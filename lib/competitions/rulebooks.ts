// Règlements de compétition versionnés (spec Legends §13bis, archi §2).
// Un règlement par scope — circuit entier OU compétition isolée — avec
// archivage de chaque version : traçabilité légale, on doit pouvoir prouver
// QUELLE version une équipe a acceptée à l'inscription.
//
// Doc id DÉTERMINISTE (`circuit_{id}` / `competition_{id}`) : un seul
// règlement possible par scope, lookup direct sans query.

import type { Firestore } from 'firebase-admin/firestore';

/**
 * Scope d'un règlement. `eventSlug` couvre les événements qui ne passent PAS par
 * le moteur de compétitions — la Springs Mania Cup, dont l'inscription est
 * individuelle et n'a donc pas d'entrée dans `competitions`. Sans lui, son
 * règlement aurait dû vivre en dur dans le code, et Matt aurait dépendu d'un
 * déploiement pour corriger une phrase.
 */
export type RulebookScope =
  | { circuitId: string }
  | { competitionId: string }
  | { eventSlug: string };

export function rulebookDocId(scope: RulebookScope): string {
  if ('circuitId' in scope) return `circuit_${scope.circuitId}`;
  if ('competitionId' in scope) return `competition_${scope.competitionId}`;
  return `event_${scope.eventSlug}`;
}

export interface ResolvedRulebook {
  id: string;
  scope: RulebookScope;
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
  scope: RulebookScope,
): Promise<ResolvedRulebook | null> {
  const snap = await db.collection('rulebooks').doc(rulebookDocId(scope)).get();
  return snap.exists ? serialize(snap.id, snap.data()!) : null;
}
