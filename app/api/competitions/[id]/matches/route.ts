import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';

// GET /api/competitions/[id]/matches — matchs du bracket pour le rendu public
// (BracketView, polling). Servi par l'Admin SDK : le SDK Firestore CLIENT est
// bloqué sur ce projet (App Check / clé restreinte), et passer par l'API
// permet surtout d'appliquer le MÊME gate de visibilité que la fiche (une
// compét masquée — brouillon ou test isDev — n'expose pas son bracket).
//
// Les docs competition_matches ne portent AUCUNE donnée personnelle (archi §8) :
// on renvoie le sous-ensemble utile au bracket (équipes dénormalisées, scores,
// statut, cast). Les sous-collections privées (room, acl, dispute) ne sont
// jamais touchées ici.

interface BracketMatch {
  id: string;
  bracket: string;
  round: number;
  slot: number;
  bo: number;
  teamA: string | null;
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  teamAInfo: { name: string; tag: string; logoUrl: string | null } | null;
  teamBInfo: { name: string; tag: string; logoUrl: string | null } | null;
  // Sources publiques d'un côté (seed ou match amont) : n° de seed et clés de
  // match uniquement — aucune PII. Sert aux hints d'origine du bracket
  // (« Perdant WB 1.2 », « Seed 3 »).
  sourceA: { type: string; ref: number | string | null } | null;
  sourceB: { type: string; ref: number | string | null } | null;
  status: string;
  winner: 'a' | 'b' | null;
  scores: { final: Array<{ a: number; b: number }> | null } | null;
  forfeit: { team: 'a' | 'b' | 'both' } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const { id } = await params;
    const db = getAdminDb();

    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const comp = compSnap.data()!;

    // Gate identique à la fiche (helper partagé).
    const hidden = isCompetitionHidden(comp);
    if (hidden) {
      const uid = await verifyAuth(req);
      if (!uid || !(await canViewHiddenCompetition(db, uid))) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }

    const snap = await db.collection('competition_matches').where('competitionId', '==', id).get();
    const matches: BracketMatch[] = snap.docs.map(d => {
      const m = d.data();
      return {
        id: (m.id as string) ?? d.id,
        bracket: m.bracket ?? 'winners',
        round: m.round ?? 1,
        slot: m.slot ?? 1,
        bo: m.bo ?? 5,
        teamA: m.teamA ?? null,
        teamB: m.teamB ?? null,
        voidA: m.voidA === true,
        voidB: m.voidB === true,
        teamAInfo: m.teamAInfo ?? null,
        teamBInfo: m.teamBInfo ?? null,
        sourceA: m.sourceA ?? null,
        sourceB: m.sourceB ?? null,
        status: m.status ?? 'pending',
        winner: m.winner ?? null,
        scores: m.scores?.final ? { final: m.scores.final } : { final: null },
        forfeit: m.forfeit ? { team: m.forfeit.team } : null,
        cast: m.cast ?? null,
      };
    });

    const res = NextResponse.json({ matches });
    // Route POLLÉE par tous les spectateurs (15 s) : sans cache, un jour de
    // match à N viewers coûte N × 63 lectures Firestore / 15 s. Une compét
    // visible publiquement renvoie la MÊME réponse pour tout le monde → cache
    // CDN court : le réseau Vercel absorbe la foule, Firestore ne voit plus
    // que ~6 requêtes/min quel que soit le nombre de spectateurs. JAMAIS de
    // cache partagé sur une compét masquée (réponse réservée admins/testeurs).
    res.headers.set(
      'Cache-Control',
      hidden ? 'private, no-store' : 'public, s-maxage=10, stale-while-revalidate=30',
    );
    return res;
  } catch (err) {
    captureApiError('API Competitions/Matches GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
