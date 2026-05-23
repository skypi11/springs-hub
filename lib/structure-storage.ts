// Quota storage unifié par structure — partagé entre documents staff et replays.
// Lit les tailles depuis Firestore (champ `sizeBytes` sur les docs ready), pas
// depuis R2 (plus rapide, plus précis : un upload pending ne compte pas).
//
// Le quota est de STRUCTURE_STORAGE_QUOTA_BYTES en free tier, bumpé à
// STRUCTURE_STORAGE_QUOTA_BYTES_PREMIUM quand `structures.{id}.premium === true`.
// Voir docs/rl-rank-verification-plan.md (section freemium storage).

import type { Firestore } from 'firebase-admin/firestore';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';

export interface StructureStorageUsage {
  docsBytes: number;
  replaysBytes: number;
  totalBytes: number;
  quotaBytes: number;
  premium: boolean;
  remainingBytes: number;
}

// Lit le flag premium d'une structure. False par défaut (clé absente ou false).
export async function isStructurePremium(
  db: Firestore,
  structureId: string,
): Promise<boolean> {
  try {
    const snap = await db.collection('structures').doc(structureId).get();
    return snap.data()?.premium === true;
  } catch {
    return false;
  }
}

export function getStructureQuotaBytes(premium: boolean): number {
  return premium
    ? UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES_PREMIUM
    : UPLOAD_LIMITS.STRUCTURE_STORAGE_QUOTA_BYTES;
}

// Calcule l'usage actuel + le quota applicable + le restant.
// Somme tous les `sizeBytes` des docs ready + replays ready pour la structure.
export async function computeStructureStorageUsage(
  db: Firestore,
  structureId: string,
): Promise<StructureStorageUsage> {
  const [docsSnap, replaysSnap, premium] = await Promise.all([
    db.collection('structure_documents').where('structureId', '==', structureId).get(),
    db.collection('replays').where('structureId', '==', structureId).get(),
    isStructurePremium(db, structureId),
  ]);

  const sumReady = (snap: FirebaseFirestore.QuerySnapshot): number =>
    snap.docs.reduce((sum, d) => {
      const data = d.data();
      if (data.status !== 'ready') return sum;
      const sz = typeof data.sizeBytes === 'number' ? data.sizeBytes : 0;
      return sum + sz;
    }, 0);

  const docsBytes = sumReady(docsSnap);
  const replaysBytes = sumReady(replaysSnap);
  const totalBytes = docsBytes + replaysBytes;
  const quotaBytes = getStructureQuotaBytes(premium);
  return {
    docsBytes,
    replaysBytes,
    totalBytes,
    quotaBytes,
    premium,
    remainingBytes: Math.max(0, quotaBytes - totalBytes),
  };
}

// Vérifie qu'un upload de taille `sizeBytes` est dans le quota.
// Retourne `null` si OK, ou un message d'erreur prêt à afficher.
export async function checkStructureStorageQuota(
  db: Firestore,
  structureId: string,
  sizeBytes: number,
): Promise<string | null> {
  const usage = await computeStructureStorageUsage(db, structureId);
  if (usage.totalBytes + sizeBytes <= usage.quotaBytes) return null;

  const mb = (n: number) => Math.round(n / (1024 * 1024));
  if (usage.premium) {
    return `Limite premium atteinte (${mb(usage.totalBytes)} / ${mb(usage.quotaBytes)} MB). Libère de la place en supprimant d'anciens fichiers.`;
  }
  return `Limite de stockage atteinte (${mb(usage.totalBytes)} / ${mb(usage.quotaBytes)} MB). Supprime d'anciens fichiers, ou passe en premium (5 GB).`;
}
