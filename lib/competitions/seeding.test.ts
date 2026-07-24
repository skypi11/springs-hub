// Tests des stratégies de seeding (design §10) — lib PURE.

import { describe, expect, it } from 'vitest';
import { mmrSeedValue, orderByMmr, orderByCircuitRank, seedRankOf, type SeedableTeam } from './seeding';

const team = (
  registrationId: string,
  worstLineupAvg: number | null,
  rosterRefMmrs: number[],
  circuitTeamId: string | null = null,
  name = registrationId,
): SeedableTeam => ({ registrationId, name, worstLineupAvg, rosterRefMmrs, circuitTeamId });

describe('mmrSeedValue', () => {
  it('priorité à la compo la plus forte calculée serveur, fallback moyenne du roster, sinon 0', () => {
    expect(mmrSeedValue(team('a', 1800, [1500, 1500, 1500]))).toBe(1800);
    expect(mmrSeedValue(team('b', null, [1600, 1400, 1200]))).toBe(1400);
    expect(mmrSeedValue(team('c', null, []))).toBe(0);
    // Valeurs nulles/négatives du roster ignorées (données abîmées).
    expect(mmrSeedValue(team('d', null, [0, -5, 1500]))).toBe(1500);
  });
});

describe('orderByMmr', () => {
  it('force décroissante, départage moyenne du roster puis nom', () => {
    const teams = [
      team('mid', 1500, [1500, 1500, 1500]),
      team('top', 1800, [1700, 1800, 1900]),
      team('low', 1200, [1200, 1200, 1200]),
      // Même compo forte que mid, roster plus profond → devant mid.
      team('mid-deep', 1500, [1600, 1500, 1500]),
    ];
    expect(orderByMmr(teams)).toEqual(['top', 'mid-deep', 'mid', 'low']);
  });

  it('égalité parfaite → ordre alphabétique stable (auditable)', () => {
    const teams = [
      team('zeta', 1500, [1500], null, 'Zeta'),
      team('alpha', 1500, [1500], null, 'Alpha'),
    ];
    expect(orderByMmr(teams)).toEqual(['alpha', 'zeta']);
    // L'ordre d'entrée ne change rien.
    expect(orderByMmr([...teams].reverse())).toEqual(['alpha', 'zeta']);
  });

  it('équipes sans données MMR en fin de liste, jamais exclues', () => {
    const teams = [
      team('nodata', null, []),
      team('strong', 1700, [1700]),
    ];
    expect(orderByMmr(teams)).toEqual(['strong', 'nodata']);
  });
});

describe('orderByCircuitRank', () => {
  const ranks = new Map<string, number>([['ct-a', 1], ['ct-b', 2], ['ct-c', 3]]);

  it('rang du circuit croissant, non-classées après (par MMR puis nom)', () => {
    const teams = [
      team('newcomer-strong', 1900, [1900], null),
      team('third', 1400, [1400], 'ct-c'),
      team('first', 1500, [1500], 'ct-a'),
      team('newcomer-weak', 1100, [1100], null),
      team('second', 1600, [1600], 'ct-b'),
    ];
    expect(orderByCircuitRank(teams, ranks)).toEqual([
      'first', 'second', 'third', 'newcomer-strong', 'newcomer-weak',
    ]);
  });

  it('circuitTeamId inconnu du classement = non-classée', () => {
    const teams = [
      team('ghost', 1300, [1300], 'ct-inconnue'),
      team('first', 1500, [1500], 'ct-a'),
    ];
    expect(orderByCircuitRank(teams, ranks)).toEqual(['first', 'ghost']);
  });
});

describe('seedRankOf', () => {
  it('ordre → rang 0-based par registrationId', () => {
    const rank = seedRankOf(['x', 'y', 'z']);
    expect(rank.get('x')).toBe(0);
    expect(rank.get('z')).toBe(2);
    expect(rank.has('absent')).toBe(false);
  });
});
