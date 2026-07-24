import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { reconstructBracket, type MatchDoc } from '@/lib/competitions/bracket-store';
import { engineFor, kindOf } from '@/lib/competitions/formats-server';
import { currentStageOf, stageLabelOf, stagesOf } from '@/lib/competitions/stages';
import {
  computeRoundRobinStandings,
  computeSwissStandings,
  isConcluded,
  DEFAULT_RR_POINTS,
} from '@/lib/tournament';
import type { StageResult } from '@/types/competitions';

// GET /api/competitions/[id]/standings — CLASSEMENT public d'un round robin
// ou d'un suisse (la table StandingsTable, polling avec le bracket). Même
// gate de visibilité que /matches ; le classement est recalculé serveur
// depuis les docs (source de vérité) par les fonctions PURES du moteur — la
// ranking table native du viewer est désactivée, CETTE réponse fait foi.
//
// Multi-étapes (design §9e) : une entrée PAR ÉTAPE à classement (RR/suisse)
// déjà lancée. Une étape CLOSE est servie dans l'ordre de son classement FIGÉ
// (stageResults — arbitrages admin archivés inclus), jamais un recalcul qui
// ré-afficherait des égalités déjà tranchées. Les champs plats historiques
// (kind/concluded/groups) restent servis pour l'étape courante (rétrocompat).
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

interface StageStandings {
  stage: number;
  kind: 'round_robin' | 'swiss';
  label: string;
  concluded: boolean;
  groups: Array<{ group: number; rows: StandingRow[] }>;
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

    const stages = stagesOf(comp);
    const cur = currentStageOf(comp);
    if (!stages.some(s => kindOf(s.format) === 'round_robin' || kindOf(s.format) === 'swiss')) {
      // Aucune étape à classement (élims pures) — leurs places finales
      // vivent dans finalPlacements à la clôture.
      return NextResponse.json({ error: 'no_standings' }, { status: 404 });
    }

    const snap = await db.collection('competition_matches').where('competitionId', '==', id).get();
    if (snap.empty) {
      const firstKind = kindOf(stages[0].format);
      return NextResponse.json({ kind: firstKind, concluded: false, groups: [], stages: [], currentStage: cur });
    }

    const docs = snap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ...(d.data() as MatchDoc) }));
    const withdrawn = Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [];
    const withdrawnSet = new Set(withdrawn);
    const stageResults = (Array.isArray(comp.stageResults) ? comp.stageResults : []) as StageResult[];

    // Display dérivé des docs de match (chaque équipe apparaît au moins une
    // fois avec son info dénormalisée).
    const infoOf = new Map<string, { name: string; tag: string; logoUrl: string | null }>();
    for (const m of docs) {
      if (m.teamA && m.teamAInfo && !infoOf.has(m.teamA)) infoOf.set(m.teamA, m.teamAInfo);
      if (m.teamB && m.teamBInfo && !infoOf.has(m.teamB)) infoOf.set(m.teamB, m.teamBInfo);
    }

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

    // Une étape TRANCHÉE est réordonnée selon son classement officiel : rang
    // local recalculé dans la poule, plus aucune « égalité ». Trois sources
    // d'ordre officiel, par priorité (review adversariale — la table publique
    // ne doit JAMAIS contredire le podium) :
    // 1. étape close par advance_stage : placements figés du stageResult ;
    // 2. compétition clôturée : finalPlacements (l'étape finale n'a pas de
    //    stageResult — close_competition n'en écrit pas) ;
    // 3. étape courante conclue avec arbitrages posés : placements du moteur
    //    AVEC les résolutions (même primitive que la console et la clôture).
    const applyOfficialOrder = (
      groups: Array<{ group: number; rows: StandingRow[] }>,
      placementOf: Map<string, number> | null,
    ) => {
      if (!placementOf || placementOf.size === 0) return groups;
      return groups.map(g => ({
        group: g.group,
        rows: [...g.rows]
          .sort((a, b) =>
            (placementOf.get(a.registrationId) ?? Number.MAX_SAFE_INTEGER)
            - (placementOf.get(b.registrationId) ?? Number.MAX_SAFE_INTEGER))
          .map((r, i) => ({ ...r, rank: i + 1, needsAdminTiebreak: false })),
      }));
    };
    const finished = comp.status === 'finished' || comp.status === 'archived';
    const finalPlacementOf = finished && Array.isArray(comp.finalPlacements)
      ? new Map((comp.finalPlacements as Array<{ registrationId?: string; placement?: number }>)
          .filter(p => typeof p.registrationId === 'string' && typeof p.placement === 'number')
          .map(p => [p.registrationId as string, p.placement as number]))
      : null;
    const liveResolutions = (comp.tiebreakResolutions as Record<string, string[]> | undefined) ?? {};

    const stageStandings: StageStandings[] = [];
    for (let n = 1; n <= Math.min(cur, stages.length); n++) {
      const st = stages[n - 1];
      const kind = kindOf(st.format);
      if (kind !== 'round_robin' && kind !== 'swiss') continue;
      let bracket;
      try {
        bracket = reconstructBracket({
          withdrawn,
          bo: st.format.bo,
          forfeitScore: st.format.forfeitScore ?? { games: 3, goalsPerGame: 1 },
          matches: docs,
          kind,
          swissRounds: typeof st.format?.swissRounds === 'number' ? st.format.swissRounds : undefined,
          stage: n,
        });
      } catch {
        // Étape sans docs (pas encore lancée / données partielles) : ignorée.
        continue;
      }
      const points = st.format?.points ?? DEFAULT_RR_POINTS;
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
      // Ordre officiel de l'étape, par priorité (cf. applyOfficialOrder).
      const concluded = isConcluded(bracket);
      let placementOf: Map<string, number> | null = null;
      if (n < cur) {
        const frozen = stageResults.find(r => r.stage === n);
        if (frozen) placementOf = new Map(frozen.placements.map(p => [p.registrationId, p.placement]));
      } else if (finalPlacementOf) {
        placementOf = finalPlacementOf;
      } else if (concluded && Object.keys(liveResolutions).length > 0) {
        // Étape courante conclue, arbitrages posés mais pas encore consommés
        // (advance/clôture à venir) : la table publique reflète l'arbitrage.
        const placed = engineFor(kind).computePlacements(bracket, st.format, liveResolutions);
        if (placed.length > 0 && placed.every(p => p.placement !== null && !p.needsAdminTiebreak)) {
          placementOf = new Map(placed.map(p => [p.teamId, p.placement as number]));
        }
      }
      stageStandings.push({
        stage: n,
        kind,
        label: stageLabelOf(st),
        // `concluded` : tous les matchs de l'étape terminaux — les marqueurs
        // d'égalité ne s'affichent qu'à ce moment (en cours, l'ordre fluctue
        // à chaque score, « à arbitrer » serait du bruit).
        concluded,
        groups: applyOfficialOrder(groups, placementOf),
      });
    }

    if (stageStandings.length === 0) {
      const firstKind = kindOf(stages[0].format);
      return NextResponse.json({ kind: firstKind, concluded: false, groups: [], stages: [], currentStage: cur });
    }

    // Champs plats historiques : l'étape courante si elle a un classement,
    // sinon la dernière étape à classement (fiche d'un poules→bracket).
    const flat = stageStandings.find(s => s.stage === cur) ?? stageStandings[stageStandings.length - 1];
    const res = NextResponse.json({
      kind: flat.kind,
      concluded: flat.concluded,
      groups: flat.groups,
      stages: stageStandings,
      currentStage: cur,
    });
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
