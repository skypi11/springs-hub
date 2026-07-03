// Règles MMR du moteur de compétitions (spec Legends §3) — fonctions PURES,
// aucune I/O. Utilisées par le wizard d'inscription (drapeaux live côté
// client) ET par le serveur (source de vérité au submit + à la validation).
//
// Principe : le MMR qui compte est le MMR de RÉFÉRENCE, calculé depuis les
// valeurs déclarées par le dirigeant (pas d'API fiable — l'admin vérifie via
// le lien tracker, comptes vérifiés obligatoires). La règle d'équipe couvre
// toutes les compos alignables : n'importe quel trio parmi titulaires + subs
// doit respecter moyenne ≤ maxAvg ET écart max-min ≤ maxGap ; plafond
// individuel par joueur en plus.

import type { RegistrationFlag } from '@/types/competitions';

export interface MmrRules {
  /** réf = weightCurrent × actuel + (1 − weightCurrent) × peak, arrondi. */
  weightCurrent: number;
  maxAvg: number;
  maxGap: number;
  maxPlayer: number;
}

// MMR de référence d'un joueur. Le peak seul condamne les ex-boostés de fin
// de saison ; l'actuel seul permet le tank — la pondération équilibre les deux.
export function computeRefMmr(current: number, peak: number, weightCurrent: number): number {
  return Math.round(weightCurrent * current + (1 - weightCurrent) * peak);
}

export interface LineupAnalysis {
  /** Moyenne de la PIRE compo alignable (la plus haute) — null si < lineupSize joueurs. */
  worstLineupAvg: number | null;
  /** Écart max-min de la PIRE compo alignable (le plus grand) — null si < lineupSize joueurs. */
  worstLineupGap: number | null;
}

// Analyse toutes les compos de `lineupSize` joueurs parmi le roster complet
// (titulaires + subs, 3 à 5 joueurs en RL → au plus C(5,3) = 10 combinaisons).
// On retient la pire moyenne ET le pire écart, indépendamment (deux compos
// différentes peuvent porter chacune un dépassement).
export function analyzeLineups(refMmrs: number[], lineupSize = 3): LineupAnalysis {
  if (refMmrs.length < lineupSize) {
    return { worstLineupAvg: null, worstLineupGap: null };
  }
  let worstAvg = -Infinity;
  let worstGap = -Infinity;
  for (const combo of combinations(refMmrs, lineupSize)) {
    const sum = combo.reduce((a, b) => a + b, 0);
    const avg = sum / lineupSize;
    const gap = Math.max(...combo) - Math.min(...combo);
    if (avg > worstAvg) worstAvg = avg;
    if (gap > worstGap) worstGap = gap;
  }
  return { worstLineupAvg: Math.round(worstAvg), worstLineupGap: worstGap };
}

// Drapeaux MMR levés pour la file de validation. Ne REFUSE rien : la
// validation reste humaine (admin-in-the-loop), les drapeaux orientent l'œil.
export function computeMmrFlags(
  refMmrs: number[],
  rules: MmrRules,
  lineupSize = 3,
): RegistrationFlag[] {
  const flags: RegistrationFlag[] = [];
  if (refMmrs.some(m => m > rules.maxPlayer)) {
    flags.push('mmr_player_cap_exceeded');
  }
  const { worstLineupAvg, worstLineupGap } = analyzeLineups(refMmrs, lineupSize);
  if (worstLineupAvg !== null && worstLineupAvg > rules.maxAvg) {
    flags.push('mmr_avg_exceeded');
  }
  if (worstLineupGap !== null && worstLineupGap > rules.maxGap) {
    flags.push('mmr_gap_exceeded');
  }
  return flags;
}

// Toutes les combinaisons de taille k (itératif, k et n minuscules ici).
function combinations(values: number[], k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  function walk(start: number) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < values.length; i++) {
      combo.push(values[i]);
      walk(i + 1);
      combo.pop();
    }
  }
  walk(0);
  return result;
}
