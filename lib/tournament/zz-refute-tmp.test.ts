// TEMP — vérification adversariale du finding « soft-lock suisse ». À SUPPRIMER.
import { describe, it, expect } from 'vitest';
import {
  generateSwiss,
  generateSwissNextRound,
  canGenerateSwissRound,
  advanceMatch,
  withdrawTeam,
  type Bracket,
  type BoConfig,
  type GameScore,
} from './index';
import { computeSwissStandings } from './swiss-standings';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };
const TEAMS = ['A', 'B', 'C', 'D', 'E', 'F'];
const LEFT = new Set(['A', 'B', 'C']); // bipartition slide R1

// Profils de score pilotables (winner fixé) : jouent sur gameDiff/goalDiff/goalsFor.
function profile(winner: 'a' | 'b', p: number): GameScore[] {
  const W = (a: number, b: number) => (winner === 'a' ? { a, b } : { a: b, b: a });
  switch (p) {
    case 0: return [W(1, 0), W(1, 0), W(1, 0)];               // 3-0, 3 buts
    case 1: return [W(4, 0), W(4, 0), W(4, 0)];               // 3-0, 12 buts
    case 2: return [W(1, 0), W(0, 1), W(1, 0), W(0, 1), W(1, 0)]; // 3-2 serré
    default: return [W(4, 0), W(0, 3), W(4, 0), W(0, 3), W(4, 0)]; // 3-2 gros écarts
  }
}

function pendingIds(b: Bracket): string[] {
  return b.order.filter(id => b.matches[id].status === 'pending');
}

function playRound(b: Bracket, winners: Array<'a' | 'b'>, profiles: number[]): Bracket {
  let next = b;
  const ids = pendingIds(next);
  ids.forEach((id, i) => {
    next = advanceMatch(next, id, {
      type: 'winner', winner: winners[i], scores: profile(winners[i], profiles[i]),
    });
  });
  return next;
}

function roundPairs(b: Bracket, round: number): Array<[string, string]> {
  return b.order
    .map(id => b.matches[id])
    .filter(m => m.round === round && m.teamB !== null)
    .map(m => [m.teamA!, m.teamB!] as [string, string]);
}

function allCross(pairs: Array<[string, string]>): boolean {
  return pairs.every(([a, b]) => LEFT.has(a) !== LEFT.has(b));
}

// Toutes les combinaisons winners (2^3) × profils (4^3) d'une ronde à 3 matchs.
function* roundAssignments(): Generator<{ winners: Array<'a' | 'b'>; profiles: number[] }> {
  for (let w = 0; w < 8; w++) {
    const winners = [0, 1, 2].map(i => ((w >> i) & 1 ? 'a' : 'b') as 'a' | 'b');
    for (let p = 0; p < 64; p++) {
      yield { winners, profiles: [p & 3, (p >> 2) & 3, (p >> 4) & 3] };
    }
  }
}

describe('réfutation finding soft-lock suisse', () => {
  it('trace du finding : ordre R3 réel + génération R4', () => {
    let b = generateSwiss(TEAMS, { bo: BO, forfeitScore: FORFEIT, rounds: 5 });
    // R1 : A-D, B-E, C-F → vainqueurs A, E, F (ordre visé A,E,F,B,C,D — profils variés)
    b = playRound(b, ['a', 'b', 'b'], [1, 0, 2]);
    const s1 = computeSwissStandings(b).map(r => r.teamId);
    console.log('ordre après R1 :', s1.join(','));
    b = generateSwissNextRound(b);
    console.log('paires R2 :', JSON.stringify(roundPairs(b, 2)));
    // Le finding attend R2 = A-E, F-B, C-D ; vainqueurs A, B, C.
    const p2 = roundPairs(b, 2);
    const winners2 = p2.map(([a]) => (['A', 'B', 'C'].includes(a) ? 'a' : 'b') as 'a' | 'b');
    // vainqueurs = A, B, C quel que soit le côté :
    const w2 = p2.map(([a, bb]) => {
      const target = ['A', 'B', 'C'].find(t => t === a || t === bb);
      return (target === a ? 'a' : 'b') as 'a' | 'b';
    });
    void winners2;
    b = playRound(b, w2, [0, 0, 0]);
    const s2 = computeSwissStandings(b).map(r => ({ t: r.teamId, pts: r.points, bh: r.buchholz }));
    console.log('classement après R2 :', JSON.stringify(s2));
    b = generateSwissNextRound(b);
    console.log('paires R3 :', JSON.stringify(roundPairs(b, 3)));
    // Joue R3 n'importe comment puis tente R4 :
    b = playRound(b, ['a', 'a', 'a'], [0, 0, 0]);
    let r4error: string | null = null;
    try {
      b = generateSwissNextRound(b);
    } catch (e) {
      r4error = (e as Error).message;
    }
    console.log('R4 :', r4error ?? 'GÉNÉRÉE — paires ' + JSON.stringify(roundPairs(b, 4)));
    expect(true).toBe(true);
  });

  it('recherche exhaustive du piège K3,3 (6 équipes, 5 rondes, W/L × 4 profils)', () => {
    // Piège = les 3 premières rondes toutes CROSS {A,B,C}|{D,E,F} (consomme K3,3).
    // R1 est cross par construction. On énumère TOUTES les issues de R1 et R2
    // (8 vainqueurs × 64 profils chacune) et on ne garde que les chemins où la
    // ronde générée reste 100% cross. Si aucun chemin ne survit jusqu'à un R3
    // cross, le dead-end d'appariement est INATTEIGNABLE (pour ces profils).
    const base = generateSwiss(TEAMS, { bo: BO, forfeitScore: FORFEIT, rounds: 5 });
    let r2CrossCount = 0;
    let r3CrossCount = 0;
    let r4Failures = 0;
    const seenR2 = new Set<string>();
    for (const a1 of roundAssignments()) {
      const afterR1 = playRound(base, a1.winners, a1.profiles);
      const withR2 = generateSwissNextRound(afterR1);
      const pairs2 = roundPairs(withR2, 2);
      const key2 = JSON.stringify(pairs2) + '|' + a1.winners.join('');
      if (!allCross(pairs2)) continue;
      r2CrossCount++;
      if (seenR2.has(key2)) continue; // même appariement + mêmes vainqueurs R1 → états stats ≠ mais on garde tout de même la 1re fois par (paires, vainqueurs) pour borner
      seenR2.add(key2);
      for (const a2 of roundAssignments()) {
        const afterR2 = playRound(withR2, a2.winners, a2.profiles);
        const withR3 = generateSwissNextRound(afterR2);
        const pairs3 = roundPairs(withR3, 3);
        if (!allCross(pairs3)) continue;
        r3CrossCount++;
        // K3,3 consommé → R4 doit échouer :
        const afterR3 = playRound(withR3, ['a', 'a', 'a'], [0, 0, 0]);
        try {
          generateSwissNextRound(afterR3);
        } catch {
          r4Failures++;
        }
      }
    }
    console.log(`R2 cross: ${r2CrossCount} · R3 cross (piège atteint): ${r3CrossCount} · échecs R4: ${r4Failures}`);
    expect(true).toBe(true);
  }, 120000);

  it('variante retraits : 4 retraits après R2 (rounds=3, config DÉFAUT)', () => {
    let b = generateSwiss(TEAMS, { bo: BO, forfeitScore: FORFEIT, rounds: 3 });
    b = playRound(b, ['a', 'b', 'b'], [0, 0, 0]); // R1
    b = generateSwissNextRound(b);
    const p2 = roundPairs(b, 2);
    console.log('paires R2 :', JSON.stringify(p2));
    b = playRound(b, ['a', 'a', 'a'], [0, 0, 0]); // R2
    // Retire tout le monde sauf les deux équipes du 1er match de R2 (elles se
    // sont DÉJÀ rencontrées) :
    const keep = new Set(p2[0]);
    for (const t of TEAMS) {
      if (!keep.has(t)) b = withdrawTeam(b, t);
    }
    console.log('actives restantes :', [...keep].join(','), '— canGenerate:', canGenerateSwissRound(b));
    let err: string | null = null;
    try {
      generateSwissNextRound(b);
    } catch (e) {
      err = (e as Error).message;
    }
    console.log('R3 :', err ?? 'GÉNÉRÉE');
    expect(true).toBe(true);
  });
});
