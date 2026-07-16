// Classement d'un circuit — fonction PURE (aucun I/O), testée. Réutilisée par
// l'API de la page circuit (Lot 2) et le calcul de la cutline LAN (Lot 4).
//
// Règles (spec Legends §1 & §11) :
// - Total = somme des `bestResultsCount` MEILLEURS résultats de l'équipe (points).
//   En cas d'égalité de points entre participations pour choisir lesquelles
//   retenir, on garde celles au meilleur délta (favorable à l'équipe, déterministe).
// - Départage (dans l'ordre `tieBreakers`, spec §11) :
//     best_placement  → meilleur placement unique du circuit (min, toutes participations)
//     goal_diff_total → délta cumulé sur les Qualifs COMPTABILISÉS (les retenus)
//     latest_event    → placement au Qualif le plus récent joué par l'équipe
// - Cutline : les `lanTeamCount` premières sont qualifiées pour la LAN.

export interface StandingParticipation {
  competitionId: string;
  placement: number;   // place compressée 1→N
  points: number;
  goalDiff: number;    // délta normalisé du Qualif
  goalsFor: number;
}

export interface StandingTeam {
  id: string;
  name: string;
  tag: string;
  participations: StandingParticipation[];
}

export interface CircuitStandingRow {
  teamId: string;
  name: string;
  tag: string;
  totalPoints: number;
  playedCount: number;         // nb de Qualifs joués
  countedCount: number;        // nb de résultats retenus (≤ bestResultsCount)
  bestPlacement: number | null;
  goalDiffCounted: number;     // délta cumulé sur les résultats retenus
  qualifiedForLan: boolean;
  rank: number;                // 1-based
}

export interface CircuitStandingsConfig {
  competitionIds: string[];    // ordre chronologique — pour « le Qualif le plus récent »
  bestResultsCount: number;
  lanTeamCount: number;
  tieBreakers: string[];
}

// Index chronologique d'une participation (plus grand = plus récent). Une
// participation hors de competitionIds (edge) est considérée la plus ancienne.
function chronoIndex(competitionIds: string[], competitionId: string): number {
  return competitionIds.indexOf(competitionId);
}

export function computeCircuitStandings(
  config: CircuitStandingsConfig,
  teams: StandingTeam[],
): CircuitStandingRow[] {
  const bestN = Math.max(1, config.bestResultsCount || 1);
  // Ne comptent QUE les participations rattachées à une compétition du circuit
  // passé en config. L'appelant décide de la liste : pour un visiteur public il
  // transmet les competitionIds VISIBLES (sans les Qualifs masquées), ce qui
  // exclut d'office leurs résultats du classement — même gate que le parcours.
  const inCircuit = new Set(config.competitionIds);

  const rows = teams
    .map(t => ({ team: t, parts: t.participations.filter(p => inCircuit.has(p.competitionId)) }))
    .filter(({ parts }) => parts.length > 0)
    .map(({ team, parts }) => {
      // Résultats retenus : les bestN meilleurs par points, délta en départage.
      const sorted = [...parts].sort((a, b) =>
        b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
      const counted = sorted.slice(0, bestN);
      const totalPoints = counted.reduce((s, p) => s + p.points, 0);
      const goalDiffCounted = counted.reduce((s, p) => s + p.goalDiff, 0);
      const bestPlacement = parts.reduce<number | null>(
        (min, p) => (min === null || p.placement < min ? p.placement : min), null);
      // Placement au Qualif le plus récent joué par l'équipe.
      const latest = [...parts].sort((a, b) =>
        chronoIndex(config.competitionIds, b.competitionId) - chronoIndex(config.competitionIds, a.competitionId))[0];
      return {
        team,
        totalPoints,
        goalDiffCounted,
        bestPlacement,
        latestPlacement: latest.placement,
        playedCount: parts.length,
        countedCount: counted.length,
      };
    });

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    for (const tb of config.tieBreakers) {
      if (tb === 'best_placement') {
        const av = a.bestPlacement ?? Number.POSITIVE_INFINITY;
        const bv = b.bestPlacement ?? Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;              // plus petit placement = mieux
      } else if (tb === 'goal_diff_total') {
        if (b.goalDiffCounted !== a.goalDiffCounted) return b.goalDiffCounted - a.goalDiffCounted;
      } else if (tb === 'latest_event') {
        if (a.latestPlacement !== b.latestPlacement) return a.latestPlacement - b.latestPlacement;
      }
    }
    // Départage final stable (spec §11 : sinon décision admin) — par nom.
    return a.team.name.localeCompare(b.team.name);
  });

  return rows.map((r, i) => ({
    teamId: r.team.id,
    name: r.team.name,
    tag: r.team.tag,
    totalPoints: r.totalPoints,
    playedCount: r.playedCount,
    countedCount: r.countedCount,
    bestPlacement: r.bestPlacement,
    goalDiffCounted: r.goalDiffCounted,
    qualifiedForLan: i < config.lanTeamCount,
    rank: i + 1,
  }));
}
