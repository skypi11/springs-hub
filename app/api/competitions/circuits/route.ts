import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCircuitHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';

// GET /api/competitions/circuits — liste publique des circuits Aedral natifs,
// point d'entrée de /competitions. Un circuit en brouillon (dont le circuit de
// test) n'est renvoyé qu'aux testeurs autorisés (feature gating). Résumé léger :
// la fiche circuit (/api/competitions/circuit/[id]) porte le détail.
export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    const uid = await verifyAuth(req);
    const isViewer = uid ? await canViewHiddenCompetition(db, uid) : false;

    const snap = await db.collection('circuits').get();
    const circuits = snap.docs
      .map(d => {
        const c = d.data();
        return {
          id: d.id,
          name: (c.name as string) ?? '',
          game: (c.game as string) ?? 'rocket_league',
          status: (c.status as string) ?? 'draft',
          hidden: isCircuitHidden(c),
          eventCount: Array.isArray(c.competitionIds) ? c.competitionIds.length : 0,
          lanTeamCount: (c.lanTeamCount as number) ?? 0,
          prizePool: c.prizePool ?? null,
          createdAt: c.createdAt?.toDate?.()?.toISOString() ?? null,
        };
      })
      .filter(c => isViewer || !c.hidden)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ circuits });
  } catch (err) {
    captureApiError('API Competitions/Circuits GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
