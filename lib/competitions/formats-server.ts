// Registry de FORMATS — partie COMPORTEMENT (serveur uniquement : les moteurs
// pèsent lourd et n'ont rien à faire dans un bundle client — design
// docs/registry-formats-design.md §3b). Miroir 1:1 des fiches de formats.ts.
//
// C'est ICI que la plateforme route par `kind` : la clôture, la
// matérialisation et la progression consomment `engineFor(kind)` au lieu de
// if/else éparpillés — ajouter un format = ajouter son entrée.

import {
  computePlacements,
  computeRoundRobinPlacements,
  DEFAULT_RR_POINTS,
  generateDoubleElim,
  generateRoundRobin,
  generateSingleElim,
  isConcluded,
  isFinished,
  needsAdminDecision,
  type Bracket,
  type PhasePlanEntryLike,
  type Placement,
} from '@/lib/tournament';
import type { CompetitionFormat, FormatKind, PhasePlanEntry } from '@/types/competitions';
import {
  buildLegendsPhasePlan,
  buildRoundRobinPhasePlan,
  buildSingleElimPhasePlan,
} from './defaults';

export interface FormatEngine {
  /** Génère le bracket complet depuis le seeding ordonné. */
  generate(seeding: string[], format: CompetitionFormat, phasePlan?: PhasePlanEntryLike[]): Bracket;
  /**
   * Le bracket permet-il la clôture ? Élims : champion mécanique connu (+
   * petite finale réglée) — `isFinished`. Round robin : tous les matchs
   * terminaux — `isConcluded` (aucun match décisif, jamais `championOf`).
   */
  isFinished(bracket: Bracket): boolean;
  /**
   * Le bracket est figé mais exige une décision admin (élims : conclu sans
   * champion mécanique — R5-1 en finale…). Round robin : TOUJOURS false, un
   * bracket conclu sans champion y est l'état NORMAL — les égalités passent
   * par `needsAdminTiebreak` des placements, gérées par la clôture.
   */
  needsAdminDecision(bracket: Bracket): boolean;
  /** Placements compressés 1→N (contrat commun `Placement[]` — la clôture,
   *  le barème circuit et la console tiebreak sont format-agnostiques). */
  computePlacements(
    bracket: Bracket,
    format: CompetitionFormat,
    tiebreakResolutions?: Record<string, string[]>,
  ): Placement[];
  /** Plan de phases par défaut du préréglage (ajustable admin). */
  buildDefaultPhasePlan(format: CompetitionFormat): PhasePlanEntry[];
}

export const FORMAT_ENGINES: Record<FormatKind, FormatEngine> = {
  double_elim: {
    generate: (seeding, format, phasePlan) =>
      generateDoubleElim(seeding, {
        bo: format.bo,
        forfeitScore: format.forfeitScore,
        phasePlan,
      }),
    isFinished,
    needsAdminDecision,
    computePlacements: (bracket, _format, resolutions) => computePlacements(bracket, resolutions),
    buildDefaultPhasePlan: () => buildLegendsPhasePlan(),
  },
  single_elim: {
    generate: (seeding, format, phasePlan) =>
      generateSingleElim(seeding, {
        bo: format.bo,
        forfeitScore: format.forfeitScore,
        phasePlan,
        thirdPlace: format.thirdPlace === true,
      }),
    isFinished,
    needsAdminDecision,
    computePlacements: (bracket, _format, resolutions) => computePlacements(bracket, resolutions),
    buildDefaultPhasePlan: format =>
      buildSingleElimPhasePlan(format.maxTeams, format.thirdPlace === true),
  },
  round_robin: {
    generate: (seeding, format, phasePlan) =>
      generateRoundRobin(seeding, {
        bo: format.bo,
        forfeitScore: format.forfeitScore,
        phasePlan,
        groups: format.groupCount ?? 1,
        doubleRound: format.doubleRound === true,
      }),
    isFinished: isConcluded,
    needsAdminDecision: () => false,
    computePlacements: (bracket, format, resolutions) =>
      computeRoundRobinPlacements(bracket, format.points ?? DEFAULT_RR_POINTS, resolutions),
    buildDefaultPhasePlan: format =>
      buildRoundRobinPhasePlan(format.maxTeams, format.groupCount ?? 1, format.doubleRound === true),
  },
};

/** Engine d'un format — kind legacy absent/inconnu : double élim (comportement
 *  historique du Lot 2, docs d'avant le multi-format). */
export function engineFor(kind: FormatKind | undefined | null): FormatEngine {
  return FORMAT_ENGINES[kind ?? 'double_elim'] ?? FORMAT_ENGINES.double_elim;
}

/** Kind d'une compétition telle que stockée (docs legacy sans kind → double élim). */
export function kindOf(format: { kind?: string } | null | undefined): FormatKind {
  const kind = format?.kind;
  if (kind === 'single_elim' || kind === 'round_robin' || kind === 'double_elim') return kind;
  return 'double_elim';
}
