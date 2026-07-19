import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { canViewReplayStats, canTriggerParse } from '@/lib/replay-permissions';
import type { TeamRef } from '@/lib/event-permissions';
import { downloadBuffer } from '@/lib/storage';
import {
  getReplay,
  uploadReplay as bcUploadReplay,
  isBallchasingConfigured,
  BallchasingApiError,
} from '@/lib/ballchasing';
import { checkBallchasingQuota, quotaErrorMessage } from '@/lib/ballchasing-quota';

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

    const { id: slugOrId, replayId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const ref = db.collection('replays').doc(replayId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Replay introuvable' }, { status: 404 });
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Replay hors structure' }, { status: 403 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });

    // Périmètre de LECTURE des stats, scopé par jeu (§3.4) : dirigeant, staff/coach
    // scopé sur le jeu de la team, capitaine, OU joueur/sub de l'équipe. Un joueur
    // peut LIRE les stats déjà parsées de SON équipe.
    const teamId = data.teamId as string;
    const ctx = resolved.context;
    const team = resolved.teams.find(t => t.id === teamId) as TeamRef | undefined;
    if (!canViewReplayStats(ctx, teamId, team)) {
      return NextResponse.json({ error: 'Équipe hors périmètre' }, { status: 403 });
    }
    // Déclencher un parsing consomme le quota hebdo de la structure → réservé à
    // ceux qui peuvent uploader (staff + capitaine). JAMAIS un joueur simple.
    const mayTrigger = canTriggerParse(ctx, teamId);

    const bcStatus = typeof data.ballchasingStatus === 'string' ? data.ballchasingStatus : null;
    let bcId = typeof data.ballchasingId === 'string' ? data.ballchasingId : '';

    // Si la clé n'est pas configurée : feature off, point.
    if (!isBallchasingConfigured()) {
      return NextResponse.json({ state: 'disabled' });
    }

    // Cache : si on a déjà fetché les stats avec status=ok ET le bon format
    // (statsVersion 2 = inclut boost/movement/positioning/demo), on renvoie direct.
    // Les caches v1 (uniquement core) sont re-fetched depuis ballchasing.
    const cachedStats = data.ballchasingStats as { status?: string; statsVersion?: number } | undefined;
    if (cachedStats && cachedStats.status === 'ok' && cachedStats.statsVersion === 2) {
      return NextResponse.json({ state: 'ready', stats: cachedStats });
    }

    // Cas du replay finalisé AVANT que la clé ballchasing soit configurée :
    // - bcStatus === 'disabled' (figé au finalize) OU
    // - bcStatus === null (replay très ancien, antérieur à la feature)
    // Et pas de bcId. La clé est maintenant là → on lance le forward "lazy"
    // à la demande, ce qui rattrape les replays historiques sans batch admin.
    // Récupère :
    // - les replays bloqués en 'pending' sans bcId (after() a planté)
    // - les replays en 'manual' (auto-parse OFF côté structure) → le clic
    //   sur le bouton stats vaut consentement explicite à parser
    // - les replays 'disabled'/'quota_exceeded' (la clé / le quota peuvent
    //   être réglés depuis le finalize initial)
    const needsLazyForward =
      !bcId && (
        bcStatus === null ||
        bcStatus === 'disabled' ||
        bcStatus === 'quota_exceeded' ||
        bcStatus === 'pending' ||
        bcStatus === 'manual'
      );
    if (needsLazyForward) {
      // Un joueur (lecture seule) ne DÉCLENCHE aucun parsing : il consommerait le
      // quota de la structure. On renvoie juste l'état, sans rien lancer (§3.4).
      if (!mayTrigger) {
        return NextResponse.json({ state: bcStatus === 'pending' ? 'pending' : 'not_parsed' });
      }
      // Check quota AVANT de tenter le forward (évite spending API pour rien)
      const quota = await checkBallchasingQuota(db, structureId);
      if (!quota.ok) {
        await ref.update({
          ballchasingStatus: 'quota_exceeded',
          ballchasingError: quotaErrorMessage(quota.reason!),
        }).catch(() => {});
        return NextResponse.json({
          state: 'quota_exceeded',
          error: quotaErrorMessage(quota.reason!),
          quota: { used: quota.structureCount.used, limit: quota.structureCount.quota, reason: quota.reason },
        });
      }
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

    if (bcStatus === 'quota_exceeded') {
      return NextResponse.json({
        state: 'quota_exceeded',
        error: typeof data.ballchasingError === 'string' ? data.ballchasingError : 'Quota stats hebdo atteint',
      });
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
      // Stats prêtes, on cache (sans le `raw` qui peut être lourd) et on renvoie.
      // statsVersion bumpé quand le shape de `players` change pour invalider le cache.
      const cached = {
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
