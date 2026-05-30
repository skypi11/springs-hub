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

import type { UserContext } from './event-permissions';
import { isDirigeant, isStaffOfTeam, isCoachForTeam, isCaptainOfTeam, canAccessCalendar } from './event-permissions';

export function canUploadReplay(ctx: UserContext, teamId: string): boolean {
  // isStaffOfTeam couvre : dirigeant + manager scopé sur le jeu de la team + staff explicite de la team.
  // isCoachForTeam couvre : coach structure scopé sur le jeu de la team.
  return isStaffOfTeam(ctx, teamId) || isCoachForTeam(ctx, teamId) || isCaptainOfTeam(ctx, teamId);
}

export function canDownloadReplay(ctx: UserContext): boolean {
  return canAccessCalendar(ctx);
}

export function canDeleteReplay(ctx: UserContext, uploadedBy: string): boolean {
  if (ctx.uid && ctx.uid === uploadedBy) return true;
  return isDirigeant(ctx);
}
