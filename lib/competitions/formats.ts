// Registry de FORMATS de tournoi — partie DÉCLARATIVE, partagée client +
// serveur (aucun I/O, aucun moteur : le comportement serveur vit dans
// formats-server.ts — design docs/registry-formats-design.md §3).
//
// Modèle : la Game Registry (lib/games-registry.ts). Ajouter un format =
// ajouter une fiche ici + son moteur pur (lib/tournament) + son entrée dans
// FORMAT_ENGINES — la validation, les préréglages et (à terme) la page de
// création suivent la fiche.
//
// `configFields` décrit les réglages SIMPLES exposables par une UI générique
// (niveau essential/advanced — la page montre l'essentiel, replie l'avancé).
// Les réglages non représentables en champ plat (overrides de BO par ronde,
// plan de phases) restent des éditeurs dédiés du formulaire.

import type { CompetitionFormat, FormatKind } from '@/types/competitions';
import {
  LEGENDS_FORMAT,
  ROUND_ROBIN_FORMAT,
  SINGLE_ELIM_FORMAT,
  SWISS_FORMAT,
  roundRobinMatchdays,
} from './defaults';

export type { FormatKind };

export type ConfigFieldLevel = 'essential' | 'advanced';

export type ConfigField =
  | {
      key: string;                 // chemin dans CompetitionFormat ("bo.default", "groupCount")
      label: string;
      help?: string;
      level: ConfigFieldLevel;
      type: 'number';
      min: number;
      max: number;
      default: number;
    }
  | {
      key: string;
      label: string;
      help?: string;
      level: ConfigFieldLevel;
      type: 'boolean';
      default: boolean;
    };

/** Ce que la fiche déclare au multi-étapes et au seeding (design §3a) : la
 *  composition « [étape de groupes] → top-N → [étape finale] » se construit
 *  sur ces drapeaux, sans code par combinaison. */
export interface FormatCapabilities {
  /** Produit un champion mécanique (match décisif). */
  producesWinner: boolean;
  /** Produit un classement 1→N complet (placements compressés). */
  producesRanking: boolean;
  /** Peut servir d'étape de groupes (qualifie un top-N vers la suite). */
  canBeGroupStage: boolean;
  /** Peut conclure un tournoi (dernière étape). */
  canBeFinalStage: boolean;
  /** Sait répartir le champ en poules. */
  supportsPools: boolean;
  /** Compatible avec le seeding par MMR de référence. */
  supportsMmrSeeding: boolean;
}

export interface FormatPreset {
  id: string;
  label: string;
  description: string;
  format: CompetitionFormat;
}

export interface FormatDef {
  kind: FormatKind;
  label: string;
  description: string;
  configFields: ConfigField[];
  presets: FormatPreset[];
  capabilities: FormatCapabilities;
  /** Aperçu factuel pour l'organisateur pendant le réglage (« 16 équipes en
   *  4 poules de 4 — 24 matchs sur 3 journées »). Pur et léger : tourne côté
   *  client à chaque frappe. */
  summarize: (format: CompetitionFormat, teamCount: number) => string;
}

// ── Résumés ─────────────────────────────────────────────────────────────────

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function summarizeDoubleElim(format: CompetitionFormat, teamCount: number): string {
  const n = Math.max(2, teamCount);
  // n−1 matchs winners + n−2 losers + grande finale (+ reset si nécessaire).
  const base = 2 * n - 2;
  const matches = format.bracketReset ? `${base} à ${base + 1}` : String(base);
  return `${plural(n, 'équipe')} — double élimination, ${matches} matchs (BO${format.bo.default} par défaut, grande finale BO${format.bo.grandFinal}).`;
}

function summarizeSingleElim(format: CompetitionFormat, teamCount: number): string {
  const n = Math.max(2, teamCount);
  const matches = n - 1 + (format.thirdPlace ? 1 : 0);
  const third = format.thirdPlace ? ' + petite finale' : '';
  return `${plural(n, 'équipe')} — élimination directe, ${plural(matches, 'match')}${third} (BO${format.bo.default} par défaut, finale BO${format.bo.grandFinal}).`;
}

function summarizeRoundRobin(format: CompetitionFormat, teamCount: number): string {
  const n = Math.max(2, teamCount);
  const groups = Math.max(1, format.groupCount ?? 1);
  const legs = format.doubleRound ? 2 : 1;
  // Tailles serpentines : ⌈n/G⌉ et ⌊n/G⌋ ; matchs = Σ C(taille, 2) × legs.
  const bigPools = n % groups;
  const smallSize = Math.floor(n / groups);
  const matches = legs * (
    bigPools * ((smallSize + 1) * smallSize / 2) +
    (groups - bigPools) * (smallSize * (smallSize - 1) / 2)
  );
  const days = roundRobinMatchdays(n, groups, format.doubleRound === true);
  const poolLabel = groups === 1
    ? 'poule unique'
    : `${plural(groups, 'poule')} de ${bigPools > 0 && smallSize > 0 ? `${smallSize}-${smallSize + 1}` : String(Math.ceil(n / groups))}`;
  const legLabel = format.doubleRound ? ', aller-retour' : '';
  return `${plural(n, 'équipe')} en ${poolLabel}${legLabel} — ${plural(matches, 'match')} sur ${plural(days, 'journée')} (BO${format.bo.default}).`;
}

function summarizeSwiss(format: CompetitionFormat, teamCount: number): string {
  const n = Math.max(2, teamCount);
  const rounds = Math.max(1, format.swissRounds ?? 1);
  const perRound = Math.floor(n / 2);
  const bye = n % 2 === 1 ? ' (+ 1 bye par ronde)' : '';
  return `${plural(n, 'équipe')} — système suisse, ${plural(rounds, 'ronde')}, ${perRound} matchs par ronde${bye} (BO${format.bo.default}).`;
}

// ── Fiches ──────────────────────────────────────────────────────────────────

export const FORMAT_DEFS: Record<FormatKind, FormatDef> = {
  double_elim: {
    kind: 'double_elim',
    label: 'Double élimination',
    description: 'Deux défaites éliminent : perdre en winners fait basculer dans le bracket losers. Grande finale entre les deux finalistes, reset possible.',
    configFields: [
      { key: 'maxTeams', label: 'Équipes max', level: 'essential', type: 'number', min: 4, max: 32, default: LEGENDS_FORMAT.maxTeams },
      { key: 'bo.default', label: 'BO par défaut', level: 'essential', type: 'number', min: 1, max: 9, default: LEGENDS_FORMAT.bo.default },
      { key: 'bo.grandFinal', label: 'BO de la grande finale', level: 'advanced', type: 'number', min: 1, max: 9, default: LEGENDS_FORMAT.bo.grandFinal },
      { key: 'bracketReset', label: 'Reset de grande finale', help: 'Si le finaliste venu des losers gagne la première grande finale, une seconde se joue.', level: 'advanced', type: 'boolean', default: LEGENDS_FORMAT.bracketReset },
    ],
    presets: [
      {
        id: 'legends',
        label: 'Qualif Legends',
        description: 'Double élimination 32 équipes, BO5 puis BO7 en fin de bracket, reset de grande finale.',
        format: LEGENDS_FORMAT,
      },
    ],
    capabilities: {
      producesWinner: true,
      producesRanking: true,
      canBeGroupStage: false,
      canBeFinalStage: true,
      supportsPools: false,
      supportsMmrSeeding: true,
    },
    summarize: summarizeDoubleElim,
  },
  single_elim: {
    kind: 'single_elim',
    label: 'Élimination directe',
    description: 'Une défaite élimine. Le format le plus court — petite finale optionnelle pour la 3e place.',
    configFields: [
      { key: 'maxTeams', label: 'Équipes max', level: 'essential', type: 'number', min: 4, max: 32, default: SINGLE_ELIM_FORMAT.maxTeams },
      { key: 'bo.default', label: 'BO par défaut', level: 'essential', type: 'number', min: 1, max: 9, default: SINGLE_ELIM_FORMAT.bo.default },
      { key: 'bo.grandFinal', label: 'BO de la finale', level: 'advanced', type: 'number', min: 1, max: 9, default: SINGLE_ELIM_FORMAT.bo.grandFinal },
      { key: 'thirdPlace', label: 'Petite finale', help: 'Les perdants des demi-finales jouent la 3e place.', level: 'essential', type: 'boolean', default: SINGLE_ELIM_FORMAT.thirdPlace === true },
    ],
    presets: [
      {
        id: 'online',
        label: 'Tournoi en ligne',
        description: 'Élimination directe 16 équipes, BO5, finale BO7.',
        format: SINGLE_ELIM_FORMAT,
      },
    ],
    capabilities: {
      producesWinner: true,
      producesRanking: true,
      canBeGroupStage: false,
      canBeFinalStage: true,
      supportsPools: false,
      supportsMmrSeeding: true,
    },
    summarize: summarizeSingleElim,
  },
  round_robin: {
    kind: 'round_robin',
    label: 'Poules / round robin',
    description: 'Chaque équipe affronte toutes les autres de sa poule. Classement par points — la brique des ligues et des phases de groupes.',
    configFields: [
      { key: 'maxTeams', label: 'Équipes max', level: 'essential', type: 'number', min: 4, max: 64, default: ROUND_ROBIN_FORMAT.maxTeams },
      { key: 'groupCount', label: 'Nombre de poules', help: 'Les têtes de série sont réparties en serpentin, jamais dans la même poule.', level: 'essential', type: 'number', min: 1, max: 16, default: ROUND_ROBIN_FORMAT.groupCount ?? 1 },
      { key: 'doubleRound', label: 'Aller-retour', help: 'Chaque paire se rencontre deux fois, camps inversés.', level: 'essential', type: 'boolean', default: ROUND_ROBIN_FORMAT.doubleRound === true },
      { key: 'bo.default', label: 'BO des matchs', level: 'essential', type: 'number', min: 1, max: 9, default: ROUND_ROBIN_FORMAT.bo.default },
      { key: 'points.win', label: 'Points par victoire', level: 'advanced', type: 'number', min: 0, max: 10, default: ROUND_ROBIN_FORMAT.points?.win ?? 3 },
      { key: 'points.loss', label: 'Points par défaite', level: 'advanced', type: 'number', min: 0, max: 10, default: ROUND_ROBIN_FORMAT.points?.loss ?? 0 },
    ],
    presets: [
      {
        id: 'league',
        label: 'Ligue simple',
        description: 'Une poule unique, tout le monde se rencontre, le premier du classement gagne.',
        format: ROUND_ROBIN_FORMAT,
      },
      {
        id: 'pools-of-4',
        label: 'Poules de 4',
        description: 'Quatre poules de quatre — la phase de groupes classique avant un bracket.',
        format: {
          ...ROUND_ROBIN_FORMAT,
          maxTeams: 16,
          groupCount: 4,
        },
      },
    ],
    capabilities: {
      producesWinner: false,
      producesRanking: true,
      canBeGroupStage: true,
      canBeFinalStage: true,
      supportsPools: true,
      supportsMmrSeeding: true,
    },
    summarize: summarizeRoundRobin,
  },
  swiss: {
    kind: 'swiss',
    label: 'Système suisse',
    description: 'À chaque ronde, les équipes de scores voisins s\'affrontent — sans re-match, personne n\'est éliminé. Départage un grand champ en peu de rondes.',
    configFields: [
      { key: 'maxTeams', label: 'Équipes max', level: 'essential', type: 'number', min: 4, max: 64, default: SWISS_FORMAT.maxTeams },
      { key: 'swissRounds', label: 'Nombre de rondes', help: 'Les rondes s\'apparient au fil des résultats. Conseillé : assez de rondes pour départager un vainqueur (log2 du nombre d\'équipes).', level: 'essential', type: 'number', min: 1, max: 12, default: SWISS_FORMAT.swissRounds ?? 4 },
      { key: 'bo.default', label: 'BO des matchs', level: 'essential', type: 'number', min: 1, max: 9, default: SWISS_FORMAT.bo.default },
      { key: 'points.win', label: 'Points par victoire', level: 'advanced', type: 'number', min: 0, max: 10, default: SWISS_FORMAT.points?.win ?? 3 },
      { key: 'points.loss', label: 'Points par défaite', level: 'advanced', type: 'number', min: 0, max: 10, default: SWISS_FORMAT.points?.loss ?? 0 },
    ],
    presets: [
      {
        id: 'swiss-16',
        label: 'Suisse 16 équipes',
        description: 'Quatre rondes appariées au score, classement par points puis Buchholz.',
        format: SWISS_FORMAT,
      },
    ],
    capabilities: {
      producesWinner: false,
      producesRanking: true,
      canBeGroupStage: true,
      canBeFinalStage: true,
      supportsPools: false,
      supportsMmrSeeding: true,
    },
    summarize: summarizeSwiss,
  },
};

/** Ordre des fiches dans les pickers (élims d'abord — l'historique du site). */
export const FORMAT_KINDS: FormatKind[] = ['double_elim', 'single_elim', 'round_robin', 'swiss'];

export function isFormatKind(value: unknown): value is FormatKind {
  return typeof value === 'string' && (FORMAT_KINDS as string[]).includes(value);
}
