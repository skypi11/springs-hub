import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';
import { downloadBuffer } from '@/lib/storage';
import {
  getReplay,
  uploadReplay as bcUploadReplay,
  isBallchasingConfigured,
  BallchasingApiError,
} from '@/lib/ballchasing';

// Sur Vercel Hobby, default = 10s : trop court pour download R2 (~2s) +
// upload ballchasing (~5-10s) + parsing (variable). On bump à 60s (max Hobby).
export const maxDuration = 60;

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
    let bcId = typeof data.ballchasingId === 'string' ? data.ballchasingId : '';

    // Si la clé n'est pas configurée : feature off, point.
    if (!isBallchasingConfigured()) {
      return NextResponse.json({ state: 'disabled' });
    }

    // Cache : si on a déjà fetché les stats avec status=ok, on les renvoie direct.
    if (data.ballchasingStats && (data.ballchasingStats as { status?: string }).status === 'ok') {
      return NextResponse.json({ state: 'ready', stats: data.ballchasingStats });
    }

    // Cas du replay finalisé AVANT que la clé ballchasing soit configurée :
    // - bcStatus === 'disabled' (figé au finalize) OU
    // - bcStatus === null (replay très ancien, antérieur à la feature)
    // Et pas de bcId. La clé est maintenant là → on lance le forward "lazy"
    // à la demande, ce qui rattrape les replays historiques sans batch admin.
    const needsLazyForward =
      !bcId && (bcStatus === null || bcStatus === 'disabled');
    if (needsLazyForward) {
      try {
        await ref.update({ ballchasingStatus: 'pending' });
        const buffer = await downloadBuffer(data.r2Key as string);
        const filename = (data.filename as string) || `${replayId}.replay`;
        const result = await bcUploadReplay(buffer, filename, { visibility: 'private' });
        await ref.update({
          ballchasingId: result.id,
          ballchasingStatus: 'uploaded',
          ballchasingUploadedAt: FieldValue.serverTimestamp(),
          ballchasingDuplicate: result.duplicate,
          ballchasingError: FieldValue.delete(),
          ballchasingErrorStatus: FieldValue.delete(),
        });
        bcId = result.id;
        // continue vers le fetch des stats juste après
      } catch (err) {
        const status = err instanceof BallchasingApiError ? err.status : 0;
        await ref.update({
          ballchasingStatus: 'failed',
          ballchasingError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          ballchasingErrorStatus: status,
        }).catch(() => {});
        return NextResponse.json({
          state: 'failed',
          error: err instanceof Error ? err.message : 'Upload ballchasing échoué',
        });
      }
    }

    if (bcStatus === 'failed') {
      return NextResponse.json({
        state: 'failed',
        error: typeof data.ballchasingError === 'string' ? data.ballchasingError : 'Upload ballchasing échoué',
      });
    }

    // Pas encore uploadé sur ballchasing ou pas d'id (upload en cours, autre tab) → pending.
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
    // Temporairement on surface le message d'erreur réel au client pour
    // faciliter le debug du flow ballchasing. Une fois stabilisé, repasser
    // sur le message générique "Erreur serveur".
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    return NextResponse.json({ error: msg, debug: true }, { status: 500 });
  }
}
