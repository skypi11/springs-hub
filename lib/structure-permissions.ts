// ╔══════════════════════════════════════════════════════════════════════════╗
// ║   STRUCTURE PERMISSIONS — Source de vérité unique pour TOUTES les        ║
// ║   autorisations structure-level (gestion équipes, membres, recrutement,  ║
// ║   promotions, etc.).                                                     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// DESIGN INTENT (Matt 2026-05-25) :
//   Centraliser toutes les règles d'accès dans UN fichier avec une API claire
//   `canDoX(ctx, structure)`. Bénéfices :
//
//   1. Cohérence : impossible qu'un endpoint oublie un rôle (bug récent
//      cat_aran responsable qui ne voyait pas ses équipes).
//   2. Lisibilité : la matrice de droits par rôle est visible en un fichier.
//   3. Migration future facile : si un jour on passe à un système de
//      permissions custom façon Discord, on remplace l'implémentation interne
//      de ces fonctions — les 30 routes API qui les appellent ne bougent pas.
//
// CONVENTIONS :
//   - Toujours passer en input un `StructureContext` minimal (uid + champs
//     pertinents de la struct). Pas de Firestore I/O ici — fonctions pures.
//   - Préfixe `can*` pour les actions, `is*` pour les rôles bruts.
//   - Pour les actions liées à une équipe spécifique, utiliser
//     `lib/event-permissions.ts` (helpers team-level).
//
// MODÈLE A (validé) :
//   - Fondateur       : tout, sans exception
//   - Co-fondateur    : tout sauf delete struct, transfer, promotions staff
//   - Responsable     = bras droit. Gestion équipes/membres/invitations/recrutement
//                       complète. Pas de settings struct, pas de promotions.
//   - Coach           = staff mobile. Training/scrim sur toute équipe, todos,
//                       replays. Pas de gestion structurelle.

export interface StructureRoleData {
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  status?: string;
  /**
   * Scope par jeu pour les Responsables (managerIds).
   * - Clé : uid
   * - Valeur : liste des `gameId` (de la registry) où le user est responsable
   *
   * Sémantique :
   * - **Pas d'entrée** pour un uid présent dans `managerIds` → all-games
   *   (rétrocompat avec le système avant scope par jeu).
   * - **Liste vide []** → cas dégénéré, équivaut à pas responsable du tout.
   * - **Liste non vide** → responsable uniquement pour ces jeux.
   *
   * Ajouté 2026-05-27 pour scaler à N jeux (un Responsable RL ≠ Responsable Val).
   */
  managerGames?: Record<string, string[]>;
  /** Idem `managerGames` mais pour les coachs. Même sémantique (absence = all-games). */
  coachGames?: Record<string, string[]>;
}

// Contexte minimal : uid de l'user + état des rôles structure.
// On accepte aussi de passer la struct entière (StructureRoleData) — les
// fonctions extraient ce qu'il leur faut. Ça évite de faire 2 helpers par
// permission (un avec ctx, un avec struct).
export interface StructureContext {
  uid: string;
  structure: StructureRoleData;
}

// ─── Rôles bruts ──────────────────────────────────────────────────────────

export function isFounder(ctx: StructureContext): boolean {
  return !!ctx.uid && ctx.structure.founderId === ctx.uid;
}

export function isCoFounder(ctx: StructureContext): boolean {
  return !!ctx.uid && (ctx.structure.coFounderIds ?? []).includes(ctx.uid);
}

export function isDirigeant(ctx: StructureContext): boolean {
  return isFounder(ctx) || isCoFounder(ctx);
}

// Manager STRUCTURE (alias "Responsable" dans l'UI utilisateur, garde le nom
// `managerIds` en interne pour ne pas casser les écritures Firestore historiques).
export function isResponsable(ctx: StructureContext): boolean {
  return !!ctx.uid && (ctx.structure.managerIds ?? []).includes(ctx.uid);
}

export function isCoach(ctx: StructureContext): boolean {
  return !!ctx.uid && (ctx.structure.coachIds ?? []).includes(ctx.uid);
}

// ─── Rôles scopés par jeu (multi-jeux, 2026-05-27) ─────────────────────────
//
// Helpers pour la couche permissions scopée par jeu. Un Responsable RL n'a
// AUCUN droit sur les équipes Valorant si la structure a explicitement scopé
// son rôle via `managerGames[uid] = ['rocket_league']`.
//
// Sémantique d'absence (rétrocompat) :
//   - `managerGames` / `coachGames` ABSENT pour un uid présent dans la liste
//     plate → le user est responsable/coach pour TOUS les jeux. Garantit que
//     les structures existantes continuent à marcher sans migration de data.
//   - Liste vide [] → dégénéré, équivaut à pas responsable/coach.
//
// USAGE :
//   - Les helpers globaux `isResponsable(ctx)` / `isCoach(ctx)` restent inchangés
//     et retournent true SI le user est responsable/coach pour AU MOINS un jeu
//     (ou all-games en cas d'absence du scope).
//   - Les helpers scopés `isResponsableForGame(ctx, gameId)` / `isCoachForGame`
//     vérifient en plus que le user a bien la permission sur ce jeu précis.
//   - Pour les permissions `can*` team-level, préférer les variantes scopées
//     qui prennent un gameId optionnel (à brancher progressivement aux call
//     sites — voir TODO en fin de fichier).

/** Liste des jeux où l'user est responsable. `null` = all-games (rétrocompat). `[]` = aucun. */
export function getResponsableGames(ctx: StructureContext): string[] | null {
  if (!isResponsable(ctx)) return [];
  const scoped = ctx.structure.managerGames?.[ctx.uid];
  return Array.isArray(scoped) ? scoped : null;
}

/** Liste des jeux où l'user est coach. `null` = all-games (rétrocompat). `[]` = aucun. */
export function getCoachGames(ctx: StructureContext): string[] | null {
  if (!isCoach(ctx)) return [];
  const scoped = ctx.structure.coachGames?.[ctx.uid];
  return Array.isArray(scoped) ? scoped : null;
}

/** True si l'user est responsable de la structure pour le `gameId` donné. */
export function isResponsableForGame(ctx: StructureContext, gameId: string): boolean {
  if (!isResponsable(ctx)) return false;
  const games = getResponsableGames(ctx);
  return games === null ? true : games.includes(gameId);
}

/** True si l'user est coach de la structure pour le `gameId` donné. */
export function isCoachForGame(ctx: StructureContext, gameId: string): boolean {
  if (!isCoach(ctx)) return false;
  const games = getCoachGames(ctx);
  return games === null ? true : games.includes(gameId);
}

/** True si l'user est admin structure pour `gameId` (dirigeant OR responsable du jeu).
 *  Les dirigeants ne sont jamais scopés — ils gèrent toujours toute la structure. */
export function isStructureAdminForGame(ctx: StructureContext, gameId: string): boolean {
  return isDirigeant(ctx) || isResponsableForGame(ctx, gameId);
}

/** True si l'user a un rôle staff (dirigeant/responsable/coach) sur `gameId`. */
export function isStructureStaffForGame(ctx: StructureContext, gameId: string): boolean {
  return isStructureAdminForGame(ctx, gameId) || isCoachForGame(ctx, gameId);
}

// Admin structure : dirigeant OU responsable. Couvre la majorité des actions
// de gestion (équipes, membres, invitations, recrutement, calendrier).
export function isStructureAdmin(ctx: StructureContext): boolean {
  return isDirigeant(ctx) || isResponsable(ctx);
}

// Staff structure (large) : dirigeant + responsable + coach. Couvre les accès
// "consultation/animation" (calendrier, replays, audience staff).
export function isStructureStaff(ctx: StructureContext): boolean {
  return isStructureAdmin(ctx) || isCoach(ctx);
}

// ─── Helper transverse ────────────────────────────────────────────────────

// Une structure suspendue bloque toutes les actions de write — sauf lecture.
// À utiliser pour gater toutes les fonctions `can*` qui modifient l'état.
function isWritable(ctx: StructureContext): boolean {
  return ctx.structure.status !== 'suspended';
}

// ─── PERMISSIONS — Actions sur la structure elle-même ──────────────────────

// Modifier les settings structure (nom, logo, tag, description, bannière,
// Discord config, recrutement on/off, message public de recrutement).
// → Dirigeants UNIQUEMENT (responsable exclu : ce sont des décisions identitaires).
export function canEditStructureSettings(ctx: StructureContext): boolean {
  return isWritable(ctx) && isDirigeant(ctx);
}

// Supprimer la structure (irréversible).
export function canDeleteStructure(ctx: StructureContext): boolean {
  return isFounder(ctx); // Fondateur unique, même sur struct suspended.
}

// Transférer la propriété (changer fondateur).
export function canTransferOwnership(ctx: StructureContext): boolean {
  return isWritable(ctx) && isFounder(ctx);
}

// ─── PERMISSIONS — Équipes (sub_teams) ────────────────────────────────────

// Créer, modifier, archiver, reorder équipes. Le contenu d'une équipe
// (joueurs, staff, capitaine, logo, label, salon Discord) est inclus.
// → Admin structure (dirigeants + responsable). Modèle A.
export function canManageTeams(ctx: StructureContext): boolean {
  return isWritable(ctx) && isStructureAdmin(ctx);
}

// Supprimer une équipe (destructif).
// → Fondateur UNIQUEMENT.
export function canDeleteTeam(ctx: StructureContext): boolean {
  return isWritable(ctx) && isFounder(ctx);
}

// Modifier le label / groupOrder / jeu d'une équipe (changement structurant).
// → Dirigeants uniquement (responsable exclu).
export function canEditTeamLabel(ctx: StructureContext): boolean {
  return isWritable(ctx) && isDirigeant(ctx);
}

// ─── PERMISSIONS — Membres ────────────────────────────────────────────────

// Inviter joueurs (lien d'invitation, invitation directe), accepter/refuser
// les candidatures join_request, retirer un membre de la structure.
// → Admin structure.
export function canManageMembers(ctx: StructureContext): boolean {
  return isWritable(ctx) && isStructureAdmin(ctx);
}

// Voir et gérer toutes les invitations en attente de la structure.
// → Admin structure.
export function canViewInvitations(ctx: StructureContext): boolean {
  return isStructureAdmin(ctx);
}

// ─── PERMISSIONS — Recrutement ────────────────────────────────────────────

// Voir la shortlist, ajouter/retirer des joueurs prospectés, voir les
// suggestions de recrutement.
// → Admin structure.
export function canAccessRecruitment(ctx: StructureContext): boolean {
  return isStructureAdmin(ctx);
}

// Activer/désactiver le mode recrutement de la structure + message public.
// → Dirigeants uniquement.
export function canToggleRecruitment(ctx: StructureContext): boolean {
  return isWritable(ctx) && isDirigeant(ctx);
}

// ─── PERMISSIONS — Promotions / staff ────────────────────────────────────

// Promouvoir/rétrograder un Responsable (managerIds) ou un Coach (coachIds).
// → Dirigeants uniquement.
export function canPromoteStaff(ctx: StructureContext): boolean {
  return isWritable(ctx) && isDirigeant(ctx);
}

// Promouvoir/rétrograder un Co-fondateur (relation 2 étapes + préavis 7j).
// → Fondateur UNIQUEMENT.
export function canPromoteCoFounder(ctx: StructureContext): boolean {
  return isWritable(ctx) && isFounder(ctx);
}

// ─── PERMISSIONS — Documents staff ────────────────────────────────────────

// Accès aux documents staff (contrats, docs sensibles).
// → Dirigeants UNIQUEMENT (responsable exclu pour la confidentialité).
export function canAccessDocuments(ctx: StructureContext): boolean {
  return isDirigeant(ctx);
}

// ─── PERMISSIONS — Calendrier (vue) ──────────────────────────────────────

// Voir la section calendrier dans le dashboard de structure.
// Les actions sur les événements eux-mêmes sont gérées par `lib/event-permissions.ts`
// (qui dépend de la team-level membership en plus du structure-level).
// → Staff structure large (dirigeants + responsable + coach) + capitaines
//   (ces derniers via le contexte event-permissions).
export function canAccessCalendarSection(ctx: StructureContext): boolean {
  return isStructureStaff(ctx);
}

// ─── HELPERS de conversion ────────────────────────────────────────────────

// Construit un StructureContext depuis les params bruts les plus courants.
// Utile dans les routes API qui font le `db.collection('structures').doc(id).get()`.
export function structureContext(uid: string, structure: StructureRoleData): StructureContext {
  return { uid, structure };
}

// ─── PERMISSIONS scopées par jeu (2026-05-27) ─────────────────────────────
//
// Variantes des `can*` qui prennent un `gameId` optionnel. Quand le gameId est
// fourni, le check applique le scope `managerGames` / `coachGames`. Sans
// gameId, comportement identique aux helpers historiques (rétrocompat).
//
// 🚧 PLAN DE MIGRATION (futur) — pour éviter la PR géante en une fois :
//
//   Étape 1 (faite maintenant)  Poser le socle technique :
//                               - Types managerGames / coachGames
//                               - Helpers getResponsableGames / getCoachGames
//                               - Variantes ForGame des `is*`
//                               - canManageEventsForGame / canManageTodosForGame
//   Étape 2 (UI Settings)       Page /settings/struct ou /admin members :
//                               sélecteur de jeux pour chaque manager/coach
//                               (ajoute/edit managerGames[uid] / coachGames[uid]).
//   Étape 3 (Migration call sites) Brancher progressivement les routes API events,
//                                  todos, replays pour utiliser les ForGame
//                                  variants. Chaque route migrée gagne le scope.
//   Étape 4 (Default to scope) Quand toutes les routes sont migrées et que
//                              les structures multi-jeux ont configuré leurs
//                              scopes, on peut considérer le all-games (null)
//                              comme dépréciation douce.
//
// Pendant l'étape 1-3 : les structures actuelles continuent à fonctionner
// EXACTEMENT comme avant (aucune migration de data nécessaire — l'absence de
// `managerGames`/`coachGames` est interprétée comme all-games).

/** Variante scopée de canManageTeams. Si gameId non fourni → comportement legacy. */
export function canManageTeamsForGame(ctx: StructureContext, gameId?: string): boolean {
  if (!isWritable(ctx)) return false;
  if (!gameId) return isStructureAdmin(ctx);
  return isStructureAdminForGame(ctx, gameId);
}

/** Variante scopée pour la gestion des événements (training/scrim/match). */
export function canManageEventsForGame(ctx: StructureContext, gameId?: string): boolean {
  if (!isWritable(ctx)) return false;
  // Events : staff structure (admin OR coach). Modèle A.
  if (!gameId) return isStructureStaff(ctx);
  return isStructureStaffForGame(ctx, gameId);
}

/** Variante scopée pour la gestion des exercices (todos) sur une équipe. */
export function canManageTodosForGame(ctx: StructureContext, gameId?: string): boolean {
  if (!isWritable(ctx)) return false;
  // Todos : staff structure (admin OR coach). Modèle A.
  if (!gameId) return isStructureStaff(ctx);
  return isStructureStaffForGame(ctx, gameId);
}
