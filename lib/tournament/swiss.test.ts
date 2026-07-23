// Tests du moteur SUISSE (generateSwiss + generateSwissNextRound) : property
// tests par SIMULATION DE TOURNOIS COMPLETS (PRNG seedé, déterministe) sur
// toutes les tailles 4→16, pair et impair — jamais de re-match, un match par
// équipe et par ronde (ou bye), byes équitablement répartis, appariement au
// score. Mêmes conventions que tournament.test.ts.

import { describe, it, expect } from 'vitest';
import {
  generateSwiss,
  generateSwissNextRound,
  canGenerateSwissRound,
  currentSwissRound,
  swissBlocker,
  swissDefaultRounds,
  advanceMatch,
  withdrawTeam,
  isConcluded,
  isSwissFinished,
  computeSwissPlacements,
  SWISS_MAX_ROUNDS,
  type Bracket,
  type BoConfig,
  type GameScore,
} from './index';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function gen(n: number, rounds?: number): Bracket {
  return generateSwiss(teams(n), { bo: BO, forfeitScore: FORFEIT, rounds });
}

function sweep(winner: 'a' | 'b'): GameScore[] {
  return Array.from({ length: 3 }, () =>
    winner === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Joue tous les matchs pending de la ronde courante (vainqueur tiré au PRNG). */
function playCurrentRound(b: Bracket, rand: () => number): Bracket {
  let next = b;
  for (const id of [...next.order]) {
    const m = next.matches[id];
    if (m.status !== 'pending') continue;
    const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
    next = advanceMatch(next, id, { type: 'winner', winner, scores: sweep(winner) });
  }
  return next;
}

describe('swissBlocker / swissDefaultRounds', () => {
  it('rondes par défaut = ⌈log2(n)⌉', () => {
    expect(swissDefaultRounds(4)).toBe(2);
    expect(swissDefaultRounds(8)).toBe(3);
    expect(swissDefaultRounds(9)).toBe(4);
    expect(swissDefaultRounds(16)).toBe(4);
    expect(swissDefaultRounds(64)).toBe(6);
  });

  it('signale exactement ce que le générateur refuserait', () => {
    expect(swissBlocker(3, 2)).toContain('hors bornes');
    expect(swissBlocker(65, 6)).toContain('hors bornes');
    expect(swissBlocker(8, 0)).toContain('rondes invalide');
    expect(swissBlocker(8, SWISS_MAX_ROUNDS + 1)).toContain('rondes invalide');
    expect(swissBlocker(4, 5)).toContain('Trop de rondes');
    expect(swissBlocker(8, 7)).toBeNull();
    expect(swissBlocker(64, 6)).toBeNull();
    expect(() => gen(4, 5)).toThrow(swissBlocker(4, 5)!);
  });
});

describe('generateSwiss — ronde 1', () => {
  it('slide pairing pair : seed i contre seed i + n/2', () => {
    const b = gen(8, 3);
    expect(b.kind).toBe('swiss');
    expect(b.swissRounds).toBe(3);
    expect(b.order).toHaveLength(4);
    const pairs = b.order.map(id => [b.matches[id].teamA, b.matches[id].teamB]);
    expect(pairs).toEqual([['t1', 't5'], ['t2', 't6'], ['t3', 't7'], ['t4', 't8']]);
    for (const id of b.order) {
      const m = b.matches[id];
      expect(m.bracket).toBe('swiss');
      expect(m.round).toBe(1);
      expect(m.id).toBe(`S1-${m.slot}`);
      expect(m.bo).toBe(BO.default);
    }
  });

  it('effectif impair : bye au seed le plus bas, résolu en walkover', () => {
    const b = gen(7, 3);
    expect(b.order).toHaveLength(4); // 3 matchs + 1 bye
    const bye = b.matches[b.order[3]];
    expect(bye.teamA).toBe('t7');
    expect(bye.teamB).toBeNull();
    expect(bye.voidB).toBe(true);
    expect(bye.status).toBe('walkover');
    expect(bye.winner).toBe('a');
  });

  it('refuse les doublons', () => {
    expect(() => generateSwiss(['a', 'a', 'b', 'c'], { bo: BO, forfeitScore: FORFEIT })).toThrow();
  });
});

describe('simulation de tournois complets (property tests seedés)', () => {
  for (let n = 4; n <= 16; n++) {
    for (const seed of [1, 42]) {
      const rounds = Math.min(swissDefaultRounds(n) + 1, n - 1);
      it(`${n} équipes, ${rounds} rondes (seed ${seed})`, () => {
        const rand = mulberry32(seed);
        let b = gen(n, rounds);

        const seenPairs = new Set<string>();
        for (let r = 1; r <= rounds; r++) {
          expect(currentSwissRound(b)).toBe(r);
          // Structure de la ronde : chaque équipe exactement une fois.
          const roundIds = b.order.filter(id => b.matches[id].round === r);
          const seen = new Set<string>();
          let byes = 0;
          for (const id of roundIds) {
            const m = b.matches[id];
            expect(m.id).toBe(`S${r}-${m.slot}`);
            expect(seen.has(m.teamA!)).toBe(false);
            seen.add(m.teamA!);
            if (m.teamB) {
              expect(seen.has(m.teamB)).toBe(false);
              seen.add(m.teamB);
              // JAMAIS de re-match sur tout le tournoi.
              const key = pairKey(m.teamA!, m.teamB);
              expect(seenPairs.has(key)).toBe(false);
              seenPairs.add(key);
            } else {
              byes += 1;
            }
          }
          expect(seen.size).toBe(n);
          expect(byes).toBe(n % 2);
          expect(roundIds).toHaveLength(Math.floor(n / 2) + (n % 2));

          // Ronde en cours : pas de génération possible.
          if (b.order.some(id => b.matches[id].status === 'pending')) {
            expect(canGenerateSwissRound(b)).toBe(false);
            expect(() => generateSwissNextRound(b)).toThrow();
          }
          b = playCurrentRound(b, rand);
          expect(isConcluded(b)).toBe(true);
          if (r < rounds) {
            expect(canGenerateSwissRound(b)).toBe(true);
            expect(isSwissFinished(b)).toBe(false);
            b = generateSwissNextRound(b);
          }
        }

        // Fin de tournoi.
        expect(isSwissFinished(b)).toBe(true);
        expect(canGenerateSwissRound(b)).toBe(false);
        expect(() => generateSwissNextRound(b)).toThrow();

        // Byes répartis : jamais deux byes pour l'une tant qu'une autre n'en a
        // aucun (écart max 1 — n impair : `rounds` byes pour n équipes).
        if (n % 2 === 1) {
          const byeCount = new Map<string, number>();
          for (const id of b.order) {
            const m = b.matches[id];
            if (m.voidB && m.status === 'walkover' && m.teamA) {
              byeCount.set(m.teamA, (byeCount.get(m.teamA) ?? 0) + 1);
            }
          }
          const counts = teams(n).map(t => byeCount.get(t) ?? 0);
          expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
          expect(counts.reduce((x, y) => x + y, 0)).toBe(rounds);
        }

        // Placements finaux : compression 1→n exacte.
        const placements = computeSwissPlacements(b);
        expect(placements).toHaveLength(n);
        const numbered = placements.map(p => p.placement);
        expect(numbered.every(p => p !== null)).toBe(true);
        expect([...numbered].sort((x, y) => x! - y!)).toEqual(
          Array.from({ length: n }, (_, i) => i + 1));
      });
    }
  }

  it('déterministe : mêmes résultats → mêmes appariements', () => {
    const run = () => {
      const rand = mulberry32(7);
      let b = gen(8, 3);
      for (let r = 1; r <= 3; r++) {
        b = playCurrentRound(b, rand);
        if (r < 3) b = generateSwissNextRound(b);
      }
      return b;
    };
    expect(run()).toEqual(run());
  });

  it('appariement AU SCORE : après la ronde 1, les vainqueurs se rencontrent', () => {
    let b = gen(8, 3);
    // Les seeds hauts gagnent tous : t1..t4 à 3 pts, t5..t8 à 0.
    for (const id of [...b.order]) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: sweep('a') });
    }
    b = generateSwissNextRound(b);
    const round2 = b.order.filter(id => b.matches[id].round === 2);
    const winners = new Set(['t1', 't2', 't3', 't4']);
    for (const id of round2) {
      const m = b.matches[id];
      // Chaque match de la ronde 2 oppose deux équipes du MÊME groupe de score.
      expect(winners.has(m.teamA!)).toBe(winners.has(m.teamB!));
    }
  });
});

describe('retrait en cours de suisse (R5-4)', () => {
  it('une équipe retirée n\'est plus appariée aux rondes suivantes', () => {
    const rand = mulberry32(3);
    let b = gen(8, 3);
    b = playCurrentRound(b, rand);
    b = withdrawTeam(b, 't1');
    b = generateSwissNextRound(b);
    const round2 = b.order.filter(id => b.matches[id].round === 2);
    for (const id of round2) {
      const m = b.matches[id];
      expect(m.teamA).not.toBe('t1');
      expect(m.teamB).not.toBe('t1');
    }
    // 7 restantes → 3 matchs + 1 bye.
    expect(round2).toHaveLength(4);
  });
});
