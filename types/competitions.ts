// Types du moteur de compétitions Aedral.
// Source de vérité fonctionnelle : docs/legends-springs-cup-spec.md
// Source de vérité technique  : docs/legends-cup-architecture.md (v2)
//
// Principes :
// - Moteur GÉNÉRIQUE : aucune logique « Legends Cup » en dur, tout est
//   configuration portée par ces documents. La Legends Springs Cup = 1 circuit
//   + 4 compétitions + 1 LAN créés depuis le panel admin.
// - Server-authoritative : toutes les écritures passent par les API routes
//   (Admin SDK). Les collections sont en `allow write: if false`.
// - Aucune donnée personnelle (uid, snowflake, MMR, âge) dans les documents à
//   lecture publique — voir chaque type pour sa visibilité.
//
// Côté client les timestamps Firestore arrivent en `Timestamp` (client SDK)
// ou en string ISO (API JSON) : on suit la convention existante `Date | string`
// des types du repo, les routes API sérialisent en ISO.

export type CompetitionGame = 'rocket_league'; // extensible (registry) — TM natif hors scope v1

// ── Circuits ────────────────────────────────────────────────────────────────

/** Collection `circuits` — lecture publique. */
export interface Circuit {
  id: string;
  name: string;                    // "Legends Springs Cup 2026"
  game: CompetitionGame;
  competitionIds: string[];        // ordre chronologique des Qualifs
  /**
   * Barème lu sur la PLACE COMPRESSÉE 1→N (archi §3) : clé = place ("1"…"32"),
   * valeur = points. Un groupe nominal vide décale les suivants.
   */
  pointsScale: Record<string, number>;
  bestResultsCount: number;        // 3 : seuls les 3 meilleurs résultats comptent
  lanTeamCount: number;            // 16 : cutline LAN
  /** Ordre des clés de départage cutline (spec §11). */
  tieBreakers: CircuitTieBreaker[];
  /** Rôle Discord « Participant » commun aux compétitions du circuit (spec §7),
   *  créé au premier provisioning — réutilisé uniquement sur le même serveur. */
  discord?: { guildId: string; participantRoleId: string } | null;
  status: CircuitStatus;
  createdAt: Date | string;
  // PAS de createdBy : doc à lecture publique, aucun uid/snowflake n'y a sa
  // place (archi §8). L'auteur est tracé dans admin_audit_logs.
}

export type CircuitStatus = 'draft' | 'active' | 'finished' | 'archived';

export type CircuitTieBreaker = 'best_placement' | 'goal_diff_total' | 'latest_event';

/**
 * Collection `circuit_teams` — lecture publique, MAIS sans aucun uid :
 * `rosterUids` de chaque participation vit dans la sous-collection privée
 * `/private/roster` (archi §2). Le classement public n'a besoin que de
 * nom/tag/points/placements.
 */
export interface CircuitTeam {
  id: string;
  circuitId: string;
  name: string;
  tag: string;
  participations: CircuitParticipation[];
}

export interface CircuitParticipation {
  competitionId: string;
  registrationId: string;
  placement: number;               // place compressée 1→N
  points: number;
  goalDiff: number;                // délta cumulé du Qualif (normalisé par match joué)
  goalsFor: number;                // buts marqués — tiebreak circuit auditables
}

/**
 * Sous-collection privée `circuit_teams/{id}/private/state` — DENY-ALL
 * (uids/snowflakes interdits dans le doc public). Alimentée à chaque
 * approbation d'inscription, PAS à la clôture : les inscriptions du Qualif
 * N+1 ouvrent pendant le Qualif N (J-14), la résolution d'identité noyau 2/3
 * doit donc lire les rosters approuvés, pas les participations closes.
 */
export interface CircuitTeamPrivateState {
  /** Réservation par compétition : max 1 inscription rattachée (archi §2). */
  claims: Record<string, string>;  // competitionId → registrationId
  /** Roster approuvé par compétition — la « précédente participation » de la
   *  règle noyau = l'entrée de la compétition la plus récente dans l'ordre de
   *  circuit.competitionIds. Map (pas array) : idempotent au re-approve. */
  rosterByCompetition: Record<string, {
    registrationId: string;
    rosterUids: string[];
    starterUids: string[];
    approvedAt: Date | string;
  }>;
}

// ── Compétitions ────────────────────────────────────────────────────────────

/** Collection `competitions` — lecture publique. */
export interface Competition {
  id: string;
  name: string;                    // "Legends Qualifier #1"
  game: CompetitionGame;
  circuitId: string | null;        // null = tournoi hors circuit
  format: CompetitionFormat;
  eligibility: CompetitionEligibility;
  roster: { starters: number; subsMax: number };   // RL : 3 + 2
  registration: {
    opensAt: Date | string;        // J-14
    closesAt: Date | string;       // J-3
    waitlist: boolean;
  };
  schedule: CompetitionSchedule;
  discord: {
    guildId: string;               // serveur SPRINGS E-SPORT
    /** Rôle « Participant » — commun au CIRCUIT quand la compétition en a un
     *  (spec §7), l'ID vit alors aussi sur circuits/{id}.discord. */
    participantRoleId: string | null;
    categoryId: string | null;         // catégorie des salons d'équipe
    /** Verrou anti-concurrence du provisioning (bail à expiration). */
    provisioningLockedUntil?: Date | string | null;
  } | null;
  status: CompetitionStatus;
  /**
   * Compteur dénormalisé d'inscriptions `approved` — maintenu EXCLUSIVEMENT
   * par les transitions de statut de la file de validation (transaction), pour
   * décider cap → approved | waitlisted sans query en transaction (piège
   * Firestore documenté). Public (affiché « 12/32 équipes »), pas une donnée
   * personnelle. Absent = 0.
   */
  approvedCount?: number;
  /**
   * Ordre de seed (statut 'seeding') : registrationId par place, index 0 =
   * seed 1. Aléatoire à l'ouverture du seeding, réordonnable par l'admin avant
   * publication (spec §2). Figé à la matérialisation du bracket. Public-safe
   * (registrationId = `${compId}_${teamId}`, aucun snowflake).
   */
  seeding?: string[];
  /**
   * Équipes retirées en cours de tournoi (withdrawTeam, R5-4) — nécessaire à la
   * reconstruction du bracket pur (lib/competitions/bracket-store). Initialisé
   * à [] à la publication.
   */
  withdrawn?: string[];
  /** Bracket matérialisé (competition_matches écrits) — pose au `publish`. */
  bracketMaterializedAt?: Date | string | null;
  createdAt: Date | string;
  // PAS de createdBy : doc public, uid/snowflake interdits (archi §8) —
  // l'auteur est tracé dans admin_audit_logs.
}

export type CompetitionStatus =
  | 'draft'          // invisible du public, données de test incluses
  | 'registration'   // fenêtre d'inscription ouverte
  | 'validation'     // inscriptions closes, file de validation en cours
  | 'seeding'        // seeding en préparation, bracket non publié
  | 'live'           // jour(s) de match
  | 'finished'       // terminé, standings écrits
  | 'archived';

export interface CompetitionFormat {
  kind: 'double_elim';             // extensible : d'autres formats plus tard
  maxTeams: number;                // 32
  /**
   * BO exprimé EN RELATIF à la fin de chaque bracket (archi §2) : les numéros
   * absolus de rounds changent avec N. Legends : défaut BO5, 2 dernières rondes
   * winners + 2 dernières rondes losers en BO7, grande finale (+ reset) BO7.
   */
  bo: {
    default: number;
    overrides: Array<{ bracket: 'winners' | 'losers'; roundsFromEnd: number; bo: number }>;
    grandFinal: number;
  };
  bracketReset: boolean;
  /**
   * Score conventionnel d'un forfait (spec §11) : `games` manches gagnées
   * `goalsPerGame`-0 en BO5 → délta ±3 ; BO7 dérivé (4 manches).
   */
  forfeitScore: { games: number; goalsPerGame: number };
}

export interface CompetitionEligibility {
  requireVerifiedAccounts: boolean;  // gate compét : comptes Epic/Steam vérifiés
  /** Âge minimum — en dessous : inscription en « dérogation requise », jamais de refus auto. */
  minAge: number | null;             // 16 pour la Legends Cup
  /** Règles MMR (spec §3) — null = pas de contrainte MMR. */
  mmr: {
    /** réf = weightCurrent × actuel + (1−weightCurrent) × peak, arrondi. */
    weightCurrent: number;           // 0.7
    /** Toute compo de 3 alignable : moyenne ≤ maxAvg ET écart max-min ≤ maxGap. */
    maxAvg: number;                  // 1850
    maxGap: number;                  // 150
    /** Plafond individuel sur le MMR de référence. */
    maxPlayer: number;               // 1900
  } | null;
}

export interface CompetitionSchedule {
  /** Jours de compétition (dates ISO "YYYY-MM-DD", heure de début par jour). */
  days: Array<{ date: string; startsAt: string }>;   // startsAt "15:00"
  /**
   * Plan des phases : quelles rondes de quel bracket se jouent dans quelle
   * phase, dans l'ordre. Ajustable par l'admin (spec §2).
   */
  phasePlan: PhasePlanEntry[];
  generalCheckinMinutes: number;     // 20 (ouvre à 14h30)
  matchCheckinMinutes: number;       // 5
  scoreCounterMinutes: number;       // 3 : contre-saisie de l'autre équipe
}

export interface PhasePlanEntry {
  phase: number;                     // 1-based, ordre de lancement
  day: number;                       // 1-based, index dans schedule.days
  label: string;                     // "P2 — WR2 + LR1"
  rounds: Array<{ bracket: 'winners' | 'losers' | 'grand_final'; round: number }>;
}

// ── Inscriptions ────────────────────────────────────────────────────────────

/**
 * Collection `competition_registrations` — snapshot d'inscription.
 * Lecture : RULES DENY-ALL (MMR, âges, Discord IDs, notes de dérogation sur
 * mineurs). La liste publique « équipes inscrites » est servie par API
 * (nom/tag/logo/pseudos uniquement).
 */
export interface CompetitionRegistration {
  id: string;
  competitionId: string;
  circuitTeamId: string | null;    // rattachement circuit (résolution d'identité, archi §2)
  structureId: string;
  teamId: string;                  // sub_team Aedral d'origine du snapshot
  name: string;                    // nom d'équipe FIGÉ à l'inscription
  tag: string;
  logoUrl: string | null;
  captainUid: string;
  /** Dénormalisé pour les queries « inscriptions d'un joueur » (profile/history). */
  rosterUids: string[];
  roster: RegistrationRosterEntry[];
  /** Calculs serveur au moment de la soumission (drapeaux MMR, etc.). */
  computed: {
    worstLineupAvg: number | null;
    worstLineupGap: number | null;
    flags: RegistrationFlag[];
  };
  status: RegistrationStatus;
  review: {
    by: string;
    at: Date | string;
    reason: string | null;
    derogations: Array<{ uid: string; note: string }>;
  } | null;
  rulebookAccepted: { version: number; at: Date | string; byUid: string } | null;
  /** L'inscripteur était-il sur le serveur Discord de la compétition à la
   *  soumission (spec §7) — null si serveur non configuré / indéterminé. */
  createdByOnDiscordGuild?: boolean | null;
  /** Check-in général 14h30 (jour de match) — null tant que non ouvert. */
  generalCheckin: { done: boolean; byUid: string | null; at: Date | string | null } | null;
  /** Provisioning Discord découplé de l'approbation (archi §6), reprise idempotente. */
  discord: {
    provisioningStatus: 'none' | 'queued' | 'partial' | 'done' | 'error';
    roleId: string | null;
    textChannelId: string | null;
    voiceChannelId: string | null;
    /** Avertissements non bloquants du dernier passage (joueur absent du serveur…). */
    warnings?: string[];
    /** Message de la dernière erreur bloquante (statut `error`). */
    errorMessage?: string | null;
  };
  seed: number | null;
  createdBy: string;
  createdAt: Date | string;
}

export type RegistrationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'waitlisted'
  | 'withdrawn';

/**
 * Drapeaux levés par le serveur pour la file de validation. Les signalements
 * anti-smurf sont montrés en AGRÉGAT ANONYMISÉ dans la console (archi §7) —
 * jamais l'identité des signaleurs.
 */
export type RegistrationFlag =
  | 'mmr_avg_exceeded'        // une compo alignable dépasse la moyenne max
  | 'mmr_gap_exceeded'        // une compo alignable dépasse l'écart max
  | 'mmr_player_cap_exceeded' // un joueur dépasse le plafond individuel
  | 'underage'                // joueur sous l'âge minimum → dérogation requise
  | 'unverified_account'      // legacy — les comptes non vérifiés sont désormais REFUSÉS à la soumission (spec §3)
  | 'banned_player'           // joueur au registre des bans → refus auto + motif
  | 'banned_structure'        // structure au registre des bans
  | 'smurf_reports'           // signalements smurf existants (agrégat)
  | 'identity_conflict'       // rattachement circuit ambigu → arbitrage admin
  | 'name_mismatch'           // nom du snapshot ≠ nom du circuit_team
  | 'discord_guild_missing';  // joueur (ou inscripteur) absent du serveur Discord de la compétition

export interface RegistrationRosterEntry {
  uid: string;
  role: 'titulaire' | 'remplacant';
  displayName: string;
  declaredCurrentMmr: number;
  declaredPeakMmr: number;
  /** MMR de référence calculé serveur : weightCurrent × actuel + reste × peak. */
  refMmr: number;
  epicId: string | null;
  /** Pseudo Epic au moment de l'inscription (lisible, l'epicId est un GUID). */
  epicName: string | null;
  steamId: string | null;
  trackerUrl: string | null;
  discordId: string;
  /** Username Discord au moment de l'inscription (lisible console admin). */
  discordUsername: string | null;
  country: string | null;
  age: number | null;              // calculé serveur depuis user_secrets, dénormalisé ici
  verified: boolean;
  /** Présence sur le serveur Discord de la compétition, vérifiée par le bot à
   *  la soumission (spec §7) — null si le serveur n'était pas configuré. */
  onDiscordGuild: boolean | null;
}

// ── Matchs ──────────────────────────────────────────────────────────────────

/**
 * Collection `competition_matches` — lecture PUBLIQUE (bracket live onSnapshot).
 * AUCUN uid/snowflake ici : `participantUids` et les byUid de check-in vivent
 * dans les sous-collections privées `/private/acl` etc. (archi §2).
 */
export interface CompetitionMatch {
  id: string;
  competitionId: string;
  bracket: 'winners' | 'losers' | 'grand_final';
  round: number;
  slot: number;                    // position dans la ronde
  phase: number | null;            // rattachement au phasePlan
  bo: number;
  teamA: string | null;            // registrationId, null = TBD
  teamB: string | null;
  /**
   * Un côté « void » ne recevra JAMAIS d'équipe (bye de seeding, double forfait
   * en amont, slot de waitlist vide). Distinct de `teamA === null` (= TBD, une
   * équipe arrive plus tard). Fidèle au moteur pur (lib/tournament) pour
   * permettre la reconstruction exacte du bracket au Lot 3.
   */
  voidA: boolean;
  voidB: boolean;
  /**
   * Le score conventionnel d'un forfait compte-t-il dans les stats de départage
   * de chaque camp ? (forfait simple : oui des deux côtés ; cascade de retrait :
   * non pour le retiré). Fidèle au moteur.
   */
  statsCountA: boolean;
  statsCountB: boolean;
  /** Nom/tag/logo dénormalisés pour le rendu du bracket public en onSnapshot
   *  (le client ne peut pas lire `competition_registrations`, deny-all). Figés
   *  à l'inscription — jamais de donnée personnelle. Null si côté TBD/void. */
  teamAInfo: { name: string; tag: string; logoUrl: string | null } | null;
  teamBInfo: { name: string; tag: string; logoUrl: string | null } | null;
  sourceA: MatchSource;
  sourceB: MatchSource;
  status: MatchStatus;
  checkin: {
    openedAt: Date | string;
    deadline: Date | string;
    a: { done: boolean; at: Date | string | null };
    b: { done: boolean; at: Date | string | null };
  } | null;
  /** Créateur de la room = équipe du haut du bracket (spec §8). */
  roomHost: 'a' | 'b';
  scores: {
    a: number[];                   // buts par manche
    b: number[];
    aSubmittedAt: Date | string | null;
    bSubmittedAt: Date | string | null;
    counterDeadline: Date | string | null;  // +3 min après la 1re saisie complète
    final: Array<{ a: number; b: number }> | null;
    /** Qui a validé le score : 'auto' (concordance) | 'admin' (force-score).
     *  JAMAIS un uid — ce doc est en lecture PUBLIQUE (invariant §8) ;
     *  l'identité de l'admin est tracée dans admin_audit_logs. */
    validatedBy: 'auto' | 'admin' | null;
  };
  /** Buts marqués/encaissés — le délta seul ne suffit pas au départage (archi §2). */
  stats: {
    a: { goalsFor: number; goalsAgainst: number };
    b: { goalsFor: number; goalsAgainst: number };
  } | null;
  forfeit: {
    team: 'a' | 'b' | 'both';
    requestedAt: Date | string;
    /** 'admin' (validé) — JAMAIS un uid (doc public §8, admin dans audit log). */
    validatedBy: 'admin' | null;
    reason: string | null;
  } | null;
  dispute: {
    openedBy: 'a' | 'b' | 'admin' | 'auto';
    openedAt: Date | string;
    auto: boolean;                 // scores discordants = litige automatique
    /** 'admin' — JAMAIS un uid (doc public §8, admin tracé dans audit log). */
    resolvedBy: 'admin' | null;
    resolution: string | null;
  } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
  winner: 'a' | 'b' | null;
  updatedAt: Date | string;
}

export type MatchSource =
  | { type: 'seed'; ref: number }                    // seed direct (round 1)
  | { type: 'winner_of'; ref: string }               // matchId amont
  | { type: 'loser_of'; ref: string }
  | { type: 'bye'; ref: null };

export type MatchStatus =
  | 'pending'                      // équipes pas toutes connues ou phase non lancée
  | 'checkin'
  | 'ready'                        // 2 check-ins faits, room à créer
  | 'live'
  | 'awaiting_scores'
  | 'score_review'                 // 1 équipe a saisi, contre-saisie en cours (3 min)
  | 'disputed'
  | 'awaiting_forfeit_validation'  // pas de forfait automatique (spec §8)
  | 'completed'
  | 'walkover'                     // état terminal — adversaire d'un double forfait
  | 'cancelled';                   // état terminal — ex. reset non joué

// ── Bans & admins de compétition ────────────────────────────────────────────

/**
 * Collection `competition_bans` — registre des bans joueurs ET structures.
 * Lecture deny-all (servie via API admin compét). Consulté automatiquement à
 * l'inscription : refus auto + motif affiché (spec §5).
 */
export interface CompetitionBan {
  id: string;
  targetType: 'user' | 'structure';
  targetId: string;                // uid ou structureId
  targetLabel: string;             // displayName / nom structure au moment du ban
  reason: string;
  /** null = permanent. */
  expiresAt: Date | string | null;
  createdBy: string;
  createdAt: Date | string;
  /** Ban levé manuellement (on garde l'historique, jamais de delete). */
  revokedAt: Date | string | null;
  revokedBy: string | null;
}

/**
 * Collection `competition_admins` — rôle scopé compétitions uniquement,
 * distinct des admins Aedral complets (`aedral_admins`). Un admin Aedral
 * complet est AUTOMATIQUEMENT admin compétition (spec §6).
 * Doc id = uid. Nommés par un admin Aedral complet uniquement.
 */
export interface CompetitionAdmin {
  uid: string;
  displayName: string;             // dénormalisé pour la liste admin
  addedBy: string;
  addedAt: Date | string;
}

// ── Règlements ──────────────────────────────────────────────────────────────

/**
 * Collection `rulebooks` — règlement de compétition versionné (archi §2).
 * Lecture publique. Chaque modification archive la version précédente dans la
 * sous-collection `/versions/{n}` (traçabilité légale : prouver QUELLE version
 * une équipe a acceptée).
 */
export interface Rulebook {
  id: string;
  scope: { circuitId: string } | { competitionId: string };
  markdown: string;
  version: number;                 // incrémenté à chaque publication
  updatedAt: Date | string;
  updatedBy: string;
}
