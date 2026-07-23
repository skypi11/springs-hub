// Tests du classement SUISSE (swiss-standings.ts) : points, BUCHHOLZ calculé
// à la main, byes à points pleins sans stats, mini-championnat, retirées
// jamais avantagées, placements compressés — scénarios exacts.

import { describe, it, expect } from 'vitest';
import {
  generateSwiss,
  generateSwissNextRound,
  generateRoundRobin,
  advanceMatch,
  withdrawTeam,
  computeSwissStandings,
  computeSwissPlacements,
  isSwissFinished,
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

/** Joue le match (winner, loser) : 3 manches 1-0, le perdant `loserGames`. */
function play(b: Bracket, winner: string, loser: string, loserGames = 0): Bracket {
  const id = b.order.find(mid => {
    const m = b.matches[mid];
    return (m.teamA === winner && m.teamB === loser) || (m.teamA === loser && m.teamB === winner);
  });
  if (!id) throw new Error(`Match introuvable : ${winner} vs ${loser}`);
  const side: 'a' | 'b' = b.matches[id].teamA === winner ? 'a' : 'b';
  const scores: GameScore[] = [];
  for (let g = 0; g < loserGames; g++) {
    scores.push(side === 'a' ? { a: 0, b: 1 } : { a: 1, b: 0 });
  }
  for (let g = 0; g < 3; g++) {
    scores.push(side === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
  }
  return advanceMatch(b, id, { type: 'winner', winner: side, scores });
}

function row(rows: ReturnType<typeof computeSwissStandings>, teamId: string) {
  const r = rows.find(x => x.teamId === teamId);
  if (!r) throw new Error(`Ligne absente : ${teamId}`);
  return r;
}

describe('computeSwissStandings — tournoi joué à la main (Buchholz vérifié)', () => {
  it('4 équipes, 2 rondes : points, Buchholz et départages exacts', () => {
    // R1 (slide) : t1-t3, t2-t4. t1 bat t3 3-0 ; t4 bat t2 3-1.
    let b = gen(4, 2);
    b = play(b, 't1', 't3');
    b = play(b, 't4', 't2', 1);
    // Appariement R2 attendu (Monrad) : t1-t4 (3 pts) et t2-t3 (0 pt).
    b = generateSwissNextRound(b);
    const r2 = b.order.filter(id => b.matches[id].round === 2).map(id => b.matches[id]);
    expect(r2.map(m => [m.teamA, m.teamB])).toEqual([['t1', 't4'], ['t2', 't3']]);
    // R2 : t1 bat t4 3-0 ; t3 bat t2 3-0.
    b = play(b, 't1', 't4');
    b = play(b, 't3', 't2');

    const rows = computeSwissStandings(b);
    // Buchholz final : chacun a affronté des adversaires totalisant 6 points.
    for (const t of ['t1', 't2', 't3', 't4']) {
      expect(row(rows, t).buchholz).toBe(6);
    }
    // t1 : 6 pts. t3 et t4 : 3 pts, Buchholz égal, jamais rencontrés (mini 0)
    // → diff de manches décide : t3 (0) devant t4 (−1). t2 : 0 pt.
    expect(rows.map(r => r.teamId)).toEqual(['t1', 't3', 't4', 't2']);
    expect(row(rows, 't1')).toMatchObject({ points: 6, played: 2, wins: 2, byes: 0 });
    expect(row(rows, 't3').gameDiff).toBe(0);
    expect(row(rows, 't4').gameDiff).toBe(-1);
    expect(rows.every(r => !r.needsAdminTiebreak)).toBe(true);

    expect(isSwissFinished(b)).toBe(true);
    const placements = computeSwissPlacements(b);
    expect(placements.map(p => p.teamId)).toEqual(['t1', 't3', 't4', 't2']);
    expect(placements.map(p => p.placement)).toEqual([1, 2, 3, 4]);
  });

  it('bye : victoire à points pleins, ronde comptée, zéro stat, zéro Buchholz', () => {
    const b = gen(5, 2); // bye ronde 1 → t5
    const rows = computeSwissStandings(b);
    expect(row(rows, 't5')).toMatchObject({
      played: 1, wins: 1, byes: 1, points: 3,
      gamesWon: 0, gamesLost: 0, goalsFor: 0, buchholz: 0,
    });
  });

  it('une équipe retirée ne gagne jamais un départage à points égaux', () => {
    // R1 : t1 bat t3 3-0 (diff +3), t4 bat t2 3-1 (diff +2). Sans retrait,
    // t1 passe devant t4. Retirée, t1 passe DERRIÈRE malgré sa diff.
    let b = gen(4, 2);
    b = play(b, 't1', 't3');
    b = play(b, 't4', 't2', 1);
    b = withdrawTeam(b, 't1');
    const rows = computeSwissStandings(b);
    expect(row(rows, 't1').points).toBe(3);
    expect(row(rows, 't4').points).toBe(3);
    expect(row(rows, 't4').rank).toBeLessThan(row(rows, 't1').rank);
  });

  it('placements provisoires en cours de tournoi (placement null)', () => {
    let b = gen(4, 2);
    b = play(b, 't1', 't3');
    b = play(b, 't4', 't2');
    expect(isSwissFinished(b)).toBe(false); // ronde 2 pas générée
    const placements = computeSwissPlacements(b);
    expect(placements.every(p => p.placement === null)).toBe(true);
  });

  it('égalité stricte → arbitrage admin + résolution appliquée (couverture exacte)', () => {
    // R1 : t1 bat t3 3-0 et t2 bat t4 3-0 → t1/t2 strictement à égalité
    // (points 3, Buchholz 0, jamais rencontrés, mêmes manches/buts).
    let b = gen(4, 3);
    b = play(b, 't1', 't3');
    // R1 slide à 4 : t1-t3 et t2-t4.
    b = play(b, 't2', 't4');
    const rows = computeSwissStandings(b);
    const top = rows.slice(0, 2);
    expect(top.every(r => r.points === 3)).toBe(true);
    expect(top.every(r => r.needsAdminTiebreak)).toBe(true);

    const placements = computeSwissPlacements(b, undefined, { rank1: ['t2', 't1'] });
    const rank1 = placements.filter(p => p.group === 'rank1');
    expect(rank1.map(p => p.teamId)).toEqual(['t2', 't1']);
    expect(rank1.every(p => !p.needsAdminTiebreak)).toBe(true);

    const bad = computeSwissPlacements(b, undefined, { rank1: ['t2', 't9'] });
    expect(bad.filter(p => p.group === 'rank1').every(p => p.needsAdminTiebreak)).toBe(true);
  });

  it('refuse un bracket qui n\'est pas un suisse', () => {
    const rr = generateRoundRobin(teams(4), { bo: BO, forfeitScore: FORFEIT });
    expect(() => computeSwissStandings(rr)).toThrow();
    expect(() => computeSwissPlacements(rr)).toThrow();
  });
});
