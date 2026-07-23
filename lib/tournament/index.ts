// Moteur de bracket (double + simple élimination) — lib PURE (archi §3).
// Point d'entrée unique du module : la matérialisation Firestore
// (competition_matches) et la console consomment ces exports.

export * from './types';
export { generateDoubleElim, generateSingleElim, seedOrder, boForRound, MIN_TEAMS, MAX_TEAMS } from './generate';
export {
  generateRoundRobin,
  snakePools,
  roundRobinBlocker,
  RR_MIN_TEAMS,
  RR_MAX_TEAMS,
  RR_MAX_POOL_SIZE,
  type RoundRobinOptions,
} from './round-robin';
export {
  computeRoundRobinStandings,
  computeRoundRobinPlacements,
  DEFAULT_RR_POINTS,
  type RoundRobinPoints,
  type PoolStandingRow,
} from './round-robin-standings';
export {
  generateSwiss,
  generateSwissNextRound,
  canGenerateSwissRound,
  currentSwissRound,
  isSwissStuck,
  swissBlocker,
  swissDefaultRounds,
  SWISS_MIN_TEAMS,
  SWISS_MAX_TEAMS,
  SWISS_MAX_ROUNDS,
  type SwissOptions,
} from './swiss';
export {
  computeSwissStandings,
  computeSwissPlacements,
  isSwissFinished,
  type SwissStandingRow,
} from './swiss-standings';
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
