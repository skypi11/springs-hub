// Clôture d'un Qualif (Lot 4A, archi §4) : l'UNIQUE écriture du classement
// final. En une transaction : placements compressés 1→N (arbitrages admin
// inclus), points du barème circuit, `participations` sur les circuit_teams,
// purge des claims des waitlisted jamais promues, statut → 'finished'.
//
// Gardes (archi §4) : BLOQUÉE tant qu'un départage admin est ouvert — aucun
// point n'est écrit tant que les places ne sont pas toutes uniques. Bloquée
// aussi sans champion mécanique (needsAdminDecision : un admin force d'abord
// le match décisif). Idempotence par le statut : live → finished une seule
// fois, une deuxième clôture répond `already_closed`.

import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { computeTeamStats, type Placement } from '@/lib/tournament';
import { engineFor, kindOf } from '@/lib/competitions/formats-server';
import { reconstructBracket, type MatchDoc } from '@/lib/competitions/bracket-store';
import type { CompetitionFormat } from '@/types/competitions';
import { computeClaimRelease } from '@/lib/competitions/withdraw-registration';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { captureApiError } from '@/lib/sentry';
import type { FinalPlacement } from '@/types/competitions';

export type CloseResult =
  | {
      ok: true;
      finalPlacements: FinalPlacement[];
      /** Équipes CLASSÉES d'une compét de circuit sans identité circuit (pas de
       *  circuitTeamId) : leurs points n'ont pas pu être écrits — à signaler,
       *  jamais avalé en silence (review Lot 4). */
      unlinked: string[];
    }
  | { ok: false; code: 'not_found' | 'already_closed' | 'invalid_status' | 'bracket_not_published' | 'not_finished' | 'tiebreak_required'; tiebreakGroups?: string[] };

export async function closeCompetition(
  db: Firestore,
  { competitionId }: { competitionId: string },
): Promise<CloseResult> {
  const compRef = db.collection('competitions').doc(competitionId);
  // Refs apprises HORS transaction (pas de .where en transaction — piège
  // documenté), relues fraîches DEDANS.
  const [matchIdsSnap, regIdsSnap] = await Promise.all([
    db.collection('competition_matches').where('competitionId', '==', competitionId).select().get(),
    db.collection('competition_registrations').where('competitionId', '==', competitionId).select().get(),
  ]);
  const matchRefs = matchIdsSnap.docs.map(d => d.ref);
  const regRefs = regIdsSnap.docs.map(d => d.ref);
  if (matchRefs.length === 0) return { ok: false, code: 'bracket_not_published' };

  let notifPayloads: NotificationPayload[] = [];

  const result = await db.runTransaction(async (tx): Promise<CloseResult> => {
    // ── Phase 1 : TOUTES les lectures ──
    const [compSnap, matchSnaps, regSnaps] = await Promise.all([
      tx.get(compRef),
      tx.getAll(...matchRefs),
      regRefs.length > 0 ? tx.getAll(...regRefs) : Promise.resolve([]),
    ]);
    if (!compSnap.exists) return { ok: false, code: 'not_found' };
    const comp = compSnap.data()!;
    if (comp.status === 'finished' || comp.status === 'archived') return { ok: false, code: 'already_closed' };
    if (comp.status !== 'live') return { ok: false, code: 'invalid_status' };
    if (!comp.bracketMaterializedAt) return { ok: false, code: 'bracket_not_published' };

    // Routage par kind via la registry de formats (formats-server) : le
    // prédicat de fin et le calcul des placements sont ceux du format —
    // élims : champion mécanique ; round robin : tous les matchs terminaux.
    const format = comp.format as CompetitionFormat;
    const engine = engineFor(kindOf(format));
    const bracket = reconstructBracket({
      withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
      bo: format.bo,
      forfeitScore: format.forfeitScore ?? { games: 3, goalsPerGame: 1 },
      matches: matchSnaps.filter(s => s.exists).map(s => ({
        id: (s.data()!.id as string) ?? s.id,
        ...(s.data() as MatchDoc),
      })),
      kind: kindOf(format),
    });
    if (!engine.isFinished(bracket)) return { ok: false, code: 'not_finished' };

    const resolutions = (comp.tiebreakResolutions as Record<string, string[]> | undefined) ?? undefined;
    const placements = engine.computePlacements(bracket, format, resolutions);
    const unresolved = [...new Set(placements.filter(p => p.needsAdminTiebreak).map(p => p.group))];
    if (unresolved.length > 0) return { ok: false, code: 'tiebreak_required', tiebreakGroups: unresolved };

    const stats = computeTeamStats(bracket);
    const regs = new Map<string, FirebaseFirestore.DocumentData>();
    for (const s of regSnaps) if (s.exists) regs.set(s.id, s.data()!);

    // Barème du circuit (place compressée → points) — hors circuit : pas de
    // points, le classement final reste sur la compétition.
    const circuitId = (comp.circuitId as string | null) ?? null;
    let pointsScale: Record<string, number> | null = null;
    if (circuitId) {
      const circuitSnap = await tx.get(db.collection('circuits').doc(circuitId));
      pointsScale = (circuitSnap.data()?.pointsScale as Record<string, number> | undefined) ?? null;
    }

    const finalPlacements: FinalPlacement[] = placements
      .filter((p): p is Placement & { placement: number } => p.placement !== null)
      .map(p => {
        const reg = regs.get(p.teamId);
        const st = stats.get(p.teamId);
        return {
          registrationId: p.teamId,
          name: (reg?.name as string) ?? p.teamId,
          tag: (reg?.tag as string) ?? '',
          placement: p.placement,
          points: pointsScale ? pointsScale[String(p.placement)] ?? 0 : null,
          goalDiff: st ? Math.round(st.normalizedDiff * 100) / 100 : 0,
          goalsFor: st?.goalsFor ?? 0,
        };
      })
      .sort((a, b) => a.placement - b.placement);

    // Circuit : participations à écrire + claims à purger. L'ÉLIGIBILITÉ
    // DÉRIVE DU BRACKET (review Lot 4, blocker) : toute équipe CLASSÉE reçoit
    // sa participation, quel que soit le statut de son inscription — une
    // promue restée 'waitlisted' par un crash, ou une DQ 'withdrawn' (R5-4 :
    // placement au groupe atteint), garde ses points. La purge ne touche QUE
    // les équipes HORS classement (waitlisted jamais promues, pending,
    // retraits d'avant-bracket au claim déjà libéré → no-op).
    // Toutes les LECTURES circuit_teams d'abord, puis les écritures.
    const placedRegIds = new Set(finalPlacements.map(p => p.registrationId));
    const participationWrites: Array<{ ctRef: FirebaseFirestore.DocumentReference; entry: Record<string, unknown> }> = [];
    const claimReleases: Array<{ ctRef: FirebaseFirestore.DocumentReference; regId: string }> = [];
    const unlinked: string[] = [];
    if (circuitId) {
      for (const p of finalPlacements) {
        const reg = regs.get(p.registrationId);
        const ctId = (reg?.circuitTeamId as string | null) ?? null;
        if (ctId) {
          participationWrites.push({
            ctRef: db.collection('circuit_teams').doc(ctId),
            entry: {
              competitionId,
              registrationId: p.registrationId,
              placement: p.placement,
              points: p.points ?? 0,
              goalDiff: p.goalDiff,
              goalsFor: p.goalsFor,
            },
          });
        } else {
          // Classée mais sans identité circuit (unapprove d'avant la garde,
          // conflit d'identité jamais arbitré…) : ses points n'iraient nulle
          // part — remonté à l'appelant, jamais avalé en silence.
          unlinked.push(`${p.placement}. ${p.name}`);
        }
      }
      for (const [regId, reg] of regs) {
        const ctId = (reg.circuitTeamId as string | null) ?? null;
        if (ctId && !placedRegIds.has(regId)) {
          claimReleases.push({ ctRef: db.collection('circuit_teams').doc(ctId), regId });
        }
      }
    }
    const ctRefs = [...participationWrites.map(w => w.ctRef), ...claimReleases.map(r => r.ctRef)];
    const stateRefs = claimReleases.map(r => r.ctRef.collection('private').doc('state'));
    const uniqueRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const r of [...ctRefs, ...stateRefs]) uniqueRefs.set(r.path, r);
    const ctSnaps = uniqueRefs.size > 0 ? await tx.getAll(...uniqueRefs.values()) : [];
    const snapByPath = new Map(ctSnaps.map(s => [s.ref.path, s]));

    // ── Phase 2 : les écritures ──
    for (const w of participationWrites) {
      const snap = snapByPath.get(w.ctRef.path);
      if (!snap?.exists) continue;
      const existing = (snap.data()?.participations as Array<{ competitionId?: string }> | undefined) ?? [];
      // Max 1 participation par compétition (archi §2) — garde contre toute
      // ré-entrée improbable (le statut verrouille déjà la double clôture).
      if (existing.some(e => e.competitionId === competitionId)) continue;
      tx.update(w.ctRef, { participations: FieldValue.arrayUnion(w.entry) });
    }
    for (const r of claimReleases) {
      const ctSnap = snapByPath.get(r.ctRef.path);
      const stateSnap = snapByPath.get(r.ctRef.collection('private').doc('state').path);
      const release = computeClaimRelease(ctSnap?.data(), stateSnap?.data(), competitionId, r.regId);
      if (!release) continue;
      const stateRef = r.ctRef.collection('private').doc('state');
      if (release.orphan) {
        tx.delete(stateRef);
        tx.delete(r.ctRef);
      } else {
        tx.set(stateRef, release.state);
      }
    }
    tx.update(compRef, {
      status: 'finished',
      finalPlacements,
      closedAt: FieldValue.serverTimestamp(),
    });

    // Notifications préparées DANS la tx (données fraîches), envoyées après.
    notifPayloads = finalPlacements.flatMap(p => {
      const reg = regs.get(p.registrationId);
      const rosterUids = Array.isArray(reg?.rosterUids) ? (reg!.rosterUids as string[]) : [];
      const pts = p.points !== null ? ` (+${p.points} pts au circuit)` : '';
      return rosterUids.map(userId => ({
        userId,
        type: 'competition_registration' as const,
        title: 'Classement final',
        message: `${p.name} termine ${p.placement === 1 ? 'championne' : `${p.placement}e`} de ${(comp.name as string) ?? competitionId}${pts}.`,
        link: `/competitions/${competitionId}`,
        metadata: { competitionId },
      }));
    });

    return { ok: true, finalPlacements, unlinked };
  });

  if (result.ok && result.unlinked.length > 0) {
    captureApiError('closeCompetition unlinked placements', new Error(
      `${competitionId} : équipes classées sans identité circuit — ${result.unlinked.join(' · ')}`));
  }
  if (result.ok && notifPayloads.length > 0) {
    try {
      await createNotifications(db, notifPayloads);
    } catch (err) {
      captureApiError('closeCompetition notify', err);
    }
  }
  return result;
}
