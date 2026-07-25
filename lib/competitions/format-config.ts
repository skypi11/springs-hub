// Manipulation d'un `CompetitionFormat` depuis une UI générique : lire et
// écrire les réglages déclarés par la registry (`configFields`, dont les clés
// sont des chemins « bo.default »), changer de format sans laisser de réglage
// orphelin, remettre les invariants d'un kind. Module PUR et client-safe.
//
// Le formulaire de création ne connaît donc AUCUN format : il affiche les
// champs déclarés par la fiche et passe par ces fonctions. Ajouter un format
// reste « ajouter une fiche ».

import type { CompetitionFormat, FormatKind } from '@/types/competitions';
import { FORMAT_DEFS, type ConfigField } from './formats';
import type { BoRoundRef } from './schedule-plan';

export type ConfigValue = number | boolean;

/** Format de départ d'un kind : celui de son premier préréglage (la fiche est
 *  la source de vérité — aucune valeur par défaut dupliquée ici). */
export function defaultFormatFor(kind: FormatKind): CompetitionFormat {
  const preset = FORMAT_DEFS[kind]?.presets[0];
  if (!preset) throw new Error(`Format sans préréglage : ${kind}`);
  return normalizeFormat({ ...preset.format });
}

/** Valeur courante d'un réglage déclaré (chemin à un ou deux niveaux). */
export function getConfigValue(format: CompetitionFormat, key: string): ConfigValue | undefined {
  const [head, tail] = key.split('.');
  const root = (format as unknown as Record<string, unknown>)[head];
  if (tail === undefined) {
    return typeof root === 'number' || typeof root === 'boolean' ? root : undefined;
  }
  if (typeof root !== 'object' || root === null) return undefined;
  const leaf = (root as Record<string, unknown>)[tail];
  return typeof leaf === 'number' || typeof leaf === 'boolean' ? leaf : undefined;
}

/** Écrit un réglage et renvoie un NOUVEAU format (invariants du kind
 *  ré-appliqués : un réglage sans objet dans ce format ne s'y installe pas). */
export function setConfigValue(
  format: CompetitionFormat,
  key: string,
  value: ConfigValue,
): CompetitionFormat {
  const [head, tail] = key.split('.');
  const next: CompetitionFormat = { ...format };
  if (tail === undefined) {
    (next as unknown as Record<string, unknown>)[head] = value;
  } else {
    const root = (format as unknown as Record<string, unknown>)[head];
    const branch = typeof root === 'object' && root !== null ? { ...(root as Record<string, unknown>) } : {};
    branch[tail] = value;
    (next as unknown as Record<string, unknown>)[head] = branch;
  }
  return normalizeFormat(next);
}

/**
 * Remet les invariants du kind — ce que le serveur imposerait de toute façon
 * (validate.validateFormat), appliqué dès la saisie pour que l'aperçu montre
 * la vérité : reset réservé au double élim, petite finale au simple élim, BO
 * unique en poules et en suisse, forfait dérivé du BO.
 */
export function normalizeFormat(format: CompetitionFormat): CompetitionFormat {
  const kind = format.kind;
  const boDefault = format.bo?.default ?? 5;
  const flat = kind === 'round_robin' || kind === 'swiss';

  const next: CompetitionFormat = {
    ...format,
    bo: {
      default: boDefault,
      // Un match de poule ou de ronde suisse n'est jamais « une finale » :
      // ni règles par tour, ni BO de finale distinct.
      overrides: flat ? [] : (format.bo?.overrides ?? []),
      grandFinal: flat ? boDefault : (format.bo?.grandFinal ?? boDefault),
    },
    bracketReset: kind === 'double_elim' && format.bracketReset === true,
    thirdPlace: kind === 'single_elim' && format.thirdPlace === true,
    // Score conventionnel de forfait : ⌈BO/2⌉ manches 1-0 (spec §11), dérivé,
    // jamais saisi — même règle que le serveur.
    forfeitScore: { games: Math.ceil(boDefault / 2), goalsPerGame: 1 },
  };

  // Réglages propres à un format : présents seulement là où ils ont un sens,
  // pour ne jamais écrire de champ orphelin en base.
  if (kind === 'round_robin') {
    // Le nombre de poules suit l'effectif : passer un tournoi de 8 à 64
    // équipes sans relever les poules donnerait une poule de 64, refusée.
    next.groupCount = poolCountFor(format.maxTeams, Math.max(1, format.groupCount ?? 1));
    next.doubleRound = format.doubleRound === true;
    next.points = format.points ?? { win: 3, draw: 1, loss: 0 };
    delete next.swissRounds;
  } else if (kind === 'swiss') {
    // Au-delà de N−1 rondes, des re-matchs deviennent inévitables.
    const wanted = format.swissRounds ?? swissDefaultRounds(format.maxTeams);
    next.swissRounds = Math.max(1, Math.min(wanted, Math.max(2, format.maxTeams) - 1));
    next.points = format.points ?? { win: 3, draw: 1, loss: 0 };
    delete next.groupCount;
    delete next.doubleRound;
  } else {
    delete next.groupCount;
    delete next.doubleRound;
    delete next.swissRounds;
    delete next.points;
  }
  return next;
}

/**
 * Règle le BO d'un tour. Les exceptions sont stockées en distance à la fin du
 * bracket (elles restent donc valables si le champ change de taille), et
 * disparaissent quand elles retombent sur le BO par défaut — jamais de règle
 * fantôme en base.
 */
export function setBoForRound(
  format: CompetitionFormat,
  ref: BoRoundRef,
  bo: number,
): CompetitionFormat {
  if (ref.bracket === 'grand_final') {
    return normalizeFormat({ ...format, bo: { ...format.bo, grandFinal: bo } });
  }
  const isSingleFinal = format.kind === 'single_elim'
    && ref.bracket === 'winners'
    && ref.roundsFromEnd === 1;
  const others = format.bo.overrides.filter(
    o => !(o.bracket === ref.bracket && o.roundsFromEnd === ref.roundsFromEnd));

  // Finale d'un simple élim : elle se règle par le « BO de finale », pas par
  // une exception — deux sources pour la même valeur finiraient par diverger.
  if (isSingleFinal) {
    return normalizeFormat({ ...format, bo: { ...format.bo, grandFinal: bo, overrides: others } });
  }
  const baseline = format.bo.default;
  return normalizeFormat({
    ...format,
    bo: {
      ...format.bo,
      overrides: bo === baseline ? others : [...others, { bracket: ref.bracket, roundsFromEnd: ref.roundsFromEnd, bo }],
    },
  });
}

/** Rondes suisses par défaut : ⌈log2(N)⌉ — miroir de swissDefaultRounds du
 *  moteur (littéral, ce module reste client-safe). */
export function swissDefaultRounds(teamCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, teamCount))));
}

/**
 * Change de format en gardant ce qui a un sens partout (taille du champ, BO
 * des matchs) et en repartant du préréglage pour le reste. Sans ça, passer de
 * « poules » à « élimination » traînerait un nombre de poules invisible mais
 * enregistré.
 */
export function switchFormatKind(format: CompetitionFormat, nextKind: FormatKind): CompetitionFormat {
  const base = defaultFormatFor(nextKind);
  const carried: CompetitionFormat = {
    ...base,
    maxTeams: clampToField(nextKind, 'maxTeams', format.maxTeams) ?? base.maxTeams,
    bo: {
      ...base.bo,
      default: clampToField(nextKind, 'bo.default', format.bo?.default) ?? base.bo.default,
    },
  };
  if (nextKind === 'swiss') {
    // Les rondes suivent la nouvelle taille de champ, sinon le préréglage
    // (4 rondes pour 16 équipes) resterait collé à un champ de 64.
    carried.swissRounds = swissDefaultRounds(carried.maxTeams);
  }
  // Poules et bornes de rondes : `normalizeFormat` s'en charge.
  return normalizeFormat(carried);
}

/** Taille de poule maximale du moteur (RR_MAX_POOL_SIZE) — littéral miroir,
 *  ce module reste client-safe. Au-delà, le calendrier devient délirant. */
const MAX_POOL_SIZE = 20;

/**
 * Nombre de poules tenable pour un champ donné : le souhait de départ, relevé
 * juste assez pour qu'aucune poule ne dépasse la taille maximale, et jamais au
 * point de descendre sous deux équipes par poule. Sans ce calcul, arriver sur
 * « poules » depuis un champ de 32 proposait une poule unique de 32 — refusée
 * à l'enregistrement, sans que l'organisateur comprenne pourquoi.
 */
export function poolCountFor(teamCount: number, wanted = 1): number {
  const teams = Math.max(2, teamCount);
  const minimum = Math.ceil(teams / MAX_POOL_SIZE);
  const maximum = Math.max(1, Math.floor(teams / 2));
  return Math.min(Math.max(wanted, minimum), maximum);
}

/** Borne une valeur numérique aux min/max déclarés par la fiche du format. */
function clampToField(kind: FormatKind, key: string, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const field = FORMAT_DEFS[kind]?.configFields.find(f => f.key === key);
  if (!field || field.type !== 'number') return undefined;
  return Math.min(field.max, Math.max(field.min, Math.round(value)));
}

/** Champs déclarés d'un format, séparés par niveau (l'UI montre l'essentiel et
 *  replie l'avancé — design §3a). */
export function configFieldsByLevel(kind: FormatKind): {
  essential: ConfigField[];
  advanced: ConfigField[];
} {
  const fields = FORMAT_DEFS[kind]?.configFields ?? [];
  return {
    essential: fields.filter(f => f.level === 'essential'),
    advanced: fields.filter(f => f.level === 'advanced'),
  };
}
