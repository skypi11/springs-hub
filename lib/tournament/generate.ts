// Génération d'un bracket double élimination 4→32 équipes (archi §3).
// Pur et déterministe : mêmes équipes → même bracket. Le seeding (aléatoire,
// modifiable par l'admin) se fait EN AMONT : ce module reçoit la liste finale
// ordonnée par seed.

import type {
  Bracket,
  BoConfig,
  MatchSource,
  PhasePlanEntryLike,
  PureMatch,
} from './types';
import { resolveInitialVoids } from './advance';

export const MIN_TEAMS = 4;
export const MAX_TEAMS = 32;

/** Ordre standard des seeds au round 1 (1 rencontre size, 2 rencontre size−1…
 *  avec le pliage récursif classique qui étale les têtes de série). */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const mirror = order.length * 2 + 1;
    const next: number[] = [];
    for (const x of order) next.push(x, mirror - x);
    order = next;
  }
  return order;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** BO d'une ronde, résolu par distance à la fin du bracket (convention du
 *  préréglage Legends : roundsFromEnd 1-based, 1 = dernière ronde). */
export function boForRound(
  bo: BoConfig,
  bracket: 'winners' | 'losers' | 'grand_final',
  round: number,
  totalRounds: { winners: number; losers: number },
): number {
  if (bracket === 'grand_final') return bo.grandFinal;
  const total = bracket === 'winners' ? totalRounds.winners : totalRounds.losers;
  const fromEnd = total - round + 1;
  const override = bo.overrides.find(o => o.bracket === bracket && o.roundsFromEnd === fromEnd);
  return override?.bo ?? bo.default;
}

function makeMatch(
  id: string,
  bracket: PureMatch['bracket'],
  round: number,
  slot: number,
  bo: number,
  sourceA: MatchSource,
  sourceB: MatchSource,
): PureMatch {
  return {
    id, bracket, round, slot, bo,
    phase: null,
    sourceA, sourceB,
    teamA: null, teamB: null,
    voidA: false, voidB: false,
    status: 'pending',
    winner: null,
    scores: null,
    forfeit: null,
    statsCountA: false,
    statsCountB: false,
  };
}

/**
 * Génère le bracket complet : winners, losers (câblage standard à rondes
 * major/minor, drops inversés une ronde major sur deux pour limiter les
 * rematchs), grande finale et match de RESET PRÉ-CRÉÉ (visible « si
 * nécessaire » sur le bracket public — annulé si le champion winners gagne la
 * GF1). Les byes (seeds > N) sont résolus immédiatement : les équipes
 * concernées avancent par walkover sans score conventionnel.
 */
export function generateDoubleElim(
  teamIds: string[],
  opts: {
    bo: BoConfig;
    forfeitScore: { games: number; goalsPerGame: number };
    phasePlan?: PhasePlanEntryLike[];
  },
): Bracket {
  const n = teamIds.length;
  if (n < MIN_TEAMS || n > MAX_TEAMS) {
    throw new Error(`Nombre d'équipes hors bornes : ${n} (attendu ${MIN_TEAMS}–${MAX_TEAMS}).`);
  }
  if (new Set(teamIds).size !== n) {
    throw new Error('Équipes en double dans le seeding.');
  }

  const size = nextPowerOfTwo(n);
  const winnersRounds = Math.log2(size);
  const losersRounds = 2 * (winnersRounds - 1);
  const totals = { winners: winnersRounds, losers: losersRounds };

  const matches: Record<string, PureMatch> = {};
  const order: string[] = [];
  const add = (m: PureMatch) => { matches[m.id] = m; order.push(m.id); };

  // ── Winners ──
  const seeds = seedOrder(size);
  for (let r = 1; r <= winnersRounds; r++) {
    const count = size / 2 ** r;
    for (let s = 1; s <= count; s++) {
      const id = `W${r}-${s}`;
      const bo = boForRound(opts.bo, 'winners', r, totals);
      if (r === 1) {
        const seedA = seeds[(s - 1) * 2];
        const seedB = seeds[(s - 1) * 2 + 1];
        add(makeMatch(id, 'winners', r, s, bo,
          { type: 'seed', ref: seedA },
          { type: 'seed', ref: seedB }));
      } else {
        add(makeMatch(id, 'winners', r, s, bo,
          { type: 'winner_of', ref: `W${r - 1}-${s * 2 - 1}` },
          { type: 'winner_of', ref: `W${r - 1}-${s * 2}` }));
      }
    }
  }

  // ── Losers ──
  // LR1 : perdants de W1 par paires. LR pair 2j (« major ») : perdants de
  // W(j+1) contre gagnants de LR(2j−1), ordre des drops inversé un major sur
  // deux (anti-rematch standard). LR impair 2j+1 (« minor ») : gagnants du
  // major précédent entre eux.
  for (let r = 1; r <= losersRounds; r++) {
    const isMajor = r % 2 === 0;
    const count = isMajor || r === 1
      ? size / 2 ** (r === 1 ? 2 : r / 2 + 1)
      : size / 2 ** ((r + 1) / 2 + 1);
    for (let s = 1; s <= count; s++) {
      const id = `L${r}-${s}`;
      const bo = boForRound(opts.bo, 'losers', r, totals);
      let sourceA: MatchSource;
      let sourceB: MatchSource;
      if (r === 1) {
        sourceA = { type: 'loser_of', ref: `W1-${s * 2 - 1}` };
        sourceB = { type: 'loser_of', ref: `W1-${s * 2}` };
      } else if (isMajor) {
        const j = r / 2;
        // Anti-rematch standard : les drops alternent inversion (majors
        // impairs) et DEMI-DÉCALAGE (majors pairs) — l'identité renverrait le
        // perdant de W(j+1) dans le quart exact de ses anciens adversaires
        // (rematch de W1 possible dès L4 en bracket 32, prouvé en review).
        const reversed = j % 2 === 1;
        const dropSlot = reversed
          ? count - s + 1
          : count >= 2 ? ((s - 1 + count / 2) % count) + 1 : s;
        sourceA = { type: 'loser_of', ref: `W${j + 1}-${dropSlot}` };
        sourceB = { type: 'winner_of', ref: `L${r - 1}-${s}` };
      } else {
        sourceA = { type: 'winner_of', ref: `L${r - 1}-${s * 2 - 1}` };
        sourceB = { type: 'winner_of', ref: `L${r - 1}-${s * 2}` };
      }
      add(makeMatch(id, 'losers', r, s, bo, sourceA, sourceB));
    }
  }

  // ── Grande finale + reset pré-créé ──
  add(makeMatch('GF', 'grand_final', 1, 1, opts.bo.grandFinal,
    { type: 'winner_of', ref: `W${winnersRounds}-1` },
    { type: 'winner_of', ref: `L${losersRounds}-1` }));
  add(makeMatch('GFR', 'grand_final', 2, 1, opts.bo.grandFinal,
    { type: 'winner_of', ref: 'GF' },
    { type: 'loser_of', ref: 'GF' }));

  const bracket: Bracket = {
    teams: [...teamIds],
    size,
    winnersRounds,
    losersRounds,
    bo: opts.bo,
    forfeitScore: opts.forfeitScore,
    matches,
    order,
    withdrawn: [],
  };

  // Placement des équipes réelles au round 1 + résolution des byes (les seeds
  // au-delà de N sont void, la propagation gère les walkovers en cascade).
  for (const id of order) {
    const m = matches[id];
    if (m.sourceA.type === 'seed') {
      const t = teamIds[m.sourceA.ref - 1];
      if (t) m.teamA = t; else m.voidA = true;
    }
    if (m.sourceB.type === 'seed') {
      const t = teamIds[m.sourceB.ref - 1];
      if (t) m.teamB = t; else m.voidB = true;
    }
  }
  resolveInitialVoids(bracket);

  // Rattachement au plan de phases (bracket+round → phase). Les rondes
  // inexistantes pour N < 32 sont simplement ignorées par le plan.
  if (opts.phasePlan) {
    for (const entry of opts.phasePlan) {
      for (const pr of entry.rounds) {
        for (const id of order) {
          const m = matches[id];
          if (m.bracket === pr.bracket && m.round === pr.round) m.phase = entry.phase;
        }
      }
    }
  }

  return bracket;
}
