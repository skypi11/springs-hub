// Permissions documents staff — accès STRICTEMENT réservé au fondateur et cofondateurs.
// Les responsables/coachs/joueurs n'y ont pas accès (contrats, docs sensibles).
//
// Garde une signature UserContext (event-permissions) pour compat avec
// l'existant. La règle est identique à `structure-permissions.canAccessDocuments`.

import type { UserContext } from './event-permissions';
import { isDirigeant } from './event-permissions';

export function canAccessDocuments(ctx: UserContext): boolean {
  return isDirigeant(ctx);
}
