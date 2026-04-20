// Compteurs dénormalisés sur le doc `structures`, mis à jour à chaque write
// qui change l'état réel : création/archivage d'équipe, join/leave membre, etc.
//
// Objectif : pouvoir afficher en admin "X équipes réelles / Y membres" sans
// faire de COUNT queries au chargement de la page.
//
// Convention :
//   structures/{id}.counters = {
//     teams:   <nombre d'équipes ACTIVES>    (archivées non comptées)
//     members: <nombre de structure_members>
//   }
//
// Le staff (fondateur + co-fondateurs + managers + coachs) est dérivé à la
// lecture directement depuis les champs coFounderIds/managerIds/coachIds du
// doc structure — pas besoin de compteur.

import type { Firestore, WriteBatch, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Voir commentaire dans lib/audit-log.ts : TS ne peut pas inférer une intersection
// valide entre WriteBatch et Transaction, on cast vers une interface structurelle.
interface Writer {
  update(ref: DocumentReference, data: Record<string, unknown>): unknown;
}
export type BatchOrTx = WriteBatch | Transaction;

export type StructureCounter = 'teams' | 'members';

// Ajoute l'incrément dans un batch ou une transaction existante — zéro
// round-trip supplémentaire. Préférer cette forme aux updates standalone
// pour garantir l'atomicité avec l'action (sinon compteur et état divergent).
export function bumpStructureCounter(
  db: Firestore,
  writer: BatchOrTx,
  structureId: string,
  field: StructureCounter,
  delta: number,
): void {
  if (!delta) return;
  const ref = db.collection('structures').doc(structureId);
  (writer as Writer).update(ref, { [`counters.${field}`]: FieldValue.increment(delta) });
}

// Fallback standalone (pas de batch/tx en cours). Évitez si possible — la
// moindre erreur réseau peut désynchroniser le compteur.
export async function bumpStructureCounterStandalone(
  db: Firestore,
  structureId: string,
  field: StructureCounter,
  delta: number,
): Promise<void> {
  if (!delta) return;
  await db.collection('structures').doc(structureId).update({
    [`counters.${field}`]: FieldValue.increment(delta),
  });
}

// Calcule la taille du staff depuis les champs du doc structure.
// Fondateur (1) + co-fondateurs + managers + coachs (en dédupliquant).
export function computeStaffSize(structure: {
  founderId?: string | null;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
}): number {
  const set = new Set<string>();
  if (structure.founderId) set.add(structure.founderId);
  for (const id of structure.coFounderIds ?? []) set.add(id);
  for (const id of structure.managerIds ?? []) set.add(id);
  for (const id of structure.coachIds ?? []) set.add(id);
  return set.size;
}
