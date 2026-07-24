// Runtime MULTI-ÉTAPES — helpers PURS (design docs/registry-formats-design.md §9).
// Un tournoi = une séquence d'étapes de format (poules→playoff, suisse→bracket…).
// SERVER-ONLY (importe formats-server, donc les moteurs) : le client n'a besoin
// de rien d'ici — les docs de match portent `stage`, l'API sérialise les métas.
//
// Invariants tenus par ce module :
// - Rétrocompat totale : compétition sans `stages` = mono-étape dérivée de
//   `format` ; docs de match sans `stage` = étape 1 ; ids d'étape 1 NUS.
// - `stages[0].format === competition.format` (l'étape 1 EST le format
//   top-level) — imposé par la validation, supposé ici.
// - Étape N ≥ 2 : ids de match préfixés `E{N}_{engineId}` — AUCUN id moteur ne
//   contient `_` (W1-1, L3-2, GF, GFR, P3, R2-3, S1-2), le parse est non-ambigu.
// - Les moteurs purs (lib/tournament) ignorent totalement les étapes : le
//   préfixe est posé/retiré par le pont (bracket-store) et les routes.

import {
  MIN_TEAMS, MAX_TEAMS,
  RR_MIN_TEAMS, RR_MAX_TEAMS,
  SWISS_MIN_TEAMS, SWISS_MAX_TEAMS,
  type Placement,
  type TeamStats,
} from '@/lib/tournament';
import { kindOf } from './formats-server';
import { FORMAT_DEFS } from './formats';
import type {
  CompetitionFormat,
  FormatKind,
  StageResult,
  StageResultPlacement,
  StageTransfer,
  TournamentStage,
} from '@/types/competitions';

// ── Lecture d'une compétition (rétrocompat) ──────────────────────────────────

export interface CompetitionStagesLike {
  format?: CompetitionFormat | null;
  stages?: TournamentStage[] | null;
  currentStage?: number | null;
}

/** Étapes d'une compétition — absent : mono-étape dérivée du format top-level
 *  (TOUT l'existant passe par cette branche). */
export function stagesOf(comp: CompetitionStagesLike): TournamentStage[] {
  const stages = Array.isArray(comp.stages) ? comp.stages : [];
  if (stages.length > 0) return stages;
  const format = comp.format as CompetitionFormat;
  return [{ kind: kindOf(format), format }];
}

/** Étape ACTIVE (1-based, absent/invalide = 1). */
export function currentStageOf(comp: CompetitionStagesLike): number {
  const n = comp.currentStage;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, stagesOf(comp).length);
}

/** Étape n (1-based). Hors bornes : clampée — les GET publics ne doivent
 *  jamais crasher sur un doc abîmé ; les mutations valident explicitement. */
export function stageAt(comp: CompetitionStagesLike, n: number): TournamentStage {
  const stages = stagesOf(comp);
  const idx = Math.min(Math.max(1, Math.trunc(n)), stages.length) - 1;
  return stages[idx];
}

/** Format de l'étape n — le point de routage unique : BO, forfeitScore,
 *  swissRounds… d'un match se lisent TOUJOURS sur le format de SON étape. */
export function formatOfStage(comp: CompetitionStagesLike, n: number): CompetitionFormat {
  return stageAt(comp, n).format;
}

/** Libellé d'étape pour l'UI : nom choisi, sinon label du format. */
export function stageLabelOf(stage: TournamentStage): string {
  return stage.name?.trim() || FORMAT_DEFS[stage.kind]?.label || stage.kind;
}

// ── Ids de match préfixés par étape (design §9b) ─────────────────────────────
// Primitives dans stage-ids.ts (module CLIENT-SAFE — l'adaptateur du viewer
// les consomme pour ses libellés) ; ré-exportées ici pour le runtime serveur.

export { parseStageMatchId, stageMatchId, stageOfMatch } from './stage-ids';

// ── Bornes moteur par format (centralisées — miroir unique des constantes) ──

/** Bornes d'effectif du moteur d'un format : arbres 4-32, round robin et
 *  suisse 4-64. Source unique — la route bracket et la validation des
 *  transferts la consomment. */
export function teamBoundsForKind(kind: FormatKind): { min: number; max: number } {
  if (kind === 'round_robin') return { min: RR_MIN_TEAMS, max: RR_MAX_TEAMS };
  if (kind === 'swiss') return { min: SWISS_MIN_TEAMS, max: SWISS_MAX_TEAMS };
  return { min: MIN_TEAMS, max: MAX_TEAMS };
}

// ── Transfert d'étape (advance_stage) ────────────────────────────────────────

export interface StageAdvanceInput {
  /** Étape CLOSE (1-based). */
  stage: number;
  transfer: StageTransfer;
  /** Placements de l'étape, résolutions admin DÉJÀ appliquées
   *  (engine.computePlacements(bracket, format, tiebreakResolutions)). */
  placements: Placement[];
  /** Stats du bracket de l'étape (computeTeamStats) — figées BRUTES dans le
   *  StageResult pour le cumul du classement final. */
  stats: Map<string, TeamStats>;
  /** Équipes retirées : place figée (R5-4) mais JAMAIS qualifiées — les
   *  suivantes au classement sont repêchées. */
  withdrawn: string[];
  /** Arbitrages de l'étape — archivés dans le résultat. */
  tiebreakResolutions: Record<string, string[]>;
  /** Effectif minimum du format de l'étape suivante (teamBoundsForKind). */
  nextStageMinTeams: number;
  /** Requis pour reseed 'random' — injecté (CSPRNG en route, déterministe en
   *  test). Jamais de Math.random ici (module pur). */
  shuffle?: (xs: string[]) => string[];
  /** Requis pour reseed 'mmr' / 'circuit' (design §10) : rang de seed par
   *  registrationId (0 = la plus forte), construit par la route via
   *  lib/competitions/seeding. Les qualifiées sans rang restent dans l'ordre
   *  du classement, après les rangées. */
  seedRank?: Map<string, number>;
}

export type StageAdvanceResult =
  | { ok: true; advanced: string[]; stageResult: StageResult }
  | {
      ok: false;
      code: 'tiebreak_required' | 'not_placed' | 'not_enough_teams' | 'reseed_unsupported';
      error: string;
      tiebreakGroups?: string[];
    };

/**
 * Calcule le passage d'étape : qualifiées (repêchage des retirées inclus),
 * ordre de seed selon la stratégie, résultat d'étape figé. PURE — la route
 * fait les gates d'état (live, étape finie) et la transaction.
 *
 * Exige un classement TOTAL (toutes égalités arbitrées, y compris sous la
 * cutline — design §9c) : le seed de l'étape suivante et le classement final
 * doivent raconter la même histoire.
 */
export function computeStageAdvance(input: StageAdvanceInput): StageAdvanceResult {
  const unresolved = [...new Set(
    input.placements.filter(p => p.needsAdminTiebreak).map(p => p.group))];
  if (unresolved.length > 0) {
    return {
      ok: false,
      code: 'tiebreak_required',
      error: `Égalité(s) à arbitrer avant de lancer l'étape suivante : ${unresolved.join(', ')}.`,
      tiebreakGroups: unresolved,
    };
  }
  if (input.placements.length === 0 || input.placements.some(p => p.placement === null)) {
    return { ok: false, code: 'not_placed', error: "L'étape n'est pas entièrement classée." };
  }

  const ordered = [...input.placements]
    .sort((a, b) => (a.placement as number) - (b.placement as number));
  // Doublons de place = données corrompues : refus net, jamais un classement faux.
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].placement === ordered[i - 1].placement) {
      return { ok: false, code: 'not_placed', error: `Placement en double dans l'étape : place ${ordered[i].placement}.` };
    }
  }

  const withdrawnSet = new Set(input.withdrawn);
  const qualifiable = ordered.filter(p => !withdrawnSet.has(p.teamId));
  const advancedByRank = qualifiable
    .slice(0, Math.max(0, Math.trunc(input.transfer.advanceCount)))
    .map(p => p.teamId);
  if (advancedByRank.length < input.nextStageMinTeams) {
    return {
      ok: false,
      code: 'not_enough_teams',
      error: `Pas assez d'équipes qualifiables pour l'étape suivante : ${advancedByRank.length} (minimum ${input.nextStageMinTeams} — retraits compris).`,
    };
  }

  let advanced: string[];
  if (input.transfer.reseed === 'standings') {
    advanced = advancedByRank;
  } else if (input.transfer.reseed === 'random') {
    if (!input.shuffle) {
      return { ok: false, code: 'reseed_unsupported', error: 'Re-seeding aléatoire sans source d\'aléa fournie.' };
    }
    advanced = input.shuffle(advancedByRank);
    // Le shuffle injecté doit être une permutation EXACTE — défense contre un
    // shuffle buggé qui perdrait/dupliquerait une équipe qualifiée.
    if (advanced.length !== advancedByRank.length
      || new Set(advanced).size !== advanced.length
      || !advanced.every(t => advancedByRank.includes(t))) {
      return { ok: false, code: 'reseed_unsupported', error: 'Re-seeding aléatoire invalide (permutation attendue).' };
    }
  } else if (input.transfer.reseed === 'mmr' || input.transfer.reseed === 'circuit') {
    // Rang de seed fourni par la route (MMR de référence / classement du
    // circuit — design §10). Tri STABLE : les sans-rang gardent l'ordre du
    // classement de l'étape, après les rangées.
    const rank = input.seedRank;
    if (!rank) {
      return { ok: false, code: 'reseed_unsupported', error: `Re-seeding « ${input.transfer.reseed} » sans rangs de seed fournis.` };
    }
    advanced = [...advancedByRank].sort((a, b) =>
      (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
  } else {
    return {
      ok: false,
      code: 'reseed_unsupported',
      error: `Stratégie de re-seeding « ${input.transfer.reseed} » non prise en charge au transfert.`,
    };
  }

  const placements: StageResultPlacement[] = ordered.map(p => {
    const st = input.stats.get(p.teamId);
    return {
      registrationId: p.teamId,
      placement: p.placement as number,
      goalDiff: st?.goalDiff ?? 0,
      goalsFor: st?.goalsFor ?? 0,
      goalsAgainst: st?.goalsAgainst ?? 0,
      matchesCounted: st?.matchesCounted ?? 0,
    };
  });

  return {
    ok: true,
    advanced,
    stageResult: {
      stage: input.stage,
      placements,
      advanced,
      tiebreakResolutions: { ...input.tiebreakResolutions },
      // Timestamp réel posé par la route à l'écriture (pattern nowIso du pont).
      closedAt: '',
    },
  };
}

// ── Classement final multi-étapes (clôture) ──────────────────────────────────

/**
 * Ordre final d'un tournoi multi-étapes : places de l'étape finale (1..K),
 * puis les éliminées de chaque étape antérieure (la plus récente d'abord) à
 * leur classement d'étape. Recompressé 1..N — le repêchage d'une retirée
 * décale proprement les suivantes.
 *
 * Jette sur données incohérentes (doublon d'équipe, qualifiée absente de
 * l'étape finale) : mieux vaut refuser la clôture qu'écrire un classement
 * faux — l'appelant traduit en erreur actionnable.
 */
export function computeMultiStageFinalOrder(
  stageResults: StageResult[],
  finalStagePlacements: Array<{ teamId: string; placement: number }>,
): Array<{ registrationId: string; placement: number }> {
  const sortedResults = [...stageResults].sort((a, b) => b.stage - a.stage);

  const finalSorted = [...finalStagePlacements].sort((a, b) => a.placement - b.placement);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const p of finalSorted) {
    if (seen.has(p.teamId)) throw new Error(`Classement final incohérent : ${p.teamId} en double.`);
    seen.add(p.teamId);
    order.push(p.teamId);
  }

  // Les qualifiées de la dernière étape close doivent TOUTES être classées par
  // l'étape finale (une retirée en cours d'étape reste classée — R5-4).
  const lastClosed = sortedResults[0];
  if (lastClosed) {
    for (const regId of lastClosed.advanced) {
      if (!seen.has(regId)) {
        throw new Error(`Classement final incohérent : ${regId} qualifiée mais absente de l'étape finale.`);
      }
    }
  }

  for (const result of sortedResults) {
    const advancedSet = new Set(result.advanced);
    const eliminated = [...result.placements]
      .filter(p => !advancedSet.has(p.registrationId))
      .sort((a, b) => a.placement - b.placement);
    for (const p of eliminated) {
      if (seen.has(p.registrationId)) {
        throw new Error(`Classement final incohérent : ${p.registrationId} en double (étape ${result.stage}).`);
      }
      seen.add(p.registrationId);
      order.push(p.registrationId);
    }
  }

  // Défense COMPLÈTE (review adversariale) : toute qualifiée de TOUTE étape
  // close doit finir classée quelque part — un stageResult abîmé (écriture
  // partielle) ne doit jamais faire disparaître une équipe en silence, avec
  // toutes les suivantes qui remontent d'une place (points de barème décalés).
  for (const result of sortedResults) {
    for (const regId of result.advanced) {
      if (!seen.has(regId)) {
        throw new Error(`Classement final incohérent : ${regId} qualifiée à l'étape ${result.stage} mais absente de toute la suite.`);
      }
    }
  }

  return order.map((registrationId, i) => ({ registrationId, placement: i + 1 }));
}

// ── Soupape « transfert impossible » (review adversariale — miroir isSwissStuck) ──

/**
 * Une étape FINIE et entièrement arbitrée dont le transfert est
 * STRUCTURELLEMENT impossible (trop de retraits pour l'effectif minimum de
 * l'étape suivante, ou génération infaisable — répartition en poules…) ne
 * doit JAMAIS briquer une compétition `live` : elle devient CLÔTURABLE au
 * classement concaténé courant (l'étape courante est traitée comme finale).
 *
 * `stuck` UNIQUEMENT sur `not_enough_teams` ou échec de génération — une
 * égalité à arbitrer ou une étape non réglée ne sont pas des impasses.
 */
export function isStageTransferStuck(input: {
  transfer: StageTransfer;
  placements: Placement[];
  stats: Map<string, TeamStats>;
  withdrawn: string[];
  tiebreakResolutions: Record<string, string[]>;
  nextStage: TournamentStage;
  /** Générateur de l'étape suivante (engineFor(kind).generate) — injecté pour
   *  garder ce module sans dépendance aux moteurs concrets au call-site. */
  generateNext: (seeding: string[]) => unknown;
}): boolean {
  const adv = computeStageAdvance({
    stage: 0, // sans objet pour un dry-run
    transfer: input.transfer,
    placements: input.placements,
    stats: input.stats,
    withdrawn: input.withdrawn,
    tiebreakResolutions: input.tiebreakResolutions,
    nextStageMinTeams: teamBoundsForKind(input.nextStage.kind).min,
    // L'ordre n'importe pas pour la faisabilité — identité pour 'random'.
    shuffle: xs => xs,
  });
  if (!adv.ok) return adv.code === 'not_enough_teams';
  try {
    input.generateNext(adv.advanced);
    return false;
  } catch {
    return true;
  }
}

/** Stats cumulées d'une équipe sur tout le tournoi : étapes closes (brutes,
 *  figées dans les StageResult) + étape finale (TeamStats du bracket). Délta
 *  normalisé par match compté, arrondi 2 décimales (contrat FinalPlacement). */
export function cumulativeTeamStats(
  registrationId: string,
  stageResults: StageResult[],
  finalStageStats: Map<string, TeamStats>,
): { goalDiff: number; goalsFor: number } {
  let goalDiff = 0;
  let goalsFor = 0;
  let matches = 0;
  for (const result of stageResults) {
    const p = result.placements.find(x => x.registrationId === registrationId);
    if (!p) continue;
    goalDiff += p.goalDiff;
    goalsFor += p.goalsFor;
    matches += p.matchesCounted;
  }
  const fin = finalStageStats.get(registrationId);
  if (fin) {
    goalDiff += fin.goalDiff;
    goalsFor += fin.goalsFor;
    matches += fin.matchesCounted;
  }
  const normalized = matches > 0 ? goalDiff / matches : 0;
  return { goalDiff: Math.round(normalized * 100) / 100, goalsFor };
}
