import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import {
  applyDeadlines,
  detectUnfinalizedAgreement,
  type FlowOutcome,
} from '@/lib/competitions/match-flow';
import { toFlowState, toEngineOutcome } from '@/lib/competitions/match-flow-server';
import { applyMatchOutcome } from '@/lib/competitions/progression';
import { notifyMatchAlert } from '@/lib/competitions/match-notify';

// Tick « jour de match » (archi §5) : applique les deadlines échues —
// check-in expiré → validation de forfait par un admin (jamais automatique),
// contre-saisie expirée → la saisie unique est retenue (+ notification admin).
// Répare aussi les accords enregistrés dont la finalisation n'est pas partie
// (crash entre deux écritures). Idempotent PAR CONSTRUCTION : chaque
// transition passe par une transaction avec garde d'état, et la progression
// no-op sur un pivot déjà terminal — des ticks concurrents (console admin
// toutes les 30 s + pages de match des participants) sont sans danger.
//
// Authentifié + rate-limité : appelable par n'importe quel utilisateur
// connecté (les pages de match tiennent le bracket vivant même console
// fermée), mais jamais par un anonyme.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const comp = compSnap.data()!;
    if (isCompetitionHidden(comp) && !(await canViewHiddenCompetition(db, uid))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const compName = (comp.name as string) ?? id;

    // ≤ 63 docs par compétition : filtre en mémoire, pas d'index composite.
    const snap = await db.collection('competition_matches').where('competitionId', '==', id).get();
    const candidates = snap.docs.filter(d => {
      const s = d.data().status as string;
      return s === 'checkin' || s === 'score_review';
    });

    const processed: Array<{ matchId: string; transition: string }> = [];
    const outcomes: Array<{ matchId: string; outcome: FlowOutcome; kind: 'deadline' | 'repair'; submitted?: string }> = [];

    for (const doc of candidates) {
      const engineId = (doc.data().id as string) ?? doc.id;
      // Transaction à garde d'état (relecture fraîche). AUCUN effet de bord
      // dans le callback : une transaction peut être REJOUÉE en cas de
      // contention — la décision est retournée, les effets sortent après.
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
        await notifyMatchAlert(db, { kind: 'checkin_expired', competitionId: id, competitionName: compName, matchLabel: engineId });
      } else if (decision?.t === 'finalize') {
        outcomes.push({ matchId: engineId, outcome: decision.outcome, kind: decision.kind });
      }
    }

    for (const o of outcomes) {
      // autoGuard : la progression re-valide la décision sur le doc pivot
      // FRAIS dans sa transaction — une contre-saisie, une correction ou un
      // litige arrivés dans la fenêtre annulent la finalisation périmée
      // (règle de course archi §5, blocker de la review adversariale).
      const r = await applyMatchOutcome(db, id, o.matchId, toEngineOutcome(o.outcome), { validatedBy: 'auto', autoGuard: true });
      if (r.changedMatchIds.length === 0) continue;   // no-op (déjà fait / état périmé) : ni trace ni notif
      processed.push({ matchId: o.matchId, transition: o.kind === 'repair' ? 'agreement_repaired' : 'single_entry_finalized' });
      if (o.kind === 'deadline') {
        await notifyMatchAlert(db, { kind: 'single_entry', competitionId: id, competitionName: compName, matchLabel: o.matchId });
      }
    }

    return NextResponse.json({ processed });
  } catch (err) {
    captureApiError('API Competitions/Tick POST error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export const maxDuration = 60;
