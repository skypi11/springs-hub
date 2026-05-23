import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaff } from '@/lib/event-permissions';
import { downloadBuffer } from '@/lib/storage';
import {
  uploadReplay as bcUploadReplay,
  isBallchasingConfigured,
  BallchasingApiError,
} from '@/lib/ballchasing';

// Sur Vercel Hobby max 60s. Avec MAX_PER_CALL=10 forwards en parallèle on tient
// largement (chacun ~5-10s, total ~10-15s en bottleneck rate-limit ballchasing).
export const maxDuration = 60;

const MAX_PER_CALL = 10;

// POST /api/structures/[id]/replays/batch-forward
// Forward tous les replays sans ballchasingId vers ballchasing en parallèle.
// Idempotent : un replay déjà uploaded est skippé. Si plus de MAX_PER_CALL
// candidats, on en traite MAX_PER_CALL et on renvoie `truncated: true` pour
// que le client puisse recliquer.
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
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    // Action de masse → réservée aux dirigeants (staff structure).
    if (!isStaff(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    if (!isBallchasingConfigured()) {
      return NextResponse.json({ error: 'BALLCHASING_API_KEY non configurée' }, { status: 503 });
    }

    // Liste des replays ready de la structure sans ballchasingId.
    const snap = await db.collection('replays')
      .where('structureId', '==', structureId)
      .where('status', '==', 'ready')
      .get();

    const candidates = snap.docs.filter(d => {
      const data = d.data();
      const bcId = typeof data.ballchasingId === 'string' ? data.ballchasingId : '';
      const bcStatus = typeof data.ballchasingStatus === 'string' ? data.ballchasingStatus : null;
      // On reforward aussi les 'failed' pour retry, mais pas les 'pending' (race condition).
      return !bcId && bcStatus !== 'pending';
    });

    const toProcess = candidates.slice(0, MAX_PER_CALL);
    const results = await Promise.allSettled(
      toProcess.map(async d => {
        const ref = d.ref;
        const data = d.data();
        await ref.update({ ballchasingStatus: 'pending' });
        try {
          const buffer = await downloadBuffer(data.r2Key as string);
          const filename = (data.filename as string) || `${d.id}.replay`;
          const result = await bcUploadReplay(buffer, filename, { visibility: 'private' });
          await ref.update({
            ballchasingId: result.id,
            ballchasingStatus: 'uploaded',
            ballchasingUploadedAt: FieldValue.serverTimestamp(),
            ballchasingDuplicate: result.duplicate,
            ballchasingError: FieldValue.delete(),
            ballchasingErrorStatus: FieldValue.delete(),
          });
          return { id: d.id, ok: true };
        } catch (err) {
          const status = err instanceof BallchasingApiError ? err.status : 0;
          await ref.update({
            ballchasingStatus: 'failed',
            ballchasingError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
            ballchasingErrorStatus: status,
          }).catch(() => {});
          return { id: d.id, ok: false, error: err instanceof Error ? err.message : 'unknown' };
        }
      })
    );

    let succeeded = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) succeeded++;
      else failed++;
    }

    return NextResponse.json({
      processed: toProcess.length,
      succeeded,
      failed,
      remaining: Math.max(0, candidates.length - toProcess.length),
      truncated: candidates.length > MAX_PER_CALL,
    });
  } catch (err) {
    captureApiError('API replays batch-forward', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
