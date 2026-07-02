// Conversion payload validé ↔ document Firestore pour le CRUD admin des
// compétitions. Séparé des routes (un route.ts Next ne peut exporter que ses
// handlers HTTP) et réutilisé par POST (create) et PATCH (update).

import { Timestamp } from 'firebase-admin/firestore';
import type { CompetitionPayload } from '@/lib/competitions/validate';

// Payload validé → doc Firestore. Les fenêtres d'inscription sont stockées en
// Timestamp (convention repo), le reste tel quel.
export function toFirestoreCompetition(payload: CompetitionPayload) {
  return {
    name: payload.name,
    game: payload.game,
    circuitId: payload.circuitId,
    format: payload.format,
    eligibility: payload.eligibility,
    roster: payload.roster,
    registration: {
      opensAt: Timestamp.fromDate(new Date(payload.registration.opensAt)),
      closesAt: Timestamp.fromDate(new Date(payload.registration.closesAt)),
      waitlist: payload.registration.waitlist,
    },
    schedule: payload.schedule,
    discord: payload.discordGuildId
      ? { guildId: payload.discordGuildId, participantRoleId: null, categoryId: null }
      : null,
  };
}

// Doc Firestore → JSON API (Timestamps sérialisés en ISO).
export function serializeCompetition(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    name: data.name ?? '',
    game: data.game ?? '',
    circuitId: data.circuitId ?? null,
    format: data.format ?? null,
    eligibility: data.eligibility ?? null,
    roster: data.roster ?? null,
    registration: data.registration
      ? {
          opensAt: data.registration.opensAt?.toDate?.()?.toISOString() ?? null,
          closesAt: data.registration.closesAt?.toDate?.()?.toISOString() ?? null,
          waitlist: data.registration.waitlist === true,
        }
      : null,
    schedule: data.schedule ?? null,
    discord: data.discord ?? null,
    status: data.status ?? 'draft',
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
  };
}

export function serializeCircuit(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    name: data.name ?? '',
    game: data.game ?? '',
    competitionIds: data.competitionIds ?? [],
    pointsScale: data.pointsScale ?? {},
    bestResultsCount: data.bestResultsCount ?? 0,
    lanTeamCount: data.lanTeamCount ?? 0,
    tieBreakers: data.tieBreakers ?? [],
    status: data.status ?? 'draft',
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
  };
}
