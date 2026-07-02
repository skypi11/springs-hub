// Formes JSON renvoyées par les routes /api/admin/circuits, /api/admin/competitions
// et /api/admin/competition-admins (Timestamps sérialisés en ISO — voir
// lib/competitions/serialize.ts).

import type {
  CompetitionEligibility,
  CompetitionFormat,
  CompetitionSchedule,
} from '@/types/competitions';

export interface AdminCircuit {
  id: string;
  name: string;
  game: string;
  competitionIds: string[];
  pointsScale: Record<string, number>;
  bestResultsCount: number;
  lanTeamCount: number;
  tieBreakers: string[];
  status: string;
  createdAt: string | null;
  createdBy: string;
}

export interface AdminCompetition {
  id: string;
  name: string;
  game: string;
  circuitId: string | null;
  format: CompetitionFormat | null;
  eligibility: CompetitionEligibility | null;
  roster: { starters: number; subsMax: number } | null;
  registration: { opensAt: string | null; closesAt: string | null; waitlist: boolean } | null;
  schedule: CompetitionSchedule | null;
  discord: { guildId: string; participantRoleId: string | null; categoryId: string | null } | null;
  status: string;
  createdAt: string | null;
  createdBy: string;
}

export interface CompetitionAdminEntry {
  uid: string;
  displayName: string;
  avatarUrl: string;
  slug: string;
  addedBy: string;
  addedAt: string | null;
}
