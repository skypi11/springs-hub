import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { clampString } from '@/lib/validation';
import { canDeleteReplay, canUploadReplay } from '@/lib/replay-permissions';
import { fileExists, deleteFileSilent } from '@/lib/storage';

const ALLOWED_RESULTS = new Set(['win', 'loss', 'draw']);

// PATCH /api/structures/[id]/replays/[replayId]
// - Finalise un replay pending (status → ready après vérif que le fichier existe sur R2)
// - Met à jour les métadonnées (title, result, score, map, notes)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; replayId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, replayId } = await params;
    const body = await req.json().catch(() => ({}));

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

    // Upload permission = OK pour l'uploader original + staff d'équipe
    const isUploader = data.uploadedBy === uid;
    const hasUploadRight = canUploadReplay(resolved.context, data.teamId);
    if (!isUploader && !hasUploadRight) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

    // Finalisation : client indique que le PUT R2 est terminé
    if (body.finalize === true && data.status === 'pending') {
      const exists = await fileExists(data.r2Key as string);
      if (!exists) {
        return NextResponse.json({ error: 'Fichier absent sur R2 — upload incomplet' }, { status: 409 });
      }
      updates.status = 'ready';
    }

    if (typeof body.title === 'string') {
      updates.title = clampString(body.title, 120) || 'Replay sans nom';
    }
    if (body.result !== undefined) {
      if (body.result === null || body.result === '') updates.result = null;
      else if (typeof body.result === 'string' && ALLOWED_RESULTS.has(body.result)) updates.result = body.result;
      else return NextResponse.json({ error: 'result invalide (win|loss|draw|null)' }, { status: 400 });
    }
    if (body.score !== undefined) {
      updates.score = body.score === null ? null : clampString(String(body.score), 20);
    }
    if (body.map !== undefined) {
      updates.map = body.map === null ? null : clampString(String(body.map), 60);
    }
    if (body.notes !== undefined) {
      updates.notes = body.notes === null ? null : clampString(String(body.notes), 2000);
    }

    await ref.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API replay PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/replays/[replayId]
// Uploader ou dirigeant. Supprime le fichier R2 ET le doc Firestore.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; replayId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
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

    if (!canDeleteReplay(resolved.context, data.uploadedBy as string)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    await deleteFileSilent(data.r2Key as string);
    await ref.delete();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API replay DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
