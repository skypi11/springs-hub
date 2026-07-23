// Classement SYSTÈME SUISSE — module DÉDIÉ, PUR (docs/registry-formats-design.md §8).
//
// Classement GLOBAL (pas de poules) : points → BUCHHOLZ (somme des points
// finaux des adversaires réellement rencontrés — la « force du calendrier »,
// LE départage suisse) → mini-championnat entre ex æquo (confrontations
// directes du sous-ensemble) → diff de manches → diff de buts → buts marqués
// → arbitrage admin (`needsAdminTiebreak`, ordre provisoire déterministe).
//
// ⚠️ BYE : une victoire par WALKOVER (côté void — bye d'appariement, ou
// siège vidé) VAUT les points d'une victoire, compte comme ronde jouée, mais
// n'apporte NI stats de manches/buts NI adversaire au Buchholz. Sémantique
// DIFFÉRENTE du round robin (où un walkover est exclu du classement) : au
// suisse, le bye est un événement NORMAL du format, pas un accident.
//
// R5-4 : une équipe RETIRÉE garde ses points acquis mais ne gagne jamais un
// départage — à points égaux elle passe derrière les non-retirées.
//
// Fin de tournoi : tous les matchs terminaux ET toutes les rondes générées
// (`bracket.swissRounds` — absent : jamais fini, fail-safe bruyant plutôt
// qu'une clôture prématurée après la ronde 1).

import type { Bracket, Placement, PureMatch } from './types';
import { computeTeamStats, isConcluded } from './placements';
import { DEFAULT_RR_POINTS, type RoundRobinPoints } from './round-robin-standings';
// Import croisé swiss ↔ swiss-standings assumé : résolu à l'APPEL uniquement
// (aucune exécution top-level dans les deux modules) — ESM le supporte.
import { isSwissStuck } from './swiss';

export interface SwissStandingRow {
  teamId: string;
  /** Rang global (1-based). Provisoire si `needsAdminTiebreak`. */
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Rondes gagnées par bye/walkover (incluses dans `wins`). */
  byes: number;
  points: number;
  /** Somme des points finaux des adversaires rencontrés (matchs joués). */
  buchholz: number;
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  needsAdminTiebreak: boolean;
}

interface TeamLine {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  points: number;
  buchholz: number;
  gamesWon: number;
  gamesLost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  /** Adversaires réellement rencontrés (pour le Buchholz). */
  opponents: string[];
}

function assertSwiss(bracket: Bracket): void {
  if (bracket.kind !== 'swiss') {
    throw new Error(`Bracket ${bracket.kind} : classement suisse réservé au système suisse.`);
  }
}

function countsFor(m: PureMatch, side: 'a' | 'b'): boolean {
  if (m.status !== 'completed') return false;
  return side === 'a' ? m.statsCountA : m.statsCountB;
}

function buildLines(bracket: Bracket, points: RoundRobinPoints): Map<string, TeamLine> {
  const lines = new Map<string, TeamLine>();
  const stats = computeTeamStats(bracket);
  const ensure = (teamId: string): TeamLine => {
    let line = lines.get(teamId);
    if (!line) {
      const st = stats.get(teamId);
      line = {
        teamId,
        played: 0, wins: 0, draws: 0, losses: 0, byes: 0, points: 0, buchholz: 0,
        gamesWon: 0, gamesLost: 0,
        goalsFor: st?.goalsFor ?? 0,
        goalsAgainst: st?.goalsAgainst ?? 0,
        goalDiff: st?.goalDiff ?? 0,
        opponents: [],
      };
      lines.set(teamId, line);
    }
    return line;
  };
  // Toutes les équipes à siège occupé apparaissent au classement (la ronde 1
  // couvre tout le monde, mais une équipe aux matchs tous walkover doit y
  // être aussi).
  for (const t of bracket.teams) {
    if (t) ensure(t);
  }

  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket !== 'swiss') continue;

    // Bye / walkover : victoire à points pleins, ronde comptée, zéro stat.
    if (m.status === 'walkover' && m.winner) {
      const teamId = m.winner === 'a' ? m.teamA : m.teamB;
      if (teamId) {
        const line = ensure(teamId);
        line.played += 1;
        line.wins += 1;
        line.byes += 1;
        line.points += points.win;
      }
      continue;
    }
    if (m.status !== 'completed') continue;

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
      const opponent = side === 'a' ? m.teamB : m.teamA;
      if (!teamId || !countsFor(m, side)) continue;
      const line = ensure(teamId);
      line.played += 1;
      if (opponent) line.opponents.push(opponent);
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
        line.draws += 1;
        line.points += points.draw;
      }
      line.gamesWon += side === 'a' ? gamesA : gamesB;
      line.gamesLost += side === 'a' ? gamesB : gamesA;
    }
  }

  // Buchholz : somme des points FINAUX des adversaires rencontrés (2e passe,
  // les points de tout le monde étant connus).
  for (const line of lines.values()) {
    line.buchholz = line.opponents.reduce(
      (sum, opp) => sum + (lines.get(opp)?.points ?? 0), 0);
  }
  return lines;
}

/** Points d'une équipe sur les seuls matchs comptés contre `subset`
 *  (mini-championnat des ex æquo — seuls les matchs JOUÉS entre eux comptent,
 *  au suisse ils ne se sont pas forcément tous rencontrés). */
function miniLeaguePoints(
  bracket: Bracket,
  points: RoundRobinPoints,
  teamId: string,
  subset: Set<string>,
): number {
  let total = 0;
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket !== 'swiss' || m.status !== 'completed') continue;
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
  /** Début de bloc (0-based) — même mécanique que le round robin : source de
   *  vérité des blocs de rangs pour les placements, jamais re-deviné. */
  blockStart: number;
}

function rankSwiss(bracket: Bracket, points: RoundRobinPoints): RankedLine[] {
  const withdrawn = new Set(bracket.withdrawn);
  const wd = (t: string) => (withdrawn.has(t) ? 1 : 0);
  const lines = [...buildLines(bracket, points).values()];

  // Ordre de base : points → retirées derrière → Buchholz → critères globaux → id.
  const base = lines.sort((x, y) =>
    y.points - x.points ||
    wd(x.teamId) - wd(y.teamId) ||
    y.buchholz - x.buchholz ||
    (y.gamesWon - y.gamesLost) - (x.gamesWon - x.gamesLost) ||
    y.goalDiff - x.goalDiff ||
    y.goalsFor - x.goalsFor ||
    x.teamId.localeCompare(y.teamId));

  const result: RankedLine[] = [];
  let i = 0;
  while (i < base.length) {
    // Paquet à égalité de (points, statut retrait, Buchholz).
    let j = i + 1;
    while (j < base.length &&
      base[j].points === base[i].points &&
      wd(base[j].teamId) === wd(base[i].teamId) &&
      base[j].buchholz === base[i].buchholz) j += 1;
    const pack = base.slice(i, j);

    if (pack.length === 1) {
      result.push({ ...pack[0], needsAdminTiebreak: false, blockStart: result.length });
      i = j;
      continue;
    }

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

/** Classement suisse global, lignes dans l'ordre final. */
export function computeSwissStandings(
  bracket: Bracket,
  points: RoundRobinPoints = DEFAULT_RR_POINTS,
): SwissStandingRow[] {
  assertSwiss(bracket);
  return rankSwiss(bracket, points).map((line, idx) => ({
    teamId: line.teamId,
    rank: idx + 1,
    played: line.played,
    wins: line.wins,
    draws: line.draws,
    losses: line.losses,
    byes: line.byes,
    points: line.points,
    buchholz: line.buchholz,
    gamesWon: line.gamesWon,
    gamesLost: line.gamesLost,
    gameDiff: line.gamesWon - line.gamesLost,
    goalsFor: line.goalsFor,
    goalsAgainst: line.goalsAgainst,
    goalDiff: line.goalDiff,
    needsAdminTiebreak: line.needsAdminTiebreak,
  }));
}

/** Le suisse est fini : tous les matchs terminaux ET (toutes les rondes
 *  générées OU tournoi structurellement COINCÉ — `isSwissStuck`, la SOUPAPE
 *  de la review adversariale : retraits massifs ou appariement sans re-match
 *  devenu impossible → la clôture au classement courant doit rester possible,
 *  sinon la compétition reste `live` à jamais). `swissRounds` absent → jamais
 *  fini (fail-safe : mieux vaut une clôture bloquée qu'un classement figé
 *  après la ronde 1). */
export function isSwissFinished(bracket: Bracket): boolean {
  if (bracket.kind !== 'swiss') return false;
  if (!isConcluded(bracket)) return false;
  const total = bracket.swissRounds;
  if (!total) return false;
  let maxRound = 0;
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.round > maxRound) maxRound = m.round;
  }
  if (maxRound >= total) return true;
  return isSwissStuck(bracket);
}

/**
 * Placements COMPRESSÉS 1→N — même contrat que le round robin : groupes
 * `rank{K}` par blocs (bloc de 1 si rang net, paquet entier sinon),
 * `placement` numéroté uniquement sur un suisse FINI (`isSwissFinished`),
 * `tiebreakResolutions` par clé de groupe (départage échoué + couverture
 * exacte). Classement global : pas de fusion inter-poules à gérer.
 */
export function computeSwissPlacements(
  bracket: Bracket,
  points: RoundRobinPoints = DEFAULT_RR_POINTS,
  tiebreakResolutions?: Record<string, string[]>,
): Placement[] {
  assertSwiss(bracket);
  const ranked = rankSwiss(bracket, points);
  const finished = isSwissFinished(bracket);

  // Blocs contigus par blockStart.
  const byStart = new Map<number, RankedLine[]>();
  for (const line of ranked) {
    const arr = byStart.get(line.blockStart) ?? [];
    arr.push(line);
    byStart.set(line.blockStart, arr);
  }

  const placements: Placement[] = [];
  let nextPlace = 1;
  for (const start of [...byStart.keys()].sort((a, b) => a - b)) {
    const block = byStart.get(start)!;
    const groupKey = `rank${start + 1}`;
    const engineRanked = block.map(l => ({
      teamId: l.teamId,
      needsAdminTiebreak: l.needsAdminTiebreak,
    }));
    const groupTeamIds = engineRanked.map(r => r.teamId);
    const resolution = tiebreakResolutions?.[groupKey];
    const resolutionValid = !!resolution
      && engineRanked.some(r => r.needsAdminTiebreak)
      && resolution.length === groupTeamIds.length
      && groupTeamIds.every(t => resolution.includes(t));
    const finalRanked = resolutionValid
      ? resolution!.map(teamId => ({ teamId, needsAdminTiebreak: false }))
      : engineRanked;
    for (const r of finalRanked) {
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
