// Helpers purs pour les permissions autour des événements du calendrier d'une structure.
// Pas d'accès Firestore ici, toute la logique métier testable en isolation.
//
// Vocabulaire :
// - "dirigeant" = fondateur ou co-fondateur
// - "staff" = dirigeant, manager ou coach (n'importe quel niveau)
// - "staff d'une équipe" = dirigeant OU membre du staff rattaché à cette équipe (sub_teams.staffIds)

export type EventType = 'training' | 'scrim' | 'match' | 'tournoi' | 'autre';
export type EventScope = 'structure' | 'teams' | 'game' | 'staff';
export type EventStatus = 'scheduled' | 'done' | 'cancelled';
export type PresenceStatus = 'present' | 'absent' | 'maybe' | 'pending';

export const EVENT_TYPES: EventType[] = ['training', 'scrim', 'match', 'tournoi', 'autre'];

// Rétrocompat : l'ancien type 'springs' (events Springs E-Sport) est devenu le
// type générique 'tournoi'. On normalise à la lecture, aucune migration des
// documents Firestore déjà créés n'est nécessaire.
export function normalizeEventType(raw: unknown): EventType {
  if (raw === 'springs') return 'tournoi';
  if (raw === 'training' || raw === 'scrim' || raw === 'match' || raw === 'tournoi' || raw === 'autre') {
    return raw;
  }
  return 'autre';
}

export interface EventTarget {
  scope: EventScope;
  teamIds?: string[];
  game?: string;
  // Sous-sélection de joueurs.
  // - scope='teams' avec UNE équipe : feuille de match (filtre le roster).
  // - scope='staff' : liste explicite des membres du staff invités (obligatoire,
  //   sélection par user dans le formulaire, groupée par rôle côté UI).
  userIds?: string[];
}

export interface EventRef {
  createdBy: string;
  target: EventTarget;
  status: EventStatus;
}

// Contexte de l'utilisateur courant, dérivé de la structure + structure_members + sub_teams.
// Les booléens dirigeant/manager/coach couvrent la structure entière ;
// staffedTeamIds liste les sub_teams où l'user figure dans staffIds ;
// captainOfTeamIds liste les sub_teams dont il est captainId (une seule normalement,
// mais typé en array par précaution).
export interface UserContext {
  uid: string;
  isFounder: boolean;
  isCoFounder: boolean;
  isManager: boolean;
  isCoach: boolean;
  staffedTeamIds: string[];
  captainOfTeamIds?: string[];
  /**
   * Scope par jeu pour les rôles structure-wide (multi-jeux, 2026-05-27).
   * - `null` ou absent → all-games rétrocompat (rôle actif sur tous les jeux)
   * - liste non vide → rôle actif uniquement sur ces gameIds
   * - liste vide `[]` → dégénéré (équivaut à pas avoir le rôle pour aucun jeu)
   *
   * Utilisé conjointement avec `teamGames` ci-dessous : quand un helper
   * vérifie `isStaffOfTeam(ctx, teamId)`, il regarde le game de cette team
   * (via teamGames) et applique le scope si défini.
   */
  managerGames?: string[] | null;
  coachGames?: string[] | null;
  /** Map teamId → game (rocket_league, valorant…) pour appliquer le scope. */
  teamGames?: Record<string, string>;
}

export interface MemberRef {
  userId: string;
  game?: string;
}

export interface TeamRef {
  id: string;
  playerIds?: string[];
  subIds?: string[];
  staffIds?: string[];
}

// ---------- Rôles de base ----------

export function isDirigeant(ctx: UserContext): boolean {
  return !!ctx.uid && (ctx.isFounder || ctx.isCoFounder);
}

export function isStaff(ctx: UserContext): boolean {
  return isDirigeant(ctx) || ctx.isManager || ctx.isCoach;
}

// Vrai si l'utilisateur a un rôle staff structure OU s'il est staff d'au moins
// une équipe (coach d'équipe enregistré dans sub_teams.staffIds).
// À utiliser pour l'accès aux features transverses (templates de exercices, etc.)
// qu'un coach d'équipe doit pouvoir exploiter sans être coach au niveau structure.
export function hasAnyStaffAccess(ctx: UserContext): boolean {
  return isStaff(ctx) || ctx.staffedTeamIds.length > 0;
}

// Modèle A (validé Matt 2026-05-24) : "Responsable = bras droit" → un user dans
// structures.managerIds[] est considéré comme staff de TOUTES les équipes de la
// structure, exactement comme un dirigeant. Ça lui ouvre create event tous types
// sur toute équipe, todos, modif présence, etc., cohérent avec le fait qu'il
// peut déjà créer/modifier les équipes elles-mêmes via checkStructureAccess.
//
// Le Coach structure (coachIds) reste géré séparément avec des règles plus
// restrictives (training/scrim uniquement via canCreateEvent, todos via check
// dédié dans la route todos).
//
// 2026-05-27 : multi-jeux. Si ctx.managerGames/coachGames est défini (liste),
// le rôle structure n'est actif que pour les jeux listés. On vérifie le game
// de la team via ctx.teamGames[teamId]. Si teamGames absent → rétrocompat
// all-games (comportement identique à avant).

/** Vrai si l'user est manager de la structure pour le jeu de cette team. */
function isManagerForTeam(ctx: UserContext, teamId: string): boolean {
  if (!ctx.isManager) return false;
  if (ctx.managerGames == null) return true; // all-games rétrocompat
  const teamGame = ctx.teamGames?.[teamId];
  if (!teamGame) return true; // game inconnu = fallback permissif (don't break legacy)
  return ctx.managerGames.includes(teamGame);
}

/** Vrai si l'user est coach de la structure pour le jeu de cette team. */
function isCoachForTeam(ctx: UserContext, teamId: string): boolean {
  if (!ctx.isCoach) return false;
  if (ctx.coachGames == null) return true; // all-games rétrocompat
  const teamGame = ctx.teamGames?.[teamId];
  if (!teamGame) return true;
  return ctx.coachGames.includes(teamGame);
}

export function isStaffOfTeam(ctx: UserContext, teamId: string): boolean {
  if (isDirigeant(ctx)) return true;
  // Modèle A : manager structure = staff de toute team. Multi-jeux : scopé
  // si ctx.managerGames est défini (uniquement les jeux listés).
  if (isManagerForTeam(ctx, teamId)) return true;
  return !!teamId && ctx.staffedTeamIds.includes(teamId);
}

// Note : isStaffOfAllTeams / isStaffOfAnyTeam ont une sémantique stricte
// "membre de staffIds de toutes/au moins une", indépendante du modèle A.
// On NE rajoute PAS le check manager structure-wide ici pour ne pas casser
// les call sites qui s'attendent à la sémantique team-level pure.
// Les call sites qui veulent la sémantique "peut agir comme staff sur N teams"
// doivent boucler sur isStaffOfTeam(ctx, id) eux-mêmes.

export function isStaffOfAllTeams(ctx: UserContext, teamIds: string[]): boolean {
  if (isDirigeant(ctx)) return true;
  if (teamIds.length === 0) return false;
  return teamIds.every(id => ctx.staffedTeamIds.includes(id));
}

export function isStaffOfAnyTeam(ctx: UserContext, teamIds: string[]): boolean {
  if (isDirigeant(ctx)) return true;
  return teamIds.some(id => ctx.staffedTeamIds.includes(id));
}

// Exports pour les call sites qui veulent check explicitement le scope par jeu.
export { isCoachForTeam, isManagerForTeam };

// ---------- Capitaine d'équipe ----------
// Le capitaine est un joueur désigné par le fondateur pour gérer le calendrier
// de son équipe quand il n'y a pas de staff rattaché. Périmètre LIMITÉ :
// - peut créer/éditer des événements pour SON équipe uniquement
// - NE peut PAS modifier le roster (titulaires/remplaçants/staff)
// - NE peut PAS archiver/supprimer l'équipe

export function isCaptainOfTeam(ctx: UserContext, teamId: string): boolean {
  if (!teamId) return false;
  return (ctx.captainOfTeamIds ?? []).includes(teamId);
}

export function isCaptainOfAnyTeam(ctx: UserContext, teamIds: string[]): boolean {
  const caps = ctx.captainOfTeamIds ?? [];
  return teamIds.some(id => caps.includes(id));
}

// Est-ce un "gestionnaire" d'une équipe (staff OU capitaine), pour décider
// de l'accès aux actions calendrier uniquement.
export function isTeamEventManager(ctx: UserContext, teamId: string): boolean {
  return isStaffOfTeam(ctx, teamId) || isCaptainOfTeam(ctx, teamId);
}

// ---------- Accès au calendrier ----------

// Qui voit la section CALENDRIER dans le dashboard de structure : tout le staff
// + les capitaines (pour gérer le calendrier de leur équipe).
// Les joueurs simples ne gèrent pas d'événements ; ils voient leurs invitations via /calendar.
export function canAccessCalendar(ctx: UserContext): boolean {
  if (isStaff(ctx)) return true;
  return (ctx.captainOfTeamIds ?? []).length > 0;
}

// ---------- Création ----------

// - structure : dirigeants only
// - game      : dirigeants only (affecte toute la structure)
// - staff     : dirigeants + managers (les coachs sont prestataires,
//              ils n'organisent pas de réunions de direction)
// - teams     : dirigeants OU staff/capitaine de TOUTES les équipes ciblées
//              OU coach structure (uniquement pour training/scrim sur n'importe
//              quelle équipe, coach mobile rémunéré par la structure)
export function canCreateEvent(ctx: UserContext, target: EventTarget, type?: EventType): boolean {
  if (target.scope === 'structure') return isDirigeant(ctx);
  if (target.scope === 'game') return isDirigeant(ctx);
  if (target.scope === 'staff') return isDirigeant(ctx) || ctx.isManager;
  if (target.scope === 'teams') {
    const teamIds = target.teamIds ?? [];
    if (teamIds.length === 0) return false;
    if (isDirigeant(ctx)) return true;
    // Staff / capitaine de TOUTES les équipes ciblées → OK pour tout type
    if (teamIds.every(id => isStaffOfTeam(ctx, id) || isCaptainOfTeam(ctx, id))) {
      return true;
    }
    // Coach structure (coachIds) : intervient à la demande sur n'importe quelle
    // équipe, mais uniquement pour des entraînements / scrims, pas de match officiel
    // ni d'événement Springs (ceux-là restent dirigeants).
    // Multi-jeux : le coach scopé n'a accès qu'aux équipes des jeux listés
    // dans ctx.coachGames (null = all-games rétrocompat).
    if (ctx.isCoach && type && (type === 'training' || type === 'scrim')) {
      if (teamIds.every(id => isCoachForTeam(ctx, id))) {
        return true;
      }
    }
    return false;
  }
  return false;
}

// ---------- Édition / cycle de vie ----------

// Éditer un événement (titre, dates, description, compte rendu, à travailler, adversaire, résultat).
// Autorisé pour : créateur, dirigeants, staff ou capitaine d'au moins une équipe ciblée (si scope=teams),
// ou manager (si scope=staff, mêmes droits que la création).
export function canEditEvent(ctx: UserContext, event: EventRef): boolean {
  if (!ctx.uid) return false;
  if (event.createdBy === ctx.uid) return true;
  if (isDirigeant(ctx)) return true;
  if (event.target.scope === 'teams') {
    const teamIds = event.target.teamIds ?? [];
    if (isStaffOfAnyTeam(ctx, teamIds)) return true;
    if (isCaptainOfAnyTeam(ctx, teamIds)) return true;
  }
  if (event.target.scope === 'staff' && ctx.isManager) return true;
  return false;
}

// Marquer comme terminé / annulé / rouvrir : mêmes règles que l'édition.
export function canMarkTerminated(ctx: UserContext, event: EventRef): boolean {
  return canEditEvent(ctx, event);
}

export function canCancelEvent(ctx: UserContext, event: EventRef): boolean {
  return canEditEvent(ctx, event);
}

// Supprimer : dirigeants uniquement (destructif, pas de trace).
// Le créateur qui n'est pas dirigeant doit passer par "annuler" pour garder l'historique.
export function canDeleteEvent(ctx: UserContext, event: EventRef): boolean {
  void event;
  return isDirigeant(ctx);
}

// ---------- Présences ----------

// Répondre à sa propre présence : il faut être invité à l'événement.
// L'appelant doit avoir calculé isInvited via getInvitedUserIds au préalable.
export function canRespondToPresence(
  ctx: UserContext,
  event: EventRef,
  isInvited: boolean
): boolean {
  if (!ctx.uid) return false;
  if (event.status === 'cancelled') return false;
  if (event.status === 'done') return false;
  return isInvited;
}

// Modifier la présence de quelqu'un d'autre : le staff peut corriger pour ses joueurs.
// - dirigeants : oui sur tous les événements
// - manager/coach/capitaine : oui si event.scope=teams ET rattaché (staff ou capitaine) à une équipe ciblée
// - scope=staff : dirigeants + managers (gestion interne staff)
// - scope=structure ou scope=game : dirigeants uniquement
export function canModifyOthersPresence(ctx: UserContext, event: EventRef): boolean {
  if (isDirigeant(ctx)) return true;
  if (event.target.scope === 'staff') return ctx.isManager;
  if (event.target.scope !== 'teams') return false;
  const teamIds = event.target.teamIds ?? [];
  if (isStaffOfAnyTeam(ctx, teamIds)) return true;
  if (isCaptainOfAnyTeam(ctx, teamIds)) return true;
  return false;
}

// ---------- Liste des invités ----------

// "Audience staff" = pool autorisé pour les événements scope='staff', groupé par
// rôle pour le picker UI. Inclut à la fois les rôles structure et les rôles
// d'équipe (sub_teams.staffRoles). Un user peut apparaître dans plusieurs groupes
// si ses rôles se chevauchent (ex : co-fondateur + manager d'équipe) ; le picker
// UI peut alors le dédupliquer ou l'afficher dans son rôle le plus haut.
export interface StaffAudience {
  dirigeantIds: string[];   // founderId + coFounderIds
  managerIds: string[];     // structure.managerIds ∪ team staff role='manager'
  coachIds: string[];       // structure.coachIds ∪ team staff role='coach'
  captainIds: string[];     // sub_teams.captainId, un joueur capitaine peut être
                            // invité à une réunion staff au cas par cas (ex: brief
                            // capitaines avant tournoi). Validé Matt 2026-05-25.
}

// Union déduplicée de tous les uid présents dans l'audience staff.
export function getAllStaffAudienceIds(audience: StaffAudience): string[] {
  const set = new Set<string>();
  for (const id of audience.dirigeantIds) if (id) set.add(id);
  for (const id of audience.managerIds) if (id) set.add(id);
  for (const id of audience.coachIds) if (id) set.add(id);
  for (const id of audience.captainIds) if (id) set.add(id);
  return Array.from(set);
}

// Calcule la liste des uid invités à un événement selon sa cible.
// - structure : tous les membres de la structure (déduplique les users multi-jeux)
// - game      : membres dont le game correspond
// - teams     : players + subs + staff de chaque équipe ciblée
// - staff     : UNIQUEMENT les uid listés dans target.userIds, filtrés pour ne
//              garder que ceux qui ont effectivement un rôle staff structure.
export function getInvitedUserIds(
  target: EventTarget,
  allMembers: MemberRef[],
  allTeams: TeamRef[],
  staffAudience?: StaffAudience
): string[] {
  const set = new Set<string>();

  if (target.scope === 'structure') {
    for (const m of allMembers) {
      if (m.userId) set.add(m.userId);
    }
  } else if (target.scope === 'game') {
    if (!target.game) return [];
    for (const m of allMembers) {
      if (m.userId && m.game === target.game) set.add(m.userId);
    }
  } else if (target.scope === 'teams') {
    const teamIds = new Set(target.teamIds ?? []);
    for (const t of allTeams) {
      if (!teamIds.has(t.id)) continue;
      for (const id of t.playerIds ?? []) if (id) set.add(id);
      for (const id of t.subIds ?? []) if (id) set.add(id);
      for (const id of t.staffIds ?? []) if (id) set.add(id);
    }
  } else if (target.scope === 'staff') {
    // Pool autorisé = audience staff complète (dirigeants + managers + coachs,
    // structure & équipe). userIds obligatoire pour scope=staff.
    if (!staffAudience) return [];
    const allStaff = new Set(getAllStaffAudienceIds(staffAudience));
    const picked = Array.isArray(target.userIds) ? target.userIds : [];
    for (const uid of picked) {
      if (uid && allStaff.has(uid)) set.add(uid);
    }
    return Array.from(set);
  }

  // Filtre "feuille de match" : si target.userIds est fourni, on restreint la
  // liste aux uid qui sont ET dans le scope ET dans la sous-sélection. Empêche
  // d'inviter un joueur qui n'est pas dans l'équipe ciblée.
  if (Array.isArray(target.userIds) && target.userIds.length > 0) {
    const keep = new Set(target.userIds);
    return Array.from(set).filter(uid => keep.has(uid));
  }

  return Array.from(set);
}

// ---------- Validation d'une cible ----------

// Vérifie qu'une cible est bien formée avant de l'écrire en base.
export function validateEventTarget(target: EventTarget): { ok: true } | { ok: false; error: string } {
  if (target.scope === 'structure') {
    return { ok: true };
  }
  if (target.scope === 'game') {
    if (!target.game) return { ok: false, error: 'Le jeu est obligatoire pour un événement scope=game.' };
    return { ok: true };
  }
  if (target.scope === 'teams') {
    const ids = target.teamIds ?? [];
    if (ids.length === 0) return { ok: false, error: 'Au moins une équipe doit être ciblée.' };
    if (target.userIds !== undefined) {
      if (!Array.isArray(target.userIds)) return { ok: false, error: 'userIds invalide.' };
      if (target.userIds.some(id => typeof id !== 'string' || !id)) {
        return { ok: false, error: 'userIds invalide.' };
      }
      // La sous-sélection par joueur n'a de sens que sur UNE équipe (feuille de match).
      if (target.userIds.length > 0 && ids.length !== 1) {
        return { ok: false, error: 'La sélection de joueurs n\u2019est possible que sur une seule équipe.' };
      }
    }
    return { ok: true };
  }
  if (target.scope === 'staff') {
    if (!Array.isArray(target.userIds) || target.userIds.length === 0) {
      return { ok: false, error: 'Au moins un membre du staff doit être invité.' };
    }
    if (target.userIds.some(id => typeof id !== 'string' || !id)) {
      return { ok: false, error: 'userIds invalide.' };
    }
    return { ok: true };
  }
  return { ok: false, error: 'Scope invalide.' };
}
