// Le tick « jour de match », extrait de sa route pour être rejouable de deux
// endroits : la requête d'un navigateur (console admin, page de match) et un
// filet planifié côté serveur.
//
// Pourquoi le filet : jusqu'ici, tomber une échéance exigeait qu'un navigateur
// soit ouvert. Pendant un match ça va — l'équipe qui attend a sa page ouverte —
// mais le check-in GÉNÉRAL a lieu avant que le moindre match soit lancé : seule
// la console de l'organisateur pouvait alors relancer les retardataires.
//
// Idempotent PAR CONSTRUCTION : chaque transition passe par une transaction à
// garde d'état, la progression no-op sur un pivot déjà terminal, et la relance
// du check-in général est verrouillée par `remindedAt`. Des ticks concurrents
// (plusieurs onglets + le filet) sont donc sans danger.

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { applyDeadlines, detectUnfinalizedAgreement, type FlowOutcome } from '@/lib/competitions/match-flow';
import { toFlowState, toEngineOutcome } from '@/lib/competitions/match-flow-server';
import { applyMatchOutcome } from '@/lib/competitions/progression';
import { notifyMatchAlert } from '@/lib/competitions/match-notify';
import { broadcast } from '@/lib/competitions/tournament-broadcast';
import { generalCheckinReminderText } from '@/lib/competitions/broadcast-messages';

export interface TickResult {
  processed: Array<{ matchId: string; transition: string }>;
  /** Équipes relancées pour le check-in général (0 = rien à faire). */
  remindedTeams: number;
}

/** Minutes avant l'échéance du check-in général où part le dernier appel. */
const CHECKIN_LEAD_MINUTES = 5;

export async function runCompetitionTick(
  db: Firestore,
  competitionId: string,
  comp: FirebaseFirestore.DocumentData,
): Promise<TickResult> {
  const compName = (comp.name as string) ?? competitionId;
  const processed: TickResult['processed'] = [];
  const outcomes: Array<{ matchId: string; outcome: FlowOutcome; kind: 'deadline' | 'repair' }> = [];

  // ≤ 63 docs par compétition : filtre en mémoire, pas d'index composite.
  const snap = await db.collection('competition_matches').where('competitionId', '==', competitionId).get();
  const candidates = snap.docs.filter(d => {
    const s = d.data().status as string;
    return s === 'checkin' || s === 'score_review';
  });

  for (const doc of candidates) {
    const engineId = (doc.data().id as string) ?? doc.id;
    // Transaction à garde d'état (relecture fraîche). AUCUN effet de bord dans
    // le callback : une transaction peut être REJOUÉE en cas de contention — la
    // décision est retournée, les effets sortent après.
    type TickDecision =
      | { t: 'checkin_expired' }
      | { t: 'finalize'; outcome: FlowOutcome; kind: 'deadline' | 'repair' }
      | null;
    const decision = await db.runTransaction<TickDecision>(async tx => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return null;
      const st = toFlowState(engineId, fresh.data()!);
      const t = applyDeadlines(st, Date.now());
      if (t?.type === 'checkin_expired') {
        tx.update(doc.ref, { status: 'awaiting_forfeit_validation', updatedAt: FieldValue.serverTimestamp() });
        return { t: 'checkin_expired' };
      }
      if (t?.type === 'finalize_single_entry') {
        // La finalisation passe par la progression (sa propre transaction,
        // garde pivot terminal) — collectée ici, appliquée après.
        return { t: 'finalize', outcome: t.outcome, kind: 'deadline' };
      }
      const repair = detectUnfinalizedAgreement(st);
      return repair ? { t: 'finalize', outcome: repair, kind: 'repair' } : null;
    });
    if (decision?.t === 'checkin_expired') {
      processed.push({ matchId: engineId, transition: 'checkin_expired' });
      // Attendu : pas de fire-and-forget en serverless.
      await notifyMatchAlert(db, { kind: 'checkin_expired', competitionId, competitionName: compName, matchLabel: engineId });
    } else if (decision?.t === 'finalize') {
      outcomes.push({ matchId: engineId, outcome: decision.outcome, kind: decision.kind });
    }
  }

  for (const o of outcomes) {
    // autoGuard : la progression re-valide la décision sur le doc pivot FRAIS
    // dans sa transaction — une contre-saisie, une correction ou un litige
    // arrivés dans la fenêtre annulent la finalisation périmée (archi §5).
    let r;
    try {
      r = await applyMatchOutcome(db, competitionId, o.matchId, toEngineOutcome(o.outcome), { validatedBy: 'auto', autoGuard: true });
    } catch (err) {
      // Compétition clôturée entre la décision et l'application : no-op.
      if (err instanceof Error && err.message === 'competition_not_live') continue;
      throw err;
    }
    if (r.changedMatchIds.length === 0) continue;   // no-op : ni trace ni notif
    processed.push({ matchId: o.matchId, transition: o.kind === 'repair' ? 'agreement_repaired' : 'single_entry_finalized' });
    if (o.kind === 'deadline') {
      await notifyMatchAlert(db, { kind: 'single_entry', competitionId, competitionName: compName, matchLabel: o.matchId });
    }
  }

  return { processed, remindedTeams: await remindGeneralCheckin(db, competitionId, comp) };
}

/**
 * Dernier appel du check-in général, aux SEULES équipes qui n'ont pas confirmé.
 * Une équipe présente peut être déclarée forfait du tournoi entier parce que son
 * capitaine n'a pas vu le message d'ouverture.
 */
async function remindGeneralCheckin(
  db: Firestore,
  competitionId: string,
  comp: FirebaseFirestore.DocumentData,
): Promise<number> {
  try {
    const gc = comp.generalCheckin as { openedAt?: Timestamp; remindedAt?: Timestamp | null } | undefined;
    const totalMinutes = (comp.schedule?.generalCheckinMinutes as number) ?? 20;
    if (!gc?.openedAt || gc.remindedAt || totalMinutes <= CHECKIN_LEAD_MINUTES + 1) return 0;

    const openedMs = gc.openedAt.toMillis();
    const dueAtMs = openedMs + (totalMinutes - CHECKIN_LEAD_MINUTES) * 60_000;
    const deadlineMs = openedMs + totalMinutes * 60_000;
    if (Date.now() < dueAtMs || Date.now() >= deadlineMs) return 0;

    // Verrou atomique : deux ticks simultanés (deux consoles, ou une console et
    // le filet planifié) enverraient sinon la relance en double.
    const compRef = db.collection('competitions').doc(competitionId);
    const claimed = await db.runTransaction(async tx => {
      const fresh = await tx.get(compRef);
      if (fresh.data()?.generalCheckin?.remindedAt) return false;
      tx.update(compRef, { 'generalCheckin.remindedAt': Timestamp.now() });
      return true;
    });
    if (!claimed) return 0;

    const regs = await db.collection('competition_registrations')
      .where('competitionId', '==', competitionId).where('status', '==', 'approved').get();
    const late = regs.docs.filter(d => {
      const g = d.data().generalCheckin;
      return g && g.done !== true;
    });
    if (late.length > 0) {
      const text = generalCheckinReminderText({ minutesLeft: CHECKIN_LEAD_MINUTES });
      await broadcast(db, competitionId, late.map(d => ({
        target: { kind: 'team' as const, registrationId: d.id },
        text, link: `https://aedral.com/competitions/${competitionId}`,
      })), { competition: comp, deadlineMs: 15_000 });
    }
    return late.length;
  } catch (err) {
    captureApiError('Tick general check-in reminder', err);
    return 0;
  }
}
