// Les types de tournoi proposés à la création — le premier écran du
// formulaire. Un préréglage règle TOUT (format, étapes, éligibilité, roster,
// nombre de journées) : il ne reste que le nom et les dates. Tout est ensuite
// modifiable, rien n'est verrouillé.
//
// Module PUR et client-safe. Chaque préréglage est couvert par un test qui
// vérifie qu'il produit une compétition acceptée par la validation serveur.

import type {
  CompetitionEligibility,
  CompetitionFormat,
  TournamentStage,
} from '@/types/competitions';
import {
  LEGENDS_CHECKIN,
  LEGENDS_ELIGIBILITY,
  LEGENDS_FORMAT,
  LEGENDS_ROSTER,
} from './defaults';
import { defaultFormatFor, normalizeFormat, setConfigValue } from './format-config';
import { buildPlanBlocks } from './schedule-plan';

export interface CreationPreset {
  id: string;
  label: string;
  /** Une phrase : ce que vit un participant, pas la mécanique interne. */
  description: string;
  format: CompetitionFormat;
  /** Séquence d'étapes (null = tournoi à une seule étape). */
  stages: TournamentStage[] | null;
  eligibility: CompetitionEligibility;
  roster: { starters: number; subsMax: number };
  checkin: typeof LEGENDS_CHECKIN;
  /** Journées de compétition pré-remplies. */
  dayCount: number;
  /** Rattaché à un circuit existant par défaut (préréglage Legends). */
  wantsCircuit?: boolean;
}

// Réglages communs aux tournois hors Legends : comptes vérifiés exigés (le
// gate anti-smurf du site), ni âge minimum ni plafond MMR.
const OPEN_ELIGIBILITY: CompetitionEligibility = {
  requireVerifiedAccounts: true,
  minAge: null,
  mmr: null,
};

const RL_ROSTER = { starters: 3, subsMax: 2 };

function elim(kind: 'single_elim' | 'double_elim', maxTeams: number): CompetitionFormat {
  return setConfigValue(defaultFormatFor(kind), 'maxTeams', maxTeams);
}

// Poules → phase finale : le format le plus demandé après l'élimination
// directe. 16 équipes en 4 poules de 4, les deux premiers de chaque poule
// filent en quarts.
const GROUPS_FORMAT = normalizeFormat({
  ...defaultFormatFor('round_robin'),
  maxTeams: 16,
  groupCount: 4,
});
const GROUPS_PLAYOFF: TournamentStage[] = [
  {
    kind: 'round_robin',
    format: GROUPS_FORMAT,
    name: 'Poules',
    transfer: { advanceCount: 8, reseed: 'standings' },
  },
  {
    kind: 'single_elim',
    format: elim('single_elim', 8),
    name: 'Phase finale',
  },
];

// Suisse → phase finale : départage un grand champ en peu de rondes, sans
// éliminer personne avant le bracket.
const SWISS_FORMAT_16 = normalizeFormat({
  ...defaultFormatFor('swiss'),
  maxTeams: 16,
  swissRounds: 4,
});
const SWISS_PLAYOFF: TournamentStage[] = [
  {
    kind: 'swiss',
    format: SWISS_FORMAT_16,
    name: 'Rondes suisses',
    transfer: { advanceCount: 8, reseed: 'standings' },
  },
  {
    kind: 'single_elim',
    format: elim('single_elim', 8),
    name: 'Phase finale',
  },
];

export const CREATION_PRESETS: CreationPreset[] = [
  {
    id: 'single-elim',
    label: 'Élimination directe',
    description: 'Une défaite et c’est fini. Le format le plus court : 16 équipes tiennent en une soirée.',
    format: elim('single_elim', 16),
    stages: null,
    eligibility: OPEN_ELIGIBILITY,
    roster: RL_ROSTER,
    checkin: LEGENDS_CHECKIN,
    dayCount: 1,
  },
  {
    id: 'double-elim',
    label: 'Double élimination',
    description: 'Deux défaites pour être sorti. Tout le monde joue au moins deux matchs.',
    format: normalizeFormat({ ...elim('double_elim', 16), bracketReset: true }),
    stages: null,
    eligibility: OPEN_ELIGIBILITY,
    roster: RL_ROSTER,
    checkin: LEGENDS_CHECKIN,
    dayCount: 1,
  },
  {
    id: 'groups-playoff',
    label: 'Poules puis phase finale',
    description: 'Quatre poules de quatre, les deux premiers de chaque poule filent en quarts.',
    format: GROUPS_FORMAT,
    stages: GROUPS_PLAYOFF,
    eligibility: OPEN_ELIGIBILITY,
    roster: RL_ROSTER,
    checkin: LEGENDS_CHECKIN,
    dayCount: 2,
  },
  {
    id: 'swiss-playoff',
    label: 'Suisse puis phase finale',
    description: 'Quatre rondes contre des équipes de niveau voisin, puis un bracket à huit.',
    format: SWISS_FORMAT_16,
    stages: SWISS_PLAYOFF,
    eligibility: OPEN_ELIGIBILITY,
    roster: RL_ROSTER,
    checkin: LEGENDS_CHECKIN,
    dayCount: 2,
  },
  {
    id: 'league',
    label: 'Ligue',
    description: 'Tout le monde affronte tout le monde, classement aux points. Une journée par semaine.',
    format: normalizeFormat({ ...defaultFormatFor('round_robin'), maxTeams: 8, groupCount: 1 }),
    stages: null,
    eligibility: OPEN_ELIGIBILITY,
    roster: RL_ROSTER,
    checkin: LEGENDS_CHECKIN,
    // Une ligue s'étale : chaque journée de championnat a son propre jour,
    // à l'inverse d'un bracket qui tient sur une soirée.
    dayCount: 7,
  },
  {
    id: 'legends-qualif',
    label: 'Qualif Legends Springs Cup',
    description: 'Le format des Qualifs : 32 équipes, double élimination sur deux jours, plafond MMR et âge minimum.',
    format: LEGENDS_FORMAT,
    stages: null,
    eligibility: LEGENDS_ELIGIBILITY,
    roster: LEGENDS_ROSTER,
    checkin: LEGENDS_CHECKIN,
    dayCount: 2,
    wantsCircuit: true,
  },
];

export function creationPreset(id: string): CreationPreset | undefined {
  return CREATION_PRESETS.find(p => p.id === id);
}

/** Les faits d'un préréglage, pour la carte de choix : ce que l'organisateur
 *  a besoin de comparer d'un coup d'œil. */
export function presetFacts(preset: CreationPreset): {
  teams: number;
  matches: number;
  days: number;
} {
  const stages = preset.stages ?? [{ kind: preset.format.kind, format: preset.format }];
  const matches = stages.reduce(
    (sum, s) => sum + buildPlanBlocks(s.format).reduce((n, b) => n + b.matchCount, 0),
    0,
  );
  return { teams: preset.format.maxTeams, matches, days: preset.dayCount };
}
