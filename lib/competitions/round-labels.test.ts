import { describe, it, expect } from 'vitest';
import { roundLabel, roundNameFromEnd } from './round-labels';

describe('roundNameFromEnd', () => {
  it('donne les noms consacrés du plus proche de la fin au plus lointain', () => {
    expect(roundNameFromEnd(0)).toBe('Finale');
    expect(roundNameFromEnd(1)).toBe('Demi-finales');
    expect(roundNameFromEnd(2)).toBe('Quarts');
    expect(roundNameFromEnd(3)).toBe('Huitièmes');
    expect(roundNameFromEnd(4)).toBe('Seizièmes');
    // Ajouté avec le passage du cap à 64 : sans lui, le premier tour d'un
    // arbre de 64 s'affichait « Tour 1 ».
    expect(roundNameFromEnd(5)).toBe('Trente-deuxièmes');
  });

  it('renvoie null hors des noms consacrés (l’appelant retombe sur « Tour N »)', () => {
    expect(roundNameFromEnd(6)).toBeNull();
    expect(roundNameFromEnd(-1)).toBeNull();
    expect(roundNameFromEnd(1.5)).toBeNull();
  });
});

describe('roundLabel', () => {
  it('nomme tous les tours d’un arbre de 32 (5 tours)', () => {
    expect([1, 2, 3, 4, 5].map(r => roundLabel(r, 5)))
      .toEqual(['Seizièmes', 'Huitièmes', 'Quarts', 'Demi-finales', 'Finale']);
  });

  it('nomme tous les tours d’un arbre de 64 (6 tours)', () => {
    expect([1, 2, 3, 4, 5, 6].map(r => roundLabel(r, 6)))
      .toEqual(['Trente-deuxièmes', 'Seizièmes', 'Huitièmes', 'Quarts', 'Demi-finales', 'Finale']);
  });

  it('retombe sur « Tour N » au-delà des noms consacrés', () => {
    // Arbre de 128 : le premier tour n'a pas de nom d'usage établi.
    expect(roundLabel(1, 7)).toBe('Tour 1');
    expect(roundLabel(2, 7)).toBe('Trente-deuxièmes');
  });
});
