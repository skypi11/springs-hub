import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';
import { getReplay, isBallchasingConfigured, BallchasingApiError } from '@/lib/ballchasing';

// GET /api/structures/[id]/replays/[replayId]/stats
// Retourne les stats parsées du replay (depuis ballchasing.com).
//
// 3 états possibles :
// - { state: 'disabled' }              → BALLCHASING_API_KEY absente (feature off)
// - { state: 'pending' }               → upload en cours ou parsing pas fini
// - { state: 'ready', stats: {...} }   → données dispos
// - { state: 'failed', error }         → erreur d'upload ou parsing (avec message)
//
// On cache les stats parsées dans le doc Firestore (`ballchasingStats`) au
// premier fetch réussi pour éviter de re-taper ballchasing à chaque ouverture
// du drawer. Le caller (client) peut poll toutes les 5-10s tant que `state`
// vaut `pending`.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; replayId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, replayId } = await params;
    const db = getAdminDb();
    const ref = db.collection('replays').doc(replayId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Replay introuvable' }, { status: 404 });
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Replay hors structure' }, { status: 403 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canDownloadReplay(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Périmètre : staff voit tout, sinon doit avoir accès à l'équipe.
    const teamId = data.teamId as string;
    const ctx = resolved.context;
    if (!isStaff(ctx)) {
      const allowed = new Set([...(ctx.staffedTeamIds ?? []), ...(ctx.captainOfTeamIds ?? [])]);
      if (!allowed.has(teamId)) {
        return NextResponse.json({ error: 'Équipe hors périmètre' }, { status: 403 });
      }
    }

    const bcStatus = typeof data.ballchasingStatus === 'string' ? data.ballchasingStatus : null;
    const bcId = typeof data.ballchasingId === 'string' ? data.ballchasingId : '';

    if (!isBallchasingConfigured() || bcStatus === 'disabled') {
      return NextResponse.json({ state: 'disabled' });
    }
    if (bcStatus === 'failed') {
      return NextResponse.json({
        state: 'failed',
        error: typeof data.ballchasingError === 'string' ? data.ballchasingError : 'Upload ballchasing échoué',
      });
    }

    // Cache : si on a déjà fetché les stats avec status=ok, on les renvoie direct.
    if (data.ballchasingStats && (data.ballchasingStats as { status?: string }).status === 'ok') {
      return NextResponse.json({ state: 'ready', stats: data.ballchasingStats });
    }

    // Pas encore uploadé sur ballchasing ou pas d'id → encore pending.
    if (!bcId || bcStatus === 'pending') {
      return NextResponse.json({ state: 'pending' });
    }

    // On a un id, on va chercher l'état actuel chez ballchasing.
    try {
      const replay = await getReplay(bcId);
      if (replay.status !== 'ok') {
        return NextResponse.json({ state: 'pending', bcStatus: replay.status });
      }
      // Stats prêtes — on cache (sans le `raw` qui peut être lourd) et on renvoie.
      const cached = {
        status: replay.status,
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
      await ref.update({
        ballchasingStats: cached,
        ballchasingStatsUpdatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ state: 'ready', stats: cached });
    } catch (err) {
      if (err instanceof BallchasingApiError) {
        return NextResponse.json({ state: 'failed', error: err.message });
      }
      throw err;
    }
  } catch (err) {
    captureApiError('API replay stats', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
