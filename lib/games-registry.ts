/**
 * Game Registry, source de vérité unique pour tout ce qui est spécifique
 * à un jeu sur Aedral. Ajouter un nouveau jeu = ajouter une entrée ici
 * (+ ses assets dans /public) et le reste du code suit.
 *
 * Phase 1 (backbone) : la registry coexiste avec les hardcodes existants.
 * Les phases suivantes migrent les call sites à consommer la registry.
 */

import type { GameType } from '@/types';
import type { TodoType } from '@/lib/todos';

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
  /** Slug URL court ("rl", "tm", "val"), utilisé dans /competitions/{slug}/[id] */
  slug: string;
  /** Couleur principale du jeu (HEX ou var CSS). Sert aux pills, accent bars, points calendrier */
  color: string;
  /** Variante claire (hover, glow) */
  colorLight: string;
  /** Composants RGB de `color` sous forme "R,G,B", sert aux `rgba(${colorRgb}, 0.1)` (glows, fond pills) */
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
  /** Types d'exo proposables pour ce jeu dans le picker NewTodoForm.
   *  La validation server accepte tous les types canoniques ; ce champ filtre
   *  uniquement l'UI pour éviter de proposer "training pack RL" à une équipe Valorant.
   *  Ne pas inclure de types deprecated. */
  availableTodoTypes: TodoType[];
  /** Libellé court de la source de vérification du compte joueur (affiché dans le
   *  guide pour expliquer comment lier son compte officiel à son profil Aedral).
   *  Ex: "Epic (via tracker.gg) ou Steam", "Riot (via Discord connection)".
   *  Absent = pas de vérification disponible pour ce jeu (déclaratif uniquement). */
  accountSourceLabel?: string;
  /** True si le logo s'affiche bien tel quel sur le hex Aedral, SANS chip
   *  frame ajouté autour. Soit parce que le PNG est vraiment transparent (RL,
   *  Valorant), soit parce que le PNG est opaque mais avec un design coloré
   *  assumé comme partie de l'identité visuelle (TM = carré cyan/vert avec
   *  "TM" blanc officiel, on affiche le logo officiel tel quel).
   *
   *  False uniquement si le PNG est opaque AVEC un fond moche qu'on veut
   *  cacher derrière un chip rempli couleur du jeu (genre PNG screenshot
   *  avec fond blanc parasite). Cas rare, à éviter — préférer fournir un
   *  logo dont le design est self-sufficient.
   *
   *  Le nom historique "isTransparent" est conservé pour minimiser le diff,
   *  mais la sémantique réelle = "logo se suffit à lui-même". */
  logoIsTransparent: boolean;
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
    logoUrl: '/games/rocket-league.png',
    bannerUrl: '/rocket-league.webp',
    roster: { titulaires: 3, remplacants: 2, allowSolo: false },
    features: {
      // Vérification anti-mensonge : ID Epic capturé via Discord connection
      // epicgames OU SteamID64 capturé via Steam OpenID (login direct Steam).
      // Stocké comme rlEpicId / rlSteamId (immuables).
      rankVerification: true,
      // Parsing replays via ballchasing.com (cf. project_ballchasing_replays_system).
      replayParsing: true,
      // PAS de cron de sync auto du rang RL : le rang est fetch à la demande
      // via /api/rl-stats (Tracker.gg) quand on affiche un profil. La passe
      // nocturne discord-sync ne fait QUE refresh le lien Epic/Steam, pas le rang.
      rankAutoSync: false,
      trackerProfile: true,
    },
    trackerUrlTemplate: 'https://rocketleague.tracker.network/rocket-league/profile/epic/{id}/overview',
    availableTodoTypes: [
      'free', 'replay_review', 'training_pack', 'workshop_map', 'free_play',
      'vod_review', 'mental_checkin', 'warmup_routine',
    ],
    accountSourceLabel: 'Compte Epic ou Steam (via Discord connection, ou Steam OpenID direct)',
    // PNG converti en RGBA via floodfill bord (commit 7ea8fc4, 58% transparent).
    logoIsTransparent: true,
  },
  trackmania: {
    id: 'trackmania',
    label: 'Trackmania',
    shortLabel: 'TM',
    slug: 'tm',
    color: '#00D936',
    colorLight: '#3FF06A',
    colorRgb: '0,217,54',
    logoUrl: '/games/trackmania.png',
    bannerUrl: '/tm.webp',
    roster: { titulaires: 1, remplacants: 0, allowSolo: true },
    features: {
      rankVerification: false,
      replayParsing: false,
      rankAutoSync: false,
      // Lien profil trackmania.io public, fetch à la demande via /api/tm-stats
      // (trophées, COTD, classements zone) quand on affiche un profil joueur.
      trackerProfile: true,
    },
    trackerUrlTemplate: 'https://trackmania.io/#/player/{id}',
    availableTodoTypes: [
      'free', 'vod_review', 'mental_checkin',
    ],
    // Le logo TM officiel = carré coloré cyan/vert avec "TM" blanc. Le fond
    // coloré N'EST PAS un fond parasite à enlever, c'est l'identité visuelle
    // de la marque (cf. retour Matt 29/05 : "c'est ca qui fait le logo").
    // → afficher le PNG tel quel, sans chip frame extra autour.
    logoIsTransparent: true,
  },
  valorant: {
    id: 'valorant',
    label: 'Valorant',
    shortLabel: 'VAL',
    slug: 'val',
    // Rouge tactique officiel Riot Valorant. Distinct des autres jeux
    // (RL bleu, TM vert) et de l'or Aedral réservé aux CTA/highlights.
    color: '#FF4655',
    colorLight: '#FF6B78',
    colorRgb: '255,70,85',
    logoUrl: '/games/valorant.png',
    bannerUrl: '/valorant-banner.jpg',
    roster: { titulaires: 5, remplacants: 2, allowSolo: false },
    features: {
      // Vérification anti-mensonge : PUUID Riot immuable stocké (valorantPuuid),
      // capturé via Discord connection riotgames au login, identique au pattern
      // Epic pour RL (cf. memory project_valorant_added).
      rankVerification: true,
      // Pas de parsing de replays Valorant pour l'instant (pas d'équivalent
      // ballchasing pour Val à ce jour).
      replayParsing: false,
      // Cron nocturne /api/cron/sync-valorant-ranks via HenrikDev API
      // (25 users/run tier Standard 30 req/min) + bouton "Sync mon rang
      // maintenant" à la demande dans Settings.
      rankAutoSync: true,
      trackerProfile: true,
    },
    trackerUrlTemplate: 'https://tracker.gg/valorant/profile/riot/{id}/overview',
    availableTodoTypes: [
      'free', 'aim_trainer', 'lineups', 'custom_game',
      'vod_review', 'mental_checkin', 'warmup_routine',
    ],
    accountSourceLabel: 'Compte Riot (capturé via ta connexion Discord, PUUID vérifié)',
    // PNG Valorant a déjà un canal alpha propre (channels=4 hasAlpha=true).
    logoIsTransparent: true,
  },
};

/** Liste ordonnée de toutes les définitions de jeux supportés */
export const ALL_GAME_DEFS: GameDef[] = Object.values(GAMES_REGISTRY);

/**
 * Récupère la définition d'un jeu. Retourne `undefined` si l'id est inconnu
 * (jamais throw, l'appelant décide quoi faire des jeux dépréciés ou inconnus).
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

/** True si le logo du jeu est sur fond transparent. Utilisé par les OG routes
 *  pour choisir entre variant "logo seul" (transparent) ou "chip rempli"
 *  (opaque, fond couleur du jeu pour cacher le carré opaque). */
export function isGameLogoTransparent(id: string | null | undefined): boolean {
  return getGame(id)?.logoIsTransparent ?? false;
}

/** Vérifie si un id est un jeu connu de la registry */
export function isKnownGame(id: string | null | undefined): id is GameId {
  if (!id) return false;
  return id in GAMES_REGISTRY;
}

/** Types d'exo proposables pour ce jeu (filtre UI du picker NewTodoForm).
 *  Si jeu inconnu, fallback sur la liste générique commune à tous les jeux. */
export function getAvailableTodoTypes(id: string | null | undefined): TodoType[] {
  const g = getGame(id);
  if (g) return g.availableTodoTypes;
  return ['free', 'vod_review', 'mental_checkin'];
}
