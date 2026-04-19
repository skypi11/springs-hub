// Permissions replays — alignées sur le modèle event-permissions / member-role.
// Règle (Matt, 2026-04-19) : staff + capitaine peuvent uploader. Les joueurs simples
// ne poussent pas leurs replays eux-mêmes pour l'instant (itération future possible).
//
// - Upload   : dirigeant structure, manager/coach structure, staff de l'équipe, capitaine de l'équipe
// - Download : toute personne qui accède au calendrier de la structure (staff large + capitaine)
// - Delete   : uploader (son propre upload) OU dirigeant structure

import type { UserContext } from './event-permissions';
import { isDirigeant, isStaff, isStaffOfTeam, isCaptainOfTeam, canAccessCalendar } from './event-permissions';

export function canUploadReplay(ctx: UserContext, teamId: string): boolean {
  if (isStaff(ctx)) return true;
  return isStaffOfTeam(ctx, teamId) || isCaptainOfTeam(ctx, teamId);
}

export function canDownloadReplay(ctx: UserContext): boolean {
  return canAccessCalendar(ctx);
}

export function canDeleteReplay(ctx: UserContext, uploadedBy: string): boolean {
  if (ctx.uid && ctx.uid === uploadedBy) return true;
  return isDirigeant(ctx);
}
