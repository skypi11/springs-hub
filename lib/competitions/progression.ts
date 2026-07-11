// Progression du bracket — l'UNIQUE chemin d'écriture d'un résultat de match
// (archi §3, décision Lot 3) : quel que soit le déclencheur (scores concordants,
// deadline de contre-saisie, force-score admin, forfait validé, retrait,
// remplacement waitlist), on reconstruit le bracket PUR depuis les docs,
// on applique l'opération moteur (advanceMatch / withdrawTeam / replaceTeam),
// puis on écrit des PATCHS CIBLÉS des seuls champs moteur — jamais un
// pureMatchToDoc entier, qui écraserait les champs « jour de match »
// (check-in, saisies des capitaines, litige, cast) posés par la machine
// d'états (match-flow).
//
// Ce module est coupé en deux :
// - computeProgressionPatches (PUR, testé Vitest) : diff avant/après moteur →
//   patchs par match + équipes nouvellement matérialisées (fusion ACL).
// - applyMatchOutcome / applyWithdraw / applyReplacement (serveur) :
//   transaction Firestore — relecture fraîche de TOUS les docs (ids
//   déterministes connus, pas de .where en transaction — piège documenté),
//   opération moteur, écriture des patchs + arrayUnion ACL + timestamps réels.

import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  advanceMatch,
  withdrawTeam,
  replaceTeam,
  isFinished,
  needsAdminDecision,
  type Bracket,
  type BoConfig,
  type GameScore,
  type MatchOutcome,
} from '@/lib/tournament';
import { reconstructBracket, type MatchDoc, type TeamDisplay } from '@/lib/competitions/bracket-store';
import type { MatchStatus } from '@/types/competitions';

// ── Diff pur : bracket avant/après → patchs ciblés ──────────────────────────

export interface MatchFieldPatch {
  teamA?: string | null;
  teamAInfo?: TeamDisplay | null;
  teamB?: string | null;
  teamBInfo?: TeamDisplay | null;
  voidA?: boolean;
  voidB?: boolean;
  statsCountA?: boolean;
  statsCountB?: boolean;
  winner?: 'a' | 'b' | null;
  /** Uniquement les statuts terminaux du moteur — jamais 'pending' (on
   *  n'écrase pas un checkin/live posé par la machine d'états). */
  status?: Extract<MatchStatus, 'completed' | 'walkover' | 'cancelled'>;
  final?: GameScore[] | null;
  stats?: {
    a: { goalsFor: number; goalsAgainst: number };
    b: { goalsFor: number; goalsAgainst: number };
  } | null;
  /** Nouveau forfait posé par le moteur sur ce match (cascade R5-4 incluse). */
  forfeitTeam?: 'a' | 'b' | 'both';
}

export interface ProgressionPatch {
  matchId: string;
  fields: MatchFieldPatch;
  /** registrationId arrivés sur ce match par cette progression → fusion ACL. */
  arrivedTeams: string[];
}

function statsOf(scores: GameScore[]): NonNullable<MatchFieldPatch['stats']> {
  let af = 0;
  let bf = 0;
  for (const g of scores) { af += g.a; bf += g.b; }
  return { a: { goalsFor: af, goalsAgainst: bf }, b: { goalsFor: bf, goalsAgainst: af } };
}

function sameScores(x: GameScore[] | null, y: GameScore[] | null): boolean {
  if (x === null || y === null) return x === y;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i].a !== y[i].a || x[i].b !== y[i].b) return false;
  return true;
}

/**
 * Diff de deux états moteur du MÊME bracket. Pur et exhaustif : tout champ
 * moteur qui a changé sort dans un patch, rien d'autre n'en sort.
 */
export function computeProgressionPatches(
  before: Bracket,
  after: Bracket,
  infoOf: (regId: string | null) => TeamDisplay | null,
): ProgressionPatch[] {
  const patches: ProgressionPatch[] = [];
  for (const id of after.order) {
    const b = before.matches[id];
    const a = after.matches[id];
    if (!b || !a) continue;                       // ensembles identiques par construction
    const fields: MatchFieldPatch = {};
    const arrivedTeams: string[] = [];

    if (a.teamA !== b.teamA) {
      fields.teamA = a.teamA;
      fields.teamAInfo = infoOf(a.teamA);
      if (a.teamA) arrivedTeams.push(a.teamA);
    }
    if (a.teamB !== b.teamB) {
      fields.teamB = a.teamB;
      fields.teamBInfo = infoOf(a.teamB);
      if (a.teamB) arrivedTeams.push(a.teamB);
    }
    if (a.voidA !== b.voidA) fields.voidA = a.voidA;
    if (a.voidB !== b.voidB) fields.voidB = a.voidB;
    if (a.statsCountA !== b.statsCountA) fields.statsCountA = a.statsCountA;
    if (a.statsCountB !== b.statsCountB) fields.statsCountB = a.statsCountB;
    if (a.winner !== b.winner) fields.winner = a.winner;
    if (a.status !== b.status && (a.status === 'completed' || a.status === 'walkover' || a.status === 'cancelled')) {
      fields.status = a.status;
    }
    if (!sameScores(a.scores, b.scores)) {
      fields.final = a.scores ? a.scores.map(g => ({ a: g.a, b: g.b })) : null;
      fields.stats = a.scores ? statsOf(a.scores) : null;
    }
    if (a.forfeit !== b.forfeit && a.forfeit !== null) {
      fields.forfeitTeam = a.forfeit;
    }

    if (Object.keys(fields).length > 0) {
      patches.push({ matchId: id, fields, arrivedTeams });
    }
  }
  return patches;
}

// ── Orchestration serveur (transaction) ─────────────────────────────────────

export interface CompetitionEngineConfig {
  bo: BoConfig;
  forfeitScore: { games: number; goalsPerGame: number };
}

export interface ProgressionResult {
  changedMatchIds: string[];
  /** Le bracket est intégralement résolu (clôture possible côté console). */
  finished: boolean;
  /** Fin sans champion mécanique (double forfait en finale…) → décision admin. */
  needsAdminDecision: boolean;
}

type EngineOp =
  | { op: 'outcome'; matchId: string; outcome: MatchOutcome }
  | { op: 'withdraw'; registrationId: string }
  | { op: 'replace'; oldRegistrationId: string; newRegistrationId: string | null };

/**
 * Applique une opération moteur en transaction. Relit TOUT frais dans la
 * transaction (comp + matchs + regs — refs déterministes, aucun `.where`),
 * calcule le diff, écrit les patchs + fusion ACL. `pivotGuard` : pour un
 * outcome, la transaction ABANDONNE si le match pivot est déjà terminal
 * (idempotence sous double-submit / tick concurrent).
 */
export interface ProgressionExtra {
  /** Qui a validé le score du PIVOT : 'auto' (accord / deadline) ou 'admin'
   *  (force-score, forfait). Les matchs de cascade restent 'auto'. */
  validatedBy?: 'auto' | 'admin';
  forfeitReason?: string | null;
  /** Texte de résolution si un litige était ouvert sur le pivot. */
  resolveDispute?: string | null;
}

async function applyEngineOp(
  db: Firestore,
  competitionId: string,
  op: EngineOp,
  extra?: ProgressionExtra,
): Promise<ProgressionResult> {
  // Ids de docs appris HORS transaction (immuables après publication).
  const matchIdsSnap = await db.collection('competition_matches')
    .where('competitionId', '==', competitionId).select().get();
  const matchRefs = matchIdsSnap.docs.map(d => d.ref);
  if (matchRefs.length === 0) throw new Error('bracket_not_published');
  const regsIdsSnap = await db.collection('competition_registrations')
    .where('competitionId', '==', competitionId).select().get();
  const regRefs = regsIdsSnap.docs.map(d => d.ref);
  const compRef = db.collection('competitions').doc(competitionId);

  return db.runTransaction(async (tx: Transaction) => {
    const [compSnap, matchSnaps, regSnaps] = await Promise.all([
      tx.get(compRef),
      tx.getAll(...matchRefs),
      regRefs.length > 0 ? tx.getAll(...regRefs) : Promise.resolve([]),
    ]);
    if (!compSnap.exists) throw new Error('competition_not_found');
    const comp = compSnap.data()!;
    const cfg: CompetitionEngineConfig = {
      bo: comp.format?.bo,
      forfeitScore: comp.format?.forfeitScore ?? { games: 3, goalsPerGame: 1 },
    };
    if (!cfg.bo) throw new Error('format_bo_missing');

    const docs = matchSnaps
      .filter(s => s.exists)
      .map(s => ({ ref: s.ref, id: (s.data()!.id as string) ?? s.id, data: s.data() as MatchDoc }));

    const infoByReg = new Map<string, TeamDisplay>();
    const rosterByReg = new Map<string, string[]>();
    for (const s of regSnaps) {
      if (!s.exists) continue;
      const r = s.data()!;
      infoByReg.set(s.id, { name: r.name ?? '', tag: r.tag ?? '', logoUrl: r.logoUrl ?? null });
      rosterByReg.set(s.id, Array.isArray(r.rosterUids) ? (r.rosterUids as string[]) : []);
    }

    const before = reconstructBracket({
      withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
      bo: cfg.bo,
      forfeitScore: cfg.forfeitScore,
      matches: docs.map(d => ({ id: d.id, ...d.data })),
    });

    // Garde d'idempotence : un outcome sur un pivot déjà terminal = déjà
    // appliqué par une requête concurrente → no-op silencieux.
    if (op.op === 'outcome') {
      const pivot = before.matches[op.matchId];
      if (!pivot) throw new Error('match_not_found');
      if (pivot.status === 'completed' || pivot.status === 'walkover' || pivot.status === 'cancelled') {
        return { changedMatchIds: [], finished: isFinished(before), needsAdminDecision: needsAdminDecision(before) };
      }
    }

    let after: Bracket;
    if (op.op === 'outcome') after = advanceMatch(before, op.matchId, op.outcome);
    else if (op.op === 'withdraw') after = withdrawTeam(before, op.registrationId);
    else after = replaceTeam(before, op.oldRegistrationId, op.newRegistrationId);

    const patches = computeProgressionPatches(before, after, regId =>
      regId ? infoByReg.get(regId) ?? null : null);

    const docByEngineId = new Map(docs.map(d => [d.id, d]));
    for (const p of patches) {
      const doc = docByEngineId.get(p.matchId);
      if (!doc) continue;
      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      const f = p.fields;
      if ('teamA' in f) { update.teamA = f.teamA; update.teamAInfo = f.teamAInfo; }
      if ('teamB' in f) { update.teamB = f.teamB; update.teamBInfo = f.teamBInfo; }
      if ('voidA' in f) update.voidA = f.voidA;
      if ('voidB' in f) update.voidB = f.voidB;
      if ('statsCountA' in f) update.statsCountA = f.statsCountA;
      if ('statsCountB' in f) update.statsCountB = f.statsCountB;
      if ('winner' in f) update.winner = f.winner;
      if (f.status) update.status = f.status;
      if ('final' in f) { update['scores.final'] = f.final; update.stats = f.stats; }
      if (f.final) {
        const isPivot = op.op === 'outcome' && p.matchId === op.matchId;
        update['scores.validatedBy'] = isPivot ? (extra?.validatedBy ?? 'auto') : 'auto';
      }
      if (f.forfeitTeam) {
        update.forfeit = {
          team: f.forfeitTeam,
          requestedAt: Timestamp.now(),
          validatedBy: 'admin',
          reason: extra?.forfeitReason ?? null,
        };
      }
      // Pivot : la finalisation ferme les compteurs de saisie ; un litige
      // ouvert résolu par force-score est clôturé ('admin', doc public §8).
      if (op.op === 'outcome' && p.matchId === op.matchId) {
        update['scores.counterDeadline'] = null;
        if (extra?.resolveDispute !== undefined && doc.data.dispute) {
          update['dispute.resolvedBy'] = 'admin';
          update['dispute.resolution'] = extra.resolveDispute;
        }
      }
      tx.update(doc.ref, update);

      // Fusion ACL — JAMAIS d'écrasement (un bye a pu peupler l'ACL à moitié).
      const arrivedUids = p.arrivedTeams.flatMap(regId => rosterByReg.get(regId) ?? []);
      if (arrivedUids.length > 0) {
        tx.set(doc.ref.collection('private').doc('acl'),
          { participantUids: FieldValue.arrayUnion(...arrivedUids) },
          { merge: true });
      }
    }

    if (op.op === 'withdraw' && !before.withdrawn.includes(op.registrationId)) {
      tx.update(compRef, { withdrawn: FieldValue.arrayUnion(op.registrationId) });
    }

    return {
      changedMatchIds: patches.map(p => p.matchId),
      finished: isFinished(after),
      needsAdminDecision: needsAdminDecision(after),
    };
  });
}

/** Résultat d'un match (accord des capitaines, deadline, ou force-score). */
export function applyMatchOutcome(
  db: Firestore,
  competitionId: string,
  matchId: string,
  outcome: MatchOutcome,
  extra?: ProgressionExtra,
): Promise<ProgressionResult> {
  return applyEngineOp(db, competitionId, { op: 'outcome', matchId, outcome }, extra);
}

/** Disqualification / abandon en cours de tournoi (R5-4) — cascade moteur. */
export function applyWithdraw(
  db: Firestore,
  competitionId: string,
  registrationId: string,
  extra?: ProgressionExtra,
): Promise<ProgressionResult> {
  return applyEngineOp(db, competitionId, { op: 'withdraw', registrationId }, extra);
}

/** Remplacement par la waitlist avant le round 1 (spec §8) — null = personne
 *  (le siège devient un bye). */
export function applyReplacement(
  db: Firestore,
  competitionId: string,
  oldRegistrationId: string,
  newRegistrationId: string | null,
): Promise<ProgressionResult> {
  return applyEngineOp(db, competitionId, { op: 'replace', oldRegistrationId, newRegistrationId });
}
