// Alertes « jour de match » aux admins (in-app garanti, best-effort — n'échoue
// jamais l'action d'origine). Destinataires : admins Aedral complets + admins
// de compétition — même pattern que registration-notify. La console (polling)
// reste la source visuelle principale ; la notif couvre l'admin alt-tabbé.

import type { Firestore } from 'firebase-admin/firestore';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { sendCompetitionChannelMessage } from '@/lib/discord-competition';

export type MatchAlertKind =
  | 'dispute_auto'         // scores divergents → litige automatique (spec §9)
  | 'dispute_manual'       // litige ouvert par une équipe
  | 'single_entry'         // une seule équipe a saisi à l'échéance (spec §9)
  | 'checkin_expired';     // équipe(s) non check-in → validation de forfait (spec §8)

const TITLES: Record<MatchAlertKind, string> = {
  dispute_auto: 'Litige automatique (scores divergents)',
  dispute_manual: 'Litige ouvert par une équipe',
  single_entry: 'Une seule équipe a saisi le score',
  checkin_expired: 'Check-in non complété',
};

export async function notifyMatchAlert(
  db: Firestore,
  { kind, competitionId, competitionName, matchLabel }:
    { kind: MatchAlertKind; competitionId: string; competitionName: string; matchLabel: string },
): Promise<void> {
  try {
    const [aedralSnap, compSnap] = await Promise.all([
      db.collection('aedral_admins').get(),
      db.collection('competition_admins').get(),
    ]);
    const recipients = new Set<string>();
    for (const d of aedralSnap.docs) recipients.add(d.id);
    for (const d of compSnap.docs) recipients.add(d.id);
    if (recipients.size === 0) return;

    const payloads: NotificationPayload[] = Array.from(recipients).map(userId => ({
      userId,
      type: 'competition_match_alert',
      title: TITLES[kind],
      message: `${competitionName} — match ${matchLabel}. À traiter dans la console.`,
      link: '/admin/competitions',
      metadata: { competitionId, matchLabel, kind },
    }));
    await createNotifications(db, payloads);
  } catch {
    // Best-effort : une notif ratée ne bloque jamais le jour de match.
  }

  // Salon staff Discord : c'est là que l'alerte a une chance d'être VUE le jour
  // J. Sans lui, un litige n'existe que dans la console — si personne ne la
  // regarde, deux équipes attendent sans que le staff le sache.
  try {
    const compSnap = await db.collection('competitions').doc(competitionId).get();
    const channelId = compSnap.data()?.discord?.options?.staffChannelId as string | undefined;
    if (!channelId) return;
    const staffRoleIds = (compSnap.data()?.discord?.options?.staffRoleIds as string[] | undefined) ?? [];
    // BORNÉ : cette fonction est attendue au milieu d'actions joueur (ouvrir un
    // litige). Discord peut mettre 60 s à répondre sous rate-limit — la requête
    // du capitaine expirerait alors que son litige est déjà enregistré.
    await Promise.race([
      sendCompetitionChannelMessage(channelId, {
        title: TITLES[kind],
        message: `${competitionName} — match ${matchLabel}. À traiter dans la console.`,
        link: `https://aedral.com/admin/competitions/${competitionId}/console`,
        // Une alerte silencieuse n'alerte personne : on mentionne le premier
        // rôle staff déclaré (les suivants voient le salon de toute façon).
        //
        // SAUF `single_entry`, qui est le déroulement NORMAL : le perdant ne
        // saisit presque jamais. Sur 63 matchs, ça faisait des dizaines de pings
        // « tout va bien » — le staff coupe le salon, et les vrais litiges
        // meurent avec. Le message reste, la notification part.
        mentionRoleId: kind === 'single_entry' ? null : (staffRoleIds[0] ?? null),
      }),
      new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
  } catch {
    // Discord indisponible : la notif in-app est déjà partie, on n'insiste pas.
  }
}
