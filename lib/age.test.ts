import { describe, it, expect } from 'vitest';
import { computeAge } from './age';

// On fixe `now` pour que les tests soient déterministes — pas de dépendance à l'horloge réelle.
const NOW = new Date('2026-04-12T12:00:00Z');

describe('computeAge', () => {
  it('calcule un âge classique', () => {
    expect(computeAge('2000-01-01', NOW)).toBe(26);
  });

  it('soustrait 1 an si l\'anniversaire n\'est pas encore passé cette année', () => {
    // Né en juin 2000 → en avril 2026, n'a pas encore 26 ans
    expect(computeAge('2000-06-15', NOW)).toBe(25);
  });

  it('compte l\'année pleine pile le jour de l\'anniversaire', () => {
    expect(computeAge('2000-04-12', NOW)).toBe(26);
  });

  it('ne compte pas encore l\'année la veille de l\'anniversaire', () => {
    expect(computeAge('2000-04-13', NOW)).toBe(25);
  });

  it('renvoie 0 pour un nouveau-né', () => {
    expect(computeAge('2026-01-01', NOW)).toBe(0);
  });

  it('renvoie null pour une date dans le futur', () => {
    expect(computeAge('2030-01-01', NOW)).toBe(null);
  });

  it('renvoie null pour une chaîne invalide', () => {
    expect(computeAge('not a date', NOW)).toBe(null);
  });

  it('renvoie null pour une chaîne vide', () => {
    expect(computeAge('', NOW)).toBe(null);
  });

  it('renvoie null pour non-string', () => {
    expect(computeAge(null, NOW)).toBe(null);
    expect(computeAge(undefined, NOW)).toBe(null);
    expect(computeAge(123, NOW)).toBe(null);
  });

  it('renvoie null pour un âge >= 150 (date trop ancienne)', () => {
    expect(computeAge('1800-01-01', NOW)).toBe(null);
  });

  it('gère le 29 février sur année bissextile', () => {
    // Né le 29 février 2000 (bissextile), maintenant en 2026
    // Anniversaire passé en mars/avril → 26 ans
    expect(computeAge('2000-02-29', NOW)).toBe(26);
  });
});
