import type { Firestore } from 'firebase-admin/firestore';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';

// Signal aux admins qu'une nouvelle inscription attend validation (retour Matt
// 09/07 : « rien ne prévient/n'est visible quand une demande d'inscription est
// faite »). Notif in-app garantie à tous les admins (Aedral complets + admins de
// compétition) ; le compteur « à valider » sur /admin/competitions complète le
// signal côté visible. Best-effort : n'échoue JAMAIS l'inscription elle-même.
export async function notifyAdminsOfNewRegistration(
  db: Firestore,
  { competitionId, competitionName, teamName, excludeUid }:
    { competitionId: string; competitionName: string; teamName: string; excludeUid?: string },
): Promise<void> {
  const [aedralSnap, compSnap] = await Promise.all([
    db.collection('aedral_admins').get(),
    db.collection('competition_admins').get(),
  ]);
  const recipients = new Set<string>();
  for (const d of aedralSnap.docs) recipients.add(d.id);
  for (const d of compSnap.docs) recipients.add(d.id);
  // L'inscripteur qui est aussi admin ne se notifie pas lui-même.
  if (excludeUid) recipients.delete(excludeUid);
  if (recipients.size === 0) return;

  const payloads: NotificationPayload[] = Array.from(recipients).map(userId => ({
    userId,
    type: 'competition_registration_submitted',
    title: 'Nouvelle inscription à valider',
    message: `${teamName} s'est inscrite à ${competitionName}. À examiner dans la file de validation.`,
    link: '/admin/competitions',
    metadata: { competitionId },
  }));
  await createNotifications(db, payloads);
}
