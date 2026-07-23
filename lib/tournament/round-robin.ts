// Génération d'un ROUND ROBIN (poules / championnat) — PUR et déterministe,
// même contrat que generate.ts : mêmes équipes → même bracket. Le seeding
// (aléatoire, modifiable par l'admin) se fait EN AMONT.
//
// Différences fondamentales avec un arbre à élimination :
// - TOUS les appariements sont connus dès la génération : chaque match a ses
//   deux équipes posées (sources `seed`), il n'existe AUCUN `winner_of` /
//   `loser_of` — la propagation d'`advanceMatch` est un no-op par construction.
// - Il n'y a NI byes NI voids : une poule impaire donne une équipe EXEMPTE par
//   journée (aucun match créé), pas un côté de match void.
// - Le résultat est un CLASSEMENT par points (round-robin-standings.ts), pas
//   un champion mécanique — `isConcluded` fait foi, jamais `championOf`.
//
// Conventions structurelles (consommées par bracket-store / la console) :
// - id = `R{journée}-{slot}` ; `slot` est GLOBAL dans la journée (toutes
//   poules confondues) → l'ordre (bracket, round, slot) de `orderIds` reste
//   déterministe sans modification. La poule vit dans `PureMatch.group`.
// - `round` = journée 1-based, continue sur l'aller-retour (leg 2 : les
//   journées R+1..2R rejouent les paires du leg 1, camps inversés).
// - BO : `bo.default` pour TOUS les matchs de poule — `boForRound` (distance à
//   la fin d'un arbre) n'a aucun sens ici, overrides et grandFinal sont
//   ignorés (refusés en amont par la validation de format).

import type { Bracket, BoConfig, PhasePlanEntryLike, PureMatch } from './types';
import { attachPhasePlan } from './generate';

/** Bornes propres au round robin : aucune contrainte de puissance de 2, la
 *  borne haute est plus généreuse que l'arbre (MAX_TEAMS=32 — l'extension des
 *  élims à 64+ est un chantier séparé, cf. docs/plateforme-tournois-vision.md). */
export const RR_MIN_TEAMS = 4;
export const RR_MAX_TEAMS = 64;
/** Garde-fou : au-delà, une poule unique devient un calendrier délirant
 *  (63 journées à 64 équipes) — la validation de format impose des poules. */
export const RR_MAX_POOL_SIZE = 20;

export interface RoundRobinOptions {
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  phasePlan?: PhasePlanEntryLike[];
  /** Nombre de poules (défaut 1 = ligue simple). */
  groups?: number;
  /** Aller-retour : chaque paire se rencontre deux fois, camps inversés. */
  doubleRound?: boolean;
}

/**
 * Faisabilité d'un round robin pour un EFFECTIF RÉEL d'équipes : renvoie null
 * si jouable, sinon le message d'erreur exact que lèverait generateRoundRobin.
 * SOURCE UNIQUE des règles — consommée par le générateur (throw) ET par la
 * route bracket (gardes canOpenSeeding/canPublish + 409 actionnable) : la
 * validation de format ne connaît que le MAX théorique, or le champ réel est
 * presque toujours plus petit (review adversariale : publish 500 sinon).
 */
export function roundRobinBlocker(teamCount: number, groups: number): string | null {
  if (teamCount < RR_MIN_TEAMS || teamCount > RR_MAX_TEAMS) {
    return `Nombre d'équipes hors bornes : ${teamCount} (attendu ${RR_MIN_TEAMS}–${RR_MAX_TEAMS}).`;
  }
  if (!Number.isInteger(groups) || groups < 1) {
    return `Nombre de poules invalide : ${groups}.`;
  }
  if (groups > Math.floor(teamCount / 2)) {
    return `Trop de poules : ${groups} pour ${teamCount} équipes (minimum 2 équipes par poule).`;
  }
  const maxPoolSize = Math.ceil(teamCount / groups);
  if (maxPoolSize > RR_MAX_POOL_SIZE) {
    return `Poule trop grande : ${maxPoolSize} équipes (maximum ${RR_MAX_POOL_SIZE} — augmenter le nombre de poules).`;
  }
  return null;
}

/** Répartition SERPENTINE des seeds en G poules : 1..G en tête de chaque
 *  poule, puis G+1..2G en ordre inverse, etc. — les têtes de série sont
 *  séparées et les poules équilibrées (tailles ⌈n/G⌉ / ⌊n/G⌋). Exposée pour
 *  les tests et la future UI de preview. Renvoie, par poule (index 0 = poule
 *  1), les SEEDS 1-based dans l'ordre serpentin. */
export function snakePools(teamCount: number, groups: number): number[][] {
  const pools: number[][] = Array.from({ length: groups }, () => []);
  for (let seed = 1; seed <= teamCount; seed++) {
    const row = Math.floor((seed - 1) / groups);
    const col = (seed - 1) % groups;
    const pool = row % 2 === 0 ? col : groups - 1 - col;
    pools[pool].push(seed);
  }
  return pools;
}

/** Appariements d'une poule par la MÉTHODE DU CERCLE : k participants
 *  (fantôme ajouté si impair), position 0 fixe, rotation des autres. Renvoie
 *  les journées (1-based implicite par l'index) : liste de paires d'INDEX
 *  dans la liste des membres de la poule. Le fantôme (index -1) ne produit
 *  aucun match — l'équipe en face est exempte cette journée. */
function circleRounds(poolSize: number): Array<Array<[number, number]>> {
  const ghost = poolSize % 2 === 1;
  const k = ghost ? poolSize + 1 : poolSize;
  // positions[i] = index du membre (k-1 = fantôme si impair)
  let positions = Array.from({ length: k }, (_, i) => i);
  const ghostIndex = ghost ? k - 1 : -1;

  const rounds: Array<Array<[number, number]>> = [];
  for (let d = 0; d < k - 1; d++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < k / 2; i++) {
      const x = positions[i];
      const y = positions[k - 1 - i];
      if (x === ghostIndex || y === ghostIndex) continue; // exempt
      // Équité domicile/extérieur : le pivot (i=0) reçoit une journée sur
      // deux ; les autres paires alternent naturellement par la rotation.
      if (i === 0 && d % 2 === 1) pairs.push([y, x]);
      else pairs.push([x, y]);
    }
    rounds.push(pairs);
    // Rotation horaire : position 0 fixe, le reste tourne d'un cran.
    positions = [positions[0], positions[k - 1], ...positions.slice(1, k - 1)];
  }
  return rounds;
}

/**
 * Génère un round robin complet : G poules remplies en serpentin, journées de
 * chaque poule par la méthode du cercle, matchs TOUS posés d'avance (aucune
 * propagation à venir). Les journées des poules sont alignées : la journée d
 * du bracket contient la journée d de CHAQUE poule (slots globaux, poule 1
 * d'abord). Aller-retour : les journées R+1..2R rejouent le leg 1 inversé.
 */
export function generateRoundRobin(teamIds: string[], opts: RoundRobinOptions): Bracket {
  const n = teamIds.length;
  if (new Set(teamIds).size !== n) {
    throw new Error('Équipes en double dans le seeding.');
  }
  const groups = opts.groups ?? 1;
  const blocker = roundRobinBlocker(n, groups);
  if (blocker) throw new Error(blocker);
  const doubleRound = opts.doubleRound === true;

  const pools = snakePools(n, groups);
  // Journées par poule (index poule → journées → paires d'index intra-poule).
  const poolRounds = pools.map(members => circleRounds(members.length));
  // Journées d'un leg = celles de la plus grande poule (les petites poules
  // n'ont simplement pas de match dans les journées au-delà des leurs).
  const legRounds = Math.max(...poolRounds.map(r => r.length));
  const matchdays = doubleRound ? legRounds * 2 : legRounds;

  const matches: Record<string, PureMatch> = {};
  const order: string[] = [];

  for (let d = 1; d <= matchdays; d++) {
    const legDay = d <= legRounds ? d : d - legRounds;
    const isReturnLeg = d > legRounds;
    let slot = 0; // global dans la journée, toutes poules
    for (let g = 0; g < groups; g++) {
      const dayPairs = poolRounds[g][legDay - 1];
      if (!dayPairs) continue; // poule plus petite : plus de journées ici
      for (const [ia, ib] of dayPairs) {
        slot += 1;
        // Aller-retour : camps inversés au leg retour.
        const seedA = isReturnLeg ? pools[g][ib] : pools[g][ia];
        const seedB = isReturnLeg ? pools[g][ia] : pools[g][ib];
        const id = `R${d}-${slot}`;
        const m: PureMatch = {
          id,
          bracket: 'round_robin',
          round: d,
          slot,
          group: g + 1,
          bo: opts.bo.default,
          phase: null,
          sourceA: { type: 'seed', ref: seedA },
          sourceB: { type: 'seed', ref: seedB },
          teamA: teamIds[seedA - 1],
          teamB: teamIds[seedB - 1],
          voidA: false,
          voidB: false,
          status: 'pending',
          winner: null,
          scores: null,
          forfeit: null,
          statsCountA: false,
          statsCountB: false,
        };
        matches[id] = m;
        order.push(id);
      }
    }
  }

  const bracket: Bracket = {
    kind: 'round_robin',
    teams: [...teamIds],
    size: n,
    winnersRounds: 0,
    losersRounds: 0,
    groups,
    matchdays,
    doubleRound,
    bo: opts.bo,
    forfeitScore: opts.forfeitScore,
    matches,
    order,
    withdrawn: [],
  };

  attachPhasePlan(bracket, opts.phasePlan);
  return bracket;
}
