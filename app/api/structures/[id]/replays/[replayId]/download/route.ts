import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaff } from '@/lib/event-permissions';
import { generateDownloadUrl } from '@/lib/storage';

// GET /api/structures/[id]/replays/[replayId]/download
// Retourne une URL signée (60s) pour télécharger le fichier R2.
// Le nom de fichier original est restauré via ResponseContentDisposition.
//
// Périmètre d'autorisation (étendu pour fix accès joueurs aux replays
// de leur équipe + cas exercice replay_review) :
// 1. Staff structure → tout
// 2. Sinon : staff d'équipe, capitaine, OU player/sub de la team du replay
// 3. Sinon : si l'user a un todo replay_review actif (non done) ciblant
//    ce replayId, on autorise (cas où le coach assigne à un joueur d'une
//    autre équipe — rare mais légitime).
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

    const teamId = data.teamId as string;
    const ctx = resolved.context;

    // Périmètre par équipe : on autorise staff struct, staff/capitaine de
    // l'équipe, ou player/sub de l'équipe.
    let allowed = false;
    if (isStaff(ctx)) {
      allowed = true;
    } else {
      const targetTeam = resolved.teams.find(t => t.id === teamId);
      if (targetTeam) {
        const playerIds = Array.isArray(targetTeam.playerIds) ? (targetTeam.playerIds as string[]) : [];
        const subIds = Array.isArray(targetTeam.subIds) ? (targetTeam.subIds as string[]) : [];
        if (
          ctx.staffedTeamIds.includes(teamId) ||
          (ctx.captainOfTeamIds ?? []).includes(teamId) ||
          playerIds.includes(uid) ||
          subIds.includes(uid)
        ) {
          allowed = true;
        }
      }
    }

    // Fallback : exercice replay_review actif ciblant ce replay précis.
    // Permet à un joueur hors team d'accéder s'il a un todo explicite.
    if (!allowed) {
      const todoSnap = await db.collection('structure_todos')
        .where('assigneeId', '==', uid)
        .where('structureId', '==', structureId)
        .where('type', '==', 'replay_review')
        .get();
      const hasActiveTodo = todoSnap.docs.some(d => {
        const td = d.data();
        if (td.done === true) return false;
        const cfg = td.config as Record<string, unknown> | undefined;
        // Nouveau format multi-replays + compat mono-replay.
        if (Array.isArray(cfg?.replayIds) && cfg.replayIds.includes(replayId)) return true;
        if (cfg?.replayId === replayId) return true;
        return false;
      });
      if (hasActiveTodo) allowed = true;
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const url = await generateDownloadUrl(
      data.r2Key as string,
      60,
      (data.filename as string) || `${replayId}.replay`,
    );

    return NextResponse.json({ url });
  } catch (err) {
    captureApiError('API replay download', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
