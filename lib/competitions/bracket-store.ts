// Pont entre le moteur de bracket PUR (lib/tournament) et la persistance
// Firestore (`competition_matches`). Bidirectionnel et testé par round-trip
// (générer → sérialiser → désérialiser = identité) : la source de vérité de
// la progression est le SET de documents Firestore, et le Lot 3 reconstruit un
// `Bracket` pur pour appeler `advanceMatch`/`withdrawTeam` puis réécrit les
// docs modifiés.
//
// Invariants respectés (archi §2) :
// - AUCUN uid/snowflake dans le doc public : `teamA`/`teamB` sont des
//   registrationId (= `${competitionId}_${teamId}`, pas des snowflakes), et le
//   nom/tag/logo dénormalisés sont déjà publics sur la fiche. Les uids du
//   roster vivent dans la sous-collection privée `/private/acl` (deny-all).
// - Le doc porte les champs structurels du moteur (void, statsCount, sources)
//   pour une reconstruction FIDÈLE — pas de perte, pas de devinette.

import type {
  Bracket,
  BracketKind,
  BoConfig,
  PureMatch,
  PureMatchStatus,
} from '@/lib/tournament';
import { generateDoubleElim, generateRoundRobin, generateSingleElim } from '@/lib/tournament';
import type { CompetitionMatch, MatchSource, MatchStatus } from '@/types/competitions';

export interface TeamDisplay {
  name: string;
  tag: string;
  logoUrl: string | null;
}

/** Doc `competition_matches` tel qu'écrit en base (sous-ensemble sérialisable
 *  de CompetitionMatch — les Timestamps restent nuls à la matérialisation). */
export type MatchDoc = Omit<CompetitionMatch, 'id'>;

// ── Sérialisation : PureMatch → doc Firestore ────────────────────────────────

function mapSourceToDoc(src: PureMatch['sourceA']): MatchSource {
  switch (src.type) {
    case 'seed': return { type: 'seed', ref: src.ref };
    case 'winner_of': return { type: 'winner_of', ref: src.ref };
    case 'loser_of': return { type: 'loser_of', ref: src.ref };
    // 'none' n'est jamais produit par generateDoubleElim (byes = côté void, pas
    // source none) — défensif : représenté comme un bye structurel.
    case 'none': return { type: 'bye', ref: null };
  }
}

function mapSourceToPure(src: MatchSource): PureMatch['sourceA'] {
  switch (src.type) {
    case 'seed': return { type: 'seed', ref: src.ref };
    case 'winner_of': return { type: 'winner_of', ref: src.ref };
    case 'loser_of': return { type: 'loser_of', ref: src.ref };
    case 'bye': return { type: 'none' };
  }
}

/**
 * Un `PureMatch` fraîchement généré/progressé → document Firestore complet.
 * Les champs « jour de match » (checkin, room, dispute, cast) naissent vides :
 * ils seront remplis par la machine d'états du Lot 3. `scores.final` reflète
 * les manches validées du moteur ; `stats` en est dérivé pour le départage.
 */
export function pureMatchToDoc(
  competitionId: string,
  m: PureMatch,
  info: { a: TeamDisplay | null; b: TeamDisplay | null },
): MatchDoc {
  const finalScores = m.scores ?? null;
  const stats = finalScores
    ? {
        a: { goalsFor: sum(finalScores.map(g => g.a)), goalsAgainst: sum(finalScores.map(g => g.b)) },
        b: { goalsFor: sum(finalScores.map(g => g.b)), goalsAgainst: sum(finalScores.map(g => g.a)) },
      }
    : null;

  return {
    competitionId,
    bracket: m.bracket,
    round: m.round,
    slot: m.slot,
    // Poule (round robin) : sérialisée uniquement quand elle existe —
    // Firestore rejette `undefined`, les matchs d'arbre n'ont pas le champ.
    ...(m.group !== undefined ? { group: m.group } : {}),
    phase: m.phase,
    bo: m.bo,
    teamA: m.teamA,
    teamB: m.teamB,
    voidA: m.voidA,
    voidB: m.voidB,
    statsCountA: m.statsCountA,
    statsCountB: m.statsCountB,
    teamAInfo: info.a,
    teamBInfo: info.b,
    sourceA: mapSourceToDoc(m.sourceA),
    sourceB: mapSourceToDoc(m.sourceB),
    status: pureStatusToDoc(m.status),
    checkin: null,
    // Créateur de la room = équipe du haut du bracket (spec §8) : teamA par
    // convention de génération.
    roomHost: 'a',
    scores: {
      a: [],
      b: [],
      aSubmittedAt: null,
      bSubmittedAt: null,
      counterDeadline: null,
      final: finalScores ? finalScores.map(g => ({ a: g.a, b: g.b })) : null,
      validatedBy: finalScores ? 'auto' : null,
    },
    stats,
    // Métadonnée jour-de-match : le moteur pur ne connaît que le camp
    // forfaitaire. validatedBy reste null ici (la route Lot 3 pose 'admin' +
    // le vrai requestedAt quand un admin applique le forfait ; l'audit log
    // porte l'identité).
    forfeit: m.forfeit
      ? { team: m.forfeit, requestedAt: nowIso(), validatedBy: null, reason: null }
      : null,
    dispute: null,
    cast: null,
    winner: m.winner,
    updatedAt: nowIso(),
  };
}

// La progression (Lot 3) réutilise les statuts riches (checkin, live…) ; à la
// matérialisation le moteur ne produit que 4 états, mappés 1:1.
function pureStatusToDoc(s: PureMatchStatus): MatchStatus {
  return s; // 'pending' | 'completed' | 'walkover' | 'cancelled' ⊂ MatchStatus
}

/** Les statuts « jour de match » (checkin, live, disputed…) correspondent tous
 *  à un match non terminal pour le moteur : ils se replient sur 'pending'. */
function docStatusToPure(s: MatchStatus): PureMatchStatus {
  if (s === 'completed' || s === 'walkover' || s === 'cancelled') return s;
  return 'pending';
}

// ── Désérialisation : docs Firestore → Bracket pur (reconstruction Lot 3) ────

/**
 * Reconstruit un `Bracket` pur à partir des SEULS documents
 * `competition_matches` + la config de la compétition. Auto-suffisant : la
 * taille, les rondes et le tableau `teams` (par seed) sont dérivés des docs,
 * PAS d'un `seeding` externe qui pourrait diverger (un siège vidé par
 * replaceTeam n'est pas représentable dans `Competition.seeding`). Les docs
 * sont donc bien l'unique source de vérité de la progression. L'ordre des
 * matchs est reconstitué à l'identique de la génération (winners → losers →
 * GF → reset, par round puis slot), pour un déroulé de propagation
 * déterministe. `withdrawn` reste fourni (il vit sur `Competition.withdrawn`
 * et les équipes retirées apparaissent dans les résultats).
 */
export function reconstructBracket(input: {
  withdrawn: string[];
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  matches: Array<{ id: string } & MatchDoc>;
  /** Format du bracket. Absent (docs d'avant le multi-format) : inféré de la
   *  présence d'une grande finale — un double élim en a TOUJOURS une — ou de
   *  matchs `round_robin` (jamais mélangés à un arbre). */
  kind?: BracketKind;
}): Bracket {
  // Round robin : reconstruction dédiée — les notions d'arbre (round 1
  // winners, puissance de 2, rondes losers) n'existent pas.
  if (input.kind === 'round_robin' || input.matches.some(m => m.bracket === 'round_robin')) {
    return reconstructRoundRobin(input);
  }
  // Taille = nombre de sièges du round 1 winners (robuste aux byes ET aux
  // sièges vidés, contrairement au comptage des équipes présentes).
  const w1 = input.matches.filter(m => m.bracket === 'winners' && m.round === 1);
  const size = w1.length * 2;
  if (size < 4 || (size & (size - 1)) !== 0) {
    throw new Error(`Bracket incohérent : ${size} sièges round 1 (attendu puissance de 2 ≥ 4).`);
  }
  const winnersRounds = Math.log2(size);
  const kind: BracketKind = input.kind
    ?? (input.matches.some(m => m.bracket === 'grand_final') ? 'double_elim' : 'single_elim');
  // Rondes losers : formule structurelle en double élim (robuste même face à
  // des docs partiels — comportement historique conservé, review), dérivées
  // des docs en simple élim (1 avec petite finale, 0 sans).
  const losersRounds = kind === 'double_elim'
    ? 2 * (winnersRounds - 1)
    : input.matches.reduce((max, m) => (m.bracket === 'losers' && m.round > max ? m.round : max), 0);

  // `teams` par seed (index 0 = seed 1) : lu depuis les sources 'seed' du round
  // 1 winners. Un siège void (bye ou vidé par replaceTeam) → '' à sa place. La
  // longueur = plus haute place occupée (les byes de fin ne sont pas des seats).
  const bySeed = new Map<number, string>();
  let maxOccupied = 0;
  for (const m of w1) {
    for (const [src, team, isVoid] of [
      [m.sourceA, m.teamA, m.voidA] as const,
      [m.sourceB, m.teamB, m.voidB] as const,
    ]) {
      if (src.type === 'seed' && !isVoid && team) {
        bySeed.set(src.ref, team);
        if (src.ref > maxOccupied) maxOccupied = src.ref;
      }
    }
  }
  const teams: string[] = [];
  for (let s = 1; s <= maxOccupied; s++) teams.push(bySeed.get(s) ?? '');

  const matches: Record<string, PureMatch> = {};
  for (const doc of input.matches) matches[doc.id] = docToPureMatch(doc);
  const order = orderIds(input.matches.map(d => ({ id: d.id, bracket: d.bracket, round: d.round, slot: d.slot })));

  return {
    kind,
    teams,
    size,
    winnersRounds,
    losersRounds,
    bo: input.bo,
    forfeitScore: input.forfeitScore,
    matches,
    order,
    withdrawn: [...input.withdrawn],
  };
}

/** Reconstruction ROUND ROBIN : `teams` par seed depuis les sources `seed` de
 *  TOUS les matchs (chaque équipe y apparaît — un siège vidé par replaceTeam
 *  reste '' à sa place), poules et journées dérivées des docs eux-mêmes. Les
 *  docs restent l'unique source de vérité de la progression (invariant du
 *  module). */
function reconstructRoundRobin(input: {
  withdrawn: string[];
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  matches: Array<{ id: string } & MatchDoc>;
}): Bracket {
  const rrMatches = input.matches.filter(m => m.bracket === 'round_robin');
  if (rrMatches.length === 0) {
    throw new Error('Round robin incohérent : aucun match de poule.');
  }
  const bySeed = new Map<number, string>();
  let maxSeed = 0;
  for (const m of rrMatches) {
    for (const [src, team, isVoid] of [
      [m.sourceA, m.teamA, m.voidA] as const,
      [m.sourceB, m.teamB, m.voidB] as const,
    ]) {
      if (src.type !== 'seed') continue;
      if (src.ref > maxSeed) maxSeed = src.ref;
      if (!isVoid && team) bySeed.set(src.ref, team);
    }
  }
  const teams: string[] = [];
  for (let s = 1; s <= maxSeed; s++) teams.push(bySeed.get(s) ?? '');

  const matches: Record<string, PureMatch> = {};
  for (const doc of rrMatches) matches[doc.id] = docToPureMatch(doc);
  const order = orderIds(rrMatches.map(d => ({ id: d.id, bracket: d.bracket, round: d.round, slot: d.slot })));

  return {
    kind: 'round_robin',
    teams,
    size: maxSeed,
    winnersRounds: 0,
    losersRounds: 0,
    groups: rrMatches.reduce((max, m) => Math.max(max, m.group ?? 1), 1),
    matchdays: rrMatches.reduce((max, m) => Math.max(max, m.round), 0),
    bo: input.bo,
    forfeitScore: input.forfeitScore,
    matches,
    order,
    withdrawn: [...input.withdrawn],
  };
}

export function docToPureMatch(doc: { id: string } & MatchDoc): PureMatch {
  const final = doc.scores?.final ?? null;
  return {
    id: doc.id,
    bracket: doc.bracket,
    round: doc.round,
    slot: doc.slot,
    ...(doc.group !== undefined ? { group: doc.group } : {}),
    bo: doc.bo,
    phase: doc.phase,
    sourceA: mapSourceToPure(doc.sourceA),
    sourceB: mapSourceToPure(doc.sourceB),
    teamA: doc.teamA,
    teamB: doc.teamB,
    voidA: doc.voidA,
    voidB: doc.voidB,
    status: docStatusToPure(doc.status),
    winner: doc.winner,
    scores: final ? final.map(g => ({ a: g.a, b: g.b })) : null,
    forfeit: doc.forfeit ? doc.forfeit.team : null,
    statsCountA: doc.statsCountA,
    statsCountB: doc.statsCountB,
  };
}

// Reproduit l'ordre de création des générateurs : bracket (winners < losers <
// grand_final), puis round croissant, puis slot croissant. En round robin le
// bracket est homogène — l'ordre est (journée, slot global), déterministe par
// construction (slots globaux, jamais deux matchs au même (round, slot)).
const BRACKET_RANK: Record<PureMatch['bracket'], number> = { winners: 0, losers: 1, grand_final: 2, round_robin: 3 };
function orderIds(ms: Array<{ id: string; bracket: PureMatch['bracket']; round: number; slot: number }>): string[] {
  return [...ms]
    .sort((a, b) =>
      BRACKET_RANK[a.bracket] - BRACKET_RANK[b.bracket] ||
      a.round - b.round ||
      a.slot - b.slot)
    .map(m => m.id);
}

// ── Matérialisation : seeding → bracket généré → docs + ACL ──────────────────

export interface MaterializedBracket {
  matches: Array<{ id: string; doc: MatchDoc }>;
  /** participantUids par match, pour les sous-docs privés `/private/acl`
   *  (deny-all). Émis dès qu'AU MOINS UN côté a un roster connu (round 1, mais
   *  aussi un match aval qu'un bye a déjà à moitié peuplé). Le Lot 3, à chaque
   *  matérialisation d'une nouvelle équipe, devra FUSIONNER (arrayUnion), pas
   *  écraser, ces participantUids — sinon il efface l'ACL du côté déjà présent. */
  acls: Array<{ matchId: string; participantUids: string[] }>;
}

/**
 * Génère et sérialise le bracket d'une compétition à partir de son seeding.
 * `registrations` : registrationId → { display, rosterUids } des équipes
 * validées. Le seeding est la liste ordonnée des registrationId.
 */
export function materializeBracket(input: {
  competitionId: string;
  seeding: string[];
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  phasePlan?: Array<{ phase: number; rounds: Array<{ bracket: PureMatch['bracket']; round: number }> }>;
  registrations: Record<string, { display: TeamDisplay; rosterUids: string[] }>;
  /** Format (défaut double élim — comportement historique du Lot 2). */
  kind?: BracketKind;
  /** Petite finale (simple élim uniquement). */
  thirdPlace?: boolean;
  /** Round robin uniquement : nombre de poules (défaut 1). */
  groups?: number;
  /** Round robin uniquement : aller-retour. */
  doubleRound?: boolean;
}): MaterializedBracket {
  const opts = {
    bo: input.bo,
    forfeitScore: input.forfeitScore,
    phasePlan: input.phasePlan,
  };
  const bracket = input.kind === 'round_robin'
    ? generateRoundRobin(input.seeding, { ...opts, groups: input.groups, doubleRound: input.doubleRound })
    : input.kind === 'single_elim'
      ? generateSingleElim(input.seeding, { ...opts, thirdPlace: input.thirdPlace })
      : generateDoubleElim(input.seeding, opts);

  const infoOf = (regId: string | null): TeamDisplay | null =>
    regId ? input.registrations[regId]?.display ?? null : null;
  const rosterOf = (regId: string | null): string[] =>
    regId ? input.registrations[regId]?.rosterUids ?? [] : [];

  const matches: MaterializedBracket['matches'] = [];
  const acls: MaterializedBracket['acls'] = [];
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    matches.push({ id, doc: pureMatchToDoc(input.competitionId, m, { a: infoOf(m.teamA), b: infoOf(m.teamB) }) });
    const participantUids = [...rosterOf(m.teamA), ...rosterOf(m.teamB)];
    if (participantUids.length > 0) acls.push({ matchId: id, participantUids });
  }
  return { matches, acls };
}

// ── Utils ────────────────────────────────────────────────────────────────────

function sum(xs: number[]): number { return xs.reduce((a, b) => a + b, 0); }

// Timestamp textuel neutre : les routes serveur remplacent par
// FieldValue.serverTimestamp() au write ; ce module pur reste sans I/O ni
// dépendance firebase-admin (testable en isolation).
function nowIso(): string { return ''; }
