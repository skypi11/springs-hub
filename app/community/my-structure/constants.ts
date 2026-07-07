import { CheckCircle, Clock, Ban, AlertCircle } from 'lucide-react';
import type { PrimaryRole } from '@/lib/member-role';
import type { DashboardTab } from './types';

// Onglets visibles selon le rôle — SOURCE UNIQUE, appelée par le rendu ET par
// l'effet de rabat de page.tsx (sinon les deux listes divergent : c'est ce qui
// a fait éjecter les managers de « Recrutement » et les testeurs de « Inscriptions »).
// « Inscriptions » (suivi compét) : dirigeant, responsable, ou manager d'équipe.
export interface TabVisibilityFlags {
  isDirigeant: boolean;
  isResponsable: boolean;   // manager structure (managerIds / role manager)
  isCoach: boolean;
  isTeamStaff: boolean;     // staff d'équipe (manager OU coach d'équipe) sans rôle structure
  isTeamManager: boolean;   // manager d'AU MOINS une équipe (staffRoles==='manager')
  captainOnly: boolean;
  hasReplaySupport: boolean;
}

export function computeVisibleTabs(f: TabVisibilityFlags): DashboardTab[] {
  let base: DashboardTab[] = f.isDirigeant
    ? ['general', 'teams', 'recruitment', 'members', 'calendar', 'todos', 'replays', 'documents']
    : f.isResponsable
    ? ['teams', 'recruitment', 'members', 'calendar', 'todos', 'replays']
    : f.isCoach || f.isTeamStaff
    ? ['members', 'calendar', 'todos', 'replays']
    : f.captainOnly
    ? ['teams', 'calendar']
    : ['calendar'];
  if (f.isDirigeant || f.isResponsable || f.isTeamManager) {
    const ti = base.indexOf('teams');
    base = ti >= 0
      ? [...base.slice(0, ti + 1), 'inscriptions', ...base.slice(ti + 1)]
      : ['inscriptions', ...base];
  }
  return f.hasReplaySupport ? base : base.filter(t => t !== 'replays');
}

export const TAB_DEFS: { key: DashboardTab; label: string; color: string }[] = [
  { key: 'general', label: 'Général', color: 'var(--s-gold)' },
  { key: 'teams', label: 'Équipes', color: 'var(--s-blue)' },
  { key: 'inscriptions', label: 'Inscriptions', color: 'var(--s-gold)' },
  { key: 'recruitment', label: 'Recrutement', color: '#33ff66' },
  { key: 'members', label: 'Membres', color: 'var(--s-gold)' },
  { key: 'calendar', label: 'Calendrier', color: 'var(--s-gold)' },
  { key: 'todos', label: 'Exercices', color: '#4da6ff' },
  { key: 'replays', label: 'Replays', color: 'var(--s-gold)' },
  { key: 'documents', label: 'Documents', color: 'var(--s-gold)' },
];

export const DEPARTURE_NOTICE_DAYS = 7;
export const DEPARTURE_NOTICE_MS = DEPARTURE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

// Ordre d'affichage des membres, basé sur le rôle dérivé (cf. lib/member-role).
export const PRIMARY_ROLE_ORDER: PrimaryRole[] = [
  'fondateur', 'co_fondateur', 'responsable', 'coach_structure',
  'manager_equipe', 'coach_equipe', 'capitaine', 'joueur', 'membre',
];

// Couleur du label principal selon le rôle dérivé.
export const PRIMARY_ROLE_COLORS: Record<PrimaryRole, string> = {
  fondateur: 'var(--s-gold)',
  co_fondateur: 'var(--s-gold)',
  responsable: 'var(--s-gold)',
  coach_structure: '#FFB800',
  manager_equipe: 'var(--s-gold)',
  coach_equipe: '#4da6ff',
  capitaine: 'var(--s-gold)',
  joueur: 'var(--s-text-dim)',
  membre: 'var(--s-text-muted)',
};

export const STATUS_INFO: Record<string, { label: string; color: string; icon: typeof CheckCircle; desc: string }> = {
  pending_validation: { label: 'En attente de validation', color: '#FFB800', icon: Clock, desc: 'Ta demande est en cours de traitement. Un entretien vocal sera organisé.' },
  active: { label: 'Active', color: '#33ff66', icon: CheckCircle, desc: 'Ta structure est active et visible publiquement.' },
  suspended: { label: 'Suspendue', color: '#ff5555', icon: Ban, desc: 'Ta structure est suspendue. Contacte un admin Aedral.' },
  rejected: { label: 'Refusée', color: '#ff5555', icon: AlertCircle, desc: 'Ta demande a été refusée.' },
};

export const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  twitch: 'Twitch',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  website: 'Site web',
};
