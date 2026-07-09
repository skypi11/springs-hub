// Compétitions historiques Springs E-Sport encore hébergées sur l'ANCIEN site
// (springs-esport.vercel.app). SOURCE DE VÉRITÉ UNIQUE — consommée par
// /competitions, l'accueil (app/page.tsx) et la landing visiteur.
//
// Avant : 3 copies hardcodées désynchronisées → la Springs League Series
// restait affichée « en cours » sur l'accueil et la landing alors qu'elle est
// TERMINÉE (elle n'apparaissait comme active qu'à cause du hardcode). Ici, un
// seul endroit à tenir à jour. Les visuels de jeu (tag, couleur, bannière) se
// dérivent du `gameId` via la games-registry — jamais de hardcode couleur.
//
// `state` distingue les compétitions JOIGNABLES / récurrentes (active) des
// compétitions PASSÉES (finished), pour l'ordre (actives d'abord) et le
// groupement « Compétitions passées ». L'ordre du tableau met les actives en tête.

import type { GameId } from '@/lib/games-registry';

export type LegacyCompetitionState = 'active' | 'finished';

export interface LegacyCompetition {
  id: string;
  gameId: GameId;
  name: string;
  /** Ex. « Chaque mois », « Saison 2 · 2026 ». */
  edition: string;
  /** active = récurrente/joignable maintenant ; finished = terminée (passée). */
  state: LegacyCompetitionState;
  /** Libellé de statut affiché (« Mensuel », « Terminé »). */
  statusLabel: string;
  format: string;
  teams: string | null;
  prize: string | null;
  href: string;
  description: string;
}

// Actives d'abord (ordre d'affichage par défaut).
export const LEGACY_COMPETITIONS: LegacyCompetition[] = [
  {
    id: 'tm-monthly',
    gameId: 'trackmania',
    name: 'Monthly Cup',
    edition: 'Chaque mois',
    state: 'active',
    statusLabel: 'Mensuel',
    format: 'Cup · Solo · Quals + Finale',
    teams: 'Solo',
    prize: null,
    href: 'https://springs-esport.vercel.app/trackmania/cup.html?cup=monthly',
    description: 'Compétition mensuelle en solo : qualifications sur plusieurs maps officielles puis finale.',
  },
  {
    id: 'rl-s2',
    gameId: 'rocket_league',
    name: 'Springs League Series',
    edition: 'Saison 2 · 2026',
    state: 'finished',
    statusLabel: 'Terminé',
    format: 'Ligue · 2 poules · BO7',
    teams: '32 équipes',
    prize: '1 600 €',
    href: 'https://springs-esport.vercel.app/rocket-league/',
    description: '32 équipes en 2 poules. Top 8 de chaque poule qualifié pour la LAN finale. Format 3v3.',
  },
];

export const ACTIVE_LEGACY_COMPETITIONS = LEGACY_COMPETITIONS.filter(c => c.state === 'active');
export const FINISHED_LEGACY_COMPETITIONS = LEGACY_COMPETITIONS.filter(c => c.state === 'finished');
