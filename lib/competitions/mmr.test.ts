import { describe, it, expect } from 'vitest';
import { computeRefMmr, analyzeLineups, computeMmrFlags } from './mmr';

// Règles Legends (spec §3) : réf = 70 % actuel + 30 % peak, moyenne ≤ 1850,
// écart ≤ 150, plafond individuel 1900.
const LEGENDS = { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 };

describe('computeRefMmr', () => {
  it('pondère 70/30 et arrondit', () => {
    expect(computeRefMmr(1800, 2000, 0.7)).toBe(1860);   // 1260 + 600
    expect(computeRefMmr(1500, 1500, 0.7)).toBe(1500);
    // 0.7×1801 + 0.3×1900 = 1260.7 + 570 = 1830.7 → 1831
    expect(computeRefMmr(1801, 1900, 0.7)).toBe(1831);
  });

  it('cas extrêmes de pondération', () => {
    expect(computeRefMmr(1000, 2000, 1)).toBe(1000);     // actuel seul
    expect(computeRefMmr(1000, 2000, 0)).toBe(2000);     // peak seul
  });
});

describe('analyzeLineups', () => {
  it('roster de 3 : une seule compo', () => {
    const { worstLineupAvg, worstLineupGap } = analyzeLineups([1800, 1700, 1600]);
    expect(worstLineupAvg).toBe(1700);
    expect(worstLineupGap).toBe(200);
  });

  it('roster de 5 : retient la PIRE moyenne (le trio le plus fort)', () => {
    // Trio le plus fort : 1900+1850+1800 = moyenne 1850
    const { worstLineupAvg } = analyzeLineups([1900, 1850, 1800, 1200, 1100]);
    expect(worstLineupAvg).toBe(1850);
  });

  it('roster de 5 : retient le PIRE écart (pas forcément la même compo)', () => {
    // Écart max possible : 1900 vs 1100 = 800 (compo 1900/x/1100)
    const { worstLineupGap } = analyzeLineups([1900, 1850, 1800, 1200, 1100]);
    expect(worstLineupGap).toBe(800);
  });

  it('moins de 3 joueurs : null (pas de compo alignable)', () => {
    const res = analyzeLineups([1800, 1700]);
    expect(res.worstLineupAvg).toBe(null);
    expect(res.worstLineupGap).toBe(null);
  });
});

describe('computeMmrFlags', () => {
  it('équipe propre : aucun drapeau', () => {
    expect(computeMmrFlags([1800, 1750, 1700], LEGENDS)).toEqual([]);
  });

  it('plafond individuel : un joueur à 1901 lève le drapeau', () => {
    expect(computeMmrFlags([1901, 1500, 1400], LEGENDS)).toContain('mmr_player_cap_exceeded');
  });

  it('sub trop fort : la compo forte dépasse la moyenne même si la moyenne 5 joueurs passe', () => {
    // Trio fort 1890/1880/1790 → moyenne 1853 > 1850. Les 2 subs faibles
    // baissent la moyenne globale mais pas celle du trio alignable.
    const flags = computeMmrFlags([1890, 1880, 1790, 1000, 1000], LEGENDS);
    expect(flags).toContain('mmr_avg_exceeded');
  });

  it('prête-nom : écart > 150 dans une compo alignable', () => {
    const flags = computeMmrFlags([1800, 1790, 1600], LEGENDS);
    expect(flags).toContain('mmr_gap_exceeded');
    expect(flags).not.toContain('mmr_avg_exceeded');
  });

  it('exactement aux bornes : pas de drapeau (≤, pas <)', () => {
    // Moyenne pile 1850, écart pile 150, joueur pile 1900
    const flags = computeMmrFlags([1900, 1850, 1800], LEGENDS);
    expect(flags).toEqual([]);
  });

  it('cumul : les trois drapeaux peuvent coexister', () => {
    // moyenne 1883 > 1850, écart 300 > 150, joueur 2000 > 1900
    const flags = computeMmrFlags([2000, 1950, 1700], LEGENDS);
    expect(flags).toContain('mmr_player_cap_exceeded');
    expect(flags).toContain('mmr_avg_exceeded');
    expect(flags).toContain('mmr_gap_exceeded');
  });
});
