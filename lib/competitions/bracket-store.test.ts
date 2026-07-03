import { describe, it, expect } from 'vitest';
import {
  generateDoubleElim,
  advanceMatch,
  computePlacements,
  championOf,
  isFinished,
  type Bracket,
  type BoConfig,
} from '@/lib/tournament';
import {
  pureMatchToDoc,
  docToPureMatch,
  reconstructBracket,
  materializeBracket,
  type MatchDoc,
} from './bracket-store';

const LEGENDS_BO: BoConfig = {
  default: 5,
  overrides: [
    { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
    { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
    { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
    { bracket: 'losers', roundsFromEnd: 2, bo: 7 },
  ],
  grandFinal: 7,
};
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `reg${i + 1}`);
}
function gen(n: number): Bracket {
  return generateDoubleElim(teams(n), { bo: LEGENDS_BO, forfeitScore: FORFEIT });
}

// PRNG seedé (déterminisme).
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
function scoresFor(winner: 'a' | 'b', bo: number, rand: () => number) {
  const needed = Math.ceil(bo / 2);
  const games: Array<{ a: number; b: number }> = [];
  let w = 0;
  let l = 0;
  const loserWins = Math.floor(rand() * needed);
  while (w < needed) {
    const winnerTakes = l >= loserWins || rand() < 0.6;
    const hi = 1 + Math.floor(rand() * 4);
    const lo = Math.floor(rand() * hi);
    if (winnerTakes) { games.push(winner === 'a' ? { a: hi, b: lo } : { a: lo, b: hi }); w++; }
    else { games.push(winner === 'a' ? { a: lo, b: hi } : { a: hi, b: lo }); l++; }
  }
  return games;
}
function playOut(b: Bracket, seed: number): Bracket {
  const rand = mulberry32(seed);
  let bracket = b;
  let guard = 0;
  while (!isFinished(bracket)) {
    const playable = bracket.order
      .map(id => bracket.matches[id])
      .filter(m => m.status === 'pending' && m.teamA !== null && m.teamB !== null);
    if (playable.length === 0) break;
    const m = playable[Math.floor(rand() * playable.length)];
    const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
    bracket = advanceMatch(bracket, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    if (++guard > 300) throw new Error('boucle');
  }
  return bracket;
}

// ── Round-trip PureMatch ↔ doc ──────────────────────────────────────────────

describe('pureMatchToDoc / docToPureMatch — round-trip fidèle', () => {
  it('chaque match d\'un bracket généré revient identique après aller-retour (toutes tailles)', () => {
    for (let n = 4; n <= 32; n++) {
      const b = gen(n);
      for (const id of b.order) {
        const original = b.matches[id];
        const doc = pureMatchToDoc('comp1', original, { a: null, b: null });
        const back = docToPureMatch({ id, ...doc });
        expect(back, `${n} équipes, match ${id}`).toEqual(original);
      }
    }
  });

  it('round-trip après progression (scores réels, forfaits, walkovers)', () => {
    const finished = playOut(gen(16), 42);
    for (const id of finished.order) {
      const original = finished.matches[id];
      const doc = pureMatchToDoc('comp1', original, { a: null, b: null });
      const back = docToPureMatch({ id, ...doc });
      expect(back, `match ${id}`).toEqual(original);
    }
  });
});

// ── Reconstruction du Bracket ────────────────────────────────────────────────

function serializeAll(b: Bracket, competitionId = 'comp1'): Array<{ id: string } & MatchDoc> {
  return b.order.map(id => ({ id, ...pureMatchToDoc(competitionId, b.matches[id], { a: null, b: null }) }));
}

describe('reconstructBracket', () => {
  it('reconstruit un bracket identique (matches, teams, rounds) pour toutes les tailles', () => {
    for (let n = 4; n <= 32; n++) {
      const b = gen(n);
      const rebuilt = reconstructBracket({
        seeding: b.teams,
        withdrawn: b.withdrawn,
        bo: LEGENDS_BO,
        forfeitScore: FORFEIT,
        matches: serializeAll(b),
      });
      expect(rebuilt.matches, `${n} équipes`).toEqual(b.matches);
      expect(rebuilt.teams).toEqual(b.teams);
      expect(rebuilt.size).toBe(b.size);
      expect(rebuilt.winnersRounds).toBe(b.winnersRounds);
      expect(rebuilt.losersRounds).toBe(b.losersRounds);
      expect(rebuilt.order).toEqual(b.order);
    }
  });

  it('progression identique sur le bracket reconstruit (même champion + placements)', () => {
    // On joue l'original, on sérialise à MI-PARCOURS, on reconstruit, puis on
    // finit les DEUX avec la même graine : le résultat doit être identique.
    const b = gen(16);
    const rand = mulberry32(7);
    let live = b;
    // Joue ~la moitié des matchs jouables.
    for (let k = 0; k < 8; k++) {
      const playable = live.order.map(id => live.matches[id])
        .filter(m => m.status === 'pending' && m.teamA !== null && m.teamB !== null);
      if (playable.length === 0) break;
      const m = playable[0];
      const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
      live = advanceMatch(live, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    }
    const rebuilt = reconstructBracket({
      seeding: live.teams, withdrawn: live.withdrawn,
      bo: LEGENDS_BO, forfeitScore: FORFEIT, matches: serializeAll(live),
    });
    const finishedOriginal = playOut(live, 99);
    const finishedRebuilt = playOut(rebuilt, 99);
    expect(championOf(finishedRebuilt)).toBe(championOf(finishedOriginal));
    expect(computePlacements(finishedRebuilt)).toEqual(computePlacements(finishedOriginal));
  });
});

// ── Matérialisation ──────────────────────────────────────────────────────────

describe('materializeBracket', () => {
  const regs = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, {
    display: { name: `Team ${i + 1}`, tag: `T${i + 1}`, logoUrl: null },
    rosterUids: [`u${i}a`, `u${i}b`, `u${i}c`],
  }]));

  it('32 équipes → 63 matchs, GF + reset inclus', () => {
    const ids = teams(32);
    const { matches } = materializeBracket({
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT, registrations: regs(ids),
    });
    expect(matches).toHaveLength(63);
    expect(matches.find(m => m.id === 'GF')).toBeDefined();
    expect(matches.find(m => m.id === 'GFR')).toBeDefined();
  });

  it('dénormalise le nom/tag/logo des équipes connues (round 1)', () => {
    const ids = teams(8);
    const { matches } = materializeBracket({
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT, registrations: regs(ids),
    });
    const w1 = matches.find(m => m.id === 'W1-1')!;
    expect(w1.doc.teamAInfo).toEqual({ name: 'Team 1', tag: 'T1', logoUrl: null });
    expect(w1.doc.teamBInfo).not.toBeNull();
    // Matchs aval : équipes TBD → info null.
    const w2 = matches.find(m => m.id === 'W2-1')!;
    expect(w2.doc.teamAInfo).toBeNull();
  });

  it('byes matérialisés en walkover (20 équipes, 12 byes) sans score', () => {
    const ids = teams(20);
    const { matches } = materializeBracket({
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT, registrations: regs(ids),
    });
    const w11 = matches.find(m => m.id === 'W1-1')!.doc; // seed 1 vs seed 32 (absent)
    expect(w11.status).toBe('walkover');
    expect(w11.winner).toBe('a');
    expect(w11.scores.final).toBeNull();
    expect(w11.voidB).toBe(true);
  });

  it('ACL round 1 : participantUids = rosters des 2 équipes ; aval sans ACL', () => {
    const ids = teams(8);
    const { acls } = materializeBracket({
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT, registrations: regs(ids),
    });
    const w11 = acls.find(a => a.matchId === 'W1-1');
    expect(w11?.participantUids).toHaveLength(6); // 3 + 3
    // Un match aval (équipes inconnues) n'a pas d'ACL initiale.
    expect(acls.find(a => a.matchId === 'GF')).toBeUndefined();
  });

  it('un bye n\'a une ACL que pour l\'équipe présente', () => {
    const ids = teams(20);
    const { acls } = materializeBracket({
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT, registrations: regs(ids),
    });
    const w11 = acls.find(a => a.matchId === 'W1-1'); // seed 1 présent, seed 32 absent
    expect(w11?.participantUids).toHaveLength(3);
  });
});
