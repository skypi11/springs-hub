// Moteur SYSTÈME SUISSE — PUR et déterministe (docs/registry-formats-design.md §8).
//
// TROISIÈME modèle du module, distinct de l'arbre ET du round robin : les
// appariements de la ronde N+1 dépendent des RÉSULTATS des rondes 1..N
// (scores voisins, jamais de re-match). D'où la GÉNÉRATION INCRÉMENTALE :
// - `generateSwiss` ne produit que la RONDE 1 (appariement « slide » par
//   seed : 1 vs ⌈n/2⌉+1, 2 vs ⌈n/2⌉+2…) + les métadonnées (`swissRounds`).
// - `generateSwissNextRound` calcule et AJOUTE la ronde suivante quand tous
//   les matchs existants sont terminaux — appariement MONRAD (ordre du
//   classement courant, chaque équipe contre la plus proche jamais
//   rencontrée) avec BACKTRACKING : un appariement valide est toujours
//   trouvé s'il en existe un ; sinon erreur EXPLICITE, jamais un re-match
//   silencieux.
// - Bye (effectif impair) : l'équipe la moins bien classée SANS bye
//   antérieur reçoit un match à côté B void → walkover (même modèle que les
//   byes d'arbre). Au classement suisse, cette victoire VAUT les points
//   d'une victoire (swiss-standings) — sémantique différente du round robin,
//   documentée là-bas.
//
// Conventions : ids `S{ronde}-{slot}` (slot global par ronde), sources
// `seed`/`seed` (les équipes sont connues à la génération de LEUR ronde ;
// la reconstruction lit la ronde 1 où tout le monde apparaît, bye compris),
// BO unique `bo.default` (un match suisse n'est jamais « une finale »).

import type { Bracket, BoConfig, PhasePlanEntryLike, PureMatch } from './types';
import { attachPhasePlan } from './generate';
import { isConcluded } from './placements';
import { computeSwissStandings } from './swiss-standings';

export const SWISS_MIN_TEAMS = 4;
export const SWISS_MAX_TEAMS = 64;
export const SWISS_MAX_ROUNDS = 12;

/** Nombre de rondes conseillé : ⌈log2(n)⌉ (départage un vainqueur net). */
export function swissDefaultRounds(teamCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, teamCount))));
}

/**
 * Faisabilité d'un suisse pour un EFFECTIF RÉEL : null si jouable, sinon le
 * message exact que lèverait le générateur. SOURCE UNIQUE des règles —
 * consommée par le moteur ET par la route bracket (même pattern que
 * `roundRobinBlocker` : la validation de format ne connaît que le max
 * théorique, le champ réel est presque toujours plus petit).
 * `rounds ≤ n − 1` : au-delà, des re-matchs deviennent inévitables.
 */
export function swissBlocker(teamCount: number, rounds: number): string | null {
  if (teamCount < SWISS_MIN_TEAMS || teamCount > SWISS_MAX_TEAMS) {
    return `Nombre d'équipes hors bornes : ${teamCount} (attendu ${SWISS_MIN_TEAMS}–${SWISS_MAX_TEAMS}).`;
  }
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > SWISS_MAX_ROUNDS) {
    return `Nombre de rondes invalide : ${rounds} (attendu 1–${SWISS_MAX_ROUNDS}).`;
  }
  if (rounds > teamCount - 1) {
    return `Trop de rondes : ${rounds} pour ${teamCount} équipes (maximum ${teamCount - 1} sans re-match).`;
  }
  return null;
}

export interface SwissOptions {
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  phasePlan?: PhasePlanEntryLike[];
  /** Nombre total de rondes (défaut ⌈log2(n)⌉). */
  rounds?: number;
}

function makeSwissMatch(
  round: number,
  slot: number,
  bo: number,
  seedA: number,
  seedB: number | null,
  teamA: string,
  teamB: string | null,
): PureMatch {
  return {
    id: `S${round}-${slot}`,
    bracket: 'swiss',
    round,
    slot,
    bo,
    phase: null,
    sourceA: { type: 'seed', ref: seedA },
    sourceB: seedB === null ? { type: 'none' } : { type: 'seed', ref: seedB },
    teamA,
    teamB,
    voidA: false,
    voidB: teamB === null,
    status: 'pending',
    winner: null,
    scores: null,
    forfeit: null,
    statsCountA: false,
    statsCountB: false,
  };
}

/** Résout les byes fraîchement créés (côté B void → walkover). Local et
 *  minimal : la propagation générale n'a rien à faire ici (aucun consumer). */
function resolveByes(bracket: Bracket): void {
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.status !== 'pending' || !m.voidB || m.teamA === null) continue;
    m.status = 'walkover';
    m.winner = 'a';
  }
}

/**
 * Génère un SUISSE : ronde 1 uniquement (slide pairing par seed — moitié
 * haute contre moitié basse), métadonnées `swissRounds`. Les rondes
 * suivantes naissent par `generateSwissNextRound` au fil des résultats.
 */
export function generateSwiss(teamIds: string[], opts: SwissOptions): Bracket {
  const n = teamIds.length;
  if (new Set(teamIds).size !== n) {
    throw new Error('Équipes en double dans le seeding.');
  }
  const rounds = opts.rounds ?? swissDefaultRounds(n);
  const blocker = swissBlocker(n, rounds);
  if (blocker) throw new Error(blocker);

  const matches: Record<string, PureMatch> = {};
  const order: string[] = [];

  // Slide pairing ronde 1 : bye au SEED le plus bas si effectif impair, puis
  // seed i contre seed i + moitié.
  const paired = n % 2 === 0 ? n : n - 1;
  const half = paired / 2;
  let slot = 0;
  for (let i = 1; i <= half; i++) {
    slot += 1;
    const m = makeSwissMatch(1, slot, opts.bo.default, i, i + half, teamIds[i - 1], teamIds[i + half - 1]);
    matches[m.id] = m;
    order.push(m.id);
  }
  if (n % 2 === 1) {
    slot += 1;
    const m = makeSwissMatch(1, slot, opts.bo.default, n, null, teamIds[n - 1], null);
    matches[m.id] = m;
    order.push(m.id);
  }

  const bracket: Bracket = {
    kind: 'swiss',
    teams: [...teamIds],
    size: n,
    winnersRounds: 0,
    losersRounds: 0,
    swissRounds: rounds,
    matchdays: rounds,
    bo: opts.bo,
    forfeitScore: opts.forfeitScore,
    matches,
    order,
    withdrawn: [],
  };
  resolveByes(bracket);
  attachPhasePlan(bracket, opts.phasePlan);
  return bracket;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Appariement MONRAD avec backtracking : la première équipe de l'ordre est
 *  appariée à la plus proche jamais rencontrée ; si l'aval se coince (que
 *  des re-matchs), on remonte essayer l'adversaire suivant. Renvoie null si
 *  AUCUN appariement complet sans re-match n'existe. */
function pairMonrad(ordered: string[], played: Set<string>): Array<[string, string]> | null {
  if (ordered.length === 0) return [];
  const [first, ...rest] = ordered;
  for (let i = 0; i < rest.length; i++) {
    if (played.has(pairKey(first, rest[i]))) continue;
    const sub = pairMonrad([...rest.slice(0, i), ...rest.slice(i + 1)], played);
    if (sub) return [[first, rest[i]], ...sub];
  }
  return null;
}

/** La ronde suivante peut-elle être générée ? (tous les matchs terminaux,
 *  rondes restantes, au moins 2 équipes actives). */
export function canGenerateSwissRound(bracket: Bracket): boolean {
  if (bracket.kind !== 'swiss') return false;
  if (!isConcluded(bracket)) return false;
  const current = currentSwissRound(bracket);
  if (current >= (bracket.swissRounds ?? 0)) return false;
  return activeTeams(bracket).length >= 2;
}

/** Dernière ronde existante (0 si aucune — jamais le cas en pratique). */
export function currentSwissRound(bracket: Bracket): number {
  let max = 0;
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.round > max) max = m.round;
  }
  return max;
}

/** Équipes encore appariables : sièges occupés, non retirées. */
function activeTeams(bracket: Bracket): string[] {
  return bracket.teams.filter(t => t && !bracket.withdrawn.includes(t));
}

/** Équipes ayant déjà reçu un bye (walkover à côté void dans une ronde). */
function byeTeams(bracket: Bracket): Set<string> {
  const out = new Set<string>();
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    if (m.bracket === 'swiss' && m.voidB && m.teamA && m.status === 'walkover') {
      out.add(m.teamA);
    }
  }
  return out;
}

/**
 * Calcule et AJOUTE la ronde suivante (nouveau bracket, l'original n'est pas
 * muté). Exige : tous les matchs terminaux, ronde restante. Ordre
 * d'appariement = classement suisse courant (points → Buchholz → …,
 * déterministe). Bye à la moins bien classée sans bye antérieur.
 */
export function generateSwissNextRound(
  bracket: Bracket,
  opts?: { phasePlan?: PhasePlanEntryLike[] },
): Bracket {
  if (bracket.kind !== 'swiss') {
    throw new Error(`Bracket ${bracket.kind} : génération de ronde réservée au suisse.`);
  }
  if (!isConcluded(bracket)) {
    throw new Error('Ronde en cours : tous les matchs doivent être terminés avant d\'apparier la suivante.');
  }
  const current = currentSwissRound(bracket);
  const total = bracket.swissRounds ?? 0;
  if (current >= total) {
    throw new Error(`Toutes les rondes sont jouées (${current}/${total}).`);
  }

  const next = structuredClone(bracket);
  const active = activeTeams(next);
  if (active.length < 2) {
    throw new Error('Moins de deux équipes encore en lice : aucune ronde à apparier.');
  }

  // Ordre du classement courant, restreint aux équipes actives.
  const standingsOrder = computeSwissStandings(next)
    .map(r => r.teamId)
    .filter(t => active.includes(t));
  // Équipes actives absentes du classement (défensif — ne devrait pas
  // arriver, tout le monde joue la ronde 1) : ajoutées en fin d'ordre.
  for (const t of active) {
    if (!standingsOrder.includes(t)) standingsOrder.push(t);
  }

  // Bye : la moins bien classée sans bye antérieur (à défaut, la dernière).
  let byeTeam: string | null = null;
  if (standingsOrder.length % 2 === 1) {
    const already = byeTeams(next);
    const candidates = [...standingsOrder].reverse();
    byeTeam = candidates.find(t => !already.has(t)) ?? candidates[0];
  }
  const toPair = standingsOrder.filter(t => t !== byeTeam);

  const played = new Set<string>();
  for (const id of next.order) {
    const m = next.matches[id];
    if (m.teamA && m.teamB) played.add(pairKey(m.teamA, m.teamB));
  }
  const pairs = pairMonrad(toPair, played);
  if (!pairs) {
    throw new Error('Appariement impossible sans re-match : réduire le nombre de rondes ou trancher à la main.');
  }

  const round = current + 1;
  const seedOf = new Map(next.teams.map((t, i) => [t, i + 1]));
  let slot = 0;
  for (const [a, b] of pairs) {
    slot += 1;
    const m = makeSwissMatch(round, slot, next.bo.default, seedOf.get(a)!, seedOf.get(b)!, a, b);
    next.matches[m.id] = m;
    next.order.push(m.id);
  }
  if (byeTeam) {
    slot += 1;
    const m = makeSwissMatch(round, slot, next.bo.default, seedOf.get(byeTeam)!, null, byeTeam, null);
    next.matches[m.id] = m;
    next.order.push(m.id);
  }
  resolveByes(next);
  attachPhasePlan(next, opts?.phasePlan);
  return next;
}
