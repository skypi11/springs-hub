import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { reconstructBracket, type MatchDoc } from '@/lib/competitions/bracket-store';
import { kindOf } from '@/lib/competitions/formats-server';
import {
  computeRoundRobinStandings,
  computeSwissStandings,
  DEFAULT_RR_POINTS,
} from '@/lib/tournament';

// GET /api/competitions/[id]/standings — CLASSEMENT public d'un round robin
// ou d'un suisse (la table StandingsTable, polling avec le bracket). Même
// gate de visibilité que /matches ; le classement est recalculé serveur
// depuis les docs (source de vérité) par les fonctions PURES du moteur — la
// ranking table native du viewer est désactivée, CETTE réponse fait foi.
//
// Aucune PII : registrationId + nom/tag/logo dénormalisés (déjà publics sur
// les matchs — le display est d'ailleurs DÉRIVÉ des docs de match, zéro
// lecture supplémentaire). Cache CDN identique à /matches (s-maxage 10 s).

interface StandingRow {
  registrationId: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  points: number;
  gameDiff: number;
  goalDiff: number;
  /** Suisse uniquement. */
  buchholz?: number;
  byes?: number;
  needsAdminTiebreak: boolean;
  withdrawn: boolean;
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

    const hidden = isCompetitionHidden(comp);
    if (hidden) {
      const uid = await verifyAuth(req);
      if (!uid || !(await canViewHiddenCompetition(db, uid))) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }

    const kind = kindOf(comp.format);
    if (kind !== 'round_robin' && kind !== 'swiss') {
      // Les élims n'ont pas de classement en cours — leurs places finales
      // vivent dans finalPlacements à la clôture.
      return NextResponse.json({ error: 'no_standings' }, { status: 404 });
    }

    const snap = await db.collection('competition_matches').where('competitionId', '==', id).get();
    if (snap.empty) {
      return NextResponse.json({ kind, groups: [] });
    }

    const docs = snap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ...(d.data() as MatchDoc) }));
    const withdrawn = Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [];
    const bracket = reconstructBracket({
      withdrawn,
      bo: comp.format.bo,
      forfeitScore: comp.format.forfeitScore ?? { games: 3, goalsPerGame: 1 },
      matches: docs,
      kind,
      swissRounds: typeof comp.format?.swissRounds === 'number' ? comp.format.swissRounds : undefined,
    });

    // Display dérivé des docs de match (chaque équipe apparaît au moins une
    // fois avec son info dénormalisée).
    const infoOf = new Map<string, { name: string; tag: string; logoUrl: string | null }>();
    for (const m of docs) {
      if (m.teamA && m.teamAInfo && !infoOf.has(m.teamA)) infoOf.set(m.teamA, m.teamAInfo);
      if (m.teamB && m.teamBInfo && !infoOf.has(m.teamB)) infoOf.set(m.teamB, m.teamBInfo);
    }
    const withdrawnSet = new Set(withdrawn);
    const points = comp.format?.points ?? DEFAULT_RR_POINTS;

    const toRow = (r: {
      teamId: string; rank: number; played: number; wins: number; losses: number;
      points: number; gameDiff: number; goalDiff: number; needsAdminTiebreak: boolean;
      buchholz?: number; byes?: number;
    }): StandingRow => {
      const info = infoOf.get(r.teamId);
      return {
        registrationId: r.teamId,
        name: info?.name ?? 'Équipe',
        tag: info?.tag ?? '',
        logoUrl: info?.logoUrl ?? null,
        rank: r.rank,
        played: r.played,
        wins: r.wins,
        losses: r.losses,
        points: r.points,
        gameDiff: r.gameDiff,
        goalDiff: r.goalDiff,
        ...(r.buchholz !== undefined ? { buchholz: r.buchholz } : {}),
        ...(r.byes !== undefined ? { byes: r.byes } : {}),
        needsAdminTiebreak: r.needsAdminTiebreak,
        withdrawn: withdrawnSet.has(r.teamId),
      };
    };

    let groups: Array<{ group: number; rows: StandingRow[] }>;
    if (kind === 'round_robin') {
      const rows = computeRoundRobinStandings(bracket, points);
      const byGroup = new Map<number, StandingRow[]>();
      for (const r of rows) {
        const arr = byGroup.get(r.group) ?? [];
        arr.push(toRow(r));
        byGroup.set(r.group, arr);
      }
      groups = [...byGroup.keys()].sort((a, b) => a - b)
        .map(g => ({ group: g, rows: byGroup.get(g)! }));
    } else {
      groups = [{ group: 1, rows: computeSwissStandings(bracket, points).map(toRow) }];
    }

    const res = NextResponse.json({ kind, groups });
    // Même politique de cache que /matches : le CDN absorbe les spectateurs.
    res.headers.set(
      'Cache-Control',
      hidden ? 'private, no-store' : 'public, s-maxage=10, stale-while-revalidate=30',
    );
    return res;
  } catch (err) {
    captureApiError('API Competitions/Standings GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
