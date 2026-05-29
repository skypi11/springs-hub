// Helper server-side : résout un identifiant arrivant en route param (slug OU
// docId Firestore) vers le vrai docId Firestore de la collection `structures`.
//
// Utilisé en pré-flight dans toutes les routes /api/structures/[id]/* pour
// supporter les URLs propres /community/structure/timetoshine tout en
// conservant la rétrocompat avec les vieux liens /community/structure/{docId}.
//
// Détection (cf. lib/structure-slug.ts) :
//  - docId Firestore : 20 chars, mix [A-Za-z0-9] case-sensitive
//  - slug          : lowercase + chiffres + tirets, 3-32 chars
// Discriminant fiable : un slug ne contient JAMAIS de majuscule.

import type { Firestore } from 'firebase-admin/firestore';
import { isLegacyStructureId } from './structure-slug';

/**
 * Résout un slug ou un docId Firestore vers le docId Firestore correspondant.
 *
 * - Si l'input ressemble à un docId Firestore (isLegacyStructureId), on vérifie
 *   que le document existe et on retourne son id tel quel.
 * - Sinon, l'input est traité comme un slug : query `where('slug', '==', input)`
 *   limit 1, retour de l'id du doc trouvé.
 *
 * @param slugOrId  identifiant brut venant des route params
 * @param db        instance Firestore Admin
 * @returns         le docId Firestore résolu, ou null si introuvable
 */
export async function resolveStructureId(
  slugOrId: string,
  db: Firestore,
): Promise<string | null> {
  if (!slugOrId || typeof slugOrId !== 'string') return null;

  if (isLegacyStructureId(slugOrId)) {
    // Sanity check : le doc existe vraiment (sinon 404 propre côté caller).
    const snap = await db.collection('structures').doc(slugOrId).get();
    return snap.exists ? slugOrId : null;
  }

  // Lookup par slug.
  const snap = await db
    .collection('structures')
    .where('slug', '==', slugOrId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}
