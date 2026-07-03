// Placements 1→N COMPRESSÉS + stats de départage (spec §11, archi §3).
// Le barème circuit lit la place compressée : avec N < 32, un groupe nominal
// vide décale les suivants — deux Qualifs de tailles différentes paient la
// même performance relative au même prix.
//
// Départage intra-groupe (spec §11) : délta de buts NORMALISÉ par match
// réellement compté → buts marqués → face-à-face s'il a eu lieu → arbitrage
// admin (`needsAdminTiebreak`, flux nominal de la console — archi §3).

import type { Bracket, Placement, PureMatch, TeamStats } from './types';

// ── Stats ───────────────────────────────────────────────────────────────────

/** Stats cumulées par équipe sur les matchs comptés (joués + forfaits selon
 *  leurs règles ; walkovers/byes exclus par construction). */
export function computeTeamStats(bracket: Bracket): Map<string, TeamStats> {
  const stats = new Map<string, TeamStats>();
  const ensure = (teamId: string): TeamStats => {
    let s = stats.get(teamId);
    if (!s) {
      s = { teamId, matchesCounted: 0, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, normalizedDiff: 0 };
      stats.set(teamId, s);
    }
    return s;
  };
  for (const teamId of bracket.teams) {
    if (teamId) ensure(teamId);
  }

  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.status !== 'completed') continue;

    if (m.forfeit === 'both') {
      // R5-1 : délta conventionnel négatif pour chacune (aucun but marqué).
      const games = Math.ceil(m.bo / 2) * bracket.forfeitScore.goalsPerGame;
      for (const side of ['a', 'b'] as const) {
        const teamId = side === 'a' ? m.teamA : m.teamB;
        const counts = side === 'a' ? m.statsCountA : m.statsCountB;
        if (!teamId || !counts) continue;
        const s = ensure(teamId);
        s.matchesCounted += 1;
        s.goalsAgainst += games;
        s.goalDiff -= games;
      }
      continue;
    }

    if (!m.scores) continue;
    let goalsA = 0;
    let goalsB = 0;
    for (const g of m.scores) { goalsA += g.a; goalsB += g.b; }
    if (m.teamA && m.statsCountA) {
      const s = ensure(m.teamA);
      s.matchesCounted += 1;
      s.goalsFor += goalsA;
      s.goalsAgainst += goalsB;
      s.goalDiff += goalsA - goalsB;
    }
    if (m.teamB && m.statsCountB) {
      const s = ensure(m.teamB);
      s.matchesCounted += 1;
      s.goalsFor += goalsB;
      s.goalsAgainst += goalsA;
      s.goalDiff += goalsB - goalsA;
    }
  }

  for (const s of stats.values()) {
    s.normalizedDiff = s.matchesCounted > 0 ? s.goalDiff / s.matchesCounted : 0;
  }
  return stats;
}

// ── Groupes d'élimination ───────────────────────────────────────────────────

interface EliminationGroup {
  key: string;
  /** 0 = champion, croissant = moins bien classé. */
  rank: number;
  teams: string[];
}

/** Groupe (clé + rang) d'une défaite au round losers r. */
function losersGroup(bracket: Bracket, round: number): { key: string; rank: number } {
  // champion=0, gf_loser=1, perdant L(last)=2, L(last−1)=3, …, L1.
  return { key: `L${round}`, rank: 2 + (bracket.losersRounds - round) };
}

/** Groupe d'atterrissage d'un double forfait en winners (R5-1 : « groupe du
 *  match forfaité » = le round losers où les équipes seraient tombées). */
function winnersDropGroup(bracket: Bracket, round: number): { key: string; rank: number } {
  const landing = round === 1 ? 1 : 2 * (round - 1);
  return losersGroup(bracket, landing);
}

/** Champion du tournoi — null tant que la grande finale (et son reset le cas
 *  échéant) n'est pas résolue. */
export function championOf(bracket: Bracket): string | null {
  const gf = bracket.matches['GF'];
  const reset = bracket.matches['GFR'];
  if (reset && reset.status !== 'cancelled') {
    if (reset.status !== 'completed' && reset.status !== 'walkover') return null;
    return reset.winner === 'a' ? reset.teamA : reset.teamB;
  }
  if (!gf) return null;
  if (gf.status === 'completed' || gf.status === 'walkover') {
    return gf.winner === 'a' ? gf.teamA : gf.teamB;
  }
  return null;
}

export function isFinished(bracket: Bracket): boolean {
  return championOf(bracket) !== null;
}

/** Match d'élimination de chaque équipe (perdre en losers, perdre la GF sans
 *  reset, perdre le reset, ou double forfait n'importe où). */
function eliminationGroups(bracket: Bracket): EliminationGroup[] {
  const groups = new Map<string, EliminationGroup>();
  const put = (g: { key: string; rank: number }, teamId: string) => {
    let entry = groups.get(g.key);
    if (!entry) {
      entry = { key: g.key, rank: g.rank, teams: [] };
      groups.set(g.key, entry);
    }
    entry.teams.push(teamId);
  };

  const gf = bracket.matches['GF'];
  const reset = bracket.matches['GFR'];
  const resetPlayed = reset && reset.status !== 'cancelled' && reset.status !== 'pending';

  const champion = championOf(bracket);
  if (champion) put({ key: 'champion', rank: 0 }, champion);

  // Vice-champion : perdant du reset s'il a eu lieu, sinon perdant de la GF.
  const finalMatch = resetPlayed ? reset! : gf;
  if (finalMatch && (finalMatch.status === 'completed') && finalMatch.winner && finalMatch.forfeit !== 'both') {
    const loser = finalMatch.winner === 'a' ? finalMatch.teamB : finalMatch.teamA;
    if (loser) put({ key: 'gf_loser', rank: 1 }, loser);
  }
  // GF/reset en double forfait : les deux au groupe du match (rang gf_loser).
  for (const m of [gf, reset]) {
    if (m && m.status === 'completed' && m.forfeit === 'both') {
      if (m.teamA) put({ key: 'gf_loser', rank: 1 }, m.teamA);
      if (m.teamB) put({ key: 'gf_loser', rank: 1 }, m.teamB);
    }
  }

  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.status !== 'completed') continue;
    if (m.bracket === 'grand_final') continue; // traité ci-dessus

    if (m.forfeit === 'both') {
      const g = m.bracket === 'winners'
        ? winnersDropGroup(bracket, m.round)
        : losersGroup(bracket, m.round);
      if (m.teamA) put(g, m.teamA);
      if (m.teamB) put(g, m.teamB);
      continue;
    }
    if (m.bracket === 'losers' && m.winner) {
      const loser = m.winner === 'a' ? m.teamB : m.teamA;
      if (loser) put(losersGroup(bracket, m.round), loser);
    }
    // Une défaite en winners n'élimine pas : l'équipe descend chez les losers.
  }

  return Array.from(groups.values()).sort((x, y) => x.rank - y.rank);
}

// ── Départage & compression ─────────────────────────────────────────────────

/** Le face-à-face s'il a eu lieu : id du vainqueur, null sinon (jamais joué,
 *  ou joué plusieurs fois avec vainqueurs différents). */
function headToHead(bracket: Bracket, teamX: string, teamY: string): string | null {
  let winnerId: string | null = null;
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.status !== 'completed' || !m.winner) continue;
    const pair = (m.teamA === teamX && m.teamB === teamY) || (m.teamA === teamY && m.teamB === teamX);
    if (!pair) continue;
    const w = m.winner === 'a' ? m.teamA : m.teamB;
    if (winnerId && winnerId !== w) return null;
    winnerId = w;
  }
  return winnerId;
}

/**
 * Ordonne un groupe d'élimination : délta normalisé décroissant → buts marqués
 * décroissants → face-à-face pour une égalité à DEUX s'il a eu lieu → sinon
 * `needsAdminTiebreak` (l'ordre rendu est alors provisoire, stable par id
 * d'équipe pour rester déterministe).
 */
export function rankWithinGroup(
  bracket: Bracket,
  teams: string[],
  stats: Map<string, TeamStats>,
): Array<{ teamId: string; needsAdminTiebreak: boolean }> {
  const key = (t: string) => {
    const s = stats.get(t);
    return { diff: s?.normalizedDiff ?? 0, goals: s?.goalsFor ?? 0 };
  };
  const sorted = [...teams].sort((x, y) => {
    const kx = key(x);
    const ky = key(y);
    if (kx.diff !== ky.diff) return ky.diff - kx.diff;
    if (kx.goals !== ky.goals) return ky.goals - kx.goals;
    return x.localeCompare(y); // stabilité déterministe en attendant l'arbitrage
  });

  const result = sorted.map(teamId => ({ teamId, needsAdminTiebreak: false }));

  // Paquets d'ex-aequo stricts (délta normalisé ET buts marqués égaux).
  let i = 0;
  while (i < result.length) {
    let j = i + 1;
    const ki = key(result[i].teamId);
    while (j < result.length) {
      const kj = key(result[j].teamId);
      if (kj.diff !== ki.diff || kj.goals !== ki.goals) break;
      j += 1;
    }
    const tied = result.slice(i, j);
    if (tied.length === 2) {
      const h2h = headToHead(bracket, tied[0].teamId, tied[1].teamId);
      if (h2h === tied[1].teamId) {
        [result[i], result[i + 1]] = [result[i + 1], result[i]];
      } else if (h2h === null) {
        result[i].needsAdminTiebreak = true;
        result[i + 1].needsAdminTiebreak = true;
      }
    } else if (tied.length > 2) {
      for (let k = i; k < j; k++) result[k].needsAdminTiebreak = true;
    }
    i = j;
  }
  return result;
}

/**
 * Placements COMPRESSÉS 1→N de toutes les équipes éliminées (+ champion).
 * Un tournoi non terminé rend les placements des équipes déjà éliminées ;
 * les équipes encore en course n'apparaissent pas.
 */
export function computePlacements(bracket: Bracket): Placement[] {
  const stats = computeTeamStats(bracket);
  const groups = eliminationGroups(bracket);
  const placements: Placement[] = [];
  let nextPlace = 1;
  for (const group of groups) {
    const ranked = rankWithinGroup(bracket, group.teams, stats);
    for (const r of ranked) {
      placements.push({
        teamId: r.teamId,
        placement: nextPlace,
        group: group.key,
        needsAdminTiebreak: r.needsAdminTiebreak,
      });
      nextPlace += 1;
    }
  }
  return placements;
}
