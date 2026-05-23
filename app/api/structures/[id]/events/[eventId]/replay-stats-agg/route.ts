import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';
import { getReplay, isBallchasingConfigured, BallchasingApiError } from '@/lib/ballchasing';

// Sur Vercel Hobby (10s default), 5 fetch ballchasing en parallèle peuvent
// dépasser. On bump à 30s pour avoir de la marge en cas de lenteur.
export const maxDuration = 30;

// GET /api/structures/[id]/events/[eventId]/replay-stats-agg
// Renvoie les stats de TOUS les replays parsés (uploaded chez ballchasing) de
// l'event. Pour les replays uploaded mais sans cache stats v2, on fetch
// ballchasing à la demande (en parallèle) et on cache. Pour les replays dont
// ballchasing n'a pas encore fini le parsing (status=pending côté bc), on
// retourne `pendingParsingCount` pour que le client puisse re-poll.
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

    // Classifie les replays en 3 buckets :
    // - cached : déjà stats v2 en Firestore → retour direct
    // - needsFetch : uploaded sur bc (bcId présent) mais pas de cache v2 → fetch
    // - notUploaded : pas encore uploadé (pending/failed/quota/disabled) → ignoré
    type DocLite = { id: string; ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData };
    const cached: DocLite[] = [];
    const needsFetch: DocLite[] = [];
    let totalCount = 0;

    for (const d of snap.docs) {
      const data = d.data();
      if (!allowedTeamIds.has(data.teamId as string)) continue;
      totalCount++;

      const stats = data.ballchasingStats as { status?: string; statsVersion?: number } | undefined;
      const bcId = typeof data.ballchasingId === 'string' ? data.ballchasingId : '';

      if (stats && stats.status === 'ok' && stats.statsVersion === 2) {
        cached.push({ id: d.id, ref: d.ref, data });
      } else if (bcId && isBallchasingConfigured()) {
        needsFetch.push({ id: d.id, ref: d.ref, data });
      }
      // Sinon : pas encore uploadé sur bc, on n'inclut pas (le client a
      // déjà la info via le badge dans la liste replays de la modal event).
    }

    // Fetch ballchasing en parallèle pour les replays sans cache.
    // Cap dur à 10 fetch parallèles pour ne pas saturer ballchasing.
    let pendingParsingCount = 0;
    let failedFetchCount = 0;
    const fetchedReplays: DocLite[] = [];

    const toFetch = needsFetch.slice(0, 10);
    const fetchResults = await Promise.allSettled(
      toFetch.map(async d => {
        const bcId = d.data.ballchasingId as string;
        const replay = await getReplay(bcId);
        if (replay.status !== 'ok') {
          // Ballchasing pas fini de parser → on ne cache rien, le client
          // pourra re-poll plus tard.
          return { doc: d, parsedNow: false, pendingAtBc: true };
        }
        // Cache en Firestore pour les prochains appels.
        const cachedStats = {
          status: replay.status,
          statsVersion: 2,
          mapName: replay.mapName,
          mapCode: replay.mapCode,
          durationSec: replay.durationSec,
          blueGoals: replay.blueGoals,
          orangeGoals: replay.orangeGoals,
          blueName: replay.blueName,
          orangeName: replay.orangeName,
          date: replay.date,
          players: replay.players,
          fetchedAt: new Date().toISOString(),
        };
        await d.ref.update({
          ballchasingStats: cachedStats,
          ballchasingStatsUpdatedAt: FieldValue.serverTimestamp(),
        });
        // Update la data locale aussi pour le retour dans la response
        d.data.ballchasingStats = cachedStats;
        return { doc: d, parsedNow: true, pendingAtBc: false };
      })
    );

    for (const r of fetchResults) {
      if (r.status === 'fulfilled') {
        if (r.value.parsedNow) fetchedReplays.push(r.value.doc);
        else if (r.value.pendingAtBc) pendingParsingCount++;
      } else {
        if (r.reason instanceof BallchasingApiError) {
          failedFetchCount++;
        } else {
          failedFetchCount++;
          captureApiError('API replay-stats-agg ballchasing fetch', r.reason);
        }
      }
    }

    // Construit la réponse : tous les replays avec stats (cached + fresh).
    const parsedReplays = [...cached, ...fetchedReplays].map(d => ({
      replayId: d.id,
      title: (d.data.title as string) || 'Replay sans nom',
      stats: d.data.ballchasingStats,
    }));

    return NextResponse.json({
      totalCount,
      parsedCount: parsedReplays.length,
      replays: parsedReplays,
      pendingParsingCount,
      failedFetchCount,
    });
  } catch (err) {
    captureApiError('API event replay-stats-agg', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
