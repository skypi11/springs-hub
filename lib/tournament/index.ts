// Moteur de bracket (double + simple élimination) — lib PURE (archi §3).
// Point d'entrée unique du module : la matérialisation Firestore
// (competition_matches) et la console consomment ces exports.

export * from './types';
export { generateDoubleElim, generateSingleElim, seedOrder, boForRound, MIN_TEAMS, MAX_TEAMS } from './generate';
export { advanceMatch, withdrawTeam, replaceTeam, forfeitScores, isTerminal } from './advance';
export {
  computeTeamStats,
  computePlacements,
  rankWithinGroup,
  championOf,
  isFinished,
  isConcluded,
  needsAdminDecision,
} from './placements';
