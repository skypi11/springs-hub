import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { runCompetitionTick } from '@/lib/competitions/tick-runner';

// Tick « jour de match » (archi §5) — déclenché par les navigateurs ouverts :
// console admin toutes les 10 s, et page de match des participants tant qu'un
// check-in ou une saisie court (le bracket reste vivant même console fermée).
// La logique vit dans lib/competitions/tick-runner : le filet planifié
// (/api/cron/competition-tick) rejoue exactement la même chose côté serveur.
//
// Authentifié + rate-limité : appelable par n'importe quel utilisateur connecté,
// jamais par un anonyme.

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const comp = compSnap.data()!;
    if (isCompetitionHidden(comp) && !(await canViewHiddenCompetition(db, uid))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const { processed, remindedTeams } = await runCompetitionTick(db, id, comp);
    return NextResponse.json({ processed, remindedTeams });
  } catch (err) {
    captureApiError('API Competitions/Tick POST error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
