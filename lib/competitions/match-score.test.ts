import { describe, it, expect } from 'vitest';
import { winsNeeded, winsOf, normalizeGameRows, isScoreValid } from './match-score';

describe('winsNeeded', () => {
  it('BO5 → 3, BO7 → 4, BO3 → 2, BO1 → 1', () => {
    expect(winsNeeded(5)).toBe(3);
    expect(winsNeeded(7)).toBe(4);
    expect(winsNeeded(3)).toBe(2);
    expect(winsNeeded(1)).toBe(1);
  });
});

describe('winsOf', () => {
  it('compte les manches gagnées, ignore les nulles', () => {
    expect(winsOf([{ a: 3, b: 1 }, { a: 0, b: 2 }, { a: 4, b: 0 }])).toEqual({ a: 2, b: 1 });
    expect(winsOf([{ a: 1, b: 1 }])).toEqual({ a: 0, b: 0 });
    expect(winsOf([])).toEqual({ a: 0, b: 0 });
  });
});

describe('normalizeGameRows', () => {
  it('état initial [] → `needed` rangées vides', () => {
    expect(normalizeGameRows([], 5)).toEqual([{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }]);
    expect(normalizeGameRows([], 7)).toHaveLength(4);
  });

  it('sweep 3-0 en BO5 → 3 rangées, PAS de 4e', () => {
    const g = [{ a: 3, b: 0 }, { a: 2, b: 1 }, { a: 4, b: 2 }]; // a gagne les 3
    expect(normalizeGameRows(g, 5)).toHaveLength(3);
  });

  it('un 4-0 en BO5 est IMPOSSIBLE à construire (rangée en trop coupée)', () => {
    const g = [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }]; // 4 manches a
    const out = normalizeGameRows(g, 5);
    expect(out).toHaveLength(3);         // coupé à la manche décisive
    expect(winsOf(out)).toEqual({ a: 3, b: 0 });
  });

  it('2-1 en BO5 fait apparaître la 4e manche', () => {
    const g = [{ a: 3, b: 0 }, { a: 0, b: 2 }, { a: 3, b: 1 }]; // a,b,a → 2-1
    const out = normalizeGameRows(g, 5);
    expect(out).toHaveLength(4);
    expect(out[3]).toEqual({ a: 0, b: 0 }); // rangée vide ajoutée
  });

  it('3-2 en BO5 → 5 rangées, s\'arrête (pas de 6e)', () => {
    const g = [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 1 }, { a: 1, b: 0 }];
    expect(normalizeGameRows(g, 5)).toHaveLength(5);
  });

  it('une manche nulle ne décide pas → la rangée reste, pas de dépassement de bo', () => {
    const g = [{ a: 3, b: 0 }, { a: 1, b: 1 }]; // a gagne 1, puis nul
    const out = normalizeGameRows(g, 5);
    expect(out).toHaveLength(3);          // garantit `needed`, garde la nulle
    expect(out.length).toBeLessThanOrEqual(5);
  });

  it('idempotent', () => {
    for (const g of [[], [{ a: 3, b: 0 }], [{ a: 1, b: 0 }, { a: 0, b: 1 }]]) {
      const once = normalizeGameRows(g, 5);
      expect(normalizeGameRows(once, 5)).toEqual(once);
    }
  });
});

describe('isScoreValid', () => {
  it('3-0 net en BO5 = valide', () => {
    expect(isScoreValid([{ a: 3, b: 0 }, { a: 2, b: 1 }, { a: 1, b: 0 }], 5)).toBe(true);
  });
  it('incomplet (2-1) = invalide', () => {
    expect(isScoreValid([{ a: 3, b: 0 }, { a: 0, b: 2 }, { a: 3, b: 1 }], 5)).toBe(false);
  });
  it('manche nulle = invalide', () => {
    expect(isScoreValid([{ a: 3, b: 0 }, { a: 1, b: 1 }, { a: 2, b: 0 }], 5)).toBe(false);
  });
  it('4-0 (4 manches gagnées) = invalide (au-delà du requis)', () => {
    expect(isScoreValid([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }], 5)).toBe(false);
  });
  it('BO7 : 4-2 valide, 3-3 invalide', () => {
    expect(isScoreValid([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 0 }], 7)).toBe(true);
    expect(isScoreValid([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 0, b: 1 }, { a: 0, b: 1 }, { a: 0, b: 1 }], 7)).toBe(false);
  });
});
