/**
 * Game Registry — source de vérité unique pour tout ce qui est spécifique
 * à un jeu sur Aedral. Ajouter un nouveau jeu = ajouter une entrée ici
 * (+ ses assets dans /public) et le reste du code suit.
 *
 * Phase 1 (backbone) : la registry coexiste avec les hardcodes existants.
 * Les phases suivantes migrent les call sites à consommer la registry.
 */

import type { GameType } from '@/types';

/**
 * GameId reste typé strict en phase 1 (synchro avec GameType legacy).
 * Quand on ajoutera Valorant (phase 3), on ouvrira GameType côté types/index.ts.
 */
export type GameId = GameType;

export interface GameRosterFormat {
  /** Nombre standard de titulaires (3 pour RL, 1 pour TM en mode solo) */
  titulaires: number;
  /** Nombre standard de remplaçants (2 pour RL, 0 pour TM) */
  remplacants: number;
  /** Mode solo possible (TM monthly cup par ex.) → désactive les contraintes roster */
  allowSolo: boolean;
}

export interface GameFeatureFlags {
  /** Système anti-mensonge rang via compte officiel vérifié (Epic pour RL, Riot pour Val…) */
  rankVerification: boolean;
  /** Parsing automatique de replays uploadés (ballchasing.com pour RL) */
  replayParsing: boolean;
  /** Sync auto du rang en arrière-plan via API tierce (cron nocturne) */
  rankAutoSync: boolean;
  /** Lien profil tracker.gg public pertinent pour ce jeu */
  trackerProfile: boolean;
}

export interface GameDef {
  /** Identifiant stable utilisé partout (Firestore, URLs, types). Ne JAMAIS changer après ship. */
  id: GameId;
  /** Nom affiché complet ("Rocket League") */
  label: string;
  /** Tag court 2-3 lettres, uppercase ("RL", "TM", "VAL") */
  shortLabel: string;
  /** Slug URL court ("rl", "tm", "val") — utilisé dans /competitions/{slug}/[id] */
  slug: string;
  /** Couleur principale du jeu (HEX ou var CSS). Sert aux pills, accent bars, points calendrier */
  color: string;
  /** Variante claire (hover, glow) */
  colorLight: string;
  /** Composants RGB de `color` sous forme "R,G,B" — sert aux `rgba(${colorRgb}, 0.1)` (glows, fond pills) */
  colorRgb: string;
  /** Chemin asset logo carré (dans /public), commence par "/" */
  logoUrl: string;
  /** Chemin asset bannière 6:1 (dans /public), commence par "/" */
  bannerUrl: string;
  /** Format roster typique pour ce jeu */
  roster: GameRosterFormat;
  /** Features activées pour ce jeu (rank verif, replay parsing, etc.) */
  features: GameFeatureFlags;
  /** Template URL profil tracker.gg, `{id}` remplacé par l'id du compte de jeu */
  trackerUrlTemplate?: string;
}

/**
 * Registry centrale. L'ordre des clés détermine l'ordre par défaut
 * dans les pickers / annuaires (RL avant TM historiquement).
 */
export const GAMES_REGISTRY: Record<GameId, GameDef> = {
  rocket_league: {
    id: 'rocket_league',
    label: 'Rocket League',
    shortLabel: 'RL',
    slug: 'rl',
    color: '#0081FF',
    colorLight: '#3FA0FF',
    colorRgb: '0,129,255',
    logoUrl: '/rocket-league.webp',
    bannerUrl: '/rocket-league.webp',
    roster: { titulaires: 3, remplacants: 2, allowSolo: false },
    features: {
      rankVerification: true,
      replayParsing: true,
      rankAutoSync: true,
      trackerProfile: true,
    },
    trackerUrlTemplate: 'https://rocketleague.tracker.network/rocket-league/profile/epic/{id}/overview',
  },
  trackmania: {
    id: 'trackmania',
    label: 'Trackmania',
    shortLabel: 'TM',
    slug: 'tm',
    color: '#00D936',
    colorLight: '#3FF06A',
    colorRgb: '0,217,54',
    logoUrl: '/tm.webp',
    bannerUrl: '/tm.webp',
    roster: { titulaires: 1, remplacants: 0, allowSolo: true },
    features: {
      rankVerification: false,
      replayParsing: false,
      rankAutoSync: false,
      trackerProfile: false,
    },
  },
};

/** Liste ordonnée de toutes les définitions de jeux supportés */
export const ALL_GAME_DEFS: GameDef[] = Object.values(GAMES_REGISTRY);

/**
 * Récupère la définition d'un jeu. Retourne `undefined` si l'id est inconnu
 * (jamais throw — l'appelant décide quoi faire des jeux dépréciés ou inconnus).
 */
export function getGame(id: string | null | undefined): GameDef | undefined {
  if (!id) return undefined;
  return GAMES_REGISTRY[id as GameId];
}

/**
 * Variante stricte pour les chemins où un jeu inconnu est forcément un bug.
 * À utiliser uniquement côté serveur dans des endpoints qui valident déjà l'input.
 */
export function getGameOrThrow(id: string): GameDef {
  const g = getGame(id);
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

/** Couleur principale d'un jeu, avec fallback neutre si jeu inconnu */
export function getGameColor(id: string | null | undefined): string {
  return getGame(id)?.color ?? 'var(--s-text-dim)';
}

/** Composants RGB "R,G,B" pour usage dans `rgba()`, avec fallback gris dim */
export function getGameColorRgb(id: string | null | undefined): string {
  return getGame(id)?.colorRgb ?? '122,122,149'; // matches --s-text-dim
}

/** Label complet ("Rocket League") avec fallback "Jeu inconnu" */
export function getGameLabel(id: string | null | undefined): string {
  return getGame(id)?.label ?? 'Jeu inconnu';
}

/** Tag court ("RL") avec fallback "?" */
export function getGameShortLabel(id: string | null | undefined): string {
  return getGame(id)?.shortLabel ?? '?';
}

/** URL du logo (commence par "/"), null si jeu inconnu */
export function getGameLogoUrl(id: string | null | undefined): string | null {
  return getGame(id)?.logoUrl ?? null;
}

/** URL de la bannière 6:1, null si jeu inconnu */
export function getGameBannerUrl(id: string | null | undefined): string | null {
  return getGame(id)?.bannerUrl ?? null;
}

/** Slug URL ("rl") pour construire des routes /competitions/{slug}/[id] */
export function getGameSlug(id: string | null | undefined): string | null {
  return getGame(id)?.slug ?? null;
}

/** Recherche un jeu par son slug ("rl" → rocket_league) */
export function getGameBySlug(slug: string | null | undefined): GameDef | undefined {
  if (!slug) return undefined;
  return ALL_GAME_DEFS.find(g => g.slug === slug);
}

/** Vérifie si un jeu supporte une feature donnée (rankVerification, replayParsing, etc.) */
export function gameHasFeature(id: string | null | undefined, feature: keyof GameFeatureFlags): boolean {
  return getGame(id)?.features[feature] ?? false;
}

/** Vérifie si un id est un jeu connu de la registry */
export function isKnownGame(id: string | null | undefined): id is GameId {
  if (!id) return false;
  return id in GAMES_REGISTRY;
}
