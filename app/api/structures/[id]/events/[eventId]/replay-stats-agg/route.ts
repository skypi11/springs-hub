import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';

// GET /api/structures/[id]/events/[eventId]/replay-stats-agg
// Renvoie les stats brutes (déjà cachées) de tous les replays parsés d'un event.
// Le client se charge de l'agrégation (sum/mean) pour pouvoir toggler sans
// nouvelle requête. Renvoie aussi `parsedCount` pour décider d'afficher la
// section moyenne du match (>= 2 replays parsés).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, eventId } = await params;
    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canDownloadReplay(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Liste tous les replays attachés à cet event avec stats cachées (v2).
    const snap = await db.collection('replays')
      .where('structureId', '==', structureId)
      .where('eventId', '==', eventId)
      .where('status', '==', 'ready')
      .get();

    // Filtre périmètre : staff voit tout, sinon doit avoir accès à l'équipe.
    const ctx = resolved.context;
    const allowedTeamIds = new Set<string>();
    if (isStaff(ctx)) {
      for (const t of resolved.teams) allowedTeamIds.add(t.id);
    } else {
      for (const id of ctx.staffedTeamIds) allowedTeamIds.add(id);
      for (const id of ctx.captainOfTeamIds ?? []) allowedTeamIds.add(id);
    }

    const parsedReplays: { replayId: string; title: string; stats: unknown }[] = [];
    let totalCount = 0;
    let parsedCount = 0;
    for (const d of snap.docs) {
      const data = d.data();
      if (!allowedTeamIds.has(data.teamId as string)) continue;
      totalCount++;
      const stats = data.ballchasingStats as { status?: string; statsVersion?: number } | undefined;
      if (stats && stats.status === 'ok' && stats.statsVersion === 2) {
        parsedReplays.push({
          replayId: d.id,
          title: (data.title as string) || 'Replay sans nom',
          stats,
        });
        parsedCount++;
      }
    }

    return NextResponse.json({ totalCount, parsedCount, replays: parsedReplays });
  } catch (err) {
    captureApiError('API event replay-stats-agg', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
