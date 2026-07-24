// Seeding — jambe SERVEUR (design §10) : construction des rangs de circuit
// depuis Firestore. La logique d'ordre reste dans seeding.ts (pur, testé) ;
// ici uniquement la lecture des docs circuit/circuit_teams.

import type { Firestore } from 'firebase-admin/firestore';
import { computeCircuitStandings, type StandingParticipation } from './standings';

/**
 * Rang au classement du circuit par circuitTeamId (1 = premier). null si le
 * circuit n'existe pas — l'appelant décide du refus (jamais de fallback
 * silencieux, design §10a).
 */
export async function circuitRankByTeamId(
  db: Firestore,
  circuitId: string,
): Promise<Map<string, number> | null> {
  const circuitSnap = await db.collection('circuits').doc(circuitId).get();
  if (!circuitSnap.exists) return null;
  const c = circuitSnap.data()!;
  const ctSnap = await db.collection('circuit_teams').where('circuitId', '==', circuitId).get();
  const rows = computeCircuitStandings(
    {
      competitionIds: Array.isArray(c.competitionIds) ? (c.competitionIds as string[]) : [],
      bestResultsCount: (c.bestResultsCount as number) ?? 1,
      lanTeamCount: (c.lanTeamCount as number) ?? 0,
      tieBreakers: Array.isArray(c.tieBreakers) ? (c.tieBreakers as string[]) : [],
    },
    ctSnap.docs.map(d => ({
      id: d.id,
      name: (d.data().name as string) ?? '',
      tag: (d.data().tag as string) ?? '',
      participations: Array.isArray(d.data().participations)
        ? (d.data().participations as StandingParticipation[])
        : [],
    })),
  );
  return new Map(rows.map(r => [r.teamId, r.rank]));
}
