import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam, isDirigeant } from '@/lib/event-permissions';
import { validateCreateTodo } from '@/lib/todos';

// Sérialise un timestamp Firestore en ms epoch (plus simple à manipuler côté client pour trier).
function tsMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

// POST /api/structures/[id]/todos — créer un devoir (batch : 1 doc par assignee)
// Accessible : staff d'équipe (fondateur/co-fondateur/manager/coach de la sous-équipe cible).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const validation = validateCreateTodo(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { subTeamId, assigneeIds, type, title, description, config, eventId, deadline } = validation.value;

    // Équipe existe et appartient à la structure
    const team = resolved.teams.find(t => t.id === subTeamId);
    if (!team) {
      return NextResponse.json({ error: 'Équipe introuvable dans cette structure.' }, { status: 404 });
    }

    // Permission : staff de l'équipe cible
    if (!isStaffOfTeam(resolved.context, subTeamId)) {
      return NextResponse.json({ error: 'Permissions insuffisantes pour cette équipe.' }, { status: 403 });
    }

    // Tous les assignees doivent faire partie de l'équipe (player/sub/staff)
    const teamMemberIds = new Set<string>([
      ...((team.playerIds as string[]) ?? []),
      ...((team.subIds as string[]) ?? []),
      ...((team.staffIds as string[]) ?? []),
    ]);
    const invalid = assigneeIds.filter(id => !teamMemberIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: 'Un ou plusieurs joueurs ne font pas partie de cette équipe.' }, { status: 400 });
    }

    // Event lié (optionnel) — doit appartenir à la structure
    if (eventId) {
      const evSnap = await db.collection('structure_events').doc(eventId).get();
      if (!evSnap.exists || evSnap.data()?.structureId !== structureId) {
        return NextResponse.json({ error: 'Événement lié introuvable.' }, { status: 400 });
      }
    }

    // Création atomique : 1 doc par assignee
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    const createdIds: string[] = [];
    for (const assigneeId of assigneeIds) {
      const ref = db.collection('structure_todos').doc();
      batch.set(ref, {
        structureId,
        subTeamId,
        assigneeId,
        type,
        title,
        description,
        config,      // objet validé selon type — voir validateTodoConfig
        response: null,
        eventId,
        deadline,  // "YYYY-MM-DD" ou null
        done: false,
        doneAt: null,
        doneBy: null,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      });
      createdIds.push(ref.id);
    }
    await batch.commit();

    return NextResponse.json({ success: true, ids: createdIds, count: createdIds.length });
  } catch (err) {
    captureApiError('API Structures/todos POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/structures/[id]/todos?subTeamId=X&status=pending|done|all
// Renvoie la liste des devoirs d'une sous-équipe (staff only).
// Dirigeants (fondateur/co-fondateur) voient toutes les équipes ;
// staff/coach/manager voient uniquement les équipes dont ils sont staff.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const subTeamId = req.nextUrl.searchParams.get('subTeamId');
    const statusFilter = (req.nextUrl.searchParams.get('status') ?? 'all') as 'pending' | 'done' | 'all';
    if (!subTeamId) {
      return NextResponse.json({ error: 'subTeamId requis.' }, { status: 400 });
    }

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    // Équipe existe
    const team = resolved.teams.find(t => t.id === subTeamId);
    if (!team) {
      return NextResponse.json({ error: 'Équipe introuvable dans cette structure.' }, { status: 404 });
    }

    // Permission : staff de l'équipe (dirigeant OU staff rattaché à l'équipe)
    if (!isStaffOfTeam(resolved.context, subTeamId)) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
    }

    // Query : on prend tous les todos de la sous-équipe puis on filtre `done` en mémoire
    // (évite un index composite subTeamId+done+createdAt).
    const snap = await db.collection('structure_todos')
      .where('subTeamId', '==', subTeamId)
      .limit(500)
      .get();

    const todos = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        structureId: d.structureId,
        subTeamId: d.subTeamId,
        assigneeId: d.assigneeId,
        type: (typeof d.type === 'string' && d.type) ? d.type : 'free',
        title: d.title ?? '',
        description: d.description ?? '',
        config: (d.config && typeof d.config === 'object') ? d.config : {},
        response: (d.response && typeof d.response === 'object') ? d.response : null,
        eventId: d.eventId ?? null,
        deadline: d.deadline ?? null,
        done: !!d.done,
        doneAt: tsMs(d.doneAt),
        doneBy: d.doneBy ?? null,
        createdBy: d.createdBy,
        createdAt: tsMs(d.createdAt) ?? 0,
      };
    }).filter(t => {
      if (statusFilter === 'pending') return !t.done;
      if (statusFilter === 'done') return t.done;
      return true;
    });

    return NextResponse.json({
      todos,
      canCreate: isStaffOfTeam(resolved.context, subTeamId),
      isDirigeant: isDirigeant(resolved.context),
    });
  } catch (err) {
    captureApiError('API Structures/todos GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
