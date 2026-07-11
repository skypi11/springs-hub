import { describe, it, expect } from 'vitest';
import {
  generateDoubleElim,
  advanceMatch,
  withdrawTeam,
  isTerminal,
  type Bracket,
  type BoConfig,
  type GameScore,
} from '@/lib/tournament';
import { computeProgressionPatches } from './progression';
import type { TeamDisplay } from './bracket-store';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 7 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function gen(n: number): Bracket {
  const teams = Array.from({ length: n }, (_, i) => `reg${i + 1}`);
  return generateDoubleElim(teams, { bo: BO, forfeitScore: FORFEIT });
}

function winScores(bo: number, winner: 'a' | 'b' = 'a'): GameScore[] {
  return Array.from({ length: Math.ceil(bo / 2) }, () =>
    winner === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
}

const infoOf = (regId: string | null): TeamDisplay | null =>
  regId ? { name: `Team ${regId}`, tag: regId.toUpperCase().slice(0, 3), logoUrl: null } : null;

// Champs autorisés dans un patch : STRICTEMENT les champs moteur.
const MOTOR_FIELDS = new Set([
  'teamA', 'teamAInfo', 'teamB', 'teamBInfo', 'voidA', 'voidB',
  'statsCountA', 'statsCountB', 'winner', 'status', 'final', 'stats', 'forfeitTeam',
]);

describe('computeProgressionPatches — résultat simple', () => {
  it('W1-1 joué : pivot complété + vainqueur propagé + perdant descendu, rien d\'autre', () => {
    const before = gen(8);
    const after = advanceMatch(before, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 2, b: 1 }, { a: 0, b: 1 }, { a: 3, b: 0 }, { a: 1, b: 0 }] });
    const patches = computeProgressionPatches(before, after, infoOf);

    const ids = patches.map(p => p.matchId).sort();
    expect(ids).toEqual(['L1-1', 'W1-1', 'W2-1']);

    const pivot = patches.find(p => p.matchId === 'W1-1')!;
    expect(pivot.fields.status).toBe('completed');
    expect(pivot.fields.winner).toBe('a');
    expect(pivot.fields.final).toHaveLength(4);
    expect(pivot.fields.stats).toEqual({
      a: { goalsFor: 6, goalsAgainst: 2 },
      b: { goalsFor: 2, goalsAgainst: 6 },
    });
    expect(pivot.arrivedTeams).toEqual([]);

    const w2 = patches.find(p => p.matchId === 'W2-1')!;
    const winnerReg = after.matches['W1-1'].teamA === after.matches['W2-1'].teamA
      ? after.matches['W2-1'].teamA : after.matches['W2-1'].teamB;
    expect(w2.arrivedTeams).toEqual([winnerReg]);
    expect(w2.fields.teamAInfo ?? w2.fields.teamBInfo).toMatchObject({ name: `Team ${winnerReg}` });
    expect(w2.fields.status).toBeUndefined();       // toujours pending côté doc

    const l1 = patches.find(p => p.matchId === 'L1-1')!;
    expect(l1.arrivedTeams).toHaveLength(1);        // le perdant descend
  });

  it('n\'émet JAMAIS autre chose que des champs moteur', () => {
    const before = gen(8);
    let b = before;
    for (const id of b.order) {
      const m = b.matches[id];
      if (!isTerminal(m) && m.teamA && m.teamB) {
        b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: winScores(m.bo) });
      }
    }
    const patches = computeProgressionPatches(before, b, infoOf);
    expect(patches.length).toBeGreaterThan(5);
    for (const p of patches) {
      for (const key of Object.keys(p.fields)) {
        expect(MOTOR_FIELDS.has(key)).toBe(true);
      }
    }
  });

  it('diff identité : aucun patch', () => {
    const b = gen(8);
    expect(computeProgressionPatches(b, b, infoOf)).toEqual([]);
  });
});

describe('computeProgressionPatches — forfaits', () => {
  it('forfait simple : score conventionnel + drapeau forfaitTeam sur le pivot', () => {
    const before = gen(8);
    const after = advanceMatch(before, 'W1-1', { type: 'forfeit', team: 'b' });
    const pivot = computeProgressionPatches(before, after, infoOf).find(p => p.matchId === 'W1-1')!;
    expect(pivot.fields.forfeitTeam).toBe('b');
    expect(pivot.fields.status).toBe('completed');
    expect(pivot.fields.winner).toBe('a');
    // Score conventionnel BO5 : 3 manches 1-0 (spec §11).
    expect(pivot.fields.final).toEqual([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }]);
  });

  it('double forfait (R5-1) : deux éliminées, void propagé chez les losers', () => {
    const before = gen(8);
    const after = advanceMatch(before, 'W1-1', { type: 'forfeit', team: 'both' });
    const patches = computeProgressionPatches(before, after, infoOf);
    const pivot = patches.find(p => p.matchId === 'W1-1')!;
    expect(pivot.fields.forfeitTeam).toBe('both');
    expect(pivot.fields.winner).toBeUndefined();    // winner reste null → pas de diff
    // Le slot loser de W1-1 ne recevra jamais personne.
    const l1 = patches.find(p => p.matchId === 'L1-1')!;
    expect(l1.fields.voidA === true || l1.fields.voidB === true).toBe(true);
    // Le match winners aval attend l'autre demi-finaliste : côté void posé.
    const w2 = patches.find(p => p.matchId === 'W2-1')!;
    expect(w2.fields.voidA === true || w2.fields.voidB === true).toBe(true);
  });
});

describe('computeProgressionPatches — retrait R5-4', () => {
  it('retrait après un match joué : forfaits conventionnels aval + délta du retiré figé (statsCount)', () => {
    let b = gen(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: winScores(b.matches['W1-1'].bo) });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: winScores(b.matches['W1-2'].bo) });
    const winner = b.matches['W2-1'].teamA!;
    const before = b;
    const after = withdrawTeam(b, winner);
    const patches = computeProgressionPatches(before, after, infoOf);

    const wf = patches.find(p => p.matchId === 'W2-1')!;
    expect(wf.fields.forfeitTeam).toBeDefined();
    expect(wf.fields.status).toBe('completed');
    // statsCount démarre à false (le moteur le passe à true quand le match
    // compte) : l'ADVERSAIRE compte le conventionnel (false→true, patché),
    // le retiré garde false (délta figé → aucun patch pour son camp).
    const withdrawnSide = after.matches['W2-1'].teamA === winner ? 'A' : 'B';
    const opponentSide = withdrawnSide === 'A' ? 'B' : 'A';
    expect(wf.fields[`statsCount${opponentSide}` as 'statsCountA' | 'statsCountB']).toBe(true);
    expect(wf.fields[`statsCount${withdrawnSide}` as 'statsCountA' | 'statsCountB']).toBeUndefined();
  });
});
