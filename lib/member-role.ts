// Dérive le rôle affiché d'un membre d'une structure à partir de son
// implication réelle (fondation, responsabilités structure, affectations d'équipe).
//
// Principe : on ne stocke PAS le rôle dérivé. `structure_members.role` reste
// un champ informatif à l'inscription ; la vérité d'affichage vient de ce helper
// à chaque lecture, ce qui rend impossible toute désync.
//
// Hiérarchie de priorité pour le `primary` (ce qui s'affiche comme label principal) :
//   Fondateur > Co-fondateur > Responsable (structure)
//   > Manager d'équipe > Coach d'équipe > Capitaine > Joueur > Membre

export type PrimaryRole =
  | 'fondateur'
  | 'co_fondateur'
  | 'responsable'
  | 'manager_equipe'
  | 'coach_equipe'
  | 'capitaine'
  | 'joueur'
  | 'membre';

export type TeamAffiliationRole = 'joueur' | 'remplacant' | 'coach' | 'manager' | 'capitaine';

export interface TeamAffiliation {
  teamId: string;
  teamName: string;
  role: TeamAffiliationRole;
}

export interface MemberRoleTeam {
  id: string;
  name: string;
  playerIds?: string[];
  subIds?: string[];
  staffIds?: string[];
  // Sous-rôle du staff par uid. Si absent ou uid non listé, on retombe sur 'coach' par défaut
  // (compat avec les équipes créées avant l'ajout du sous-rôle).
  staffRoles?: Record<string, 'coach' | 'manager'>;
  captainId?: string | null;
  status?: 'active' | 'archived';
}

export interface MemberRoleInput {
  userId: string;
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  teams: MemberRoleTeam[];
  // Si vrai, on inclut les équipes archivées dans le calcul des affectations.
  // Par défaut on ignore les équipes archivées pour l'affichage du rôle courant.
  includeArchived?: boolean;
}

export interface MemberRoleResult {
  primary: PrimaryRole;
  affiliations: TeamAffiliation[];
}

export const PRIMARY_ROLE_LABELS: Record<PrimaryRole, string> = {
  fondateur: 'Fondateur',
  co_fondateur: 'Co-fondateur',
  responsable: 'Responsable',
  manager_equipe: "Manager d'équipe",
  coach_equipe: 'Coach',
  capitaine: 'Capitaine',
  joueur: 'Joueur',
  membre: 'Membre',
};

export function computeMemberRole(input: MemberRoleInput): MemberRoleResult {
  const {
    userId,
    founderId,
    coFounderIds = [],
    managerIds = [],
    coachIds = [],
    teams,
    includeArchived = false,
  } = input;

  const affiliations: TeamAffiliation[] = [];
  for (const t of teams) {
    if (!includeArchived && t.status === 'archived') continue;
    const isPlayer = (t.playerIds ?? []).includes(userId);
    const isSub = (t.subIds ?? []).includes(userId);
    const isStaff = (t.staffIds ?? []).includes(userId);
    const isCaptain = t.captainId === userId;
    const staffRole: 'coach' | 'manager' =
      (t.staffRoles?.[userId] as 'coach' | 'manager' | undefined) ?? 'coach';

    if (isStaff) {
      affiliations.push({ teamId: t.id, teamName: t.name, role: staffRole });
    }
    if (isCaptain) {
      affiliations.push({ teamId: t.id, teamName: t.name, role: 'capitaine' });
    }
    if (isPlayer) {
      affiliations.push({ teamId: t.id, teamName: t.name, role: 'joueur' });
    } else if (isSub) {
      affiliations.push({ teamId: t.id, teamName: t.name, role: 'remplacant' });
    }
  }

  let primary: PrimaryRole;
  if (userId === founderId) {
    primary = 'fondateur';
  } else if (coFounderIds.includes(userId)) {
    primary = 'co_fondateur';
  } else if (managerIds.includes(userId)) {
    primary = 'responsable';
  } else if (affiliations.some(a => a.role === 'manager')) {
    primary = 'manager_equipe';
  } else if (affiliations.some(a => a.role === 'coach') || coachIds.includes(userId)) {
    primary = 'coach_equipe';
  } else if (affiliations.some(a => a.role === 'capitaine')) {
    primary = 'capitaine';
  } else if (affiliations.some(a => a.role === 'joueur' || a.role === 'remplacant')) {
    primary = 'joueur';
  } else {
    primary = 'membre';
  }

  return { primary, affiliations };
}

// Utilitaires de présentation — gardés ici pour qu'ils soient testables et
// partagés entre les pages privée (my-structure) et publique (structure/[id]).

export interface AffiliationBadge {
  key: string;
  label: string;
  teamNames: string[];
}

// Regroupe les affiliations par rôle pour un affichage compact :
// "Manager · Elite 1, Academy A" au lieu de deux badges séparés.
export function groupAffiliations(affiliations: TeamAffiliation[]): AffiliationBadge[] {
  const order: TeamAffiliationRole[] = ['manager', 'coach', 'capitaine', 'joueur', 'remplacant'];
  const labels: Record<TeamAffiliationRole, string> = {
    manager: 'Manager',
    coach: 'Coach',
    capitaine: 'Capitaine',
    joueur: 'Joueur',
    remplacant: 'Remplaçant',
  };
  const byRole = new Map<TeamAffiliationRole, string[]>();
  for (const a of affiliations) {
    if (!byRole.has(a.role)) byRole.set(a.role, []);
    byRole.get(a.role)!.push(a.teamName);
  }
  return order
    .filter(role => byRole.has(role))
    .map(role => ({
      key: role,
      label: labels[role],
      teamNames: byRole.get(role)!,
    }));
}
