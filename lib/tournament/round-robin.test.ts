// Tests du moteur ROUND ROBIN (generateRoundRobin) + interaction avec la
// progression partagée (advanceMatch/withdrawTeam/replaceTeam). Mêmes
// conventions que tournament.test.ts : property tests EXHAUSTIFS et
// déterministes sur toutes les combinaisons valides (tailles × poules ×
// aller-retour) — pas d'échantillonnage.

import { describe, it, expect } from 'vitest';
import {
  generateRoundRobin,
  snakePools,
  roundRobinBlocker,
  advanceMatch,
  withdrawTeam,
  replaceTeam,
  RR_MIN_TEAMS,
  RR_MAX_POOL_SIZE,
  type Bracket,
  type BoConfig,
  type GameScore,
} from './index';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function gen(n: number, groups = 1, doubleRound = false): Bracket {
  return generateRoundRobin(teams(n), { bo: BO, forfeitScore: FORFEIT, groups, doubleRound });
}

/** Score 3-0 pour le camp donné (BO5 : 3 manches gagnées 1-0). */
function sweep(winner: 'a' | 'b'): GameScore[] {
  return Array.from({ length: 3 }, () =>
    winner === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

// Toutes les combinaisons valides à couvrir : n 4→16 × groups 1→3 (quand
// chaque poule garde ≥ 2 équipes) × aller simple/retour. 16 équipes en 3
// poules couvrent les tailles inégales (6/5/5).
const CASES: Array<{ n: number; groups: number; doubleRound: boolean }> = [];
for (let n = 4; n <= 16; n++) {
  for (const groups of [1, 2, 3]) {
    if (groups > Math.floor(n / 2)) continue;
    for (const doubleRound of [false, true]) {
      CASES.push({ n, groups, doubleRound });
    }
  }
}

describe('snakePools — répartition serpentine', () => {
  it('sépare les têtes de série et équilibre les tailles (toutes tailles)', () => {
    for (let n = 4; n <= 64; n++) {
      for (let groups = 1; groups <= Math.min(16, Math.floor(n / 2)); groups++) {
        const pools = snakePools(n, groups);
        expect(pools).toHaveLength(groups);
        // Chaque seed exactement une fois.
        const all = pools.flat().sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        // Seeds 1..G dans des poules distinctes (row 0 du serpentin).
        for (let s = 1; s <= groups; s++) {
          expect(pools[s - 1][0]).toBe(s);
        }
        // Tailles ⌈n/G⌉ / ⌊n/G⌋.
        const sizes = pools.map(p => p.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      }
    }
  });

  it('alterne le sens une rangée sur deux (serpentin, pas modulo)', () => {
    // 8 équipes, 3 poules : rangée 0 → 1,2,3 ; rangée 1 (inversée) → 6,5,4 ;
    // rangée 2 → 7,8. Un modulo naïf donnerait 4 à la poule 1 (avec 1 et 7).
    expect(snakePools(8, 3)).toEqual([[1, 6, 7], [2, 5, 8], [3, 4]]);
  });
});

describe('generateRoundRobin — structure (property tests exhaustifs)', () => {
  it('refuse bornes, doublons et poules invalides', () => {
    expect(() => gen(RR_MIN_TEAMS - 1)).toThrow();
    expect(() => generateRoundRobin(teams(65), { bo: BO, forfeitScore: FORFEIT })).toThrow();
    expect(() => generateRoundRobin(['a', 'a', 'b', 'c'], { bo: BO, forfeitScore: FORFEIT })).toThrow();
    expect(() => gen(8, 0)).toThrow();
    expect(() => gen(8, 5)).toThrow();      // poule de 1
    // Poule au-delà de RR_MAX_POOL_SIZE : 42 équipes en 2 poules → 21.
    expect(() => gen(42, 2)).toThrow();
    expect(RR_MAX_POOL_SIZE).toBe(20);
  });

  for (const { n, groups, doubleRound } of CASES) {
    const label = `${n} équipes, ${groups} poule(s)${doubleRound ? ', aller-retour' : ''}`;
    it(label, () => {
      const b = gen(n, groups, doubleRound);
      const legs = doubleRound ? 2 : 1;
      const pools = snakePools(n, groups);
      const poolOf = new Map<string, number>();
      pools.forEach((seeds, gi) => {
        for (const s of seeds) poolOf.set(`t${s}`, gi + 1);
      });

      // Métadonnées du bracket.
      expect(b.kind).toBe('round_robin');
      expect(b.size).toBe(n);
      expect(b.winnersRounds).toBe(0);
      expect(b.losersRounds).toBe(0);
      expect(b.groups).toBe(groups);
      expect(b.doubleRound).toBe(doubleRound);
      const biggest = Math.max(...pools.map(p => p.length));
      const legDays = biggest % 2 === 0 ? biggest - 1 : biggest;
      expect(b.matchdays).toBe(legDays * legs);

      // Nombre total de matchs = Σ C(taille, 2) × legs.
      const expected = legs * pools.reduce((sum, p) => sum + (p.length * (p.length - 1)) / 2, 0);
      expect(b.order).toHaveLength(expected);
      expect(Object.keys(b.matches)).toHaveLength(expected);

      // Chaque paire INTRA-poule exactement `legs` fois ; aucune inter-poules.
      const pairCounts = new Map<string, number>();
      for (const id of b.order) {
        const m = b.matches[id];
        expect(m.teamA).toBeTruthy();
        expect(m.teamB).toBeTruthy();
        expect(poolOf.get(m.teamA!)).toBe(m.group);
        expect(poolOf.get(m.teamB!)).toBe(m.group);
        const key = pairKey(m.teamA!, m.teamB!);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of pairCounts) {
        const [x, y] = key.split('|');
        expect(poolOf.get(x)).toBe(poolOf.get(y)); // jamais inter-poules
        expect(count).toBe(legs);
      }

      // Chaque équipe joue (taille de sa poule − 1) × legs matchs.
      const perTeam = new Map<string, number>();
      for (const id of b.order) {
        const m = b.matches[id];
        perTeam.set(m.teamA!, (perTeam.get(m.teamA!) ?? 0) + 1);
        perTeam.set(m.teamB!, (perTeam.get(m.teamB!) ?? 0) + 1);
      }
      for (const t of teams(n)) {
        const poolSize = pools[poolOf.get(t)! - 1].length;
        expect(perTeam.get(t) ?? 0).toBe((poolSize - 1) * legs);
      }

      // Jamais deux matchs d'une même équipe dans la même journée.
      const byDay = new Map<number, Set<string>>();
      for (const id of b.order) {
        const m = b.matches[id];
        const seen = byDay.get(m.round) ?? new Set<string>();
        expect(seen.has(m.teamA!)).toBe(false);
        expect(seen.has(m.teamB!)).toBe(false);
        seen.add(m.teamA!);
        seen.add(m.teamB!);
        byDay.set(m.round, seen);
      }

      // Invariants de forme de chaque match.
      for (const id of b.order) {
        const m = b.matches[id];
        expect(m.bracket).toBe('round_robin');
        expect(m.status).toBe('pending');
        expect(m.bo).toBe(BO.default);
        expect(m.voidA).toBe(false);
        expect(m.voidB).toBe(false);
        expect(m.sourceA.type).toBe('seed');
        expect(m.sourceB.type).toBe('seed');
        expect(m.group).toBeGreaterThanOrEqual(1);
        expect(m.group).toBeLessThanOrEqual(groups);
        expect(m.id).toBe(`R${m.round}-${m.slot}`);
      }

      // Slots globaux contigus 1..k par journée + order aligné (round, slot).
      for (const [day, ids] of groupByDay(b).entries()) {
        const slots = ids.map(id => b.matches[id].slot).sort((a, b2) => a - b2);
        expect(slots).toEqual(Array.from({ length: slots.length }, (_, i) => i + 1));
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(b.matchdays!);
      }
      const sortedOrder = [...b.order].sort((x, y) =>
        b.matches[x].round - b.matches[y].round || b.matches[x].slot - b.matches[y].slot);
      expect(b.order).toEqual(sortedOrder);

      // Aller-retour : la journée d+R rejoue les paires de la journée d,
      // camps inversés.
      if (doubleRound) {
        const byDayPairs = new Map<number, Map<string, { a: string; b: string }>>();
        for (const id of b.order) {
          const m = b.matches[id];
          const entry = byDayPairs.get(m.round) ?? new Map();
          entry.set(pairKey(m.teamA!, m.teamB!), { a: m.teamA!, b: m.teamB! });
          byDayPairs.set(m.round, entry);
        }
        for (let d = 1; d <= legDays; d++) {
          const leg1 = byDayPairs.get(d);
          const leg2 = byDayPairs.get(d + legDays);
          // Les petites poules peuvent manquer certaines journées des deux
          // legs à l'identique.
          expect([...(leg1?.keys() ?? [])].sort()).toEqual([...(leg2?.keys() ?? [])].sort());
          for (const [key, sides] of leg1 ?? []) {
            const back = leg2!.get(key)!;
            expect(back.a).toBe(sides.b);
            expect(back.b).toBe(sides.a);
          }
        }
      }
    });
  }

  function groupByDay(b: Bracket): Map<number, string[]> {
    const out = new Map<number, string[]>();
    for (const id of b.order) {
      const m = b.matches[id];
      const arr = out.get(m.round) ?? [];
      arr.push(id);
      out.set(m.round, arr);
    }
    return out;
  }

  it('déterministe : mêmes équipes → même bracket', () => {
    const a = gen(11, 3, true);
    const b = gen(11, 3, true);
    expect(a).toEqual(b);
  });
});

describe('advanceMatch en round robin — la propagation est un no-op', () => {
  it('un résultat ne touche QUE le match pivot', () => {
    const b = gen(8, 2);
    const id = b.order[0];
    const after = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: sweep('a') });
    expect(after.matches[id].status).toBe('completed');
    expect(after.matches[id].winner).toBe('a');
    for (const other of after.order) {
      if (other === id) continue;
      expect(after.matches[other]).toEqual(b.matches[other]);
    }
  });

  it('double forfait : défaite comptée des deux côtés, aucun aval affecté', () => {
    const b = gen(6);
    const id = b.order[0];
    const after = advanceMatch(b, id, { type: 'forfeit', team: 'both' });
    const m = after.matches[id];
    expect(m.status).toBe('completed');
    expect(m.forfeit).toBe('both');
    expect(m.winner).toBeNull();
    expect(m.statsCountA).toBe(true);
    expect(m.statsCountB).toBe(true);
    for (const other of after.order) {
      if (other === id) continue;
      expect(after.matches[other]).toEqual(b.matches[other]);
    }
  });

  it('tous les matchs joués → chaque match terminal, aucun résiduel', () => {
    let b = gen(7, 2, false);
    for (const id of [...b.order]) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: sweep('a') });
    }
    for (const id of b.order) {
      expect(b.matches[id].status).toBe('completed');
    }
  });
});

describe('withdrawTeam en round robin (R5-4)', () => {
  it('les matchs restants du retiré deviennent des forfaits crédités, les joués restent', () => {
    let b = gen(6);
    // t1 joue et gagne son premier match.
    const firstOfT1 = b.order.find(id => {
      const m = b.matches[id];
      return m.teamA === 't1' || m.teamB === 't1';
    })!;
    const side = b.matches[firstOfT1].teamA === 't1' ? 'a' : 'b';
    b = advanceMatch(b, firstOfT1, { type: 'winner', winner: side, scores: sweep(side) });

    const after = withdrawTeam(b, 't1');
    expect(after.withdrawn).toContain('t1');
    // Le match joué est intact.
    expect(after.matches[firstOfT1]).toEqual(b.matches[firstOfT1]);
    // Tous les autres matchs de t1 : forfait conventionnel, adversaire
    // vainqueur, stats du retiré figées.
    for (const id of after.order) {
      if (id === firstOfT1) continue;
      const m = after.matches[id];
      if (m.teamA !== 't1' && m.teamB !== 't1') {
        expect(m).toEqual(b.matches[id]);
        continue;
      }
      const withdrawnSide = m.teamA === 't1' ? 'a' : 'b';
      expect(m.status).toBe('completed');
      expect(m.forfeit).toBe(withdrawnSide);
      expect(m.winner).toBe(withdrawnSide === 'a' ? 'b' : 'a');
      expect(withdrawnSide === 'a' ? m.statsCountA : m.statsCountB).toBe(false);
      expect(withdrawnSide === 'a' ? m.statsCountB : m.statsCountA).toBe(true);
    }
  });
});

describe('replaceTeam en round robin (avant le premier match joué)', () => {
  it('remplace l\'équipe dans tous ses matchs', () => {
    const b = gen(8, 2);
    const after = replaceTeam(b, 't3', 'waitlist1');
    expect(after.teams).toContain('waitlist1');
    expect(after.teams).not.toContain('t3');
    for (const id of after.order) {
      const m = after.matches[id];
      expect(m.teamA).not.toBe('t3');
      expect(m.teamB).not.toBe('t3');
    }
    const count = after.order.filter(id =>
      after.matches[id].teamA === 'waitlist1' || after.matches[id].teamB === 'waitlist1').length;
    expect(count).toBe(3); // poule de 4 → 3 matchs
  });

  it('slot vidé (personne en waitlist) : les matchs deviennent des walkovers sans stats', () => {
    const b = gen(6);
    const after = replaceTeam(b, 't2', null);
    for (const id of after.order) {
      const m = after.matches[id];
      if (b.matches[id].teamA !== 't2' && b.matches[id].teamB !== 't2') {
        expect(m).toEqual(b.matches[id]);
        continue;
      }
      expect(m.status).toBe('walkover');
      expect(m.scores).toBeNull();
    }
  });

  it('refusé dès qu\'un match est joué', () => {
    let b = gen(6);
    b = advanceMatch(b, b.order[0], { type: 'winner', winner: 'a', scores: sweep('a') });
    expect(() => replaceTeam(b, 't5', 'x')).toThrow();
  });
});

// ── Régression review : faisabilité pour l'effectif RÉEL ────────────────────

describe('roundRobinBlocker — source unique des règles de faisabilité', () => {
  it('signale exactement ce que generateRoundRobin refuserait', () => {
    // Le scénario du blocker : format « 4 poules » validé sur maxTeams=16,
    // mais seulement 6 équipes inscrites → la route doit refuser AVANT le
    // générateur, avec le même message.
    expect(roundRobinBlocker(6, 4)).toContain('Trop de poules');
    expect(roundRobinBlocker(3, 1)).toContain('hors bornes');
    expect(roundRobinBlocker(65, 8)).toContain('hors bornes');
    expect(roundRobinBlocker(42, 2)).toContain('Poule trop grande');
    expect(roundRobinBlocker(6, 0)).toContain('poules invalide');
    expect(roundRobinBlocker(8, 2)).toBeNull();
    expect(roundRobinBlocker(64, 8)).toBeNull();
  });

  it('generateRoundRobin jette le même message (jamais de divergence)', () => {
    expect(() => generateRoundRobin(teams(6), { bo: BO, forfeitScore: FORFEIT, groups: 4 }))
      .toThrow(roundRobinBlocker(6, 4)!);
  });
});
