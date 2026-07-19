// Quota storage unifié par structure, partagé entre documents staff et replays.
// Lit les tailles depuis Firestore (champ `sizeBytes` sur les docs ready), pas
// depuis R2 (plus rapide, plus précis : un upload pending ne compte pas).
//
// Le quota dépend du PLAN de la structure (free vs pro). Source de vérité dans
// lib/plan-limits.ts. Legacy `premium: true` → 'pro' via getStructurePlan().

import type { Firestore } from 'firebase-admin/firestore';
import { getStructurePlan, getLimit, type StructurePlan } from '@/lib/plan-limits';

export interface StructureStorageUsage {
  docsBytes: number;
  replaysBytes: number;
  totalBytes: number;
  quotaBytes: number;
  plan: StructurePlan;
  premium: boolean;             // @deprecated, alias rétrocompat de `plan === 'pro'`
  remainingBytes: number;
}

// Lit le plan d'une structure (avec fallback legacy `premium: true` → 'pro').
export async function getStructurePlanFromDb(
  db: Firestore,
  structureId: string,
): Promise<StructurePlan> {
  try {
    const snap = await db.collection('structures').doc(structureId).get();
    return getStructurePlan(snap.data() ?? null);
  } catch {
    return 'free';
  }
}

// @deprecated, alias rétrocompat pour les call sites pas encore migrés.
// Préférer getStructurePlanFromDb() qui renvoie le plan typé directement.
export async function isStructurePremium(
  db: Firestore,
  structureId: string,
): Promise<boolean> {
  return (await getStructurePlanFromDb(db, structureId)) === 'pro';
}

export function getStructureQuotaBytes(planOrPremium: StructurePlan | boolean): number {
  // Accepte les 2 signatures pendant la transition (anciens appels passent un boolean)
  const plan: StructurePlan = typeof planOrPremium === 'boolean'
    ? (planOrPremium ? 'pro' : 'free')
    : planOrPremium;
  return getLimit(plan, 'storageBytes');
}

// Calcule l'usage actuel + le quota applicable + le restant.
// Somme tous les `sizeBytes` des docs ready + replays ready pour la structure.
export async function computeStructureStorageUsage(
  db: Firestore,
  structureId: string,
): Promise<StructureStorageUsage> {
  const [docsSnap, replaysSnap, plan] = await Promise.all([
    db.collection('structure_documents').where('structureId', '==', structureId).get(),
    db.collection('replays').where('structureId', '==', structureId).get(),
    getStructurePlanFromDb(db, structureId),
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
  const quotaBytes = getStructureQuotaBytes(plan);
  return {
    docsBytes,
    replaysBytes,
    totalBytes,
    quotaBytes,
    plan,
    premium: plan === 'pro',
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
  if (usage.plan === 'pro') {
    return `Limite Pro atteinte (${mb(usage.totalBytes)} / ${mb(usage.quotaBytes)} MB). Libère de la place en supprimant d'anciens fichiers.`;
  }
  return `Limite de stockage atteinte (${mb(usage.totalBytes)} / ${mb(usage.quotaBytes)} MB). Supprime d'anciens fichiers, ou passe en premium (5 GB).`;
}
