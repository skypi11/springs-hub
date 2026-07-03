import { describe, it, expect } from 'vitest';
import {
  generateDoubleElim,
  advanceMatch,
  withdrawTeam,
  replaceTeam,
  computePlacements,
  computeTeamStats,
  championOf,
  isFinished,
  seedOrder,
  type Bracket,
  type BoConfig,
  type PureMatch,
} from './index';

// Config Legends (defaults.ts) : BO5, demi/finales winners+losers et GF en BO7.
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

// BO5 partout : pour les scénarios unitaires à scores contrôlés (dans un
// bracket de 4, la config Legends mettrait déjà W1 en BO7 — c'est le test
// dédié au BO relatif qui couvre ce comportement).
const FLAT_BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function gen(n: number): Bracket {
  return generateDoubleElim(teams(n), { bo: LEGENDS_BO, forfeitScore: FORFEIT });
}

function genFlat(n: number): Bracket {
  return generateDoubleElim(teams(n), { bo: FLAT_BO, forfeitScore: FORFEIT });
}

// PRNG seedé (mulberry32) : les property tests sont DÉTERMINISTES.
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

/** Scores plausibles pour une victoire du camp donné en BO donné. */
function scoresFor(winner: 'a' | 'b', bo: number, rand: () => number) {
  const needed = Math.ceil(bo / 2);
  const loserWins = Math.floor(rand() * needed);
  const games: Array<{ a: number; b: number }> = [];
  let w = 0;
  let l = 0;
  while (w < needed) {
    const winnerTakes = l >= loserWins || rand() < 0.6;
    const hi = 1 + Math.floor(rand() * 4);
    const lo = Math.floor(rand() * hi);
    if (winnerTakes) {
      games.push(winner === 'a' ? { a: hi, b: lo } : { a: lo, b: hi });
      w += 1;
    } else {
      games.push(winner === 'a' ? { a: lo, b: hi } : { a: hi, b: lo });
      l += 1;
    }
  }
  return games;
}

function pendingPlayable(b: Bracket): PureMatch[] {
  return b.order
    .map(id => b.matches[id])
    .filter(m => m.status === 'pending' && m.teamA !== null && m.teamB !== null);
}

/** Joue tout le bracket avec des vainqueurs aléatoires seedés. */
function playOut(b: Bracket, seed: number): Bracket {
  const rand = mulberry32(seed);
  let bracket = b;
  let guard = 0;
  while (!isFinished(bracket)) {
    const playable = pendingPlayable(bracket);
    if (playable.length === 0) {
      throw new Error('Blocage : aucun match jouable et pas de champion.');
    }
    const m = playable[Math.floor(rand() * playable.length)];
    const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
    bracket = advanceMatch(bracket, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    guard += 1;
    if (guard > 200) throw new Error('Boucle infinie.');
  }
  return bracket;
}

// ── Génération ──────────────────────────────────────────────────────────────

describe('seedOrder', () => {
  it('pliage standard (8) : 1v8, 4v5, 2v7, 3v6', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe('generateDoubleElim — structure', () => {
  it('refuse < 4, > 32 et les doublons', () => {
    expect(() => gen(3)).toThrow();
    expect(() => gen(33)).toThrow();
    expect(() => generateDoubleElim(['a', 'a', 'b', 'c'], { bo: LEGENDS_BO, forfeitScore: FORFEIT })).toThrow();
  });

  it('32 équipes : 5 rondes winners, 8 rondes losers, GF + reset pré-créé', () => {
    const b = gen(32);
    expect(b.winnersRounds).toBe(5);
    expect(b.losersRounds).toBe(8);
    expect(b.matches['GF']).toBeDefined();
    expect(b.matches['GFR']).toBeDefined();
    // 31 matchs winners + 30 losers + GF + GFR
    expect(b.order).toHaveLength(31 + 30 + 2);
  });

  it('BO résolu par roundsFromEnd (Legends R5-3)', () => {
    const b = gen(32);
    expect(b.matches['W1-1'].bo).toBe(5);
    expect(b.matches['W4-1'].bo).toBe(7);  // demi winners
    expect(b.matches['W5-1'].bo).toBe(7);  // finale winners
    expect(b.matches['L6-1'].bo).toBe(5);
    expect(b.matches['L7-1'].bo).toBe(7);  // demi losers
    expect(b.matches['L8-1'].bo).toBe(7);  // finale losers
    expect(b.matches['GF'].bo).toBe(7);
    expect(b.matches['GFR'].bo).toBe(7);
  });

  it('câblage complet : chaque match non-round-1 a des sources valides', () => {
    for (const n of [4, 8, 16, 32]) {
      const b = gen(n);
      for (const id of b.order) {
        const m = b.matches[id];
        for (const src of [m.sourceA, m.sourceB]) {
          if (src.type === 'winner_of' || src.type === 'loser_of') {
            expect(b.matches[src.ref], `${id} référence ${src.ref}`).toBeDefined();
          }
        }
      }
    }
  });

  it('chaque perdant winners a exactement une place chez les losers', () => {
    for (const n of [4, 8, 16, 32]) {
      const b = gen(n);
      const loserDrops = new Map<string, number>();
      for (const id of b.order) {
        const m = b.matches[id];
        for (const src of [m.sourceA, m.sourceB]) {
          if (src.type === 'loser_of') {
            loserDrops.set(src.ref, (loserDrops.get(src.ref) ?? 0) + 1);
          }
        }
      }
      for (const id of b.order) {
        const m = b.matches[id];
        if (m.bracket === 'winners') {
          expect(loserDrops.get(id), `perdant de ${id}`).toBe(1);
        }
      }
      // GF : son perdant alimente uniquement le reset.
      expect(loserDrops.get('GF')).toBe(1);
    }
  });

  it('N non-puissance de 2 : les byes avancent les têtes de série sans score', () => {
    const b = gen(20); // size 32, 12 byes
    // Seed 1 affronte seed 32 (absent) → walkover immédiat.
    const w1 = b.matches['W1-1'];
    expect(w1.status).toBe('walkover');
    expect(w1.winner).toBe('a');
    expect(w1.scores).toBeNull();
    // t1 est déjà placé au round 2.
    const w2 = b.matches['W2-1'];
    expect(w2.teamA).toBe('t1');
  });

  it('phase plan appliqué aux rondes existantes', () => {
    const b = generateDoubleElim(teams(8), {
      bo: LEGENDS_BO,
      forfeitScore: FORFEIT,
      phasePlan: [
        { phase: 1, rounds: [{ bracket: 'winners', round: 1 }] },
        { phase: 2, rounds: [{ bracket: 'winners', round: 2 }, { bracket: 'losers', round: 1 }] },
      ],
    });
    expect(b.matches['W1-3'].phase).toBe(1);
    expect(b.matches['L1-1'].phase).toBe(2);
    expect(b.matches['W3-1'].phase).toBeNull();
  });
});

// ── Progression ─────────────────────────────────────────────────────────────

describe('advanceMatch', () => {
  it('victoire : propage le gagnant en winners et le perdant chez les losers', () => {
    let b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(1)) });
    expect(b.matches['W2-1'].teamA).toBe(b.matches['W1-1'].teamA);
    expect(b.matches['L1-1'].teamA).toBe(b.matches['W1-1'].teamB);
  });

  it('valide les scores (nombre de manches, pas d\'égalité, décision exacte)', () => {
    const b = genFlat(4);
    expect(() => advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }] })).toThrow();
    expect(() => advanceMatch(b, 'W1-1', {
      type: 'winner', winner: 'a',
      scores: [{ a: 1, b: 1 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }],
    })).toThrow();
    expect(() => advanceMatch(b, 'W1-1', {
      type: 'winner', winner: 'b',
      scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }],
    })).toThrow();
  });

  it('refuse un match déjà terminé ou incomplet', () => {
    let b = genFlat(20);
    expect(() => advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'a' })).toThrow(); // walkover de bye
    b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(2)) });
    expect(() => advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'a' })).toThrow();
    expect(() => advanceMatch(b, 'GF', { type: 'forfeit', team: 'a' })).toThrow(); // équipes inconnues
  });

  it('forfait simple : score conventionnel ±3 compté des deux côtés, le forfaitaire descend', () => {
    let b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'b' });
    const m = b.matches['W1-1'];
    expect(m.winner).toBe('a');
    expect(m.scores).toEqual([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }]);
    expect(b.matches['L1-1'].teamA).toBe(m.teamB); // il descend, pas éliminé
    const stats = computeTeamStats(b);
    expect(stats.get(m.teamA!)!.goalDiff).toBe(3);
    expect(stats.get(m.teamB!)!.goalDiff).toBe(-3);
    expect(stats.get(m.teamB!)!.matchesCounted).toBe(1);
  });

  it('double forfait (R5-1) : les deux éliminées à −3, walkover pour l\'adversaire d\'aval', () => {
    let b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'both' });
    const m = b.matches['W1-1'];
    // Personne n'avance ni ne descend.
    expect(b.matches['W2-1'].voidA).toBe(true);
    expect(b.matches['L1-1'].voidA).toBe(true);
    // Stats : −3 chacune, aucun but marqué.
    const stats = computeTeamStats(b);
    expect(stats.get(m.teamA!)!.goalDiff).toBe(-3);
    expect(stats.get(m.teamB!)!.goalDiff).toBe(-3);
    // L'autre demi-finale se joue ; son gagnant traverse W2 par walkover SANS score.
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(3)) });
    expect(b.matches['W2-1'].status).toBe('walkover');
    const winnerStats = computeTeamStats(b).get(b.matches['W1-2'].teamA!)!;
    expect(winnerStats.matchesCounted).toBe(1); // W1-2 seulement — pas le walkover
    // Placements : les deux forfaitaires au groupe d'atterrissage L1.
    const placements = computePlacements(b);
    const forfeited = placements.filter(p => p.group === 'L1');
    expect(forfeited.map(p => p.teamId).sort()).toEqual([m.teamA, m.teamB].sort());
  });

  it('reset : annulé si le champion winners gagne la GF1, joué sinon', () => {
    // Champion winners gagne GF1 → reset cancelled.
    let b = playUntilGF(genFlat(4), 10);
    b = advanceMatch(b, 'GF', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(4)) });
    expect(b.matches['GFR'].status).toBe('cancelled');
    expect(championOf(b)).toBe(b.matches['GF'].teamA);

    // L'équipe des losers gagne GF1 → reset peuplé, le champion sort du reset.
    let b2 = playUntilGF(genFlat(4), 11);
    b2 = advanceMatch(b2, 'GF', { type: 'winner', winner: 'b', scores: scoresFor('b', 5, mulberry32(5)) });
    const reset = b2.matches['GFR'];
    expect(reset.status).toBe('pending');
    expect(reset.teamA).toBe(b2.matches['GF'].teamB); // vainqueur GF1 (ex-losers)
    expect(reset.teamB).toBe(b2.matches['GF'].teamA); // champion winners battu
    expect(isFinished(b2)).toBe(false);
    b2 = advanceMatch(b2, 'GFR', { type: 'winner', winner: 'b', scores: scoresFor('b', 5, mulberry32(6)) });
    expect(championOf(b2)).toBe(reset.teamB);
  });
});

/** Joue jusqu'à ce que la GF soit prête (deux équipes connues). */
function playUntilGF(b: Bracket, seed: number): Bracket {
  const rand = mulberry32(seed);
  let bracket = b;
  let guard = 0;
  while (bracket.matches['GF'].teamA === null || bracket.matches['GF'].teamB === null) {
    const playable = pendingPlayable(bracket).filter(m => m.id !== 'GF');
    if (playable.length === 0) throw new Error('GF jamais prête.');
    const m = playable[0];
    const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
    bracket = advanceMatch(bracket, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    if (++guard > 200) throw new Error('Boucle infinie.');
  }
  return bracket;
}

// ── Retrait & remplacement ──────────────────────────────────────────────────

describe('withdrawTeam (R5-4)', () => {
  it('cascade : forfaits conventionnels, adversaires crédités, délta du retiré figé', () => {
    let b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 2, b: 0 }, { a: 2, b: 0 }, { a: 2, b: 0 }] });
    const leaver = b.matches['W1-1'].teamA!; // +6, qualifié en W2
    b = withdrawTeam(b, leaver);
    // W2 : forfait conventionnel une fois l'adversaire arrivé (W1-2 gagné 3-0).
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    const w2 = b.matches['W2-1'];
    expect(w2.status).toBe('completed');
    expect(w2.forfeit).toBeTruthy();
    const opponent = w2.teamA === leaver ? w2.teamB! : w2.teamA!;
    const stats = computeTeamStats(b);
    // L'adversaire est crédité du score conventionnel : +3 (W1-2) +3 (forfait W2).
    expect(stats.get(opponent)!.goalDiff).toBe(6);
    expect(stats.get(opponent)!.matchesCounted).toBe(2);
    // Délta du retiré FIGÉ à +6 (le forfait de cascade ne compte pas pour lui).
    expect(stats.get(leaver)!.goalDiff).toBe(6);
    expect(stats.get(leaver)!.matchesCounted).toBe(1);
  });

  it('l\'équipe retirée descend puis est éliminée — le tournoi se termine', () => {
    let b = genFlat(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(8)) });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(9)) });
    const leaver = b.matches['W2-1'].teamA!;
    b = withdrawTeam(b, leaver);
    // Sa demi winners est forfaite, il tombe en losers et re-forfait dès que
    // son adversaire losers existe.
    let guard = 0;
    while (!isFinished(b)) {
      const playable = pendingPlayable(b);
      expect(playable.length, 'aucun blocage').toBeGreaterThan(0);
      const m = playable[0];
      b = advanceMatch(b, m.id, { type: 'winner', winner: 'a', scores: scoresFor('a', m.bo, mulberry32(20 + guard)) });
      if (++guard > 20) throw new Error('Boucle infinie.');
    }
    const placements = computePlacements(b);
    expect(placements.find(p => p.teamId === leaver)).toBeDefined();
    expect(placements.find(p => p.teamId === leaver)!.placement).toBeGreaterThan(1);
  });

  it('idempotent', () => {
    let b = genFlat(4);
    b = withdrawTeam(b, 't4');
    const again = withdrawTeam(b, 't4');
    expect(again.withdrawn).toEqual(['t4']);
  });
});

describe('replaceTeam (waitlist, spec §8)', () => {
  it('remplace partout tant qu\'aucun match réel n\'est joué', () => {
    const b = genFlat(20); // t1 a traversé W1 par bye → figure en W2
    const next = replaceTeam(b, 't1', 'waitlisted');
    expect(next.teams).toContain('waitlisted');
    expect(next.matches['W2-1'].teamA).toBe('waitlisted');
    expect(next.matches['W1-1'].teamA).toBe('waitlisted');
  });

  it('refuse après un match joué ; refuse une équipe déjà présente', () => {
    let b = genFlat(4);
    expect(() => replaceTeam(b, 't1', 't2')).toThrow();
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, mulberry32(12)) });
    const played = b.matches['W1-1'].teamA!;
    expect(() => replaceTeam(b, played, 'newcomer')).toThrow();
  });

  it('personne en waitlist → bye : l\'adversaire avance SANS score conventionnel', () => {
    const b = genFlat(4);
    const gone = b.matches['W1-1'].teamB!;
    const next = replaceTeam(b, gone, null);
    const w1 = next.matches['W1-1'];
    expect(w1.status).toBe('walkover');
    expect(w1.scores).toBeNull();
    const stats = computeTeamStats(next);
    expect(stats.get(w1.teamA!)!.matchesCounted).toBe(0);
    expect(next.matches['W2-1'].teamA).toBe(w1.teamA);
  });
});

// ── Property tests : tous les N de 4 à 32, plusieurs seeds ──────────────────

describe('property : bracket joué de bout en bout', () => {
  for (let n = 4; n <= 32; n++) {
    it(`${n} équipes — 3 déroulés seedés : terminaison, placements 1→N uniques, groupes cohérents`, () => {
      for (const seed of [1, 42, 1337]) {
        const finished = playOut(gen(n), seed);
        expect(isFinished(finished)).toBe(true);

        const placements = computePlacements(finished);
        // Toutes les équipes classées exactement une fois, places 1→N compressées.
        expect(placements).toHaveLength(n);
        const teamsSeen = new Set(placements.map(p => p.teamId));
        expect(teamsSeen.size).toBe(n);
        const places = placements.map(p => p.placement).sort((x, y) => x - y);
        expect(places).toEqual(Array.from({ length: n }, (_, i) => i + 1));

        // Champion en tête, groupe champion unique.
        expect(placements.find(p => p.placement === 1)!.teamId).toBe(championOf(finished));
        expect(placements.filter(p => p.group === 'champion')).toHaveLength(1);
        expect(placements.filter(p => p.group === 'gf_loser')).toHaveLength(1);

        // Aucun match resté pending avec deux équipes.
        expect(pendingPlayable(finished)).toHaveLength(0);
      }
    });
  }

  it('les stats agrégées sont conservatives (somme des déltas comptés = 0 hors forfaits asymétriques)', () => {
    // Sans forfait ni retrait, chaque but marqué par A est encaissé par B :
    // la somme des déltas doit être nulle.
    const finished = playOut(gen(16), 7);
    const stats = computeTeamStats(finished);
    const total = Array.from(stats.values()).reduce((sum, s) => sum + s.goalDiff, 0);
    expect(total).toBe(0);
  });

  it('groupes nominaux compressés : 20 équipes → pas de trous dans les places', () => {
    const finished = playOut(gen(20), 99);
    const placements = computePlacements(finished);
    expect(placements.map(p => p.placement).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

// ── Départage ───────────────────────────────────────────────────────────────

describe('rankWithinGroup', () => {
  it('délta normalisé prime, puis buts marqués, puis face-à-face', () => {
    // Bracket 8 : construire deux perdants LR1 avec des stats contrôlées.
    let b = genFlat(8);
    // W1-1 : t1 bat t8 6-0 (3 manches 2-0) → t8 délta −6.
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 2, b: 0 }, { a: 2, b: 0 }, { a: 2, b: 0 }] });
    // W1-2 : t4 bat t5 3-0 → t5 délta −3.
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    // L1-1 : t8 vs t5 → t5 gagne 3-0 → t8 éliminé en L1 (délta −9), t5 remonte.
    b = advanceMatch(b, 'L1-1', { type: 'winner', winner: 'b', scores: [{ a: 0, b: 1 }, { a: 0, b: 1 }, { a: 0, b: 1 }] });
    const stats = computeTeamStats(b);
    expect(stats.get('t8')!.goalDiff).toBe(-9);
    // t8 est éliminé au groupe L1 — placement provisoire cohérent.
    const placements = computePlacements(b);
    const t8 = placements.find(p => p.teamId === 't8')!;
    expect(t8.group).toBe('L1');
    expect(t8.needsAdminTiebreak).toBe(false);
  });

  it('égalité parfaite à deux SANS face-à-face → needsAdminTiebreak', () => {
    // Deux équipes éliminées au même groupe avec exactement les mêmes stats
    // et qui ne se sont jamais rencontrées.
    let b = genFlat(8);
    // W1-1 : t1 bat t8 3-0 ; W1-2 : t4 bat t5 3-0 (t8 et t5 : délta −3, 0 marqué).
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    // W1-3 : t2 bat t7 3-0 ; W1-4 : t3 bat t6 3-0 (t7 et t6 pareil).
    b = advanceMatch(b, 'W1-3', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    b = advanceMatch(b, 'W1-4', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }] });
    // L1 : t8/t5 → t8 double forfait avec t5 ? Non — on veut qu'ils SOIENT
    // éliminés au même groupe sans s'être joués : L1-1 (t8 vs t5) et
    // L1-2 (t7 vs t6) : les perdants de L1-1 et L1-2 tombent au groupe L1.
    b = advanceMatch(b, 'L1-1', { type: 'winner', winner: 'b', scores: [{ a: 0, b: 1 }, { a: 0, b: 1 }, { a: 0, b: 1 }] });
    b = advanceMatch(b, 'L1-2', { type: 'winner', winner: 'b', scores: [{ a: 0, b: 1 }, { a: 0, b: 1 }, { a: 0, b: 1 }] });
    // Éliminés L1 : t8 (délta −6, 0 marqué, 2 matchs → −3/match) et t7 (idem).
    const placements = computePlacements(b);
    const l1 = placements.filter(p => p.group === 'L1');
    expect(l1).toHaveLength(2);
    expect(l1.every(p => p.needsAdminTiebreak)).toBe(true);
  });

  it('égalité parfaite à deux AVEC face-à-face → départagée sans admin', () => {
    let b = genFlat(4);
    // W1-1 : t1 bat t4 3-2 ; W1-2 : t2 bat t3 3-2.
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }] });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }] });
    // L1-1 : t4 bat t3 3-2 → t3 éliminé (groupe L1, seul) ; t4 remonte.
    b = advanceMatch(b, 'L1-1', { type: 'winner', winner: 'a', scores: [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }] });
    const placements = computePlacements(b);
    expect(placements.find(p => p.teamId === 't3')!.needsAdminTiebreak).toBe(false);
  });
});
