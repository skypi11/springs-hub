// Préréglages du moteur de compétitions — valeurs par défaut « Legends
// Springs Cup » issues de la spec validée (docs/legends-springs-cup-spec.md).
// Le moteur reste générique : ces constantes ne servent qu'à pré-remplir les
// formulaires admin (bouton « Préréglage Legends »), tout est éditable.

import type {
  CompetitionEligibility,
  CompetitionFormat,
  PhasePlanEntry,
} from '@/types/competitions';

// Barème v2 (spec §11) — lu sur la place COMPRESSÉE 1→N. Propriétés calibrées :
// 3× 10e place (51 pts) > 1 victoire isolée (40) ; 3× 16e (33) < 1 victoire.
export const LEGENDS_POINTS_SCALE: Record<string, number> = {
  '1': 40, '2': 34, '3': 30, '4': 26, '5': 24, '6': 22, '7': 20, '8': 19,
  '9': 18, '10': 17, '11': 16, '12': 15, '13': 14, '14': 13, '15': 12, '16': 11,
  '17': 10, '18': 10, '19': 9, '20': 9, '21': 8, '22': 8, '23': 7, '24': 7,
  '25': 6, '26': 6, '27': 5, '28': 5, '29': 4, '30': 4, '31': 3, '32': 3,
};

// BO5 partout sauf : 2 dernières rondes winners (demi + finale), 2 dernières
// rondes losers (demi + finale), grande finale + reset — en BO7 (décision R5-3).
export const LEGENDS_FORMAT: CompetitionFormat = {
  kind: 'double_elim',
  maxTeams: 32,
  bo: {
    default: 5,
    overrides: [
      { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
      { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
      { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
      { bracket: 'losers', roundsFromEnd: 2, bo: 7 },
    ],
    grandFinal: 7,
  },
  bracketReset: true,
  // Forfait BO5 : 3 manches 1-0 → délta ±3 (spec §11). Les matchs BO7 dérivent
  // leur score conventionnel de leur propre BO (4 manches) au moment du calcul.
  forfeitScore: { games: 3, goalsPerGame: 1 },
};

// Règles MMR 2v2 (spec §3) : réf = 70 % actuel + 30 % peak, toute compo de 3
// alignable ≤ 1850 de moyenne et ≤ 150 d'écart, plafond individuel 1900.
export const LEGENDS_ELIGIBILITY: CompetitionEligibility = {
  requireVerifiedAccounts: true,
  minAge: 16,
  mmr: {
    weightCurrent: 0.7,
    maxAvg: 1850,
    maxGap: 150,
    maxPlayer: 1900,
  },
};

export const LEGENDS_ROSTER = { starters: 3, subsMax: 2 };

// Fenêtres jour de match (spec §8-9).
export const LEGENDS_CHECKIN = {
  generalCheckinMinutes: 20, // check-in général 14h30 → 14h50
  matchCheckinMinutes: 5,
  scoreCounterMinutes: 3,
};

// Plan de phases par défaut pour un double élim 32 équipes sur 2 jours
// (découpage validé de la spec §2 — « un full-winner joue 3 matchs le jour 1 »).
// N=32 : winners WR1→WR5, losers LR1→LR8, grande finale (+ reset pré-créé).
// Le plan reste ajustable par l'admin ; pour N < 32 le générateur de bracket
// (Lot 2) recalera les rondes réellement existantes.
export function buildLegendsPhasePlan(): PhasePlanEntry[] {
  return [
    { phase: 1, day: 1, label: 'P1 — WR1', rounds: [{ bracket: 'winners', round: 1 }] },
    { phase: 2, day: 1, label: 'P2 — WR2 + LR1', rounds: [{ bracket: 'winners', round: 2 }, { bracket: 'losers', round: 1 }] },
    { phase: 3, day: 1, label: 'P3 — WR3 + LR2', rounds: [{ bracket: 'winners', round: 3 }, { bracket: 'losers', round: 2 }] },
    { phase: 4, day: 1, label: 'P4 — LR3', rounds: [{ bracket: 'losers', round: 3 }] },
    { phase: 5, day: 1, label: 'P5 — LR4', rounds: [{ bracket: 'losers', round: 4 }] },
    { phase: 6, day: 2, label: 'P6 — Demi-finales WB + LR5', rounds: [{ bracket: 'winners', round: 4 }, { bracket: 'losers', round: 5 }] },
    { phase: 7, day: 2, label: 'P7 — LR6', rounds: [{ bracket: 'losers', round: 6 }] },
    { phase: 8, day: 2, label: 'P8 — LR7', rounds: [{ bracket: 'losers', round: 7 }] },
    { phase: 9, day: 2, label: 'P9 — Finale WB', rounds: [{ bracket: 'winners', round: 5 }] },
    { phase: 10, day: 2, label: 'P10 — Finale LB', rounds: [{ bracket: 'losers', round: 8 }] },
    { phase: 11, day: 2, label: 'P11 — Grande finale (+ reset)', rounds: [{ bracket: 'grand_final', round: 1 }] },
  ];
}

// Ordre de départage cutline top-16 (spec §11) : meilleur placement unique du
// circuit → délta cumulé sur les Qualifs comptés → résultat du plus récent.
export const LEGENDS_TIE_BREAKERS = ['best_placement', 'goal_diff_total', 'latest_event'] as const;

export const LEGENDS_CIRCUIT = {
  bestResultsCount: 3,
  lanTeamCount: 16,
};
