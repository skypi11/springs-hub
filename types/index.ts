export interface SpringsUser {
  uid: string;
  discordId: string;
  discordUsername: string;
  discordAvatar?: string;
  displayName: string;
  slug?: string;               // Slug public utilisé dans /profile/[slug], généré au signup, unique. Voir lib/user-slug.ts.
  avatarUrl?: string;          // URL custom, sinon discordAvatar
  bio?: string;
  country?: string;
  // Date de naissance : STOCKÉE dans user_secrets/{uid} (server-only), PAS dans
  // le doc users (lisible par tout connecté — donnée de mineurs, RGPD). Le champ
  // ci-dessous n'existe que dans le retour owner de GET /api/profile (injecté
  // depuis user_secrets pour pré-remplir Settings). Sur le doc users, seul le
  // flag hasDateOfBirth subsiste. Voir docs/legends-cup-architecture.md §2.
  dateOfBirth?: string;        // ISO "YYYY-MM-DD", owner uniquement, jamais affiché
  hasDateOfBirth?: boolean;    // flag non sensible (complétion profil, segments admin)
  games?: string[];            // ['rocket_league', 'trackmania']
  isFan?: boolean;
  isAdmin?: boolean;
  isFounderApproved?: boolean;
  // Rôle dirigeant le plus élevé, dérivé au login par GET /api/auth/me, non
  // persisté en base. Sert notamment à l'affichage du rôle dans la sidebar.
  structureRole?: 'fondateur' | 'co_fondateur' | null;
  // Schema 2026-05-25 : array (max 2 structures par jeu). Lecture défensive via
  // lib/structure-membership.ts (string legacy wrappé automatiquement en [string]).
  structurePerGame?: Record<string, string | string[]>;
  // Recrutement
  isAvailableForRecruitment?: boolean;
  recruitmentRole?: string;    // 'joueur' | 'coach' | 'manager'
  recruitmentMessage?: string; // message libre
  // Préférences de notification.
  // Opt-out des DM Discord d'ANNONCES/RELANCES envoyés par les admins Aedral
  // (via /admin/messages). N'affecte PAS les DM fonctionnels (exercices assignés,
  // rang contesté, invitations) qui restent liés à l'activité de l'utilisateur.
  // Absent / false = reçoit (défaut) ; true = a refusé les DM d'annonces.
  dmAnnouncementsOptOut?: boolean;
  // ── Rocket League ────────────────────────────────────────────────────────
  // IDENTITÉ OFFICIELLE Epic (anti-mensonge / sticky), voir
  // docs/rl-rank-verification-plan.md. rlEpicId est posé une fois (snapshot
  // de la connexion Epic Discord vérifiée) puis FIGÉ. Toute modification
  // ultérieure passe par une demande admin. rlEpicName se rafraîchit librement
  // à chaque login / resync Discord (cosmétique, URL tracker, affichage).
  rlEpicId?: string;             // ID Epic permanent (32-hex), RÉFÉRENCE
  rlEpicName?: string;           // pseudo Epic courant, affichage + URL tracker
  rlEpicLinkedAt?: Date | string;
  rlEpicLinkSource?: 'discord' | 'admin';

  // Identité auto-dérivée pour la construction des URLs tracker.gg /
  // Ballchasing (cross-platform, Steam / PSN / Xbox / Switch en plus d'Epic).
  // → on construit auto les URLs via lib/rl-platform.ts.
  rlPlatform?: 'epic' | 'steam' | 'psn' | 'xbox' | 'switch';
  rlPlatformId?: string;       // pseudo ou ID selon la plateforme
  // Legacy (à migrer / supprimer une fois la nouvelle voie déployée) :
  epicAccountId?: string;      // ID Epic permanent (résolu via Tracker.gg), sert aux lookups stats
  epicDisplayName?: string;    // pseudo Epic actuel, affiché dans l'UI, peut changer
  rlTrackerUrl?: string;       // lien RL Tracker manuel, déprécié, auto-généré désormais

  // IDENTITÉ OFFICIELLE Steam (anti-mensonge / sticky, symétrique à Epic).
  // rlSteamId est figé à la confirmation : on prend le SteamID64 depuis
  // `steamLinked.steamId64` au moment où le joueur clique « Oui c'est mon
  // compte RL Steam ». Toute modification ultérieure = demande admin.
  // Distinct de `steamLinked` brut : avoir Steam lié ≠ jouer RL sur Steam.
  rlSteamId?: string;            // SteamID64 figé, RÉFÉRENCE
  rlSteamName?: string;          // persona Steam courant, affichage + URL tracker
  rlSteamLinkedAt?: Date | string;
  rlSteamLinkSource?: 'openid' | 'admin';

  // Steam OpenID linkage, récupéré via /api/auth/steam/callback.
  // SteamID64 est IMMUABLE → fournit la matière première pour le snapshot
  // `rlSteamId` ci-dessus, mais NE compte PAS seul comme identité RL vérifiée
  // (un joueur peut avoir un compte Steam sans jouer RL dessus).
  steamLinked?: {
    steamId64: string;
    personaName?: string | null;
    avatarUrl?: string | null;
    profileUrl?: string | null;
    linkedAt?: Date | string;
  };
  // Rang auto-déclaré + stats si dispos
  rlRank?: string;
  rlMmr?: number;
  rlStats?: RLStats;           // stats auto via API TRN (legacy, broken en prod)
  // Horodatage du dernier changement de rang, sert (a) à réinitialiser le
  // cooldown anti-spam des signalements quand l'user change son rang
  // (n'importe qui peut re-signaler immédiatement), (b) à afficher éventuellement
  // l'ancienneté du rang sur la fiche. Maintenu par POST /api/profile.
  rlRankChangedAt?: Date | string;
  // Trackmania
  pseudoTM?: string;           // pseudo affiché en course
  loginTM?: string;            // identifiant Ubisoft/Nadeo
  tmIoUrl?: string;            // URL trackmania.io du joueur
  tmStats?: TMStats;           // stats auto via API
  // Valorant, rang & stats agrégées. Source : déclaratif (saisie /settings) OU
  // sync nocturne via HenrikDev API (déclenché par cron si Riot connection liée).
  // Format `valorantRank` : libellé Riot officiel ("Diamond 2", "Radiant", etc.).
  // Validation : lib/valorant-ranks.ts → isValidValorantRank().
  valorantRank?: string;
  valorantRR?: number;          // Rank Rating dans le tier actuel (0-100)
  valorantRankSyncedAt?: Date | string; // dernière sync HenrikDev (si auto)
  valorantRankSource?: 'declared' | 'henrikdev'; // source du rang affiché
  // PUUID Riot encrypted, immuable côté Riot. Stocké au premier link via
  // Discord connection (pickValorantRiotId().puuid). Sert de "compte vérifié"
  // anti-mensonge style RL : si le user change de PUUID (= relié un autre
  // compte Riot dans Discord), on détecte et on peut alerter / flagger.
  valorantPuuid?: string;
  valorantPuuidLinkedAt?: Date | string; // timestamp du premier link
  // Dernière fois que l'user a ouvert /changelog (sert au dot rouge sidebar).
  lastChangelogSeenAt?: Date | string;
  createdAt?: Date;
  // Enrichissement renvoyé par GET /api/profile, structures où le joueur est impliqué
  structures?: ProfileStructure[];
  // Connexions tierces synchronisées depuis Discord (Epic, Steam, Twitch, YouTube, Spotify, etc.)
  // → enrichissent le profil + auto-update du pseudo Epic via le pull au login
  discordConnections?: import('@/lib/discord-connections').DiscordConnection[];
  // Préférences d'affichage des OG images (story + bannière horizontale) — voir OgDisplayPreferences.
  // Si absent ou ranks=[], les routes OG retombent sur leur logique automatique
  // (pickHeroRank historique : RL vérifié → Valorant → RL non vérifié).
  ogDisplay?: OgDisplayPreferences;
}

/**
 * Préférences user-éditables qui pilotent le contenu des OG images publiques
 * (story 1080×1920 + bannière 1200×630 + embeds Discord/Twitter).
 *
 * Stocké sur le user dès aujourd'hui (gratuit pour tous). L'accès en écriture
 * est gardé par `canUserCustomizeOgDisplay()` dans lib/plan-limits.ts — qui
 * retourne `true` aujourd'hui mais peut basculer à un check premium plus tard
 * sans casser le data déjà stocké. Cf. memoire `feedback_freemium_reserve`.
 *
 * Le rendu OG lit ces préférences server-side dans les routes /api/og/* et
 * fait un fallback raisonnable (auto-detect des rangs dispos, structure
 * principale par défaut) si les preferences sont absentes ou vides.
 */
export interface OgDisplayPreferences {
  /**
   * Liste ordonnée des IDs de jeux dont afficher le rang sur les OG images.
   * Max 2 par contrainte visuelle (cf. retour Matt 29/05).
   * - `[]` ou absent → fallback auto sur la logique pickHeroRank historique
   *   (1 seul rang choisi par priorité).
   * - `['rocket_league']` → affiche que RL en bloc unique stacked.
   * - `['rocket_league', 'valorant']` → affiche les 2 côte à côte en mini-blocs.
   * Les IDs doivent être des jeux valides de games-registry (sinon ignorés).
   */
  ranks?: string[];
  /**
   * Afficher le tag "Membre de [STRUCTURE]" + logo sur les OG. Default true.
   * Ignoré si l'user n'a pas de structure.
   */
  showStructure?: boolean;
  /**
   * Afficher l'équipe ("Joueur de [TEAM]") + son tag/jeu sur les OG. Default true.
   * Ignoré si l'user n'a pas d'équipe.
   */
  showTeam?: boolean;
  /**
   * Si l'user est dans 2+ structures, quel game ID choisir pour afficher
   * structure+équipe. Default = premier jeu pratiqué.
   */
  primaryGameForStructure?: string | null;
}

export interface ProfileStructure {
  id: string;
  /** Slug propre pour construire l'URL publique via getStructureHref(). Null si non backfillé. */
  slug?: string | null;
  name: string;
  tag: string;
  logoUrl: string;
  role: 'fondateur' | 'co_fondateur' | 'responsable' | 'coach_structure' | 'manager_equipe' | 'coach_equipe' | 'capitaine' | 'joueur' | 'remplacant' | 'membre';
  teams: { id: string; name: string; game: string; role: 'joueur' | 'remplacant' | 'coach' | 'manager' | 'capitaine' }[];
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
  // Préavis de départ co-fondateur (7 jours), clé = uid, valeur = timestamp du dépôt
  coFounderDepartures?: Record<string, Date | string | number>;
  // Plan freemium (préparation backend, pas encore exposé UI / payant).
  // Source de vérité : lib/plan-limits.ts (getStructurePlan + getLimit).
  // Legacy : `premium: true` (boolean) maps vers `plan: 'pro'` via getStructurePlan.
  plan?: 'free' | 'pro';
  premium?: boolean;            // @deprecated, utiliser `plan` à la place
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
  label?: string;             // label de niveau (ex: "Elite", "Academy", "Amateur"), groupement + tri
  order?: number;             // ordre manuel au sein d'un label (drag&drop)
  groupOrder?: number;        // ordre du label lui-même dans la liste (drag&drop entre groupes)
  status?: SubTeamStatus;     // active (défaut) | archived
  archivedAt?: Date | string;
  archivedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Le moteur de compétitions (Legends Cup & suivantes) a ses types dédiés dans
// types/competitions.ts — l'ancienne interface Competition (schéma spéculatif
// de la Phase 1, jamais importée) a été retirée au Lot 0.

// ── Bannière de structure, point focal ───────────────────────────────────
// Point focal de la bannière (modèle YouTube/Twitch) : l'image s'affiche en
// `background-size: cover` et `coverFocus` fournit le `background-position`.
// Indépendant du ratio d'affichage de la bannière. null/absent = centré (50/50).
export interface BannerFocus {
  x: number;  // background-position-x, en % (0-100)
  y: number;  // background-position-y, en % (0-100)
}

// ── Calendrier / Événements de structure ──────────────────────────────────
export type EventType = 'training' | 'scrim' | 'match' | 'tournoi' | 'autre';
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
  // Champs spécifiques au type 'tournoi'
  tournoiNom?: string | null;
  tournoiFormat?: string | null;
  tournoiUrl?: string | null;
  tournoiInscriptionUrl?: string | null;
  tournoiReglementUrl?: string | null;
}

// ── Annonces Discord, templates dynamiques (admin) ─────────────────────
// Stockées dans Firestore `announce_templates`, gérées via /admin/announce.
// Permet d'ajouter de nouvelles templates sans redéploy.
export interface AnnounceTemplate {
  id: string;                  // = doc id
  key: string;                 // slug stable (ex: 'patch-notes-mai-2026')
  label: string;               // affiché dans le dropdown
  title: string;
  description: string;         // markdown Discord supporté
  color: number;               // hex int (ex: 0xFFB800)
  defaultChannelHint?: string; // nom partiel du channel suggéré (ex: 'annonces')
  createdAt?: Date | string;
  updatedAt?: Date | string;
  createdBy?: string;          // uid admin
  lastUsedAt?: Date | string;  // pour tri "récemment utilisé"
  // Publication sur le site public /changelog (timeline). Quand true,
  // l'annonce apparaît dans la page changelog publique. Defaults to true
  // pour les nouvelles annonces, mettre à false pour Discord-only.
  publishOnSite?: boolean;
  /** Catégorie de la timeline (feature / ux / tech / fix / security).
   *  Défaut 'feature' si absent. Voir lib/changelog-categories.ts. */
  category?: string;
  /** Date de publication sur le site (premier ship). Utilisé pour ordonner
   *  la timeline indépendamment du updatedAt qui peut bouger sur édition. */
  publishedAt?: Date | string;
}

// ── Replays ──────────────────────────────────────────────────────────────
// Rocket League uniquement pour l'instant. Stockés sur R2 (clé dans r2Key),
// accédés via URL signée (60s) car privés au staff de la structure.
export type ReplayStatus = 'pending' | 'ready';
export type ReplayResult = 'win' | 'loss' | 'draw';

export interface Replay {
  id: string;
  structureId: string;
  teamId: string;              // sub_team, obligatoire pour organiser la bibliothèque
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

export type GameType = 'rocket_league' | 'trackmania' | 'valorant';
export type UserRole = 'visitor' | 'player' | 'fan' | 'coach' | 'manager' | 'founder' | 'admin';

// Constantes utilisables côté serveur et client pour éviter les magic strings.
// La source de vérité reste `lib/games-registry.ts` (ALL_GAME_DEFS), ces
// constantes sont conservées pour la compat ascendante des call sites.
export const GAMES = {
  RL: 'rocket_league' as const,
  TM: 'trackmania' as const,
  VAL: 'valorant' as const,
};
export const ALL_GAMES: GameType[] = [GAMES.RL, GAMES.TM, GAMES.VAL];

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
