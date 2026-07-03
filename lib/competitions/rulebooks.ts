// Règlements de compétition versionnés (spec Legends §13bis, archi §2).
// Un règlement par scope — circuit entier OU compétition isolée — avec
// archivage de chaque version : traçabilité légale, on doit pouvoir prouver
// QUELLE version une équipe a acceptée à l'inscription.
//
// Doc id DÉTERMINISTE (`circuit_{id}` / `competition_{id}`) : un seul
// règlement possible par scope, lookup direct sans query.

import type { Firestore } from 'firebase-admin/firestore';

export function rulebookDocId(scope: { circuitId: string } | { competitionId: string }): string {
  return 'circuitId' in scope ? `circuit_${scope.circuitId}` : `competition_${scope.competitionId}`;
}

export interface ResolvedRulebook {
  id: string;
  scope: { circuitId: string } | { competitionId: string };
  markdown: string;
  version: number;
  updatedAt: string | null;
}

function serialize(id: string, data: FirebaseFirestore.DocumentData): ResolvedRulebook {
  return {
    id,
    scope: data.scope,
    markdown: data.markdown ?? '',
    version: data.version ?? 1,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
  };
}

// Règlement applicable à une compétition : le règlement propre à la
// compétition prime, sinon celui de son circuit. null si aucun n'est rédigé.
export async function getRulebookForCompetition(
  db: Firestore,
  competition: { id: string; circuitId?: string | null },
): Promise<ResolvedRulebook | null> {
  const compSnap = await db.collection('rulebooks').doc(`competition_${competition.id}`).get();
  if (compSnap.exists) return serialize(compSnap.id, compSnap.data()!);

  if (competition.circuitId) {
    const circuitSnap = await db.collection('rulebooks').doc(`circuit_${competition.circuitId}`).get();
    if (circuitSnap.exists) return serialize(circuitSnap.id, circuitSnap.data()!);
  }
  return null;
}

export async function getRulebookByScope(
  db: Firestore,
  scope: { circuitId: string } | { competitionId: string },
): Promise<ResolvedRulebook | null> {
  const snap = await db.collection('rulebooks').doc(rulebookDocId(scope)).get();
  return snap.exists ? serialize(snap.id, snap.data()!) : null;
}
