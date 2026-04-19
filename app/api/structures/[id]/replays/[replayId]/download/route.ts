import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canDownloadReplay } from '@/lib/replay-permissions';
import { isStaff } from '@/lib/event-permissions';
import { generateDownloadUrl } from '@/lib/storage';

// GET /api/structures/[id]/replays/[replayId]/download
// Retourne une URL signée (60s) pour télécharger le fichier R2.
// Le nom de fichier original est restauré via ResponseContentDisposition.
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
    if (data.status !== 'ready') {
      return NextResponse.json({ error: 'Replay non finalisé' }, { status: 409 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canDownloadReplay(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Périmètre : staff structure voit tout ; staff/capitaine d'équipe voit uniquement ses équipes
    const teamId = data.teamId as string;
    const ctx = resolved.context;
    if (!isStaff(ctx)) {
      const allowed = new Set([...(ctx.staffedTeamIds ?? []), ...(ctx.captainOfTeamIds ?? [])]);
      if (!allowed.has(teamId)) {
        return NextResponse.json({ error: 'Équipe hors périmètre' }, { status: 403 });
      }
    }

    const url = await generateDownloadUrl(
      data.r2Key as string,
      60,
      (data.filename as string) || `${replayId}.replay`
    );

    return NextResponse.json({ url });
  } catch (err) {
    captureApiError('API replay download', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
