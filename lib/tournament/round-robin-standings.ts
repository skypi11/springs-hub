// Classement d'un ROUND ROBIN — module DÉDIÉ (pas dans placements.ts, dont
// championOf/eliminationGroups sont intrinsèquement « élimination »). PUR.
//
// Intra-poule (tout le monde y joue le même nombre de matchs, stats brutes
// comparables) : points → MINI-CHAMPIONNAT entre ex æquo (points recalculés
// sur les seuls matchs entre eux — la « confrontation directe » généralisée
// à N équipes) → diff de manches → diff de buts → buts marqués → arbitrage
// admin (`needsAdminTiebreak`, ordre provisoire déterministe par id).
//
// Inter-poules (compression 1→N pour le barème circuit) : le RANG DANS SA
// POULE est le critère primaire — insensible aux tailles de poules. Les
// équipes de même rang sont départagées par des valeurs PAR MATCH (points/
// match, délta normalisé, buts/match — philosophie de `normalizedDiff`,
// archi §3 : des poules de tailles différentes restent comparables). Le
// face-à-face n'existe pas entre poules ; égalité stricte → arbitrage admin.
//
// Fin de tournoi : `isConcluded` (tous les matchs terminaux) — JAMAIS
// `championOf` (aucun match décisif en round robin). La numérotation 1→N
// n'existe que sur un round robin conclu, comme pour les arbres.

import type { Bracket, Placement, PureMatch } from './types';
import { computeTeamStats, isConcluded } from './placements';

/** Barème de points d'un match de poule. `draw` est prêt pour les jeux à
 *  match nul (aucun chemin de nul dans le moteur RL actuel — BO impair). */
export interface RoundRobinPoints {
  win: number;
  draw: number;
  loss: number;
}

export const DEFAULT_RR_POINTS: RoundRobinPoints = { win: 3, draw: 1, loss: 0 };

export interface PoolStandingRow {
  teamId: string;
  /** Poule 1-based. */
  group: number;
  /** Rang dans la poule (1-based). Provisoire si `needsAdminTiebreak`. */
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  needsAdminTiebreak: boolean;
}

// ── Agrégation par équipe ───────────────────────────────────────────────────

interface TeamLine {
  teamId: string;
  group: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gamesWon: number;
  gamesLost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
}

function assertRoundRobin(bracket: Bracket): void {
  if (bracket.kind !== 'round_robin') {
    throw new Error(`Bracket ${bracket.kind} : classement de poule réservé au round robin.`);
  }
}

/** Matchs de poule comptés pour une équipe : `completed` avec le flag
 *  `statsCount` de son côté (forfait simple compté, retiré post-retrait figé
 *  — mêmes règles que les buts, spec §11/R5-4). Walkovers exclus partout
 *  (pas un match joué). */
function countsFor(m: PureMatch, side: 'a' | 'b'): boolean {
  if (m.status !== 'completed') return false;
  return side === 'a' ? m.statsCountA : m.statsCountB;
}

function buildLines(bracket: Bracket, points: RoundRobinPoints): Map<string, TeamLine> {
  const lines = new Map<string, TeamLine>();
  const stats = computeTeamStats(bracket); // buts (gère forfaits/statsCount)

  // Poule de chaque équipe — dérivée des matchs (chaque équipe joue dans
  // exactement une poule par construction).
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket !== 'round_robin' || m.group === undefined) continue;
    for (const side of ['a', 'b'] as const) {
      const teamId = side === 'a' ? m.teamA : m.teamB;
      if (!teamId || lines.has(teamId)) continue;
      const st = stats.get(teamId);
      lines.set(teamId, {
        teamId,
        group: m.group,
        played: 0, wins: 0, draws: 0, losses: 0, points: 0,
        gamesWon: 0, gamesLost: 0,
        goalsFor: st?.goalsFor ?? 0,
        goalsAgainst: st?.goalsAgainst ?? 0,
        goalDiff: st?.goalDiff ?? 0,
      });
    }
  }

  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket !== 'round_robin' || m.status !== 'completed') continue;

    // Manches par camp. Double forfait (scores null, R5-1) : aucun gain,
    // ceil(bo/2) manches concédées chacun — miroir de computeTeamStats qui
    // inflige le délta conventionnel négatif aux deux camps.
    let gamesA = 0;
    let gamesB = 0;
    if (m.scores) {
      for (const g of m.scores) {
        if (g.a > g.b) gamesA += 1; else gamesB += 1;
      }
    }
    const bothForfeitGames = m.forfeit === 'both' ? Math.ceil(m.bo / 2) : 0;

    for (const side of ['a', 'b'] as const) {
      const teamId = side === 'a' ? m.teamA : m.teamB;
      if (!teamId || !countsFor(m, side)) continue;
      const line = lines.get(teamId);
      if (!line) continue;
      line.played += 1;
      if (m.forfeit === 'both') {
        line.losses += 1;
        line.points += points.loss;
        line.gamesLost += bothForfeitGames;
        continue;
      }
      if (m.winner === side) {
        line.wins += 1;
        line.points += points.win;
      } else if (m.winner !== null) {
        line.losses += 1;
        line.points += points.loss;
      } else {
        // Théorique (aucun chemin de nul en RL) — gardé pour la généricité.
        line.draws += 1;
        line.points += points.draw;
      }
      line.gamesWon += side === 'a' ? gamesA : gamesB;
      line.gamesLost += side === 'a' ? gamesB : gamesA;
    }
  }

  return lines;
}

// ── Tri intra-poule ─────────────────────────────────────────────────────────

/** Points d'une équipe sur les seuls matchs comptés contre les équipes de
 *  `subset` (mini-championnat des ex æquo). */
function miniLeaguePoints(
  bracket: Bracket,
  points: RoundRobinPoints,
  teamId: string,
  subset: Set<string>,
): number {
  let total = 0;
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket !== 'round_robin' || m.status !== 'completed') continue;
    const side: 'a' | 'b' | null = m.teamA === teamId ? 'a' : m.teamB === teamId ? 'b' : null;
    if (!side) continue;
    const opponent = side === 'a' ? m.teamB : m.teamA;
    if (!opponent || !subset.has(opponent)) continue;
    if (!countsFor(m, side)) continue;
    if (m.forfeit === 'both') { total += points.loss; continue; }
    if (m.winner === side) total += points.win;
    else if (m.winner !== null) total += points.loss;
    else total += points.draw;
  }
  return total;
}

interface RankedLine extends TeamLine {
  needsAdminTiebreak: boolean;
  /** Index 0-based (dans la poule triée) du DÉBUT du bloc de cette équipe :
   *  son propre index si son rang est net, l'index de la première équipe du
   *  paquet si l'égalité est irrésolue. Source de vérité des blocs de rang
   *  pour la compression inter-poules — jamais re-deviné depuis les stats. */
  blockStart: number;
}

/** Ordonne une poule. Renvoie les lignes dans l'ordre final + le flag de
 *  départage par équipe (paquets d'égalité stricte irrésolus). */
function rankPool(bracket: Bracket, points: RoundRobinPoints, pool: TeamLine[]): RankedLine[] {
  // Ordre de base déterministe (avant mini-league) : points puis critères
  // globaux puis id.
  const base = [...pool].sort((x, y) =>
    y.points - x.points ||
    (y.gamesWon - y.gamesLost) - (x.gamesWon - x.gamesLost) ||
    y.goalDiff - x.goalDiff ||
    y.goalsFor - x.goalsFor ||
    x.teamId.localeCompare(y.teamId));

  const result: RankedLine[] = [];
  let i = 0;
  while (i < base.length) {
    // Paquet à égalité de POINTS.
    let j = i + 1;
    while (j < base.length && base[j].points === base[i].points) j += 1;
    const pack = base.slice(i, j);

    if (pack.length === 1) {
      result.push({ ...pack[0], needsAdminTiebreak: false, blockStart: result.length });
      i = j;
      continue;
    }

    // Mini-championnat : points recalculés sur les matchs entre ex æquo.
    const subset = new Set(pack.map(l => l.teamId));
    const mini = new Map(pack.map(l => [l.teamId, miniLeaguePoints(bracket, points, l.teamId, subset)]));
    const key = (l: TeamLine) => ({
      mini: mini.get(l.teamId) ?? 0,
      gameDiff: l.gamesWon - l.gamesLost,
      goalDiff: l.goalDiff,
      goalsFor: l.goalsFor,
    });
    const sortedPack = [...pack].sort((x, y) => {
      const kx = key(x);
      const ky = key(y);
      return ky.mini - kx.mini || ky.gameDiff - kx.gameDiff ||
        ky.goalDiff - kx.goalDiff || ky.goalsFor - kx.goalsFor ||
        x.teamId.localeCompare(y.teamId);
    });

    // Sous-paquets encore à égalité STRICTE sur tous les critères → arbitrage.
    let a = 0;
    while (a < sortedPack.length) {
      let b = a + 1;
      const ka = key(sortedPack[a]);
      while (b < sortedPack.length) {
        const kb = key(sortedPack[b]);
        if (kb.mini !== ka.mini || kb.gameDiff !== ka.gameDiff ||
            kb.goalDiff !== ka.goalDiff || kb.goalsFor !== ka.goalsFor) break;
        b += 1;
      }
      const unresolved = b - a > 1;
      const blockStart = result.length;
      for (let k = a; k < b; k++) {
        result.push({ ...sortedPack[k], needsAdminTiebreak: unresolved, blockStart });
      }
      a = b;
    }
    i = j;
  }
  return result;
}

// ── API publique ────────────────────────────────────────────────────────────

/** Poules classées : poule (1-based) → lignes dans l'ordre final, avec blocs. */
function rankAllPools(
  bracket: Bracket,
  points: RoundRobinPoints,
): Map<number, RankedLine[]> {
  const lines = buildLines(bracket, points);
  const byPool = new Map<number, TeamLine[]>();
  for (const line of lines.values()) {
    const arr = byPool.get(line.group) ?? [];
    arr.push(line);
    byPool.set(line.group, arr);
  }
  const out = new Map<number, RankedLine[]>();
  for (const g of [...byPool.keys()].sort((a, b) => a - b)) {
    out.set(g, rankPool(bracket, points, byPool.get(g)!));
  }
  return out;
}

/** Classement de toutes les poules, lignes triées (poule croissante puis rang). */
export function computeRoundRobinStandings(
  bracket: Bracket,
  points: RoundRobinPoints = DEFAULT_RR_POINTS,
): PoolStandingRow[] {
  assertRoundRobin(bracket);
  const rows: PoolStandingRow[] = [];
  for (const [g, ranked] of rankAllPools(bracket, points)) {
    ranked.forEach((line, idx) => {
      rows.push({
        teamId: line.teamId,
        group: g,
        rank: idx + 1,
        played: line.played,
        wins: line.wins,
        draws: line.draws,
        losses: line.losses,
        points: line.points,
        gamesWon: line.gamesWon,
        gamesLost: line.gamesLost,
        gameDiff: line.gamesWon - line.gamesLost,
        goalsFor: line.goalsFor,
        goalsAgainst: line.goalsAgainst,
        goalDiff: line.goalDiff,
        needsAdminTiebreak: line.needsAdminTiebreak,
      });
    });
  }
  return rows;
}

/**
 * Placements COMPRESSÉS 1→N d'un round robin, même contrat que
 * `computePlacements` (placements.ts) : `placement` numéroté UNIQUEMENT sur
 * un bracket conclu (sinon null), groupes + flags fiables en cours de poule,
 * `tiebreakResolutions` par clé de groupe (appliquée seulement si le
 * départage automatique a échoué ET qu'elle couvre exactement le groupe).
 *
 * Groupes de placement `rank{K}` : le bloc d'équipes occupant les rangs
 * K..K+len−1 de sa poule (bloc de 1 si le rang est net ; paquet entier au
 * MEILLEUR rang commun si l'égalité intra-poule est irrésolue). Les blocs de
 * même rang de toutes les poules fusionnent, départagés par valeurs PAR
 * MATCH (tailles de poules potentiellement inégales).
 */
export function computeRoundRobinPlacements(
  bracket: Bracket,
  points: RoundRobinPoints = DEFAULT_RR_POINTS,
  tiebreakResolutions?: Record<string, string[]>,
): Placement[] {
  assertRoundRobin(bracket);
  const finished = isConcluded(bracket);

  // Blocs intra-poule : `blockStart` (posé par rankPool, jamais re-deviné)
  // regroupe chaque paquet irrésolu au MEILLEUR rang commun ; une équipe au
  // rang net forme un bloc de 1. Les blocs de même rang de toutes les poules
  // fusionnent dans le groupe `rank{K}` (K = blockStart + 1).
  interface Entry { row: RankedLine; blockFlagged: boolean }
  const groups = new Map<number, Entry[]>(); // rangStart 1-based → entrées
  for (const ranked of rankAllPools(bracket, points).values()) {
    for (const line of ranked) {
      const rankStart = line.blockStart + 1;
      const arr = groups.get(rankStart) ?? [];
      arr.push({ row: line, blockFlagged: line.needsAdminTiebreak });
      groups.set(rankStart, arr);
    }
  }

  const teamStats = computeTeamStats(bracket);
  const placements: Placement[] = [];
  let nextPlace = 1;

  for (const rankStart of [...groups.keys()].sort((a, b) => a - b)) {
    const entries = groups.get(rankStart)!;
    const groupKey = `rank${rankStart}`;

    // Départage inter-poules par valeurs PAR MATCH.
    const perMatch = (e: Entry) => {
      const st = teamStats.get(e.row.teamId);
      const played = e.row.played || 1;
      return {
        points: e.row.points / played,
        diff: st?.normalizedDiff ?? 0,
        goals: e.row.goalsFor / played,
      };
    };
    const sorted = [...entries].sort((x, y) => {
      const kx = perMatch(x);
      const ky = perMatch(y);
      return ky.points - kx.points || ky.diff - kx.diff || ky.goals - kx.goals ||
        x.row.teamId.localeCompare(y.row.teamId);
    });

    // Flags : paquet intra-poule irrésolu (propagé), ou égalité stricte
    // per-match entre équipes du groupe (pas de face-à-face inter-poules).
    const flags = sorted.map(e => e.blockFlagged);
    let a = 0;
    while (a < sorted.length) {
      let b = a + 1;
      const ka = perMatch(sorted[a]);
      while (b < sorted.length) {
        const kb = perMatch(sorted[b]);
        if (kb.points !== ka.points || kb.diff !== ka.diff || kb.goals !== ka.goals) break;
        b += 1;
      }
      if (b - a > 1) for (let k = a; k < b; k++) flags[k] = true;
      a = b;
    }

    const engineRanked = sorted.map((e, idx) => ({
      teamId: e.row.teamId,
      needsAdminTiebreak: flags[idx],
    }));
    // Même sémantique de résolution que computePlacements : uniquement si le
    // départage automatique a échoué, et couverture EXACTE du groupe.
    const resolution = tiebreakResolutions?.[groupKey];
    const groupTeamIds = engineRanked.map(r => r.teamId);
    const resolutionValid = !!resolution
      && engineRanked.some(r => r.needsAdminTiebreak)
      && resolution.length === groupTeamIds.length
      && groupTeamIds.every(t => resolution.includes(t));
    const ranked = resolutionValid
      ? resolution!.map(teamId => ({ teamId, needsAdminTiebreak: false }))
      : engineRanked;

    for (const r of ranked) {
      placements.push({
        teamId: r.teamId,
        placement: finished ? nextPlace : null,
        group: groupKey,
        needsAdminTiebreak: r.needsAdminTiebreak,
      });
      nextPlace += 1;
    }
  }
  return placements;
}
