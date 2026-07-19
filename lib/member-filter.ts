// Helpers PURS pour la recherche/tri de l'onglet Membres (côté client, ~150
// membres max → tout se fait en mémoire, pas de pagination). Sortis du composant
// pour être testés unitairement (env node).

import type { PrimaryRole } from './member-role';

export type MemberGroup = 'all' | 'direction' | 'staff' | 'joueurs';
export type MemberSort = 'role' | 'name' | 'recent';

// Regroupement des 9 rôles dérivés en 3 familles filtrables. À ~150 membres,
// 3 groupes suffisent (9 chips satureraient la barre d'outils).
const GROUP_OF: Record<PrimaryRole, Exclude<MemberGroup, 'all'>> = {
  fondateur: 'direction',
  co_fondateur: 'direction',
  responsable: 'direction',
  coach_structure: 'staff',
  manager_equipe: 'staff',
  coach_equipe: 'staff',
  capitaine: 'staff',
  joueur: 'joueurs',
  membre: 'joueurs',
};

export function memberGroupOf(primary: PrimaryRole): Exclude<MemberGroup, 'all'> {
  return GROUP_OF[primary];
}

/**
 * Un membre a-t-il vocation à apparaître dans la bannière « SANS ÉQUIPE »
 * (recrues à placer) ? NON s'il fait partie du staff structurel (fondateur,
 * co-fondateur, responsable, coach structure) — il n'a pas à être « placé » —
 * ou s'il est déjà assigné à une équipe active. Bug remonté : un responsable
 * polluait la bannière.
 */
export function isPlaceableMember(
  userId: string,
  structuralStaffUids: ReadonlySet<string>,
  assignedUids: ReadonlySet<string>,
): boolean {
  return !structuralStaffUids.has(userId) && !assignedUids.has(userId);
}

// Forme minimale attendue par le filtre/tri. `roleOrder` = index dans
// PRIMARY_ROLE_ORDER, fourni par l'appelant (garde le helper agnostique de
// l'emplacement de la constante) ; `teamNames` = noms d'équipes pour la recherche.
export interface FilterableMember {
  displayName: string;
  discordUsername: string;
  joinedAt?: number | null;
  primary: PrimaryRole;
  roleOrder: number;
  teamNames: string[];
}

/**
 * Filtre (recherche texte + groupe de rôle) puis trie une liste de membres.
 * Ne mute pas l'entrée. Recherche insensible à la casse sur pseudo, pseudo
 * Discord et noms d'équipes.
 */
export function filterSortMembers<T extends FilterableMember>(
  items: T[],
  opts: { q: string; group: MemberGroup; sort: MemberSort },
): T[] {
  const q = opts.q.trim().toLowerCase();

  const filtered = items.filter((it) => {
    if (opts.group !== 'all' && memberGroupOf(it.primary) !== opts.group) return false;
    if (!q) return true;
    return (
      it.displayName.toLowerCase().includes(q) ||
      it.discordUsername.toLowerCase().includes(q) ||
      it.teamNames.some((n) => n.toLowerCase().includes(q))
    );
  });

  const sorted = [...filtered];
  if (opts.sort === 'name') {
    sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }));
  } else if (opts.sort === 'recent') {
    sorted.sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0));
  } else {
    // 'role' — l'ordre hiérarchique par défaut (comportement historique de l'onglet).
    sorted.sort((a, b) => a.roleOrder - b.roleOrder);
  }
  return sorted;
}
