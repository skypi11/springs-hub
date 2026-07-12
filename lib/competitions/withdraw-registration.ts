// Retrait d'une inscription AVANT publication du bracket — mécanique partagée
// entre : le retrait par l'équipe elle-même (onglet Inscriptions), l'effet
// d'une sanction exclusion/ban (hook à la création), et l'unapprove admin
// (releaseCircuitClaim). Après publication du bracket, un retrait est une
// DISQUALIFICATION : il passe par la console (applyWithdraw, cascade R5-4) —
// jamais par ici.

import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { removeRegistrationFromCalendar } from '@/lib/competitions/calendar-sync';
import { deprovisionRegistration } from '@/lib/discord-competition';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { captureApiError } from '@/lib/sentry';

/**
 * Calcul PUR de la libération d'un claim circuit : à partir des snapshots du
 * doc `circuit_teams` et de son `private/state`, retourne les écritures à
 * appliquer (état nettoyé, ou suppression si la team devient orpheline —
 * aucune participation, aucun claim, aucun roster). Null si rien à faire.
 * Séparé de la transaction pour être utilisable dans une clôture qui doit
 * faire TOUTES ses lectures avant TOUTES ses écritures (contrainte Firestore).
 */
export function computeClaimRelease(
  ctData: FirebaseFirestore.DocumentData | undefined,
  stateData: FirebaseFirestore.DocumentData | undefined,
  competitionId: string,
  registrationId: string,
): { orphan: boolean; state: { claims: Record<string, string>; rosterByCompetition: Record<string, unknown> } } | null {
  if (!ctData) return null;
  const claims = { ...((stateData?.claims as Record<string, string>) ?? {}) };
  const rosters = { ...((stateData?.rosterByCompetition as Record<string, unknown>) ?? {}) };
  if (claims[competitionId] === registrationId) delete claims[competitionId];
  if ((rosters[competitionId] as { registrationId?: string } | undefined)?.registrationId === registrationId) {
    delete rosters[competitionId];
  }
  const participations = (ctData.participations as unknown[] | undefined) ?? [];
  const orphan = participations.length === 0
    && Object.keys(claims).length === 0
    && Object.keys(rosters).length === 0;
  return { orphan, state: { claims, rosterByCompetition: rosters } };
}

/**
 * Libère la réservation d'identité circuit d'une inscription (claim atomique
 * `circuit_teams/{id}/private/state`) — et supprime la circuit_team devenue
 * orpheline. Appelée DANS une transaction, avant toute écriture de celle-ci.
 */
export async function releaseCircuitClaim(
  db: Firestore,
  tx: Transaction,
  competitionId: string,
  registrationId: string,
  circuitTeamId: string | null,
): Promise<void> {
  if (!circuitTeamId) return;
  const ctRef = db.collection('circuit_teams').doc(circuitTeamId);
  const stateRef = ctRef.collection('private').doc('state');
  const [ctSnap, stateSnap] = await Promise.all([tx.get(ctRef), tx.get(stateRef)]);
  const release = computeClaimRelease(ctSnap.data(), stateSnap.data(), competitionId, registrationId);
  if (!release) return;
  if (release.orphan) {
    tx.delete(stateRef);
    tx.delete(ctRef);
  } else {
    tx.set(stateRef, release.state);
  }
}

export type WithdrawResult =
  | { ok: true }
  | { ok: false; code: 'not_found' | 'already_withdrawn' | 'bracket_published' | 'state_changed' };

/**
 * Retire une inscription active (pending / approved / waitlisted) d'une
 * compétition dont le bracket n'est PAS publié. Transactionnel : statut,
 * compteur dénormalisé, claim circuit. Post-transaction (best-effort) :
 * créneaux calendrier, salons Discord, notifications roster + admins.
 */
export async function withdrawRegistration(
  db: Firestore,
  { registrationId, cause }: {
    registrationId: string;
    /** Phrase FR complète affichée au roster (« retirée par X », « exclusion : … »). */
    cause: string;
  },
): Promise<WithdrawResult> {
  const regRef = db.collection('competition_registrations').doc(registrationId);
  const pre = await regRef.get();
  if (!pre.exists) return { ok: false, code: 'not_found' };
  const preData = pre.data()!;
  const competitionId = preData.competitionId as string;
  const compRef = db.collection('competitions').doc(competitionId);

  try {
    await db.runTransaction(async tx => {
      const [regNow, compNow] = await Promise.all([tx.get(regRef), tx.get(compRef)]);
      if (!regNow.exists) throw new Error('not_found');
      const r = regNow.data()!;
      if (r.status === 'withdrawn' || r.status === 'rejected') throw new Error('already_withdrawn');
      if (compNow.data()?.bracketMaterializedAt) throw new Error('bracket_published');

      await releaseCircuitClaim(db, tx, competitionId, registrationId, (r.circuitTeamId as string) ?? null);
      tx.update(regRef, { status: 'withdrawn', circuitTeamId: null, updatedAt: FieldValue.serverTimestamp() });
      if (r.status === 'approved') {
        const approvedCount = (compNow.data()?.approvedCount as number | undefined) ?? 0;
        tx.update(compRef, { approvedCount: Math.max(0, approvedCount - 1) });
      }
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'state_changed';
    if (code === 'not_found' || code === 'already_withdrawn' || code === 'bracket_published') {
      return { ok: false, code };
    }
    throw err;
  }

  const comp = (await compRef.get()).data() ?? {};
  const compName = (comp.name as string) ?? competitionId;

  // Créneaux calendrier + salons Discord : best-effort, jamais bloquant.
  try {
    await removeRegistrationFromCalendar(db, { competitionId, teamId: preData.teamId as string });
  } catch (err) { captureApiError('withdrawRegistration calendar cleanup', err); }
  try {
    const guildId = comp.discord?.guildId as string | undefined;
    if (guildId && (preData.discord?.roleId || preData.discord?.textChannelId)) {
      await deprovisionRegistration(db, guildId, {
        registrationId,
        roleId: (preData.discord?.roleId as string) ?? null,
        textChannelId: (preData.discord?.textChannelId as string) ?? null,
        voiceChannelId: (preData.discord?.voiceChannelId as string) ?? null,
        participantRoleId: (comp.discord?.participantRoleId as string) ?? null,
        roster: Array.isArray(preData.roster)
          ? (preData.roster as Array<{ discordId?: string; displayName?: string }>)
              .filter(p => p.discordId)
              .map(p => ({ discordId: p.discordId as string, displayName: (p.displayName as string) ?? '' }))
          : [],
      });
    }
  } catch (err) { captureApiError('withdrawRegistration deprovision', err); }

  // Notifications : roster (le fait + la cause) + admins (place libérée).
  try {
    const rosterUids = Array.isArray(preData.rosterUids) ? (preData.rosterUids as string[]) : [];
    const payloads: NotificationPayload[] = rosterUids.map(userId => ({
      userId,
      type: 'competition_registration',
      title: 'Inscription retirée',
      message: `${(preData.name as string) ?? 'Ton équipe'} n'est plus inscrite à ${compName}. ${cause}`,
      link: `/competitions/${competitionId}`,
      metadata: { competitionId },
    }));
    const [aedralSnap, compAdminsSnap] = await Promise.all([
      db.collection('aedral_admins').get(),
      db.collection('competition_admins').get(),
    ]);
    const admins = new Set<string>();
    for (const d of aedralSnap.docs) admins.add(d.id);
    for (const d of compAdminsSnap.docs) admins.add(d.id);
    for (const adminUid of admins) {
      payloads.push({
        userId: adminUid,
        type: 'competition_registration_submitted',
        title: 'Retrait d\'inscription',
        message: `${(preData.name as string) ?? 'Une équipe'} s'est retirée de ${compName}. ${cause} La liste d'attente peut être examinée.`,
        link: '/admin/competitions',
        metadata: { competitionId },
      });
    }
    await createNotifications(db, payloads);
  } catch (err) { captureApiError('withdrawRegistration notify', err); }

  return { ok: true };
}
