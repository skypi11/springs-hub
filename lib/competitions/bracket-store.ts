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
  BoConfig,
  PureMatch,
  PureMatchStatus,
} from '@/lib/tournament';
import { generateDoubleElim } from '@/lib/tournament';
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
    forfeit: m.forfeit
      ? { team: m.forfeit, requestedAt: nowIso(), validatedBy: 'auto', reason: null }
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
 * Reconstruit un `Bracket` pur à partir des documents `competition_matches` et
 * de la config de la compétition. L'ordre des matchs est reconstitué à
 * l'identique de la génération (winners → losers → GF → reset, par round puis
 * slot), garantissant un déroulé de propagation déterministe.
 */
export function reconstructBracket(input: {
  seeding: string[];              // registrationIds en ordre de seed (index 0 = seed 1)
  withdrawn: string[];
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
  matches: Array<{ id: string } & MatchDoc>;
}): Bracket {
  const size = nextPowerOfTwo(input.seeding.length);
  const winnersRounds = Math.log2(size);
  const losersRounds = 2 * (winnersRounds - 1);

  const matches: Record<string, PureMatch> = {};
  for (const doc of input.matches) {
    matches[doc.id] = docToPureMatch(doc);
  }

  const order = orderIds(input.matches.map(d => ({ id: d.id, bracket: d.bracket, round: d.round, slot: d.slot })));

  return {
    teams: [...input.seeding],
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

export function docToPureMatch(doc: { id: string } & MatchDoc): PureMatch {
  const final = doc.scores?.final ?? null;
  return {
    id: doc.id,
    bracket: doc.bracket,
    round: doc.round,
    slot: doc.slot,
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

// Reproduit l'ordre de création de generateDoubleElim : bracket (winners <
// losers < grand_final), puis round croissant, puis slot croissant.
const BRACKET_RANK: Record<PureMatch['bracket'], number> = { winners: 0, losers: 1, grand_final: 2 };
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
   *  (deny-all). Rempli pour les matchs dont les deux équipes sont connues à la
   *  matérialisation (round 1) ; le Lot 3 complète à chaque avancée. */
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
}): MaterializedBracket {
  const bracket = generateDoubleElim(input.seeding, {
    bo: input.bo,
    forfeitScore: input.forfeitScore,
    phasePlan: input.phasePlan,
  });

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
function nextPowerOfTwo(n: number): number { let p = 1; while (p < n) p *= 2; return p; }

// Timestamp textuel neutre : les routes serveur remplacent par
// FieldValue.serverTimestamp() au write ; ce module pur reste sans I/O ni
// dépendance firebase-admin (testable en isolation).
function nowIso(): string { return ''; }
