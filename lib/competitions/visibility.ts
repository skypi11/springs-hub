// Visibilité publique d'une compétition — SOURCE UNIQUE de la règle de gate,
// pour qu'aucun endpoint ne diverge (revue Lot 2 : la fiche/matches/open
// gataient bien, mais le règlement et l'inscription avaient été oubliés).
//
// Règle : une compétition est masquée du public si elle est en BROUILLON ou
// marquée de TEST (isDev) — même publiée en 'live'. Elle n'est alors visible
// (et inscriptible) que par les admins de compétition et les comptes du bac à
// sable (users.isDev).

import type { Firestore } from 'firebase-admin/firestore';
import { isCompetitionAdmin } from '@/lib/firebase-admin';

export function isCompetitionHidden(comp: { status?: string; isDev?: boolean }): boolean {
  return comp.status === 'draft' || comp.isDev === true;
}

/** L'utilisateur peut-il voir/interagir avec une compétition masquée ?
 *  Admin de compétition (rôle scopé ou admin Aedral) OU compte du bac à sable. */
export async function canViewHiddenCompetition(db: Firestore, uid: string): Promise<boolean> {
  if (await isCompetitionAdmin(uid)) return true;
  const snap = await db.collection('users').doc(uid).get();
  return snap.data()?.isDev === true;
}
