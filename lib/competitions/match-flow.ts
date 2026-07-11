// Machine d'états « jour de match » — PURE, aucune I/O (archi §5, spec §8-§9).
// Composant critique : décide de la légalité de chaque action (check-in,
// saisie de scores, litige, forfait, deadlines) et de QUAND un résultat est
// acquis. Elle ne produit JAMAIS le document final d'un match : le résultat
// (scores.final, stats, winner, status terminal) est toujours écrit par la
// PROGRESSION (lib/tournament advanceMatch → patch ciblé), unique chemin
// d'écriture — cette lib retourne des décisions typées que la route applique.
//
// Décisions métier appliquées (spec, ne pas re-débattre) :
// - Check-in de phase : 5 min, lancé par ACTION EXPLICITE d'un admin (R5-2),
//   capitaine seul. Échéance sans check-in → « en attente de validation du
//   forfait par un admin » — JAMAIS de forfait automatique (spec §8).
// - Scores : saisis par les capitaines OU le staff des DEUX équipes (spec §9).
//   Première saisie complète → l'autre camp a `scoreCounterMinutes` (3 min).
//   Deadline échue → la saisie unique est retenue + notification admin.
//   RÈGLE DE COURSE (archi §5) : une contre-saisie qui ARRIVE avant la
//   finalisation effective est traitée normalement, même après la deadline —
//   seule applyDeadlines() finalise.
// - Scores divergents → litige AUTOMATIQUE ; bouton litige manuel en plus.
//   Litige = gel du match, résolution admin (force-score) débloque.
// - Horloge : les millisecondes `nowMs` sont TOUJOURS passées par l'appelant
//   (testabilité, cohérence transactionnelle) — jamais de Date.now() ici.

import type { MatchStatus } from '@/types/competitions';

export type FlowSide = 'a' | 'b';

export interface GamePair { a: number; b: number }

/** Vue minimale d'un match nécessaire aux décisions (millis partout). */
export interface FlowMatchState {
  id: string;
  bo: number;
  teamA: string | null;
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  status: MatchStatus;
  checkin: { deadlineMs: number; aDone: boolean; bDone: boolean } | null;
  scores: {
    a: GamePair[];                  // saisie du camp A ([] = pas saisi)
    b: GamePair[];
    aSubmittedAtMs: number | null;
    bSubmittedAtMs: number | null;
    counterDeadlineMs: number | null;
  };
  disputeOpen: boolean;
}

export interface FlowConfig {
  matchCheckinMinutes: number;      // 5
  scoreCounterMinutes: number;      // 3
}

/** Résultat acquis — consommé par la progression (advanceMatch). */
export type FlowOutcome =
  | { type: 'winner'; winner: FlowSide; games: GamePair[] }
  | { type: 'forfeit'; team: FlowSide | 'both' };

export type FlowEvent =
  | { kind: 'checkin_opened'; deadlineMs: number }
  | { kind: 'both_checked_in' }
  | { kind: 'checkin_expired'; missing: FlowSide[] }
  | { kind: 'counter_started'; deadlineMs: number; awaiting: FlowSide }
  | { kind: 'dispute_opened'; auto: boolean }
  | { kind: 'single_entry_notice'; submitted: FlowSide }   // notif admins (spec §9)
  | { kind: 'outcome'; outcome: FlowOutcome; via: 'agreement' | 'deadline' | 'admin' | 'forfeit' };

export type FlowError =
  | 'invalid_state'         // l'action n'est pas légale dans le statut courant
  | 'teams_not_ready'       // équipes pas toutes connues / côté void
  | 'already_done'          // check-in déjà fait pour ce camp
  | 'deadline_passed'       // check-in après l'échéance
  | 'invalid_scores'        // saisie incohérente avec le BO
  | 'dispute_open';         // match gelé par un litige

type Fail = { ok: false; error: FlowError };
const fail = (error: FlowError): Fail => ({ ok: false, error });

// États depuis lesquels un match est définitivement figé pour les participants.
const TERMINAL: ReadonlySet<MatchStatus> = new Set(['completed', 'walkover', 'cancelled']);
// États où une saisie de score est recevable (le match se joue ou vient de finir).
const SCORABLE: ReadonlySet<MatchStatus> = new Set(['live', 'awaiting_scores', 'score_review']);

export function isTerminalStatus(status: MatchStatus): boolean {
  return TERMINAL.has(status);
}

// ── Validation d'une saisie de manches ───────────────────────────────────────

/**
 * Mêmes règles que le moteur (advance.ts validateScores) : vainqueur net à
 * exactement ceil(bo/2) manches, pas de manche après la décision, pas de
 * manche nulle, buts entiers ≥ 0. Le moteur revalidera à la progression —
 * double filet voulu.
 */
export function validateEntry(games: GamePair[], bo: number): { ok: true; winner: FlowSide } | Fail {
  const needed = Math.ceil(bo / 2);
  if (!Array.isArray(games) || games.length < needed || games.length > bo) return fail('invalid_scores');
  let winsA = 0;
  let winsB = 0;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g || !Number.isInteger(g.a) || !Number.isInteger(g.b) || g.a < 0 || g.b < 0) return fail('invalid_scores');
    if (g.a === g.b) return fail('invalid_scores');           // pas de nul en manche
    if (winsA >= needed || winsB >= needed) return fail('invalid_scores'); // manche après décision
    if (g.a > g.b) winsA++;
    else winsB++;
  }
  if (winsA !== needed && winsB !== needed) return fail('invalid_scores');
  const loserWins = winsA === needed ? winsB : winsA;
  if (loserWins >= needed) return fail('invalid_scores');
  return { ok: true, winner: winsA === needed ? 'a' : 'b' };
}

function sameEntries(x: GamePair[], y: GamePair[]): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i].a !== y[i].a || x[i].b !== y[i].b) return false;
  }
  return true;
}

// ── Lancement de phase (admin, R5-2 : action explicite, partiel possible) ────

export interface OpenCheckinDecision {
  ok: true;
  deadlineMs: number;
  events: FlowEvent[];
}

/** Ouvre le check-in d'UN match (l'admin lance une phase = la liste des matchs
 *  dont les 2 équipes sont connues ; un litige amont ne gèle pas les autres). */
export function openPhaseCheckin(m: FlowMatchState, cfg: FlowConfig, nowMs: number): OpenCheckinDecision | Fail {
  if (m.status !== 'pending') return fail('invalid_state');
  if (!m.teamA || !m.teamB || m.voidA || m.voidB) return fail('teams_not_ready');
  if (m.disputeOpen) return fail('dispute_open');
  const deadlineMs = nowMs + cfg.matchCheckinMinutes * 60_000;
  return { ok: true, deadlineMs, events: [{ kind: 'checkin_opened', deadlineMs }] };
}

// ── Check-in d'un camp (capitaine seul — le camp est dérivé SERVEUR) ─────────

export interface CheckinDecision {
  ok: true;
  side: FlowSide;
  bothDone: boolean;                // true → le match passe en 'live'
  events: FlowEvent[];
}

export function submitCheckin(m: FlowMatchState, side: FlowSide, nowMs: number): CheckinDecision | Fail {
  if (m.status !== 'checkin' || !m.checkin) return fail('invalid_state');
  const done = side === 'a' ? m.checkin.aDone : m.checkin.bDone;
  if (done) return fail('already_done');
  if (nowMs > m.checkin.deadlineMs) return fail('deadline_passed');
  const other = side === 'a' ? m.checkin.bDone : m.checkin.aDone;
  const events: FlowEvent[] = other ? [{ kind: 'both_checked_in' }] : [];
  return { ok: true, side, bothDone: other, events };
}

// ── Saisie des scores (capitaines OU staff des deux équipes, spec §9) ────────

export type SubmitScoresDecision =
  | {
      ok: true;
      side: FlowSide;
      games: GamePair[];
      /** null → première saisie (ou correction) : le match attend l'autre camp. */
      resolution:
        | null
        | { kind: 'agreement'; outcome: FlowOutcome }
        | { kind: 'mismatch' };                       // → litige automatique
      /** Posée uniquement à la PREMIÈRE saisie complète du match. */
      counterDeadlineMs: number | null;
      events: FlowEvent[];
    }
  | Fail;

export function submitScores(
  m: FlowMatchState,
  side: FlowSide,
  games: GamePair[],
  cfg: FlowConfig,
  nowMs: number,
): SubmitScoresDecision {
  if (!SCORABLE.has(m.status)) return fail('invalid_state');
  if (m.disputeOpen) return fail('dispute_open');
  const valid = validateEntry(games, m.bo);
  if (!valid.ok) return valid;

  const otherEntry = side === 'a' ? m.scores.b : m.scores.a;
  const otherSubmitted = otherEntry.length > 0;
  const firstEntryOfMatch = !otherSubmitted && (side === 'a' ? m.scores.a : m.scores.b).length === 0;

  if (otherSubmitted) {
    // Contre-saisie (règle de course : acceptée tant que rien n'est finalisé,
    // même après la deadline — c'est applyDeadlines qui finalise).
    if (sameEntries(games, otherEntry)) {
      const winner = valid.winner;
      const outcome: FlowOutcome = { type: 'winner', winner, games };
      return {
        ok: true, side, games,
        resolution: { kind: 'agreement', outcome },
        counterDeadlineMs: null,
        events: [{ kind: 'outcome', outcome, via: 'agreement' }],
      };
    }
    return {
      ok: true, side, games,
      resolution: { kind: 'mismatch' },
      counterDeadlineMs: null,
      events: [{ kind: 'dispute_opened', auto: true }],
    };
  }

  // Première saisie du match → compteur 3 min pour l'autre camp. Une simple
  // CORRECTION (même camp qui re-saisit) ne repousse pas le compteur.
  const counterDeadlineMs = firstEntryOfMatch
    ? nowMs + cfg.scoreCounterMinutes * 60_000
    : m.scores.counterDeadlineMs;
  const events: FlowEvent[] = firstEntryOfMatch
    ? [{ kind: 'counter_started', deadlineMs: counterDeadlineMs!, awaiting: side === 'a' ? 'b' : 'a' }]
    : [];
  return { ok: true, side, games, resolution: null, counterDeadlineMs, events };
}

// ── Litige manuel (avant complétion uniquement — après, c'est un admin) ──────

export interface DisputeDecision {
  ok: true;
  events: FlowEvent[];
}

// (le camp ouvrant est journalisé par la route — la légalité n'en dépend pas)
export function openDispute(m: FlowMatchState): DisputeDecision | Fail {
  if (!SCORABLE.has(m.status) && m.status !== 'checkin') return fail('invalid_state');
  if (m.disputeOpen) return fail('already_done');
  return { ok: true, events: [{ kind: 'dispute_opened', auto: false }] };
}

// ── Deadlines (tick idempotent — archi §5, transaction par match) ────────────

export type DeadlineTransition =
  | { type: 'checkin_expired'; missing: FlowSide[]; events: FlowEvent[] }
  | { type: 'finalize_single_entry'; outcome: FlowOutcome; submitted: FlowSide; events: FlowEvent[] };

/**
 * Transition due à l'horloge, s'il y en a une. Appelée DANS une transaction
 * (relire le statut + la deadline avant d'appliquer — pattern archi §5).
 * Ne retourne jamais plus d'une transition : le tick suivant traite la suite.
 */
export function applyDeadlines(m: FlowMatchState, nowMs: number): DeadlineTransition | null {
  if (TERMINAL.has(m.status) || m.disputeOpen) return null;

  if (m.status === 'checkin' && m.checkin && nowMs > m.checkin.deadlineMs) {
    if (!m.checkin.aDone || !m.checkin.bDone) {
      const missing: FlowSide[] = [];
      if (!m.checkin.aDone) missing.push('a');
      if (!m.checkin.bDone) missing.push('b');
      return { type: 'checkin_expired', missing, events: [{ kind: 'checkin_expired', missing }] };
    }
    return null;
  }

  if (m.status === 'score_review' && m.scores.counterDeadlineMs !== null && nowMs > m.scores.counterDeadlineMs) {
    const aIn = m.scores.a.length > 0;
    const bIn = m.scores.b.length > 0;
    // Les deux saisies présentes = déjà résolu par submitScores (agreement ou
    // litige) — l'état score_review avec 2 saisies ne doit pas exister.
    if (aIn === bIn) return null;
    const submitted: FlowSide = aIn ? 'a' : 'b';
    const games = aIn ? m.scores.a : m.scores.b;
    const valid = validateEntry(games, m.bo);
    if (!valid.ok) return null;                       // défensif : saisie corrompue → décision admin
    const outcome: FlowOutcome = { type: 'winner', winner: valid.winner, games };
    return {
      type: 'finalize_single_entry',
      outcome,
      submitted,
      events: [
        { kind: 'single_entry_notice', submitted },
        { kind: 'outcome', outcome, via: 'deadline' },
      ],
    };
  }

  return null;
}

/**
 * GARDE DE FINALISATION AUTOMATIQUE (review adversariale — blocker) : toute
 * finalisation « auto » (accord des capitaines, deadline du tick) est décidée
 * HORS de la transaction de progression. Entre la décision et l'application,
 * une contre-saisie, une correction ou un litige peuvent légalement arriver
 * (règle de course archi §5). La progression rejoue donc cette fonction sur
 * l'état FRAIS du pivot dans SA transaction : si l'outcome attendu n'est plus
 * exactement celui décidé, elle ABANDONNE (no-op) — le tick suivant décidera
 * sur l'état à jour. Un litige ouvert bloque toute finalisation auto.
 */
export function expectedAutoOutcome(m: FlowMatchState, nowMs: number): FlowOutcome | null {
  if (m.disputeOpen || TERMINAL.has(m.status)) return null;
  const agreement = detectUnfinalizedAgreement(m);
  if (agreement) return agreement;
  const due = applyDeadlines(m, nowMs);
  return due?.type === 'finalize_single_entry' ? due.outcome : null;
}

export function sameOutcome(x: FlowOutcome, y: FlowOutcome): boolean {
  if (x.type !== y.type) return false;
  if (x.type === 'forfeit' && y.type === 'forfeit') return x.team === y.team;
  if (x.type === 'winner' && y.type === 'winner') {
    return x.winner === y.winner && sameEntries(x.games, y.games);
  }
  return false;
}

/**
 * Relance du check-in par un admin (console) : un match en « attente de
 * validation du forfait » peut REPRENDRE si l'équipe en retard arrive (le
 * forfait n'est jamais la seule issue — spec §8, l'admin décide). Les
 * check-ins déjà faits sont conservés ; nouvelle deadline pleine.
 */
export interface ReopenCheckinDecision {
  ok: true;
  deadlineMs: number;
  aDone: boolean;
  bDone: boolean;
  /** Les deux camps avaient déjà check-in → le match repart directement en cours. */
  bothDone: boolean;
  events: FlowEvent[];
}

export function reopenCheckin(m: FlowMatchState, cfg: FlowConfig, nowMs: number): ReopenCheckinDecision | Fail {
  if (m.status !== 'awaiting_forfeit_validation' && m.status !== 'checkin') return fail('invalid_state');
  if (!m.teamA || !m.teamB || m.voidA || m.voidB) return fail('teams_not_ready');
  if (m.disputeOpen) return fail('dispute_open');
  const aDone = m.checkin?.aDone === true;
  const bDone = m.checkin?.bDone === true;
  const deadlineMs = nowMs + cfg.matchCheckinMinutes * 60_000;
  return {
    ok: true, deadlineMs, aDone, bDone, bothDone: aDone && bDone,
    events: [{ kind: 'checkin_opened', deadlineMs }],
  };
}

/**
 * RÉPARATION (tick) : deux saisies complètes et CONCORDANTES en score_review =
 * un accord enregistré dont la finalisation (progression) n'est jamais partie
 * (crash entre l'enregistrement de la contre-saisie et l'application du
 * résultat). Le tick rejoue la finalisation — la progression est idempotente.
 * Deux saisies divergentes ne passent jamais par ici (litige posé dans la
 * même transaction que la contre-saisie).
 */
export function detectUnfinalizedAgreement(m: FlowMatchState): FlowOutcome | null {
  if (m.status !== 'score_review' || m.disputeOpen) return null;
  if (m.scores.a.length === 0 || m.scores.b.length === 0) return null;
  if (!sameEntries(m.scores.a, m.scores.b)) return null;
  const valid = validateEntry(m.scores.a, m.bo);
  if (!valid.ok) return null;
  return { type: 'winner', winner: valid.winner, games: m.scores.a };
}

// ── Actions admin (console) ──────────────────────────────────────────────────

export interface AdminOutcomeDecision {
  ok: true;
  outcome: FlowOutcome;
  events: FlowEvent[];
}

/** Force-score : depuis tout état non terminal (litige inclus — c'est LA voie
 *  de résolution d'un litige, spec §9). */
export function forceScore(m: FlowMatchState, games: GamePair[]): AdminOutcomeDecision | Fail {
  if (TERMINAL.has(m.status)) return fail('invalid_state');
  if (!m.teamA || !m.teamB || m.voidA || m.voidB) return fail('teams_not_ready');
  const valid = validateEntry(games, m.bo);
  if (!valid.ok) return valid;
  const outcome: FlowOutcome = { type: 'winner', winner: valid.winner, games };
  return { ok: true, outcome, events: [{ kind: 'outcome', outcome, via: 'admin' }] };
}

/** Validation d'un forfait (jamais automatique, spec §8) : le score
 *  conventionnel et la propagation viennent du moteur à la progression. */
export function validateForfeit(m: FlowMatchState, team: FlowSide | 'both'): AdminOutcomeDecision | Fail {
  if (TERMINAL.has(m.status)) return fail('invalid_state');
  if (!m.teamA || !m.teamB || m.voidA || m.voidB) return fail('teams_not_ready');
  const outcome: FlowOutcome = { type: 'forfeit', team };
  return { ok: true, outcome, events: [{ kind: 'outcome', outcome, via: 'forfeit' }] };
}
