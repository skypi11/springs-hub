import { describe, it, expect } from 'vitest';
import {
  getStructuresForGame,
  getAllStructureIds,
  canJoinStructure,
  addStructureToGame,
  removeStructureFromGame,
  normalizeStructurePerGame,
  isStructureCountedInCap,
  STRUCTURE_MEMBERSHIP_CAP,
} from './structure-membership';

describe('getStructuresForGame', () => {
  it('renvoie array vide si undefined', () => {
    expect(getStructuresForGame(undefined, 'rl')).toEqual([]);
    expect(getStructuresForGame(null, 'rl')).toEqual([]);
    expect(getStructuresForGame({}, 'rl')).toEqual([]);
  });

  it('wrap une string legacy en array', () => {
    expect(getStructuresForGame({ rl: 'ARAN' }, 'rl')).toEqual(['ARAN']);
  });

  it('renvoie le array tel quel', () => {
    expect(getStructuresForGame({ rl: ['ARAN', 'TTC'] }, 'rl')).toEqual(['ARAN', 'TTC']);
  });

  it('filtre les valeurs vides dans un array', () => {
    expect(getStructuresForGame({ rl: ['ARAN', '', 'TTC'] }, 'rl')).toEqual(['ARAN', 'TTC']);
  });
});

describe('canJoinStructure', () => {
  it('OK si rien pour ce jeu', () => {
    expect(canJoinStructure({}, 'rl', 'ARAN')).toEqual({ ok: true });
  });

  it('OK si 1 struct ≠ déjà présente', () => {
    expect(canJoinStructure({ rl: ['ARAN'] }, 'rl', 'TTC')).toEqual({ ok: true });
  });

  it('refuse si déjà dans la structure', () => {
    const result = canJoinStructure({ rl: ['ARAN'] }, 'rl', 'ARAN');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_in_structure');
  });

  it('refuse si cap atteint (2 différentes)', () => {
    const result = canJoinStructure({ rl: ['ARAN', 'TTC'] }, 'rl', 'GHOST');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cap_reached');
      expect(result.current).toEqual(['ARAN', 'TTC']);
    }
  });

  it('compat string legacy : refuse si déjà dans la même struct', () => {
    const result = canJoinStructure({ rl: 'ARAN' }, 'rl', 'ARAN');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_in_structure');
  });

  it('compat string legacy : autorise une seconde struct', () => {
    expect(canJoinStructure({ rl: 'ARAN' }, 'rl', 'TTC')).toEqual({ ok: true });
  });

  it('jeux indépendants', () => {
    expect(canJoinStructure({ rl: ['A', 'B'] }, 'tm', 'X')).toEqual({ ok: true });
  });
});

describe('addStructureToGame', () => {
  it('ajoute si vide', () => {
    expect(addStructureToGame({}, 'rl', 'ARAN')).toEqual(['ARAN']);
  });

  it('idempotent si déjà présente', () => {
    expect(addStructureToGame({ rl: ['ARAN'] }, 'rl', 'ARAN')).toEqual(['ARAN']);
  });

  it('ajoute en 2e position', () => {
    expect(addStructureToGame({ rl: ['ARAN'] }, 'rl', 'TTC')).toEqual(['ARAN', 'TTC']);
  });

  it('throw si cap atteint', () => {
    expect(() => addStructureToGame({ rl: ['ARAN', 'TTC'] }, 'rl', 'GHOST')).toThrow(/Cap atteint/);
  });
});

describe('removeStructureFromGame', () => {
  it('retire la struct', () => {
    expect(removeStructureFromGame({ rl: ['ARAN', 'TTC'] }, 'rl', 'ARAN')).toEqual(['TTC']);
  });

  it('renvoie le array intact si non présente', () => {
    expect(removeStructureFromGame({ rl: ['ARAN'] }, 'rl', 'X')).toEqual(['ARAN']);
  });

  it('renvoie array vide si on retire la dernière', () => {
    expect(removeStructureFromGame({ rl: ['ARAN'] }, 'rl', 'ARAN')).toEqual([]);
  });
});

describe('normalizeStructurePerGame', () => {
  it('convertit toutes les strings en arrays', () => {
    expect(normalizeStructurePerGame({ rl: 'ARAN', tm: ['A', 'B'] })).toEqual({
      rl: ['ARAN'],
      tm: ['A', 'B'],
    });
  });

  it('renvoie {} pour undefined/null', () => {
    expect(normalizeStructurePerGame(undefined)).toEqual({});
    expect(normalizeStructurePerGame(null)).toEqual({});
  });
});

describe('isStructureCountedInCap', () => {
  it('active et pending_validation comptent', () => {
    expect(isStructureCountedInCap('active')).toBe(true);
    expect(isStructureCountedInCap('pending_validation')).toBe(true);
  });

  it('archived/suspended/rejected/deletion_scheduled ne comptent pas', () => {
    expect(isStructureCountedInCap('suspended')).toBe(false);
    expect(isStructureCountedInCap('rejected')).toBe(false);
    expect(isStructureCountedInCap('deletion_scheduled')).toBe(false);
    expect(isStructureCountedInCap(undefined)).toBe(false);
    expect(isStructureCountedInCap(null)).toBe(false);
  });
});

describe('getAllStructureIds', () => {
  it('agrège tous les ids tous jeux', () => {
    expect(getAllStructureIds({ rl: ['A', 'B'], tm: ['C'] })).toEqual(['A', 'B', 'C']);
  });

  it('dédup les ids présents sur plusieurs jeux', () => {
    expect(getAllStructureIds({ rl: ['A', 'B'], tm: ['B', 'C'] })).toEqual(['A', 'B', 'C']);
  });

  it('renvoie [] si vide', () => {
    expect(getAllStructureIds({})).toEqual([]);
  });
});

describe('STRUCTURE_MEMBERSHIP_CAP', () => {
  it('est égal à 2 (validé Matt 2026-05-25)', () => {
    expect(STRUCTURE_MEMBERSHIP_CAP).toBe(2);
  });
});
