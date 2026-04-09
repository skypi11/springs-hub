export interface SpringsUser {
  uid: string;
  discordId: string;
  discordUsername: string;
  discordAvatar?: string;
  displayName: string;
  bio?: string;
  country?: string;
  games?: string[];
  isFan?: boolean;
  isAdmin?: boolean;
  isFounderApproved?: boolean;
  structurePerGame?: Record<string, string>;
  // Rocket League
  epicAccountId?: string;
  rlTrackerUrl?: string;
  rlRank?: string;
  isAvailableForRecruitment?: boolean;
  availableRole?: string;
  // Trackmania
  pseudoTM?: string;
  loginTM?: string;
  createdAt?: Date;
}

export interface Structure {
  id: string;
  name: string;
  tag: string;
  logoUrl?: string;
  description?: string;
  games: string[];
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  status: 'pending_validation' | 'active' | 'suspended' | 'deletion_scheduled';
  createdAt?: Date;
}

export interface Competition {
  id: string;
  name: string;
  game: 'rocket_league' | 'trackmania';
  type: 'league' | 'cup' | 'tournament';
  status: 'upcoming' | 'registration' | 'active' | 'finished' | 'archived';
  format?: Record<string, unknown>;
  registrationOpen?: Date;
  registrationClose?: Date;
  startDate?: Date;
  endDate?: Date;
  prizePool?: Record<string, number>;
  maxTeams?: number;
  allowSolo?: boolean;
  createdAt?: Date;
}

export type GameType = 'rocket_league' | 'trackmania';
export type UserRole = 'visitor' | 'player' | 'fan' | 'coach' | 'manager' | 'founder' | 'admin';
