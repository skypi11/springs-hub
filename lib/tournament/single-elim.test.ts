// Tests du moteur SIMPLE élimination (generateSingleElim + placements single).
// Mêmes conventions que tournament.test.ts : PRNG seedé (déterministe),
// property tests sur TOUTES les tailles 4→32, avec et sans petite finale.

import { describe, it, expect } from 'vitest';
import {
  generateSingleElim,
  advanceMatch,
  withdrawTeam,
  replaceTeam,
  computePlacements,
  championOf,
  isFinished,
  isConcluded,
  needsAdminDecision,
  type Bracket,
  type BoConfig,
  type PureMatch,
} from './index';

const BO: BoConfig = {
  default: 5,
  overrides: [],
  grandFinal: 7,   // en simple élim : BO de la FINALE (sauf override explicite)
};
const FLAT_BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function gen(n: number, thirdPlace = false): Bracket {
  return generateSingleElim(teams(n), { bo: BO, forfeitScore: FORFEIT, thirdPlace });
}

function genFlat(n: number, thirdPlace = false): Bracket {
  return generateSingleElim(teams(n), { bo: FLAT_BO, forfeitScore: FORFEIT, thirdPlace });
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

function playOut(b: Bracket, seed: number): Bracket {
  const rand = mulberry32(seed);
  let bracket = b;
  let guard = 0;
  while (!isFinished(bracket)) {
    const playable = pendingPlayable(bracket);
    if (playable.length === 0) {
      throw new Error('Blocage : aucun match jouable et tournoi non fini.');
    }
    const m = playable[Math.floor(rand() * playable.length)];
    const winner: 'a' | 'b' = rand() < 0.5 ? 'a' : 'b';
    bracket = advanceMatch(bracket, m.id, { type: 'winner', winner, scores: scoresFor(winner, m.bo, rand) });
    guard += 1;
    if (guard > 100) throw new Error('Boucle infinie.');
  }
  return bracket;
}

// ── Structure ───────────────────────────────────────────────────────────────

describe('generateSingleElim — structure', () => {
  it('refuse < 4, > 32 et les doublons', () => {
    expect(() => gen(3)).toThrow();
    expect(() => gen(33)).toThrow();
    expect(() => generateSingleElim(['a', 'a', 'b', 'c'], { bo: BO, forfeitScore: FORFEIT })).toThrow();
  });

  it('16 équipes : 4 rondes winners, 15 matchs, ni losers ni GF, kind single_elim', () => {
    const b = gen(16);
    expect(b.kind).toBe('single_elim');
    expect(b.winnersRounds).toBe(4);
    expect(b.losersRounds).toBe(0);
    expect(b.order).toHaveLength(15);
    expect(b.order.every(id => id.startsWith('W'))).toBe(true);
    expect(b.matches['GF']).toBeUndefined();
    expect(b.matches['GFR']).toBeUndefined();
  });

  it('petite finale : P3 branchée sur les perdants des demies, losersRounds 1', () => {
    const b = gen(8, true);
    expect(b.losersRounds).toBe(1);
    const p3 = b.matches['P3'];
    expect(p3).toBeDefined();
    expect(p3.bracket).toBe('losers');
    expect(p3.sourceA).toEqual({ type: 'loser_of', ref: 'W2-1' });
    expect(p3.sourceB).toEqual({ type: 'loser_of', ref: 'W2-2' });
    expect(b.order).toHaveLength(8);   // 7 matchs + P3
  });

  it('BO : finale en grandFinal, le reste en défaut, petite finale en défaut', () => {
    const b = gen(8, true);
    expect(b.matches['W1-1'].bo).toBe(5);
    expect(b.matches['W2-1'].bo).toBe(5);
    expect(b.matches['W3-1'].bo).toBe(7);   // finale ← bo.grandFinal
    expect(b.matches['P3'].bo).toBe(5);
  });

  it('BO : un override winners explicite prime sur grandFinal, les demies overridables', () => {
    const bo: BoConfig = {
      default: 3,
      overrides: [
        { bracket: 'winners', roundsFromEnd: 1, bo: 9 },
        { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
      ],
      grandFinal: 5,
    };
    const b = generateSingleElim(teams(8), { bo, forfeitScore: FORFEIT });
    expect(b.matches['W3-1'].bo).toBe(9);   // override > grandFinal
    expect(b.matches['W2-1'].bo).toBe(7);   // demies
    expect(b.matches['W1-1'].bo).toBe(3);
  });

  it('câblage : chaque match hors round 1 consomme deux vainqueurs de la ronde précédente', () => {
    const b = gen(32);
    for (const id of b.order) {
      const m = b.matches[id];
      if (m.round === 1 || m.id === 'P3') continue;
      for (const src of [m.sourceA, m.sourceB]) {
        expect(src.type).toBe('winner_of');
        if (src.type === 'winner_of') {
          const up = b.matches[src.ref];
          expect(up).toBeDefined();
          expect(up.round).toBe(m.round - 1);
        }
      }
    }
  });

  it('N non-puissance de 2 : les byes avancent les têtes de série sans score', () => {
    const b = gen(13);
    expect(b.size).toBe(16);
    // Seeds 14-16 absents : 3 walkovers au round 1.
    const walkovers = b.order.map(id => b.matches[id]).filter(m => m.status === 'walkover');
    expect(walkovers).toHaveLength(3);
    for (const m of walkovers) {
      expect(m.scores).toBeNull();
      expect(m.statsCountA).toBe(false);
      expect(m.statsCountB).toBe(false);
    }
  });

  it('phase plan appliqué aux rondes existantes', () => {
    const b = generateSingleElim(teams(8), {
      bo: BO, forfeitScore: FORFEIT, thirdPlace: true,
      phasePlan: [
        { phase: 1, rounds: [{ bracket: 'winners', round: 1 }] },
        { phase: 2, rounds: [{ bracket: 'winners', round: 2 }] },
        { phase: 3, rounds: [{ bracket: 'winners', round: 3 }, { bracket: 'losers', round: 1 }] },
      ],
    });
    expect(b.matches['W1-3'].phase).toBe(1);
    expect(b.matches['W2-2'].phase).toBe(2);
    expect(b.matches['W3-1'].phase).toBe(3);
    expect(b.matches['P3'].phase).toBe(3);
  });
});

// ── Champion, fin de tournoi, placements ────────────────────────────────────

describe('championOf / isFinished (simple élim)', () => {
  it('le vainqueur de la finale est champion ; sans petite finale le tournoi est fini', () => {
    const b = playOut(genFlat(4), 42);
    const final = b.matches['W2-1'];
    const expected = final.winner === 'a' ? final.teamA : final.teamB;
    expect(championOf(b)).toBe(expected);
    expect(isFinished(b)).toBe(true);
  });

  it('avec petite finale : champion connu ≠ tournoi fini tant que P3 n\'est pas réglée', () => {
    let b = genFlat(4, true);
    const rand = mulberry32(7);
    // Jouer les demies puis la FINALE d'abord (P3 reste en attente).
    for (const id of ['W1-1', 'W1-2', 'W2-1']) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: scoresFor('a', b.matches[id].bo, rand) });
    }
    expect(championOf(b)).not.toBeNull();
    expect(isFinished(b)).toBe(false);   // places 3-4 pas encore uniques
    b = advanceMatch(b, 'P3', { type: 'winner', winner: 'b', scores: scoresFor('b', b.matches['P3'].bo, rand) });
    expect(isFinished(b)).toBe(true);
  });

  it('petite finale : vainqueur 3e, perdant 4e (places compressées)', () => {
    let b = genFlat(4, true);
    const rand = mulberry32(11);
    for (const id of ['W1-1', 'W1-2', 'W2-1', 'P3']) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: scoresFor('a', b.matches[id].bo, rand) });
    }
    const placements = computePlacements(b);
    const p3 = b.matches['P3'];
    const third = placements.find(p => p.teamId === p3.teamA);
    const fourth = placements.find(p => p.teamId === p3.teamB);
    expect(third?.placement).toBe(3);
    expect(third?.group).toBe('third');
    expect(fourth?.placement).toBe(4);
    expect(fourth?.group).toBe('fourth');
  });

  it('double forfait en finale : aucun champion fabriqué, décision admin, les deux finalistes', () => {
    let b = genFlat(4);
    const rand = mulberry32(3);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    b = advanceMatch(b, 'W2-1', { type: 'forfeit', team: 'both' });
    expect(championOf(b)).toBeNull();
    expect(isConcluded(b)).toBe(true);
    expect(needsAdminDecision(b)).toBe(true);
    const placements = computePlacements(b);
    expect(placements.filter(p => p.group === 'finalist')).toHaveLength(2);
    // Pas de numérotation sans champion.
    expect(placements.every(p => p.placement === null)).toBe(true);
  });

  it('double forfait des deux demies avec petite finale : P3 annulée, tournoi injouable proprement', () => {
    let b = genFlat(8, true);
    const rand = mulberry32(5);
    for (const id of ['W1-1', 'W1-2', 'W1-3', 'W1-4']) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    }
    b = advanceMatch(b, 'W2-1', { type: 'forfeit', team: 'both' });
    b = advanceMatch(b, 'W2-2', { type: 'forfeit', team: 'both' });
    // Les 4 demi-finalistes éliminés → finale ET petite finale annulées.
    expect(b.matches['W3-1'].status).toBe('cancelled');
    expect(b.matches['P3'].status).toBe('cancelled');
    expect(championOf(b)).toBeNull();
    expect(needsAdminDecision(b)).toBe(true);
    const groups = computePlacements(b).filter(p => p.group === 'W2');
    expect(groups).toHaveLength(4);
  });

  it('régression review : demi-perdant RETIRÉ avant P3 → groupe « fourth » (R5-4), devant les double-forfaitaires', () => {
    // Scénario prouvé en review adversariale : t1 bat t4 (match réel), t4 se
    // retire, l'autre demie part en double forfait → P3 annulée. t4 a ATTEINT
    // la petite finale : elle se classe 2e (fourth), PAS avec les R5-1 en W1.
    let b = genFlat(4, true);
    const rand = mulberry32(31);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    const t4 = b.matches['W1-1'].winner === 'a' ? b.matches['W1-1'].teamB! : b.matches['W1-1'].teamA!;
    b = withdrawTeam(b, t4);
    b = advanceMatch(b, 'W1-2', { type: 'forfeit', team: 'both' });
    expect(b.matches['P3'].status).toBe('cancelled');
    expect(isFinished(b)).toBe(true);
    const placements = computePlacements(b);
    const p4 = placements.find(p => p.teamId === t4);
    expect(p4?.group).toBe('fourth');
    expect(p4?.placement).toBe(2);   // champion, puis t4 (P3 atteinte), puis les R5-1
    const r51 = placements.filter(p => p.group === 'W1');
    expect(r51).toHaveLength(2);
    expect(r51.every(p => (p.placement ?? 0) > 2)).toBe(true);
  });

  it('régression review : les demi-perdants ne sont PAS classés tant que P3 est en attente', () => {
    let b = genFlat(4, true);
    const rand = mulberry32(37);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    // P3 et finale en attente : seuls personne n'est éliminé — aucun groupe.
    const placements = computePlacements(b);
    expect(placements).toHaveLength(0);
  });

  it('property : avec petite finale, aucun perdant de demie en groupe W{k−1} (hors double forfait de la demie)', () => {
    for (const n of [4, 8, 16]) {
      for (const seed of [3, 4]) {
        const b = playOut(genFlat(n, true), seed * 100 + n);
        const k = b.winnersRounds;
        const placements = computePlacements(b);
        for (const p of placements.filter(x => x.group === `W${k - 1}`)) {
          // Seule voie légitime : une demie en double forfait.
          const semi = b.order.map(id => b.matches[id]).find(m =>
            m.bracket === 'winners' && m.round === k - 1
            && (m.teamA === p.teamId || m.teamB === p.teamId));
          expect(semi?.forfeit, `${n} équipes, ${p.teamId}`).toBe('both');
        }
      }
    }
  });

  it('demie en walkover + petite finale : un 3e sans 4e, pas de fantôme', () => {
    // 5 équipes dans un bracket de 8 : les byes créent des walkovers.
    let b = genFlat(5, true);
    const rand = mulberry32(13);
    let guard = 0;
    while (!isFinished(b)) {
      const playable = pendingPlayable(b);
      if (playable.length === 0) break;
      const m = playable[0];
      b = advanceMatch(b, m.id, { type: 'winner', winner: 'a', scores: scoresFor('a', m.bo, rand) });
      if (++guard > 20) throw new Error('boucle');
    }
    const placements = computePlacements(b);
    expect(placements).toHaveLength(5);
    const places = placements.map(p => p.placement).sort((x, y) => (x ?? 0) - (y ?? 0));
    expect(places).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── Retrait & remplacement ──────────────────────────────────────────────────

describe('withdrawTeam / replaceTeam (simple élim)', () => {
  it('retrait en cours de tournoi : forfait conventionnel, délta du retiré figé, le tournoi se termine', () => {
    let b = genFlat(8);
    const rand = mulberry32(21);
    // Round 1 joué entièrement.
    for (let s = 1; s <= 4; s++) {
      b = advanceMatch(b, `W1-${s}`, { type: 'winner', winner: 'a', scores: scoresFor('a', 5, rand) });
    }
    const victim = b.matches['W2-1'].teamA!;
    b = withdrawTeam(b, victim);
    const w2 = b.matches['W2-1'];
    expect(w2.status).toBe('completed');
    expect(w2.forfeit).toBe(victim === w2.teamA ? 'a' : 'b');
    expect(victim === w2.teamA ? w2.statsCountA : w2.statsCountB).toBe(false);
    // Le reste se joue.
    b = playOut(b, 22);
    expect(championOf(b)).not.toBeNull();
    expect(championOf(b)).not.toBe(victim);
    const placements = computePlacements(b);
    expect(placements.map(p => p.placement).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(
      Array.from({ length: 8 }, (_, i) => i + 1));
  });

  it('remplacement waitlist avant le round 1 ; slot → bye si personne', () => {
    const b = genFlat(8);
    const out = b.teams[2];
    const replaced = replaceTeam(b, out, 'newbie');
    expect(replaced.teams).toContain('newbie');
    expect(replaced.teams).not.toContain(out);

    const emptied = replaceTeam(b, out, null);
    const w1 = Object.values(emptied.matches).find(m => m.round === 1 && (m.voidA || m.voidB));
    expect(w1).toBeDefined();
    expect(w1!.status).toBe('walkover');
    expect(w1!.scores).toBeNull();
  });
});

// ── Property : toutes les tailles, avec et sans petite finale ───────────────

describe('property : simple élim joué de bout en bout', () => {
  for (let n = 4; n <= 32; n++) {
    it(`${n} équipes — déroulés seedés avec/sans petite finale : placements 1→N uniques`, () => {
      for (const thirdPlace of [false, true]) {
        for (const seed of [1, 2]) {
          const b = playOut(genFlat(n, thirdPlace), seed * 1000 + n);
          expect(isFinished(b)).toBe(true);
          expect(championOf(b)).not.toBeNull();
          const placements = computePlacements(b);
          expect(placements).toHaveLength(n);
          const places = placements.map(p => p.placement).sort((x, y) => (x ?? 0) - (y ?? 0));
          expect(places).toEqual(Array.from({ length: n }, (_, i) => i + 1));
          // Une équipe = un placement, le champion est placé 1.
          const champ = placements.find(p => p.placement === 1);
          expect(champ?.teamId).toBe(championOf(b));
          expect(champ?.group).toBe('champion');
          // Avec petite finale jouée : places 3 et 4 issues de P3.
          if (thirdPlace && b.matches['P3'].status === 'completed') {
            const third = placements.find(p => p.placement === 3);
            expect(third?.group).toBe('third');
          }
        }
      }
    });
  }

  it('nombre de matchs : N−1 (+1 avec petite finale) pour une puissance de 2', () => {
    for (const n of [4, 8, 16, 32]) {
      expect(gen(n).order).toHaveLength(n - 1);
      expect(gen(n, true).order).toHaveLength(n);
    }
  });
});
