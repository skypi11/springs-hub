import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';

// GET /api/events/[eventId]/meta
// Fetch les méta d'un event (titre, type, dates, adversaire, structureId)
// pour la page dédiée /community/event/[id]/stats. Résout structureId depuis
// l'event puis vérifie via resolveUserContext que l'user y a bien accès.
//
// Endpoint léger — ne renvoie pas les replays ni les présences, juste de quoi
// afficher le header de la page stats. Pour les stats elles-mêmes, le client
// appellera /api/structures/[id]/events/[eventId]/replay-stats-agg.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { eventId } = await params;
    const db = getAdminDb();
    const snap = await db.collection('structure_events').doc(eventId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    const data = snap.data()!;
    const structureId = data.structureId as string;

    // Auth : doit avoir accès aux replays de la structure (= staff/équipe)
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    if (!canDownloadReplay(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    return NextResponse.json({
      eventId,
      structureId,
      structureName: resolved.structure.name ?? '',
      title: (data.title as string) || 'Sans titre',
      type: (data.type as string) || 'event',
      startsAt: data.startsAt?.toDate?.()?.toISOString() ?? null,
      endsAt: data.endsAt?.toDate?.()?.toISOString() ?? null,
      opponent: (data.opponent as string) || null,
      result: (data.result as string) || null,
      score: (data.score as string) || null,
    });
  } catch (err) {
    captureApiError('API event meta', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
