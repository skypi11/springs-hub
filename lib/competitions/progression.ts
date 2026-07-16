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
import { expectedAutoOutcome, sameOutcome, type FlowOutcome } from '@/lib/competitions/match-flow';
import { toFlowState } from '@/lib/competitions/match-flow-server';
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
  /**
   * GARDE DES FINALISATIONS AUTOMATIQUES (blocker review) : la décision
   * (accord, deadline du tick) a été prise HORS de cette transaction. Quand ce
   * flag est posé, la transaction rejoue expectedAutoOutcome sur le doc pivot
   * FRAIS : si un litige s'est ouvert, si une saisie a changé, ou si l'outcome
   * attendu n'est plus EXACTEMENT celui décidé → no-op (le tick suivant
   * re-décidera sur l'état à jour). La règle de course (archi §5) est ainsi
   * garantie jusqu'à l'écriture, pas seulement jusqu'à la décision.
   */
  autoGuard?: boolean;
  forfeitReason?: string | null;
  /** Texte de résolution si un litige était ouvert sur le pivot. */
  resolveDispute?: string | null;
}

// Comparaison MatchOutcome (moteur) ↔ FlowOutcome (machine d'états) — mêmes
// données, vocabulaires différents (scores ↔ games).
function outcomeMatchesFlow(engine: MatchOutcome, flow: FlowOutcome): boolean {
  const asFlow: FlowOutcome = engine.type === 'winner'
    ? { type: 'winner', winner: engine.winner, games: engine.scores }
    : { type: 'forfeit', team: engine.team };
  return sameOutcome(asFlow, flow);
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
    // Garde de statut DANS la transaction (review Lot 4) : une op moteur après
    // la clôture corromprait un classement déjà figé (participations écrites,
    // finalPlacements publiés). Le check doit vivre ICI — un retry de
    // transaction après conflit avec close relit le doc frais et doit
    // re-décider ; un check pré-transactionnel ne couvrirait pas ce chemin.
    if (comp.status !== 'live') throw new Error('competition_not_live');
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
      kind: comp.format?.kind === 'single_elim' ? 'single_elim' : 'double_elim',
    });

    // Garde d'idempotence : un outcome sur un pivot déjà terminal = déjà
    // appliqué par une requête concurrente → no-op silencieux.
    if (op.op === 'outcome') {
      const pivot = before.matches[op.matchId];
      if (!pivot) throw new Error('match_not_found');
      if (pivot.status === 'completed' || pivot.status === 'walkover' || pivot.status === 'cancelled') {
        return { changedMatchIds: [], finished: isFinished(before), needsAdminDecision: needsAdminDecision(before) };
      }
      // Garde des finalisations AUTO : re-valider la décision sur le doc frais.
      if (extra?.autoGuard) {
        const pivotDoc = docs.find(d => d.id === op.matchId);
        if (!pivotDoc) throw new Error('match_not_found');
        const fresh = toFlowState(op.matchId, pivotDoc.data as FirebaseFirestore.DocumentData);
        const expected = expectedAutoOutcome(fresh, Date.now());
        if (!expected || !outcomeMatchesFlow(op.outcome, expected)) {
          // L'état a bougé depuis la décision (litige, correction, contre-
          // saisie) : finalisation périmée abandonnée.
          return { changedMatchIds: [], finished: isFinished(before), needsAdminDecision: needsAdminDecision(before) };
        }
      }
    }

    let after: Bracket;
    if (op.op === 'outcome') after = advanceMatch(before, op.matchId, op.outcome);
    else if (op.op === 'withdraw') after = withdrawTeam(before, op.registrationId);
    else after = replaceTeam(before, op.oldRegistrationId, op.newRegistrationId);

    const patches = computeProgressionPatches(before, after, regId =>
      regId ? infoByReg.get(regId) ?? null : null);

    const docByEngineId = new Map(docs.map(d => [d.id, d]));
    // Statuts « jour de match » actifs : un changement d'équipe sur un tel
    // match (remplacement waitlist…) doit purger les traces du camp sortant.
    const ACTIVE = new Set(['checkin', 'ready', 'live', 'awaiting_scores', 'score_review', 'disputed', 'awaiting_forfeit_validation']);
    for (const p of patches) {
      const doc = docByEngineId.get(p.matchId);
      if (!doc) continue;
      const raw = doc.data as FirebaseFirestore.DocumentData;
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
      // Équipe qui change de siège sur un match DÉJÀ actif (remplacement
      // waitlist, review adversariale) : les check-ins et saisies du camp
      // sortant ne doivent pas être hérités par l'arrivante.
      if (ACTIVE.has((raw.status as string) ?? 'pending')) {
        for (const side of ['a', 'b'] as const) {
          const teamKey = side === 'a' ? 'teamA' : 'teamB';
          if (teamKey in f) {
            if (raw.checkin) {
              update[`checkin.${side}`] = { done: false, at: null };
            }
            update[`scores.${side}`] = [];
            update[`scores.${side}SubmittedAt`] = null;
            update['scores.counterDeadline'] = null;
          }
        }
      }
      // Finalisation TERMINALE du pivot : compteurs fermés, et JAMAIS de match
      // terminal avec un litige encore ouvert (review adversariale) — les
      // finalisations auto sur litige ouvert sont déjà no-opées par la garde,
      // ce chemin ne concerne donc que les décisions admin.
      if (op.op === 'outcome' && p.matchId === op.matchId) {
        update['scores.counterDeadline'] = null;
        const disputeOpen = !!raw.dispute && raw.dispute.resolvedBy == null;
        if (disputeOpen) {
          update['dispute.resolvedBy'] = 'admin';
          update['dispute.resolution'] = extra?.resolveDispute
            ?? extra?.forfeitReason
            ?? 'Tranché par un admin de compétition.';
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

    // Repêchage : les statuts d'inscription basculent DANS la même transaction
    // que le siège (blocker review Lot 4 — un crash entre le swap moteur et un
    // update séparé laissait l'équipe promue 'waitlisted' assise dans le
    // bracket : zéro point à la clôture + circuit_team purgée comme non-promue).
    if (op.op === 'replace') {
      const regById = new Map(regSnaps.filter(s => s.exists).map(s => [s.id, s]));
      const oldSnap = regById.get(op.oldRegistrationId);
      if (oldSnap) {
        tx.update(oldSnap.ref, { status: 'withdrawn', updatedAt: FieldValue.serverTimestamp() });
      }
      if (op.newRegistrationId) {
        const newSnap = regById.get(op.newRegistrationId);
        if (newSnap) {
          const n = newSnap.data()!;
          tx.update(newSnap.ref, {
            status: 'approved',
            // Repêchée après ouverture du check-in général : à confirmer aussi.
            ...(n.generalCheckin == null ? { generalCheckin: { done: false, byUid: null, at: null } } : {}),
            // Salons Discord : à provisionner via le bouton existant si besoin.
            ...(n.discord?.provisioningStatus === 'none' ? { 'discord.provisioningStatus': 'queued' } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
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
