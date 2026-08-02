// Formes JSON renvoyées par les routes /api/admin/circuits, /api/admin/competitions
// et /api/admin/competition-admins (Timestamps sérialisés en ISO — voir
// lib/competitions/serialize.ts).

import type {
  CompetitionDiscordOptions,
  CompetitionEligibility,
  CompetitionFormat,
  CompetitionSchedule,
  TournamentStage,
} from '@/types/competitions';

export interface AdminCircuit {
  id: string;
  name: string;
  game: string;
  competitionIds: string[];
  pointsScale: Record<string, number>;
  bestResultsCount: number;
  lanTeamCount: number;
  prizePool: { amount: number; currency: string; note?: string } | null;
  organizer: { name: string; logoUrl?: string | null } | null;
  tieBreakers: string[];
  status: string;
  createdAt: string | null;
}

export interface AdminCompetition {
  id: string;
  name: string;
  game: string;
  circuitId: string | null;
  /** Identité portée par l'affiche de résultat et les supports publics. Vide
   *  sur une étape de circuit : celle du circuit sert alors de repli. */
  organizer: { name: string; logoUrl?: string | null } | null;
  accentColor: string | null;
  format: CompetitionFormat | null;
  /** Séquence d'étapes (null = tournoi à une seule étape). Servie par l'API
   *  depuis le Lot multi-étapes : sans elle, le formulaire d'édition renvoyait
   *  un payload sans `stages` et le serveur devait deviner (resync ou 409). */
  stages: TournamentStage[] | null;
  eligibility: CompetitionEligibility | null;
  roster: { starters: number; subsMax: number } | null;
  registration: { opensAt: string | null; closesAt: string | null; waitlist: boolean } | null;
  schedule: CompetitionSchedule | null;
  discord: {
    guildId: string;
    participantRoleId: string | null;
    categoryId: string | null;
    options?: CompetitionDiscordOptions;
  } | null;
  status: string;
  isDev?: boolean;
  bracketMaterializedAt?: string | null;
  /** Inscriptions en attente de validation (signal « à valider » sur la carte admin). */
  pendingCount?: number;
  createdAt: string | null;
}

export interface CompetitionAdminEntry {
  uid: string;
  displayName: string;
  avatarUrl: string;
  slug: string;
  addedBy: string;
  addedAt: string | null;
}
