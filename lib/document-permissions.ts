// Permissions documents staff — accès STRICTEMENT réservé au fondateur et cofondateurs.
// Les managers/coachs/joueurs n'y ont pas accès (contrats, docs sensibles).

import type { UserContext } from './event-permissions';
import { isDirigeant } from './event-permissions';

export function canAccessDocuments(ctx: UserContext): boolean {
  return isDirigeant(ctx);
}
