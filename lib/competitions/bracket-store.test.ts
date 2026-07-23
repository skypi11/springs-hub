import { describe, it, expect } from 'vitest';
import {
  generateDoubleElim,
  generateSingleElim,
  generateRoundRobin,
  generateSwiss,
  generateSwissNextRound,
  advanceMatch,
  replaceTeam,
  withdrawTeam,
  computePlacements,
  computeTeamStats,
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
  materializeMatches,
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

  it('siège vidé par replaceTeam(null) : reconstruit depuis les docs sans ressusciter l\'équipe', () => {
    // Régression review Lot 2 : reconstructBracket dérive teams des docs, donc
    // un siège void reste void (l'équipe retirée ne réapparaît pas).
    const b = gen(8);
    const vacated = b.matches['W1-2'].teamA!;
    const mutated = replaceTeam(b, vacated, null);
    const rebuilt = reconstructBracket({
      withdrawn: mutated.withdrawn, bo: LEGENDS_BO, forfeitScore: FORFEIT, matches: serializeAll(mutated),
    });
    expect(rebuilt.teams).toEqual(mutated.teams);          // '' au siège vidé, pas l'ancienne équipe
    expect(rebuilt.teams).not.toContain(vacated);
    expect(computeTeamStats(rebuilt).has(vacated)).toBe(false);
    expect(rebuilt.matches).toEqual(mutated.matches);
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
      withdrawn: live.withdrawn,
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

  it('kind single_elim : arbre seul (N−1 matchs), petite finale sur demande', () => {
    const ids = teams(16);
    const base = {
      competitionId: 'comp1', seeding: ids, bo: LEGENDS_BO, forfeitScore: FORFEIT,
      registrations: regs(ids), kind: 'single_elim' as const,
    };
    const { matches } = materializeBracket(base);
    expect(matches).toHaveLength(15);
    expect(matches.find(m => m.id === 'GF')).toBeUndefined();
    expect(matches.find(m => m.id === 'P3')).toBeUndefined();
    const withP3 = materializeBracket({ ...base, thirdPlace: true });
    expect(withP3.matches).toHaveLength(16);
    expect(withP3.matches.find(m => m.id === 'P3')).toBeDefined();
  });
});

// ── Simple élimination : round-trip + reconstruction + progression ──────────

describe('bracket-store — simple élimination', () => {
  const SINGLE_BO: BoConfig = { default: 5, overrides: [], grandFinal: 7 };
  function genSingle(n: number, thirdPlace = false): Bracket {
    return generateSingleElim(teams(n), { bo: SINGLE_BO, forfeitScore: FORFEIT, thirdPlace });
  }

  it('round-trip fidèle pour toutes les tailles, avec et sans petite finale', () => {
    for (let n = 4; n <= 32; n++) {
      for (const thirdPlace of [false, true]) {
        const b = genSingle(n, thirdPlace);
        for (const id of b.order) {
          const original = b.matches[id];
          const doc = pureMatchToDoc('comp1', original, { a: null, b: null });
          const back = docToPureMatch({ id, ...doc });
          expect(back, `${n} équipes, P3=${thirdPlace}, match ${id}`).toEqual(original);
        }
      }
    }
  });

  it('reconstruit un bracket single identique — kind inféré sans grande finale', () => {
    for (const n of [4, 11, 16, 27, 32]) {
      for (const thirdPlace of [false, true]) {
        const b = genSingle(n, thirdPlace);
        const rebuilt = reconstructBracket({
          withdrawn: b.withdrawn, bo: SINGLE_BO, forfeitScore: FORFEIT,
          matches: serializeAll(b),
        });
        expect(rebuilt.kind, `${n} équipes`).toBe('single_elim');
        expect(rebuilt.losersRounds).toBe(b.losersRounds);
        expect(rebuilt.matches).toEqual(b.matches);
        expect(rebuilt.order).toEqual(b.order);
      }
    }
  });

  it('progression identique sur le bracket single reconstruit (champion + placements)', () => {
    const b = genSingle(16, true);
    const rand = mulberry32(17);
    let live = b;
    for (let k = 0; k < 6; k++) {
      const playable = live.order.map(id => live.matches[id])
        .filter(m => m.status === 'pending' && m.teamA !== null && m.teamB !== null);
      if (playable.length === 0) break;
      const m = playable[0];
      const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
      live = advanceMatch(live, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    }
    const rebuilt = reconstructBracket({
      withdrawn: live.withdrawn, bo: SINGLE_BO, forfeitScore: FORFEIT,
      matches: serializeAll(live), kind: 'single_elim',
    });
    const finishedOriginal = playOut(live, 55);
    const finishedRebuilt = playOut(rebuilt, 55);
    expect(championOf(finishedRebuilt)).toBe(championOf(finishedOriginal));
    expect(computePlacements(finishedRebuilt)).toEqual(computePlacements(finishedOriginal));
  });
});

// ── Round robin : round-trip + reconstruction + progression ─────────────────

describe('bracket-store — round robin', () => {
  const RR_BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
  function genRR(n: number, groups = 1, doubleRound = false): Bracket {
    return generateRoundRobin(teams(n), { bo: RR_BO, forfeitScore: FORFEIT, groups, doubleRound });
  }
  function roundTrip(bracket: Bracket): Bracket {
    const docs = bracket.order.map(id => ({
      id,
      ...pureMatchToDoc('comp-rr', bracket.matches[id], { a: null, b: null }),
    }));
    return reconstructBracket({
      withdrawn: [...bracket.withdrawn],
      bo: bracket.bo,
      forfeitScore: bracket.forfeitScore,
      matches: docs,
      kind: 'round_robin',
    });
  }

  it('round-trip fidèle : tailles 4→12 × poules 1→3 × aller-retour', () => {
    for (let n = 4; n <= 12; n++) {
      for (const groups of [1, 2, 3]) {
        if (groups > Math.floor(n / 2)) continue;
        for (const doubleRound of [false, true]) {
          const b = genRR(n, groups, doubleRound);
          const back = roundTrip(b);
          expect(back.kind).toBe('round_robin');
          expect(back.size).toBe(b.size);
          expect(back.teams).toEqual(b.teams);
          expect(back.groups).toBe(b.groups);
          expect(back.matchdays).toBe(b.matchdays);
          // Régression review : l'aller-retour est inféré des paires de seeds
          // — le round-trip doit être identitaire sur doubleRound aussi.
          expect(back.doubleRound).toBe(b.doubleRound);
          expect(back.order).toEqual(b.order);
          for (const id of b.order) {
            expect(back.matches[id]).toEqual(b.matches[id]);
          }
        }
      }
    }
  });

  it('la poule survit à la sérialisation (champ group) et jamais sur un arbre', () => {
    const rr = genRR(8, 2);
    const doc = pureMatchToDoc('comp-rr', rr.matches[rr.order[0]], { a: null, b: null });
    expect(doc.group).toBe(1);
    const elim = gen(4);
    const elimDoc = pureMatchToDoc('comp-elim', elim.matches[elim.order[0]], { a: null, b: null });
    expect('group' in elimDoc).toBe(false);
  });

  it('round-trip après progression (résultat + retrait en cascade)', () => {
    let b = genRR(6, 2);
    b = advanceMatch(b, b.order[0], {
      type: 'winner',
      winner: 'a',
      scores: [{ a: 2, b: 0 }, { a: 2, b: 1 }, { a: 2, b: 0 }],
    });
    const withdrawnTeam = b.matches[b.order[1]].teamA!;
    b = withdrawTeam(b, withdrawnTeam);
    const docs = b.order.map(id => ({
      id,
      ...pureMatchToDoc('comp-rr', b.matches[id], { a: null, b: null }),
    }));
    const back = reconstructBracket({
      withdrawn: [...b.withdrawn],
      bo: b.bo,
      forfeitScore: b.forfeitScore,
      matches: docs,
      kind: 'round_robin',
    });
    for (const id of b.order) {
      expect(back.matches[id]).toEqual(b.matches[id]);
    }
  });

  it('reconstruction inférée sans kind explicite (matchs round_robin présents)', () => {
    const b = genRR(5);
    const docs = b.order.map(id => ({
      id,
      ...pureMatchToDoc('comp-rr', b.matches[id], { a: null, b: null }),
    }));
    const back = reconstructBracket({
      withdrawn: [],
      bo: b.bo,
      forfeitScore: b.forfeitScore,
      matches: docs,
    });
    expect(back.kind).toBe('round_robin');
    expect(back.size).toBe(5);
  });

  it('materializeBracket route le round robin (docs + poule sérialisée)', () => {
    const registrations: Record<string, { display: { name: string; tag: string; logoUrl: string | null }; rosterUids: string[] }> = {};
    for (const t of teams(8)) {
      registrations[t] = { display: { name: t, tag: t.toUpperCase(), logoUrl: null }, rosterUids: [`u_${t}`] };
    }
    const { matches, acls } = materializeBracket({
      competitionId: 'comp-rr',
      seeding: teams(8),
      bo: RR_BO,
      forfeitScore: FORFEIT,
      registrations,
      kind: 'round_robin',
      groups: 2,
    });
    expect(matches).toHaveLength(12); // 2 poules de 4 → 2 × C(4,2)
    expect(matches.every(m => m.doc.bracket === 'round_robin')).toBe(true);
    expect(matches.every(m => typeof m.doc.group === 'number')).toBe(true);
    // Toutes les équipes connues d'avance → une ACL par match.
    expect(acls).toHaveLength(12);
  });
});

// ── Suisse : round-trip + reconstruction + génération incrémentale ──────────

describe('bracket-store — suisse', () => {
  const SWISS_BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
  function genSwiss(n: number, rounds: number): Bracket {
    return generateSwiss(teams(n), { bo: SWISS_BO, forfeitScore: FORFEIT, rounds });
  }
  function docsOf(bracket: Bracket) {
    return bracket.order.map(id => ({
      id,
      ...pureMatchToDoc('comp-sw', bracket.matches[id], { a: null, b: null }),
    }));
  }
  function roundTrip(bracket: Bracket): Bracket {
    return reconstructBracket({
      withdrawn: [...bracket.withdrawn],
      bo: bracket.bo,
      forfeitScore: bracket.forfeitScore,
      matches: docsOf(bracket),
      kind: 'swiss',
      swissRounds: bracket.swissRounds,
    });
  }

  it('round-trip fidèle ronde 1 (pair et impair, bye compris)', () => {
    for (const n of [4, 7, 8, 13, 16]) {
      const b = genSwiss(n, 3);
      const back = roundTrip(b);
      expect(back.kind).toBe('swiss');
      expect(back.size).toBe(n);
      expect(back.teams).toEqual(b.teams);
      expect(back.swissRounds).toBe(3);
      expect(back.order).toEqual(b.order);
      for (const id of b.order) {
        expect(back.matches[id]).toEqual(b.matches[id]);
      }
    }
  });

  it('round-trip après une ronde jouée + génération de la suivante', () => {
    let b = genSwiss(8, 3);
    for (const id of [...b.order]) {
      b = advanceMatch(b, id, {
        type: 'winner', winner: 'a',
        scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }],
      });
    }
    b = generateSwissNextRound(b);
    const back = roundTrip(b);
    expect(back.order).toEqual(b.order);
    for (const id of b.order) {
      expect(back.matches[id]).toEqual(b.matches[id]);
    }
    // Sans swissRounds (config manquante) : jamais « fini » — fail-safe.
    const noRounds = reconstructBracket({
      withdrawn: [], bo: b.bo, forfeitScore: b.forfeitScore,
      matches: docsOf(b), kind: 'swiss',
    });
    expect(noRounds.swissRounds).toBeUndefined();
  });

  it('materializeBracket route le suisse (ronde 1 seule) et materializeMatches ajoute la ronde 2', () => {
    const registrations: Record<string, { display: { name: string; tag: string; logoUrl: string | null }; rosterUids: string[] }> = {};
    for (const t of teams(8)) {
      registrations[t] = { display: { name: t, tag: t.toUpperCase(), logoUrl: null }, rosterUids: [`u_${t}`] };
    }
    const { matches, acls } = materializeBracket({
      competitionId: 'comp-sw',
      seeding: teams(8),
      bo: SWISS_BO,
      forfeitScore: FORFEIT,
      registrations,
      kind: 'swiss',
      swissRounds: 3,
    });
    expect(matches).toHaveLength(4); // ronde 1 SEULE
    expect(matches.every(m => m.doc.bracket === 'swiss')).toBe(true);
    expect(acls).toHaveLength(4);

    // Ronde 2 générée puis matérialisée en APPEND.
    let b = genSwiss(8, 3);
    for (const id of [...b.order]) {
      b = advanceMatch(b, id, {
        type: 'winner', winner: 'a',
        scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }],
      });
    }
    const after = generateSwissNextRound(b);
    const newIds = after.order.filter(id => !b.matches[id]);
    expect(newIds).toHaveLength(4);
    const appended = materializeMatches({
      competitionId: 'comp-sw', bracket: after, matchIds: newIds, registrations,
    });
    expect(appended.matches).toHaveLength(4);
    expect(appended.matches.every(m => m.doc.round === 2)).toBe(true);
    expect(appended.acls).toHaveLength(4);
  });
});
