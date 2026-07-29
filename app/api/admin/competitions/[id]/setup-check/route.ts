import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { checkCompetitionSetup } from '@/lib/competitions/setup-check';
import { discordIdOfUid } from '@/lib/competitions/discord-guard';

// GET /api/admin/competitions/[id]/setup-check
// « Est-ce que tout est prêt ? » — bot présent et outillé, salons vivants,
// équipes provisionnées, joueurs joignables. Lecture seule.
//
// Sans l'intent « Server Members », chaque joueur coûte un appel Discord : la
// vérification est bornée côté lib (cap + deadline) et le rapport dit quand
// elle est partielle plutôt que de laisser croire qu'elle est complète.
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const discordUserId = discordIdOfUid(uid);
    if (!discordUserId) {
      return NextResponse.json({ error: 'Ton compte n\'est pas lié à Discord.' }, { status: 400 });
    }

    const { id } = await params;
    const report = await checkCompetitionSetup(getAdminDb(), id, discordUserId);
    return NextResponse.json({ report });
  } catch (err) {
    captureApiError('API Admin/Competitions/SetupCheck GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
