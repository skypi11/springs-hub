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
// N=32 : winners WR1→WR5, losers LR1→LR8, grande finale + reset (P11).
// Le rattachement se fait par NUMÉRO DE RONDE ABSOLU (generate.ts) : les
// rondes inexistantes sont simplement ignorées. Comme les byes ne réduisent
// PAS le nombre de rondes (size = nextPowerOfTwo(N)), ce plan est correct pour
// tout N ∈ [17, 32] (winnersRounds = 5), le profil des Qualifs Legends. Pour
// N ≤ 16 (size ≤ 16, moins de rondes) les libellés seraient décalés : prévoir
// alors un plan dérivé de la taille effective. Le plan reste ajustable admin.
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
    // Le reset pré-créé est grand_final round 2 : il partage la phase de la GF.
    { phase: 11, day: 2, label: 'P11 — Grande finale (+ reset)', rounds: [{ bracket: 'grand_final', round: 1 }, { bracket: 'grand_final', round: 2 }] },
  ];
}

// ── Préréglage « Tournoi en ligne — simple élimination » ────────────────────
// Pour les tournois hors circuit (dont le tournoi test avant la Legends) :
// BO5 partout, finale BO7, pas de petite finale par défaut. Tout éditable.
export const SINGLE_ELIM_FORMAT: CompetitionFormat = {
  kind: 'single_elim',
  maxTeams: 16,
  bo: {
    default: 5,
    overrides: [],
    grandFinal: 7,   // en simple élim : BO de la FINALE
  },
  bracketReset: false,
  thirdPlace: false,
  forfeitScore: { games: 3, goalsPerGame: 1 },
};

// Plan de phases simple élim : une phase par ronde, libellés par profondeur.
// Comme le plan Legends, le rattachement se fait par ronde ABSOLUE d'un arbre
// de `size = nextPowerOfTwo(maxTeams)` : si N final donne moins de rondes, les
// premières phases ne matchent rien et sont ignorées — prévoir d'ajuster le
// plan (éditable) si le champ réel est bien plus petit que maxTeams.
export function buildSingleElimPhasePlan(maxTeams: number, thirdPlace = false): PhasePlanEntry[] {
  let size = 1;
  while (size < Math.max(4, Math.min(32, maxTeams))) size *= 2;
  const rounds = Math.log2(size);
  const labelOf = (fromEnd: number): string => {
    if (fromEnd === 0) return 'Finale';
    if (fromEnd === 1) return 'Demi-finales';
    if (fromEnd === 2) return 'Quarts';
    if (fromEnd === 3) return 'Huitièmes';
    return 'Seizièmes';
  };
  const plan: PhasePlanEntry[] = [];
  for (let r = 1; r <= rounds; r++) {
    const isFinal = r === rounds;
    // La petite finale (losers round 1) se joue avec la finale — seulement si
    // elle est activée (la validation refuse un plan qui la cite sans elle).
    plan.push({
      phase: r,
      day: 1,
      label: `P${r} — ${labelOf(rounds - r)}${isFinal && thirdPlace ? ' + petite finale' : ''}`,
      rounds: isFinal && thirdPlace
        ? [{ bracket: 'winners', round: r }, { bracket: 'losers', round: 1 }]
        : [{ bracket: 'winners', round: r }],
    });
  }
  return plan;
}

// ── Préréglage « Ligue / poules — round robin » ─────────────────────────────
// Chaque équipe affronte toutes les autres de sa poule ; classement par
// points (3/1/0 par défaut). BO identique sur tous les matchs de poule
// (`bo.default` — pas d'overrides par ronde, refusés par la validation ;
// `grandFinal` est forcé à la même valeur, aucun match n'est « une finale »).
export const ROUND_ROBIN_FORMAT: CompetitionFormat = {
  kind: 'round_robin',
  maxTeams: 8,
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false,
  groupCount: 1,
  doubleRound: false,
  points: { win: 3, draw: 1, loss: 0 },
  forfeitScore: { games: 3, goalsPerGame: 1 },
};

/** Journées d'un round robin pour `teamCount` équipes en `groupCount` poules
 *  (la plus grande poule dicte le nombre de journées d'un leg ; ×2 en
 *  aller-retour). Partagé avec buildRoundRobinPhasePlan et les résumés. */
export function roundRobinMatchdays(teamCount: number, groupCount: number, doubleRound: boolean): number {
  const poolSize = Math.ceil(Math.max(2, teamCount) / Math.max(1, groupCount));
  const legDays = poolSize % 2 === 0 ? poolSize - 1 : poolSize;
  return doubleRound ? legDays * 2 : legDays;
}

// Plan de phases round robin : une phase par JOURNÉE (jour 1 par défaut,
// ajustable admin). Comme les autres builders, calculé sur maxTeams : si le
// champ réel est plus petit, les journées inexistantes ne matchent rien et
// sont ignorées par attachPhasePlan — symétrique des élims.
export function buildRoundRobinPhasePlan(
  teamCount: number,
  groupCount: number,
  doubleRound: boolean,
): PhasePlanEntry[] {
  const days = roundRobinMatchdays(teamCount, groupCount, doubleRound);
  const plan: PhasePlanEntry[] = [];
  for (let d = 1; d <= days; d++) {
    plan.push({
      phase: d,
      day: 1,
      label: `J${d}`,
      rounds: [{ bracket: 'round_robin', round: d }],
    });
  }
  return plan;
}

// ── Préréglage « Système suisse » ───────────────────────────────────────────
// Rondes générées INCRÉMENTALEMENT (la ronde N+1 s'apparie sur les résultats
// des rondes 1..N — action console « generate_next_round »). BO unique,
// classement par points + Buchholz.
export const SWISS_FORMAT: CompetitionFormat = {
  kind: 'swiss',
  maxTeams: 16,
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false,
  swissRounds: 4,                       // ⌈log2(16)⌉
  points: { win: 3, draw: 1, loss: 0 },
  forfeitScore: { games: 3, goalsPerGame: 1 },
};

// Plan de phases suisse : une phase par RONDE (jour 1 par défaut, ajustable
// admin). Chaque ronde matérialisée au fil des résultats se rattache à sa
// phase via attachPhasePlan au moment de sa génération.
export function buildSwissPhasePlan(rounds: number): PhasePlanEntry[] {
  const plan: PhasePlanEntry[] = [];
  for (let r = 1; r <= rounds; r++) {
    plan.push({
      phase: r,
      day: 1,
      label: `Ronde ${r}`,
      rounds: [{ bracket: 'swiss', round: r }],
    });
  }
  return plan;
}

// Ordre de départage cutline top-16 (spec §11) : meilleur placement unique du
// circuit → délta cumulé sur les Qualifs comptés → résultat du plus récent.
export const LEGENDS_TIE_BREAKERS = ['best_placement', 'goal_diff_total', 'latest_event'] as const;

export const LEGENDS_CIRCUIT = {
  bestResultsCount: 3,
  lanTeamCount: 16,
  // Dotation Legends : 1 200 € cash, remis à la LAN uniquement (spec §1).
  prizePool: { amount: 1200, currency: 'EUR', note: 'Remis à la LAN finale' },
};
