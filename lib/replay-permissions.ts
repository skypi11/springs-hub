// Permissions replays, alignées sur le modèle event-permissions / member-role.
// Règle (Matt, 2026-04-19) : staff + capitaine peuvent uploader. Les joueurs simples
// ne poussent pas leurs replays eux-mêmes pour l'instant (itération future possible).
//
// - Upload   : dirigeant structure, manager/coach structure scopé sur le jeu de l'équipe,
//              staff de l'équipe, capitaine de l'équipe
// - Download : toute personne qui accède au calendrier de la structure (staff large + capitaine)
// - Delete   : uploader (son propre upload) OU dirigeant structure
//
// Multi-jeux (2026-05-30) : pour les structures multi-jeux, un responsable RL ne peut
// pas uploader sur une équipe Val, et inversement. Le scope est géré via les helpers
// `isStaffOfTeam` (qui couvre dirigeant + manager scopé) et `isCoachForTeam` (coach scopé).

import type { UserContext, TeamRef } from './event-permissions';
import { isDirigeant, isStaffOfTeam, isCoachForTeam, isCaptainOfTeam, canAccessCalendar } from './event-permissions';

export function canUploadReplay(ctx: UserContext, teamId: string): boolean {
  // isStaffOfTeam couvre : dirigeant + manager scopé sur le jeu de la team + staff explicite de la team.
  // isCoachForTeam couvre : coach structure scopé sur le jeu de la team.
  return isStaffOfTeam(ctx, teamId) || isCoachForTeam(ctx, teamId) || isCaptainOfTeam(ctx, teamId);
}

/**
 * LECTURE des stats déjà parsées d'un replay. Ne coûte AUCUN quota ballchasing
 * (≠ déclencher un parsing, cf. canTriggerParse). Périmètre : dirigeant, staff/
 * coach scopé sur le jeu de l'équipe, capitaine, OU joueur/remplaçant de
 * l'équipe. `team` (doc sub_teams) est requis pour trancher le cas joueur/sub.
 *
 * NB : NE réplique PAS exactement le droit de TÉLÉCHARGER — la route download a
 * en plus un repli « exercice replay_review » (un joueur d'une AUTRE équipe avec
 * un exo de review peut télécharger le fichier mais pas voir les stats ici). Écart
 * mineur assumé.
 */
export function canViewReplayStats(ctx: UserContext, teamId: string, team?: TeamRef | null): boolean {
  if (isDirigeant(ctx)) return true;
  if (isStaffOfTeam(ctx, teamId) || isCoachForTeam(ctx, teamId)) return true;
  if (isCaptainOfTeam(ctx, teamId)) return true;
  if (!team || !ctx.uid) return false;
  return (team.playerIds ?? []).includes(ctx.uid) || (team.subIds ?? []).includes(ctx.uid);
}

/**
 * DÉCLENCHEMENT d'un parsing ballchasing (forward). CONSOMME le quota hebdo de la
 * structure (20/semaine). Strictement réservé à ceux qui peuvent déjà uploader
 * (staff + capitaine) — JAMAIS un joueur simple, sinon un joueur pourrait cramer
 * le quota de la structure.
 */
export function canTriggerParse(ctx: UserContext, teamId: string): boolean {
  return canUploadReplay(ctx, teamId);
}

/**
 * Accès à la page stats d'un ÉVÉNEMENT (pas de teamId direct : on dérive de la
 * cible de l'event). Conserve l'accès staff/capitaine (canAccessCalendar) et
 * AJOUTE le joueur membre d'une des équipes ciblées (lecture seule).
 */
export function canViewEventReplayStats(
  ctx: UserContext,
  target: { scope: string; teamIds?: string[] },
  teams: TeamRef[],
): boolean {
  if (canAccessCalendar(ctx)) return true;
  if (target.scope !== 'teams') return false;
  return (target.teamIds ?? []).some(id => canViewReplayStats(ctx, id, teams.find(t => t.id === id)));
}

export function canDeleteReplay(ctx: UserContext, uploadedBy: string): boolean {
  if (ctx.uid && ctx.uid === uploadedBy) return true;
  return isDirigeant(ctx);
}
