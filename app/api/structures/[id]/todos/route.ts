import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam, isDirigeant } from '@/lib/event-permissions';
import {
  validateCreateTodo,
  computeRelativeDeadlineAt,
  parisYmd,
  endOfDayParisMs,
  TODO_TYPE_META,
} from '@/lib/todos';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { postTodoEmbed, sendTodoDM } from '@/lib/discord-bot';

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
    const {
      subTeamId, assigneeIds, type, title, description, config,
      eventId,
      deadline: absoluteDeadline,
      deadlineAt: absoluteDeadlineAt,
      deadlineMode, deadlineOffsetDays,
    } = validation.value;

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

    // Event lié (optionnel) — doit appartenir à la structure.
    // Si deadlineMode='relative' on a aussi besoin de event.startsAt pour calculer la deadline concrète.
    let eventStartsAtMs: number | null = null;
    if (eventId) {
      const evSnap = await db.collection('structure_events').doc(eventId).get();
      const evData = evSnap.data();
      if (!evSnap.exists || evData?.structureId !== structureId) {
        return NextResponse.json({ error: 'Événement lié introuvable.' }, { status: 400 });
      }
      eventStartsAtMs = tsMs(evData?.startsAt);
    }

    // Résolution finale de la deadline (YMD Paris + ms epoch).
    //  - absolute → YMD fourni ; deadlineAt = fin de journée Paris de ce YMD.
    //  - relative → deadlineAt = event.startsAt + offset*24h (option A : offset=0 ⇒ au kick-off) ;
    //    deadline YMD déduit via parisYmd.
    let deadline: string | null = absoluteDeadline;
    let deadlineAt: number | null = absoluteDeadlineAt;
    if (deadlineMode === 'relative') {
      if (typeof deadlineOffsetDays !== 'number') {
        return NextResponse.json({ error: 'Offset de deadline manquant.' }, { status: 400 });
      }
      if (eventStartsAtMs === null) {
        return NextResponse.json({ error: 'Event sans date de début : deadline relative impossible.' }, { status: 400 });
      }
      deadlineAt = computeRelativeDeadlineAt(eventStartsAtMs, deadlineOffsetDays);
      deadline = parisYmd(deadlineAt);
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
        deadline,                                    // "YYYY-MM-DD" ou null (calculée si relative)
        deadlineAt,                                  // ms epoch ou null — source de vérité pour isOverdue/tri
        deadlineMode: deadlineMode ?? null,          // 'absolute' | 'relative' | null
        deadlineOffsetDays: deadlineOffsetDays ?? null,  // uniquement si mode='relative'
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

    // Notif in-app aux assignés (best-effort — on ne bloque pas la création si ça échoue).
    try {
      const typeLabel = TODO_TYPE_META[type]?.short ?? 'Devoir';
      const teamLabel = (team.name as string | undefined) ?? 'ton équipe';
      const deadlineHint = deadline ? ` (pour le ${deadline})` : '';
      const notifs: NotificationPayload[] = assigneeIds.map(uidAssignee => ({
        userId: uidAssignee,
        type: 'todo_assigned',
        title: `Nouveau devoir : ${typeLabel}`,
        message: `« ${title} » — ${teamLabel}${deadlineHint}`,
        link: '/calendar',
        metadata: { structureId, subTeamId, type, eventId, deadline },
      }));
      await createNotifications(db, notifs);
    } catch (notifErr) {
      captureApiError('API Structures/todos POST notif error', notifErr);
    }

    // Fan-out Discord (fire-and-forget) : embed dans le channel de l'équipe + DM aux assignés.
    // On ne await pas pour ne pas ralentir la réponse UI — l'UI doit pouvoir fermer le form
    // immédiatement après que le devoir soit créé en base.
    ;(async () => {
      try {
        const structureName = (resolved.structure as { name?: string }).name ?? null;
        const structureLogoUrl = (resolved.structure as { logoUrl?: string }).logoUrl ?? null;
        const teamName = (team as { name?: string }).name ?? null;
        const teamLogoUrl = (team as { logoUrl?: string }).logoUrl ?? null;
        const channelId = (team as { discordChannelId?: string }).discordChannelId;
        const siteTodoUrl = `${req.nextUrl.origin}/calendar`;

        // displayName du créateur pour le footer (best-effort — fallback silencieux).
        let createdByName: string | null = null;
        try {
          const userSnap = await db.collection('users').doc(uid).get();
          const u = userSnap.data();
          if (u) {
            createdByName = (u.displayName as string | undefined)
              ?? (u.discordUsername as string | undefined)
              ?? null;
          }
        } catch { /* ignore */ }

        // uid Springs (format `discord_SNOWFLAKE`) → snowflake Discord pour ping / DM.
        const toDiscordId = (u: string): string | null => {
          if (!u.startsWith('discord_')) return null;
          const id = u.slice('discord_'.length);
          return /^\d{5,32}$/.test(id) ? id : null;
        };
        const pingUserIds = assigneeIds
          .map(toDiscordId)
          .filter((v): v is string => !!v);

        const embedInput = {
          title,
          type,
          description: description || null,
          deadlineAtMs: deadlineAt,
          deadlineYmd: deadline,
          teamName,
          structureName,
          createdByName,
          siteTodoUrl,
          thumbnailUrl: teamLogoUrl || structureLogoUrl,
          authorIconUrl: teamLogoUrl || structureLogoUrl,
          pingUserIds,
        };

        // 1) Embed dans le channel de l'équipe si configuré.
        if (channelId) {
          try {
            const messageId = await postTodoEmbed(channelId, embedInput);
            // On log le post pour permettre un edit/delete futur (même pattern que events).
            await db.collection('structure_todos').doc(createdIds[0]).collection('discord_posts').add({
              scope: 'team_channel',
              channelId,
              messageId,
              postedAt: FieldValue.serverTimestamp(),
            });
          } catch (e) {
            captureApiError('Discord post todo failed (team channel)', e);
          }
        }

        // 2) DM à chaque assigné (best-effort — 403 est normal si DMs désactivés).
        await Promise.all(pingUserIds.map(async did => {
          const res = await sendTodoDM(did, embedInput);
          if (!res.ok) {
            // Pas un vrai "error" — on ne spam pas Sentry pour des 403 attendus.
            // On pourrait tracker par user en metadata pour faire un rapport "X ne reçoit pas les DMs".
          }
        }));
      } catch (e) {
        captureApiError('Discord fan-out todo failed', e);
      }
    })();

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
        // Legacy fallback : si doc ancien sans deadlineAt, dérive depuis YMD (fin de journée Paris).
        deadlineAt: typeof d.deadlineAt === 'number'
          ? d.deadlineAt
          : (d.deadline ? endOfDayParisMs(d.deadline) : null),
        deadlineMode: (d.deadlineMode === 'relative' || d.deadlineMode === 'absolute')
          ? d.deadlineMode
          : (d.deadline ? 'absolute' : null),
        deadlineOffsetDays: typeof d.deadlineOffsetDays === 'number' ? d.deadlineOffsetDays : null,
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
