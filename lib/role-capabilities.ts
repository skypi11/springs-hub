// Catalogue user-facing des capacités par rôle de structure.
// Source de vérité unique pour le modal "À propos du rôle X" affiché au moment
// de la promotion + pour la page d'aide consultable par les dirigeants.
//
// IMPORTANT : ce fichier décrit ce que les utilisateurs voient et comprennent.
// Pour la logique d'autorisation effective, voir lib/structure-permissions.ts
// (source de vérité côté code). Ces 2 fichiers doivent rester cohérents, si
// tu changes une permission technique, mets aussi à jour le label ici.

export type StructureRole =
  | 'fondateur'
  | 'co_fondateur'
  | 'responsable'
  | 'coach_structure'
  | 'manager_equipe'
  | 'coach_equipe'
  | 'capitaine';

export interface RoleCapability {
  label: string;        // ex: "Modifier les paramètres de la structure"
  category: string;     // pour grouper visuellement (Structure, Équipes, Calendrier…)
}

export interface RoleDefinition {
  key: StructureRole;
  name: string;              // user-facing label (ex: "Responsable")
  shortName: string;         // version courte pour badges
  tagline: string;           // une phrase qui résume le rôle
  color: 'gold' | 'blue' | 'green' | 'neutral';
  can: RoleCapability[];     // ce que le rôle PEUT faire (en plus du rôle inférieur)
  cant: RoleCapability[];    // ce que le rôle NE PEUT PAS faire (limites à clarifier)
  scope: string;             // "Structure entière" ou "Sa propre équipe" etc.
}

const CAT = {
  structure: 'Gestion structure',
  promote: 'Promotions / staff',
  members: 'Membres & invitations',
  recrutement: 'Recrutement',
  teams: 'Équipes',
  calendar: 'Calendrier',
  todos: 'Exercices',
  replays: 'Replays',
  docs: 'Documents staff',
} as const;

export const ROLE_DEFINITIONS: Record<StructureRole, RoleDefinition> = {
  fondateur: {
    key: 'fondateur',
    name: 'Fondateur',
    shortName: 'Fonda',
    tagline: 'Propriétaire de la structure, pouvoir total et irréversible.',
    color: 'gold',
    scope: 'Structure entière',
    can: [
      { category: CAT.structure, label: 'Modifier tous les paramètres de la structure (identité, Discord, recrutement)' },
      { category: CAT.structure, label: 'Supprimer la structure (destructif)' },
      { category: CAT.structure, label: 'Transférer la propriété à un autre membre' },
      { category: CAT.promote, label: 'Promouvoir un Co-fondateur' },
      { category: CAT.promote, label: 'Promouvoir / retirer un Responsable ou un Coach' },
      { category: CAT.teams, label: 'Supprimer une équipe (destructif)' },
      { category: CAT.teams, label: 'Modifier le label / groupe d\'une équipe' },
      { category: CAT.docs, label: 'Accéder aux documents staff (contrats, sensibles)' },
    ],
    cant: [],
  },

  co_fondateur: {
    key: 'co_fondateur',
    name: 'Co-fondateur',
    shortName: 'Co-fonda',
    tagline: 'Bras droit du fondateur, tous les droits sauf ceux strictement réservés au propriétaire.',
    color: 'gold',
    scope: 'Structure entière',
    can: [
      { category: CAT.structure, label: 'Modifier tous les paramètres de la structure' },
      { category: CAT.promote, label: 'Promouvoir / retirer un Responsable ou un Coach' },
      { category: CAT.teams, label: 'Modifier le label / groupe d\'une équipe' },
      { category: CAT.docs, label: 'Accéder aux documents staff' },
      { category: CAT.calendar, label: 'Supprimer un événement (destructif)' },
    ],
    cant: [
      { category: CAT.structure, label: 'Supprimer la structure' },
      { category: CAT.structure, label: 'Transférer la propriété' },
      { category: CAT.promote, label: 'Promouvoir un Co-fondateur (fondateur uniquement)' },
      { category: CAT.teams, label: 'Supprimer une équipe (fondateur uniquement)' },
    ],
  },

  responsable: {
    key: 'responsable',
    name: 'Responsable',
    shortName: 'Resp.',
    tagline: 'Bras droit opérationnel, gère équipes, membres, recrutement et calendrier de toute la structure.',
    color: 'gold',
    scope: 'Structure entière',
    can: [
      { category: CAT.teams, label: 'Créer, modifier, archiver, réorganiser toutes les équipes' },
      { category: CAT.teams, label: 'Modifier le roster de n\'importe quelle équipe (joueurs, remplaçants, capitaine, salon Discord)' },
      { category: CAT.members, label: 'Inviter un joueur (lien ou invitation directe)' },
      { category: CAT.members, label: 'Accepter / refuser les candidatures' },
      { category: CAT.members, label: 'Retirer un membre de la structure' },
      { category: CAT.recrutement, label: 'Accéder à la shortlist + suggestions de recrutement' },
      { category: CAT.calendar, label: 'Créer tous types d\'événements (training, scrim, match, tournoi) sur toute équipe' },
      { category: CAT.calendar, label: 'Créer des réunions staff (scope=staff)' },
      { category: CAT.calendar, label: 'Modifier la présence des joueurs sur tout événement d\'équipe' },
      { category: CAT.todos, label: 'Créer / assigner des exercices à n\'importe quel joueur' },
      { category: CAT.todos, label: 'Créer des templates d\'exercices partagés' },
      { category: CAT.replays, label: 'Uploader et télécharger des replays pour toute équipe' },
    ],
    cant: [
      { category: CAT.structure, label: 'Modifier les paramètres de la structure (nom, logo, Discord, recrutement)' },
      { category: CAT.promote, label: 'Promouvoir ou rétrograder qui que ce soit' },
      { category: CAT.teams, label: 'Supprimer une équipe ni modifier son label' },
      { category: CAT.calendar, label: 'Créer un événement scope=structure ou scope=game' },
      { category: CAT.calendar, label: 'Supprimer un événement' },
      { category: CAT.docs, label: 'Accéder aux documents staff (contrats, sensibles)' },
    ],
  },

  coach_structure: {
    key: 'coach_structure',
    name: 'Coach structure',
    shortName: 'Coach',
    tagline: 'Staff mobile, anime les entraînements/scrims et assigne les exercices sur n\'importe quelle équipe.',
    color: 'blue',
    scope: 'Toutes les équipes (training/scrim + exercices + replays uniquement)',
    can: [
      { category: CAT.calendar, label: 'Créer un événement training ou scrim sur n\'importe quelle équipe' },
      { category: CAT.todos, label: 'Créer / assigner des exercices aux joueurs de n\'importe quelle équipe' },
      { category: CAT.replays, label: 'Uploader et télécharger des replays pour toute équipe' },
      { category: CAT.calendar, label: 'Voir et participer au calendrier de la structure' },
    ],
    cant: [
      { category: CAT.teams, label: 'Modifier les équipes (composition, staff, capitaine)' },
      { category: CAT.calendar, label: 'Créer un match ou un tournoi' },
      { category: CAT.calendar, label: 'Modifier la présence des joueurs sur les événements des autres' },
      { category: CAT.members, label: 'Inviter des joueurs ou gérer les invitations' },
      { category: CAT.recrutement, label: 'Accéder au recrutement (shortlist, suggestions)' },
      { category: CAT.docs, label: 'Accéder aux documents staff' },
    ],
  },

  manager_equipe: {
    key: 'manager_equipe',
    name: 'Manager d\'équipe',
    shortName: 'Mgr éq.',
    tagline: 'Responsable d\'une équipe précise, gère sa composition et son agenda.',
    color: 'gold',
    scope: 'Son équipe uniquement',
    can: [
      { category: CAT.teams, label: 'Modifier la composition de son équipe (titulaires, remplaçants, capitaine, logo, salon Discord)' },
      { category: CAT.calendar, label: 'Créer tous types d\'événements sur son équipe (training, scrim, match, tournoi)' },
      { category: CAT.calendar, label: 'Modifier la présence des joueurs de son équipe' },
      { category: CAT.todos, label: 'Créer / assigner des exercices aux joueurs de son équipe' },
      { category: CAT.replays, label: 'Uploader et télécharger des replays de son équipe' },
    ],
    cant: [
      { category: CAT.teams, label: 'Modifier ou supprimer son équipe (archiver, label réservé aux dirigeants)' },
      { category: CAT.teams, label: 'Modifier le staff de son équipe (ajout/retrait coach/manager équipe, réservé aux dirigeants)' },
      { category: CAT.teams, label: 'Toucher aux autres équipes de la structure' },
      { category: CAT.members, label: 'Inviter des joueurs à la structure' },
      { category: CAT.docs, label: 'Accéder aux documents staff' },
    ],
  },

  coach_equipe: {
    key: 'coach_equipe',
    name: 'Coach d\'équipe',
    shortName: 'Coach éq.',
    tagline: 'Coach attitré d\'une équipe, anime ses entraînements et upload ses replays.',
    color: 'blue',
    scope: 'Son équipe uniquement',
    can: [
      { category: CAT.calendar, label: 'Créer un événement training ou scrim sur son équipe' },
      { category: CAT.calendar, label: 'Modifier la présence des joueurs de son équipe' },
      { category: CAT.todos, label: 'Créer / assigner des exercices aux joueurs de son équipe' },
      { category: CAT.replays, label: 'Uploader et télécharger des replays de son équipe' },
    ],
    cant: [
      { category: CAT.teams, label: 'Modifier la composition de son équipe' },
      { category: CAT.calendar, label: 'Créer un match ou un tournoi' },
      { category: CAT.teams, label: 'Toucher aux autres équipes' },
    ],
  },

  capitaine: {
    key: 'capitaine',
    name: 'Capitaine',
    shortName: 'Cap.',
    tagline: 'Joueur désigné par le fondateur pour gérer l\'agenda de son équipe.',
    color: 'green',
    scope: 'Son équipe uniquement (calendrier seulement)',
    can: [
      { category: CAT.calendar, label: 'Créer tous types d\'événements sur son équipe (training, scrim, match, tournoi)' },
      { category: CAT.calendar, label: 'Modifier la présence des joueurs de son équipe' },
      { category: CAT.replays, label: 'Uploader et télécharger des replays de son équipe' },
    ],
    cant: [
      { category: CAT.teams, label: 'Modifier la composition de son équipe (réservé staff/dirigeants)' },
      { category: CAT.todos, label: 'Créer des exercices pour ses coéquipiers' },
    ],
  },
};

export const ROLE_COLOR_MAP: Record<'gold' | 'blue' | 'green' | 'neutral', { bg: string; fg: string; border: string }> = {
  gold:    { bg: 'rgba(255,184,0,0.12)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.35)' },
  blue:    { bg: 'rgba(0,129,255,0.10)', fg: 'var(--s-blue)', border: 'rgba(0,129,255,0.30)' },
  green:   { bg: 'rgba(0,217,54,0.10)',  fg: 'var(--s-green)', border: 'rgba(0,217,54,0.30)' },
  neutral: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--s-text)', border: 'var(--s-border)' },
};

// Liste ordonnée pour l'UI (du plus puissant au moins puissant)
export const ROLE_ORDER: StructureRole[] = [
  'fondateur',
  'co_fondateur',
  'responsable',
  'coach_structure',
  'manager_equipe',
  'coach_equipe',
  'capitaine',
];
