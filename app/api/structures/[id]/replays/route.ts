import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canUploadReplay, canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { StorageKeys, generateUploadUrl, isAllowedMime, sanitizeFilename } from '@/lib/storage';

// Sérialise un Timestamp Firestore en ISO
function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

// GET /api/structures/[id]/replays?teamId=&eventId=
// Liste les replays visibles par l'utilisateur. Le staff structure voit tout.
// Le staff d'équipe / capitaine ne voit que SES équipes.
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
    const url = new URL(req.url);
    const teamId = url.searchParams.get('teamId');
    const eventId = url.searchParams.get('eventId');

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canDownloadReplay(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Détermine le périmètre visible
    const ctx = resolved.context;
    const allowedTeamIds = new Set<string>();
    if (isStaff(ctx)) {
      for (const t of resolved.teams) allowedTeamIds.add(t.id);
    } else {
      for (const id of ctx.staffedTeamIds) allowedTeamIds.add(id);
      for (const id of ctx.captainOfTeamIds ?? []) allowedTeamIds.add(id);
    }

    if (teamId && !allowedTeamIds.has(teamId)) {
      return NextResponse.json({ error: 'Équipe hors périmètre' }, { status: 403 });
    }

    let query = db.collection('replays').where('structureId', '==', structureId).where('status', '==', 'ready');
    if (teamId) query = query.where('teamId', '==', teamId);
    if (eventId) query = query.where('eventId', '==', eventId);
    // Firestore limite les where à 30 éléments sur 'in' — on re-filtre en mémoire si pas staff
    const snap = await query.get();

    const replays = snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
      .filter(r => allowedTeamIds.has(r.teamId as string))
      .map(r => ({
        ...r,
        createdAt: ts(r.createdAt),
      }));

    // Tri décroissant par date
    replays.sort((a, b) => {
      const ta = (a as { createdAt: string | null }).createdAt ?? '';
      const tb = (b as { createdAt: string | null }).createdAt ?? '';
      return tb.localeCompare(ta);
    });

    return NextResponse.json({ replays });
  } catch (err) {
    captureApiError('API replays GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/replays
// Crée un doc replay en status='pending' et retourne une URL signée R2 pour PUT direct.
// Le client fait un PUT Binary sur uploadUrl puis PATCH sur /[replayId] pour finaliser.
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
    const body = await req.json().catch(() => ({}));
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    const eventId = typeof body.eventId === 'string' && body.eventId ? body.eventId : null;
    const filename = typeof body.filename === 'string' ? body.filename : '';
    const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;
    const contentType = typeof body.contentType === 'string' ? body.contentType : 'application/octet-stream';

    if (!teamId) return NextResponse.json({ error: 'teamId requis' }, { status: 400 });
    if (!filename) return NextResponse.json({ error: 'filename requis' }, { status: 400 });
    if (sizeBytes <= 0 || sizeBytes > UPLOAD_LIMITS.REPLAY_BYTES) {
      const mb = Math.round(UPLOAD_LIMITS.REPLAY_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Taille invalide — max ${mb} MB` }, { status: 413 });
    }
    // MIME : .replay n'a pas de MIME standard, on accepte octet-stream et vide
    if (!isAllowedMime(contentType, 'REPLAYS')) {
      return NextResponse.json({ error: 'Type de fichier non supporté' }, { status: 415 });
    }

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });

    // Vérifie que l'équipe existe bien dans cette structure
    const team = resolved.teams.find(t => t.id === teamId);
    if (!team) return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });

    if (!canUploadReplay(resolved.context, teamId)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Si eventId fourni, valider : même structure, même équipe ciblée, type scrim/match
    if (eventId) {
      const evSnap = await db.collection('structure_events').doc(eventId).get();
      if (!evSnap.exists) return NextResponse.json({ error: 'Event introuvable' }, { status: 404 });
      const ev = evSnap.data()!;
      if (ev.structureId !== structureId) {
        return NextResponse.json({ error: 'Event hors structure' }, { status: 403 });
      }
      const teamIds = Array.isArray(ev.target?.teamIds) ? (ev.target.teamIds as string[]) : [];
      if (ev.target?.scope === 'teams' && !teamIds.includes(teamId)) {
        return NextResponse.json({ error: 'Équipe ne participe pas à cet event' }, { status: 400 });
      }
      if (ev.type !== 'scrim' && ev.type !== 'match') {
        return NextResponse.json({ error: 'Replays autorisés uniquement sur scrims/matchs' }, { status: 400 });
      }
    }

    // Génère le doc Firestore pending + la clé R2
    const replayRef = db.collection('replays').doc();
    const replayId = replayRef.id;
    const safe = sanitizeFilename(filename);
    const r2Key = StorageKeys.eventReplay(structureId, eventId ?? 'library', replayId);

    const initialTitle = safe.replace(/\.replay$/i, '').slice(0, 120) || 'Replay sans nom';
    await replayRef.set({
      structureId,
      teamId,
      eventId: eventId ?? null,
      uploadedBy: uid,
      filename: safe,
      sizeBytes,
      r2Key,
      status: 'pending',
      title: initialTitle,
      result: null,
      score: null,
      map: null,
      notes: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // URL signée valable 10 min pour laisser au client le temps d'uploader un 10 MB
    const uploadUrl = await generateUploadUrl(r2Key, contentType, 600);

    return NextResponse.json({ replayId, uploadUrl, r2Key });
  } catch (err) {
    captureApiError('API replays POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
