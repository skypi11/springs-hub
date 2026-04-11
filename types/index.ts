export interface SpringsUser {
  uid: string;
  discordId: string;
  discordUsername: string;
  discordAvatar?: string;
  displayName: string;
  avatarUrl?: string;          // URL custom, sinon discordAvatar
  bio?: string;
  country?: string;
  dateOfBirth?: string;        // ISO string "YYYY-MM-DD" — jamais affiché, sert à calculer l'âge
  games?: string[];            // ['rocket_league', 'trackmania']
  isFan?: boolean;
  isAdmin?: boolean;
  isFounderApproved?: boolean;
  structurePerGame?: Record<string, string>;
  // Recrutement
  isAvailableForRecruitment?: boolean;
  recruitmentRole?: string;    // 'joueur' | 'coach' | 'manager'
  recruitmentMessage?: string; // message libre
  // Rocket League
  epicAccountId?: string;      // pseudo Epic Games
  rlTrackerUrl?: string;       // lien RL Tracker
  rlRank?: string;
  rlMmr?: number;
  rlStats?: RLStats;           // stats auto via API TRN
  // Trackmania
  pseudoTM?: string;           // pseudo affiché en course
  loginTM?: string;            // identifiant Ubisoft/Nadeo
  tmIoUrl?: string;            // URL trackmania.io du joueur
  tmStats?: TMStats;           // stats auto via API
  createdAt?: Date;
}

export interface RLStats {
  rank?: string;               // ex: "Champion II"
  division?: string;           // ex: "Division III"
  mmr?: number;
  playlist?: string;           // ex: "Ranked Doubles 2v2"
  iconUrl?: string;            // URL icône du rang
  updatedAt?: string;          // ISO date dernière mise à jour
}

export interface TMStats {
  displayName?: string;
  trophies?: number;
  echelon?: number;            // 1-9
  clubTag?: string;
  trophyTiers?: { tier: number; count: number }[];
  zoneRankings?: { zone: string; rank: number }[];
  cotdBestRank?: number;
  cotdBestDiv?: number;
  cotdCount?: number;
  cotdAvgRank?: number;
  profileUrl?: string;
  updatedAt?: string;
}

export interface Structure {
  id: string;
  name: string;
  tag: string;                  // ex: "EXA"
  logoUrl?: string;             // URL logo carré, fond transparent
  description?: string;
  games: string[];              // ['rocket_league', 'trackmania']
  legalStatus?: string;         // 'none' | 'asso_1901' | 'auto_entreprise' | 'sas_sarl' | 'other'
  teamCount?: number;           // nombre d'équipes actuelles
  staffCount?: number;          // nombre de staff (co-fondateur, manager, coach)
  discordUrl?: string;          // lien serveur Discord
  message?: string;             // message optionnel (demande de création)
  // Réseaux sociaux
  socials?: {
    twitter?: string;
    youtube?: string;
    twitch?: string;
    instagram?: string;
    tiktok?: string;
    website?: string;
  };
  // Recrutement
  recruiting?: {
    active: boolean;
    positions: { game: string; role: string }[];  // ex: [{ game: 'rocket_league', role: 'joueur' }]
  };
  // Palmarès
  achievements?: { title: string; date?: string; competition?: string }[];
  // Rôles
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  // Statut
  status: 'pending_validation' | 'active' | 'suspended' | 'deletion_scheduled';
  reviewComment?: string;       // commentaire admin (approbation/refus)
  reviewedBy?: string;          // uid admin
  requestedAt?: Date;
  validatedAt?: Date;
  suspendedAt?: Date;
  suspendedBy?: string;
  deletionRequestedAt?: Date;
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
