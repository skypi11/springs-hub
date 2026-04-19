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
  epicAccountId?: string;      // ID Epic permanent (résolu via Tracker.gg) — sert aux lookups stats
  epicDisplayName?: string;    // pseudo Epic actuel — affiché dans l'UI, peut changer
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
    message?: string;                              // annonce libre (markdown) affichée au-dessus des positions
  };
  // Palmarès
  achievements?: Achievement[];
  // Rôles
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  // Préavis de départ co-fondateur (7 jours) — clé = uid, valeur = timestamp du dépôt
  coFounderDepartures?: Record<string, Date | string | number>;
  // Statut
  status: 'pending_validation' | 'active' | 'suspended' | 'deletion_scheduled' | 'orphaned';
  reviewComment?: string;       // commentaire admin (approbation/refus)
  reviewedBy?: string;          // uid admin
  requestedAt?: Date;
  validatedAt?: Date;
  suspendedAt?: Date;
  suspendedBy?: string;
  deletionRequestedAt?: Date;
  createdAt?: Date;
}

export interface Achievement {
  placement: string;          // "1er", "2e", "Top 4", "Demi-finale"
  competition: string;        // "Springs Cup Saison 2"
  game: string;               // 'rocket_league' | 'trackmania'
  date: string;               // "2026-03" (mois/année)
}

export type SubTeamStatus = 'active' | 'archived';

export interface SubTeam {
  id: string;
  structureId: string;
  game: string;               // 'rocket_league' | 'trackmania'
  name: string;               // "Équipe principale", "Équipe B"
  playerIds: string[];         // joueurs titulaires
  subIds: string[];            // remplaçants
  staffIds: string[];          // managers/coachs rattachés à cette équipe
  captainId?: string;         // joueur capitaine (peut gérer calendrier de SON équipe, pas le roster)
  label?: string;             // label de niveau (ex: "Elite", "Academy", "Amateur") — groupement + tri
  order?: number;             // ordre manuel au sein d'un label (drag&drop)
  groupOrder?: number;        // ordre du label lui-même dans la liste (drag&drop entre groupes)
  status?: SubTeamStatus;     // active (défaut) | archived
  archivedAt?: Date | string;
  archivedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
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

// ── Calendrier / Événements de structure ──────────────────────────────────
export type EventType = 'training' | 'scrim' | 'match' | 'springs' | 'autre';
export type EventScope = 'structure' | 'teams' | 'game';
export type EventStatus = 'scheduled' | 'done' | 'cancelled';
export type PresenceStatus = 'present' | 'absent' | 'maybe' | 'pending';

export interface EventTarget {
  scope: EventScope;
  teamIds?: string[];
  game?: string;
}

export interface StructureEvent {
  id: string;
  structureId: string;
  createdBy: string;
  createdAt?: string;           // ISO pour le client
  updatedAt?: string;
  // Contenu
  title: string;
  type: EventType;
  description?: string;
  location?: string;
  startsAt: string;             // ISO
  endsAt: string;               // ISO
  // Cible
  target: EventTarget;
  // État
  status: EventStatus;
  completedAt?: string | null;
  completedBy?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  // Post-event
  compteRendu?: string;
  aTravailler?: string;
  adversaire?: string | null;
  resultat?: string | null;
}

// ── Replays ──────────────────────────────────────────────────────────────
// Rocket League uniquement pour l'instant. Stockés sur R2 (clé dans r2Key),
// accédés via URL signée (60s) car privés au staff de la structure.
export type ReplayStatus = 'pending' | 'ready';
export type ReplayResult = 'win' | 'loss' | 'draw';

export interface Replay {
  id: string;
  structureId: string;
  teamId: string;              // sub_team — obligatoire pour organiser la bibliothèque
  eventId?: string | null;     // si rattaché à un scrim/match
  uploadedBy: string;
  // Fichier
  filename: string;            // original, sanitizé
  sizeBytes: number;
  r2Key: string;
  status: ReplayStatus;        // pending → le fichier n'a pas encore été PUT sur R2
  // Métadonnées éditables
  title: string;
  result?: ReplayResult | null;
  score?: string | null;       // "3-2"
  map?: string | null;
  notes?: string | null;
  createdAt?: string;
}

// ── Documents staff ───────────────────────────────────────────────────────────
// Arborescence libre de dossiers + fichiers stockés sur R2 (privés, signed URLs).
// Accès strict : fondateur + cofondateurs (voir lib/document-permissions.ts).

export type DocumentStatus = 'pending' | 'ready';

export interface StructureFolder {
  id: string;
  structureId: string;
  parentId: string | null;     // null = racine
  name: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StructureDocument {
  id: string;
  structureId: string;
  folderId: string | null;     // null = racine
  uploadedBy: string;
  filename: string;            // nom d'origine sanitizé (pour download)
  mime: string;                // MIME d'origine (images stockées en webp)
  sizeBytes: number;
  r2Key: string;
  status: DocumentStatus;
  title: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EventPresence {
  id: string;
  eventId: string;
  structureId: string;
  userId: string;
  status: PresenceStatus;
  wasStructureMember: boolean;
  respondedAt?: string | null;
  updatedBy?: string | null;
}

export type GameType = 'rocket_league' | 'trackmania';
export type UserRole = 'visitor' | 'player' | 'fan' | 'coach' | 'manager' | 'founder' | 'admin';

// Constantes utilisables côté serveur et client pour éviter les magic strings
export const GAMES = {
  RL: 'rocket_league' as const,
  TM: 'trackmania' as const,
};
export const ALL_GAMES: GameType[] = [GAMES.RL, GAMES.TM];

export const STRUCTURE_ROLES = {
  FOUNDER: 'fondateur' as const,
  CO_FOUNDER: 'cofondateur' as const,
  MANAGER: 'manager' as const,
  COACH: 'coach' as const,
  PLAYER: 'joueur' as const,
};
export type StructureRole = typeof STRUCTURE_ROLES[keyof typeof STRUCTURE_ROLES];

export const STRUCTURE_STATUS = {
  PENDING: 'pending_validation' as const,
  ACTIVE: 'active' as const,
  REJECTED: 'rejected' as const,
  SUSPENDED: 'suspended' as const,
  DELETION_SCHEDULED: 'deletion_scheduled' as const,
  ORPHANED: 'orphaned' as const,
};
export type StructureStatus = typeof STRUCTURE_STATUS[keyof typeof STRUCTURE_STATUS];
