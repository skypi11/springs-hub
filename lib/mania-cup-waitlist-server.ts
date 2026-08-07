import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { MANIA_CUP_REGISTRATIONS } from './mania-cup';
import { MANIA_CUP_WAITLIST, type EntreeAttente, type StatutAttente } from './mania-cup-waitlist';

// Lecture de la file d'attente, et comptage des places réellement disponibles.
//
// Ce fichier est le SEUL endroit qui traduit les documents Firestore en entrées
// exploitables par les fonctions pures : les horodatages y deviennent des
// millisecondes, une bonne fois.

export type EntreeAttenteDoc = {
  uid: string;
  createdAt?: Timestamp | null;
  status?: StatutAttente;
  invitationExpiresAt?: Timestamp | null;
  invitedAt?: Timestamp | null;
  invitedBy?: string | null;
};

const ms = (t: Timestamp | null | undefined): number | null =>
  t && typeof t.toMillis === 'function' ? t.toMillis() : null;

export function versEntree(uid: string, d: EntreeAttenteDoc | undefined): EntreeAttente {
  return {
    uid,
    createdAt: ms(d?.createdAt) ?? 0,
    statut: d?.status ?? 'waiting',
    expireA: ms(d?.invitationExpiresAt),
  };
}

export async function lireFileAttente(
  db: Firestore
): Promise<{ entrees: EntreeAttente[]; docs: Map<string, EntreeAttenteDoc> }> {
  const snap = await db.collection(MANIA_CUP_WAITLIST).get();
  const docs = new Map<string, EntreeAttenteDoc>();
  const entrees = snap.docs.map((d) => {
    const data = d.data() as EntreeAttenteDoc;
    docs.set(d.id, data);
    return versEntree(d.id, data);
  });
  return { entrees, docs };
}

/** Les places réglées — celles, et elles seules, qui sont définitivement prises. */
export async function compterPlacesReglees(db: Firestore): Promise<number> {
  const snap = await db
    .collection(MANIA_CUP_REGISTRATIONS)
    .where('status', '==', 'confirmed')
    .count()
    .get();
  return snap.data().count;
}
