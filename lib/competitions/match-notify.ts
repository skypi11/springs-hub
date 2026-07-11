// Alertes « jour de match » aux admins (in-app garanti, best-effort — n'échoue
// jamais l'action d'origine). Destinataires : admins Aedral complets + admins
// de compétition — même pattern que registration-notify. La console (polling)
// reste la source visuelle principale ; la notif couvre l'admin alt-tabbé.

import type { Firestore } from 'firebase-admin/firestore';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';

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
}
