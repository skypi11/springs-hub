// Registre des bans de compétition (spec Legends §5) — helpers serveur.
// Bans de joueurs ET de structures : motif, durée ou permanent, jamais
// supprimés (revoke = horodaté, l'historique reste). Consulté automatiquement
// à l'inscription : refus auto + motif affiché.

import type { Firestore, Timestamp } from 'firebase-admin/firestore';

export interface ActiveBan {
  id: string;
  targetType: 'user' | 'structure';
  targetId: string;
  targetLabel: string;
  reason: string;
  expiresAt: Date | null; // null = permanent
}

function isActive(data: FirebaseFirestore.DocumentData, now: Date): boolean {
  if (data.revokedAt) return false;
  const expiresAt = (data.expiresAt as Timestamp | null)?.toDate?.() ?? null;
  if (expiresAt && expiresAt <= now) return false;
  return true;
}

// Bans ACTIFS visant l'un des joueurs (uids) ou la structure. Deux queries
// `in` par paquets de 10 (limite Firestore) — un roster RL = 3-5 uids, donc
// en pratique 1 query users + 1 query structure.
export async function getActiveCompetitionBans(
  db: Firestore,
  { uids, structureId }: { uids: string[]; structureId?: string | null },
): Promise<ActiveBan[]> {
  const now = new Date();
  const found: ActiveBan[] = [];

  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

  const queries: Promise<FirebaseFirestore.QuerySnapshot>[] = chunks.map(chunk =>
    db.collection('competition_bans')
      .where('targetType', '==', 'user')
      .where('targetId', 'in', chunk)
      .get(),
  );
  if (structureId) {
    queries.push(
      db.collection('competition_bans')
        .where('targetType', '==', 'structure')
        .where('targetId', '==', structureId)
        .get(),
    );
  }

  const snaps = await Promise.all(queries);
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!isActive(data, now)) continue;
      found.push({
        id: doc.id,
        targetType: data.targetType,
        targetId: data.targetId,
        targetLabel: data.targetLabel ?? '',
        reason: data.reason ?? '',
        expiresAt: (data.expiresAt as Timestamp | null)?.toDate?.() ?? null,
      });
    }
  }
  return found;
}

// Sérialisation JSON API d'un doc ban (Timestamps → ISO).
export function serializeBan(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    targetType: data.targetType ?? 'user',
    targetId: data.targetId ?? '',
    targetLabel: data.targetLabel ?? '',
    reason: data.reason ?? '',
    expiresAt: data.expiresAt?.toDate?.()?.toISOString() ?? null,
    createdBy: data.createdBy ?? '',
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    revokedAt: data.revokedAt?.toDate?.()?.toISOString() ?? null,
    revokedBy: data.revokedBy ?? null,
    active: isActive(data, new Date()),
  };
}
