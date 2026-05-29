/**
 * Helpers communs aux endpoints OG (Open Graph) d'Aedral.
 *
 * Les routes `/api/og/*` génèrent des PNG 1200×630 via next/og + satori pour
 * les embeds Discord/Twitter/etc. Toutes partagent la même DA (texture hex,
 * coins or HUD, accent bar dorée, palette Aedral) et les mêmes contraintes
 * techniques (font Rajdhani bundled, conversion d'images WebP → PNG via sharp
 * parce que satori ne décode pas le WebP).
 *
 * Source historique : `app/api/og/match/[eventId]/route.tsx` (premier OG ship).
 * Ce module a été extrait pour pouvoir réutiliser le même rendu sur les
 * endpoints structure et profile sans dupliquer la logique.
 *
 * Tout est server-only (lit `process.cwd()`, `fs`, et utilise `sharp`).
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { getGameColor } from '@/lib/games-registry';
import { getRankIconFile, getRankTierConfig } from '@/lib/rl-ranks';
import { getValorantRankIconFile, getValorantTierConfig } from '@/lib/valorant-ranks';
import type { OgDisplayPreferences } from '@/types';

// ─── Dimensions OG standard ──────────────────────────────────────────────────
// 1200×630 = format recommandé par Facebook/Twitter/Discord. Tout endpoint OG
// devrait utiliser ces dimensions sauf cas exceptionnel.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// ─── Palette Aedral ──────────────────────────────────────────────────────────
// Tokens centraux pour rester cohérent avec `app/design-system.css`. On
// duplique les valeurs en hex parce que satori/@vercel/og ne résout pas les
// `var(--s-*)` CSS au moment du rendu.
export const AEDRAL_PALETTE = {
  bg: '#0a0a0a',
  surface: '#111111',
  elevated: '#1a1a1a',
  gold: '#FFB800',
  goldDark: '#ff8800',
  text: '#eaeaf0',
  textDim: '#7a7a95',
  textMuted: '#6a6a8a',
  /** Fond principal des bannières OG : dégradé sombre 3 stops cohérent avec la sidebar. */
  backgroundGradient:
    'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #111111 100%)',
  /** Gradient or réutilisé pour l'accent bar du haut. */
  goldBarGradient:
    'linear-gradient(90deg, #FFB800 0%, #ff8800 50%, #FFB800 100%)',
} as const;

// ─── Font Rajdhani ──────────────────────────────────────────────────────────
// Rajdhani 700 : police esport/gaming angulaire alignée sur les biseaux de la
// DA Aedral. TTF bundlée dans /public/fonts (un fetch Google Fonts au runtime
// s'est révélé fragile en cold start). Lue 1 fois puis cachée module-level.
let RAJDHANI_CACHE: Buffer | null = null;

/**
 * Charge la font Rajdhani-Bold.ttf depuis `/public/fonts`. Retourne `null`
 * si le fichier n'existe pas ou n'est pas lisible (le rendu tombera alors
 * sur `sans-serif` par défaut, sans crasher).
 */
export function loadRajdhani(): Buffer | null {
  if (RAJDHANI_CACHE) return RAJDHANI_CACHE;
  try {
    const p = path.join(process.cwd(), 'public', 'fonts', 'Rajdhani-Bold.ttf');
    RAJDHANI_CACHE = fs.readFileSync(p);
    return RAJDHANI_CACHE;
  } catch {
    return null;
  }
}

// ─── Texture hexagonale ─────────────────────────────────────────────────────
/**
 * Génère une trame hexagonale (honeycomb) en SVG, taille exacte de la
 * bannière. Rendue en absolute `<img>` par-dessus le fond. C'est la signature
 * visuelle de la DA Aedral (cf. `.hex-bg` côté site).
 *
 * Le rayon (38px) et l'opacité du stroke (0.055) sont calibrés pour rester
 * subtils à 1200×630 sans dominer le contenu.
 */
export function hexTextureDataUri(width: number, height: number): string {
  const r = 38;
  const stepX = r * Math.sqrt(3);
  const stepY = r * 1.5;
  const paths: string[] = [];
  for (let row = -1; row * stepY < height + r; row++) {
    const offsetX = row % 2 === 0 ? 0 : stepX / 2;
    for (let col = -1; col * stepX < width + stepX; col++) {
      const cx = col * stepX + offsetX;
      const cy = row * stepY;
      const w2 = stepX / 2;
      const r2 = r / 2;
      paths.push(
        `M${cx},${cy - r} L${cx + w2},${cy - r2} L${cx + w2},${cy + r2} L${cx},${cy + r} L${cx - w2},${cy + r2} L${cx - w2},${cy - r2}Z`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g fill="none" stroke="rgba(255,255,255,0.055)" stroke-width="1">${paths.map(p => `<path d="${p}"/>`).join('')}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ─── Conversion image → PNG dataURI ─────────────────────────────────────────
/**
 * Convertit n'importe quelle image (R2 webp, URL externe png/jpg, etc.) en
 * data URI PNG. satori / @vercel/og gère mal le WebP, donc on force PNG pour
 * un comportement uniforme. Limite la résolution à 512px (les logos OG
 * affichent en 200-280px max, pas besoin de plus haut).
 *
 * Comportement défensif : retourne `null` si fetch ou décodage échoue,
 * l'appelant tombera sur son fallback (initiales, avatar par défaut, etc.).
 * On ne propage jamais d'erreur jusqu'à un 500 — un OG cassé tue l'embed.
 */
export async function loadLogoAsPngDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const png = await sharp(buf, { failOn: 'error' })
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Conversion fichier local → PNG dataURI ────────────────────────────────
/**
 * Variante de `loadLogoAsPngDataUri` qui lit une image depuis le disque local
 * (relative à `process.cwd()`, typiquement dans `/public`) au lieu d'aller la
 * chercher via HTTP. Utile pour les icônes de rang RL/Valorant, les logos
 * Aedral statiques, etc. — pas de latence réseau, pas de risque DNS.
 *
 * Le chemin est résolu via `path.join(process.cwd(), 'public', relPath)`
 * (donc passer `'rl-ranks/grand-champion-iii.png'`, pas `'/rl-ranks/...'`).
 *
 * Sécurité : on refuse les `..` pour éviter la traversée hors `public/`. Si
 * le fichier est introuvable ou illisible → retourne `null` (l'appelant
 * tombe sur son fallback sans 500).
 */
export async function loadLocalIconAsPngDataUri(relPath: string | null | undefined): Promise<string | null> {
  if (!relPath) return null;
  if (relPath.includes('..')) return null; // anti path-traversal défensif
  try {
    const clean = relPath.replace(/^[\\/]+/, ''); // strip leading slash si présent
    const absPath = path.join(process.cwd(), 'public', clean);
    const buf = fs.readFileSync(absPath);
    const png = await sharp(buf, { failOn: 'error' })
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Typo utilitaires ───────────────────────────────────────────────────────
/**
 * Retourne une taille de police adaptative pour les noms (équipes, joueurs,
 * structures). Évite que les noms longs débordent du layout sans avoir à
 * ajuster manuellement à chaque endpoint.
 *
 * @param maxLen longueur du plus long label à afficher
 */
export function nameFontSize(maxLen: number): number {
  if (maxLen <= 9) return 64;
  if (maxLen <= 13) return 52;
  if (maxLen <= 18) return 40;
  return 32;
}

/**
 * Variante "large" pour les hero titres (1 seul nom centré, plus de place
 * que sur le layout VS). Utilisée par les OG structure / profile.
 */
export function heroNameFontSize(len: number): number {
  if (len <= 8) return 96;
  if (len <= 12) return 80;
  if (len <= 18) return 64;
  if (len <= 26) return 52;
  return 42;
}

/**
 * Extrait jusqu'à 3 caractères d'un nom pour servir d'initiales en fallback
 * quand le logo / avatar est introuvable. Toujours uppercase, jamais vide.
 */
export function initials(name: string): string {
  return (name || '').trim().slice(0, 3).toUpperCase() || '?';
}

// ─── Hero rank picking pour les routes OG profil ────────────────────────────
/**
 * Représente un rang à afficher en hero sur une OG image. Centralisé ici
 * pour rester DRY entre les 4 routes OG profile (horizontal + story) + 2
 * banner routes.
 *
 * `gameId` identifie le jeu (utile pour les tags type "RANG RL" et le
 * routing d'icône). `iconBasePath` indique le sous-dossier de `/public`
 * (rl-ranks ou valorant-ranks) où trouver l'icône PNG du tier.
 */
export interface HeroRank {
  gameId: string;
  label: string;          // "RANG RL", "RANG VAL"
  value: string;          // "Super Sonic Legend", "Diamond II"
  color: string;          // couleur officielle du tier (red Grand Champ, blue Diamond, etc.)
  iconFile: string | null;
  iconBasePath: 'rl-ranks' | 'valorant-ranks';
}

/**
 * Construit le HeroRank pour un jeu donné à partir des données user, OU null
 * si l'user n'a pas de rang exploitable pour ce jeu.
 *
 * Couleur : prend la couleur OFFICIELLE du tier reconnu (Grand Champ = rouge,
 * Diamond = bleu, etc.). Fallback sur la couleur du jeu si tier non reconnu.
 */
function buildHeroRankForGame(
  gameId: string,
  data: Record<string, unknown>,
): HeroRank | null {
  if (gameId === 'rocket_league') {
    const rlRank = typeof data.rlRank === 'string' ? data.rlRank.trim() : '';
    if (!rlRank) return null;
    const tierConfig = getRankTierConfig(rlRank);
    return {
      gameId: 'rocket_league',
      label: 'RANG RL',
      value: rlRank,
      color: tierConfig?.color ?? getGameColor('rocket_league'),
      iconFile: getRankIconFile(rlRank),
      iconBasePath: 'rl-ranks',
    };
  }
  if (gameId === 'valorant') {
    const valRank = typeof data.valorantRank === 'string' ? data.valorantRank.trim() : '';
    if (!valRank) return null;
    const tierConfig = getValorantTierConfig(valRank);
    return {
      gameId: 'valorant',
      label: 'RANG VAL',
      value: valRank,
      color: tierConfig?.color ?? getGameColor('valorant'),
      iconFile: getValorantRankIconFile(valRank),
      iconBasePath: 'valorant-ranks',
    };
  }
  // TM pas de tier system structuré → pas de rang affichable
  return null;
}

/**
 * Logique auto-detect (legacy) quand l'user n'a pas de préférences OG :
 * priorité RL vérifié → Valorant → RL non vérifié. Retourne UN seul rang
 * (le plus prestigieux selon priorité) ou null.
 */
function pickHeroRankAuto(data: Record<string, unknown>): HeroRank | null {
  const rlVerified = typeof data.rlEpicId === 'string' || typeof data.rlSteamId === 'string';
  if (rlVerified) {
    const r = buildHeroRankForGame('rocket_league', data);
    if (r) return r;
  }
  const v = buildHeroRankForGame('valorant', data);
  if (v) return v;
  // Dernier fallback : RL non vérifié
  return buildHeroRankForGame('rocket_league', data);
}

/**
 * Sélectionne 0, 1 ou 2 rangs à afficher en hero sur les OG images du profil
 * du joueur. Utilisé par les 4 routes OG profile (horizontal+story) + les 2
 * routes banner download.
 *
 * Stratégie :
 * 1. Si l'user a customisé ses préférences (`ogDisplay.ranks` non vide) ET
 *    qu'il a le droit (canCustomize true) → respecte sa sélection (max 2).
 *    Les game IDs invalides ou sans rang dispo sont silencieusement ignorés.
 * 2. Sinon fallback auto-detect : 1 seul rang choisi par priorité
 *    (RL vérifié > Valorant > RL non vérifié).
 *
 * `canCustomize` doit être passé par l'appelant via `canUserCustomizeOgDisplay(user)`
 * de lib/plan-limits.ts → permet de désactiver les preferences quand on flippera
 * le gate premium plus tard sans toucher au data en base.
 */
export function pickHeroRanks(
  data: Record<string, unknown>,
  options: { canCustomize?: boolean } = {},
): HeroRank[] {
  const { canCustomize = true } = options;
  const ogDisplay = (canCustomize && data.ogDisplay && typeof data.ogDisplay === 'object'
    ? data.ogDisplay
    : null) as OgDisplayPreferences | null;
  const requestedIds = Array.isArray(ogDisplay?.ranks) ? ogDisplay.ranks : [];

  if (requestedIds.length > 0) {
    const ranks: HeroRank[] = [];
    // Respecte l'ordre de l'user, cap à 2, ignore les game IDs invalides ou sans rang
    for (const gid of requestedIds) {
      if (ranks.length >= 2) break;
      if (typeof gid !== 'string') continue;
      const r = buildHeroRankForGame(gid, data);
      if (r) ranks.push(r);
    }
    return ranks;
  }

  // Fallback auto : 1 seul rang choisi par priorité
  const auto = pickHeroRankAuto(data);
  return auto ? [auto] : [];
}

/**
 * Sélectionne quels logos de jeux afficher dans les chips de l'OG profile.
 *
 * Cohérent avec pickHeroRanks : si l'user a choisi des ranks à afficher
 * (ogDisplay.ranks non vide), on n'affiche QUE les logos correspondants
 * (un user qui customise sa carte ne veut voir que les jeux qu'il met en
 * avant — retour Matt 30/05 : "il faut enlever les logos qu'on sélectionne pas").
 *
 * Sinon (preferences vides ou user sans droit de customisation) → fallback
 * historique : tous les jeux pratiqués, cap à `capWhenAuto` (3 par défaut).
 */
export function pickVisibleGames(
  data: Record<string, unknown>,
  options: { canCustomize?: boolean; capWhenAuto?: number } = {},
): { games: string[]; extra: number } {
  const { canCustomize = true, capWhenAuto = 3 } = options;
  const ogDisplay = (canCustomize && data.ogDisplay && typeof data.ogDisplay === 'object'
    ? data.ogDisplay
    : null) as OgDisplayPreferences | null;
  const requestedRanks = Array.isArray(ogDisplay?.ranks)
    ? (ogDisplay.ranks.filter((g): g is string => typeof g === 'string'))
    : [];

  if (requestedRanks.length > 0) {
    // L'user a explicitement choisi → afficher uniquement ces logos.
    // Pas de "+N" car la sélection est délibérée (pas une troncature).
    return { games: requestedRanks, extra: 0 };
  }

  // Fallback auto : tous les jeux pratiqués (cap visuel).
  const userGames = Array.isArray(data.games)
    ? (data.games.filter((g): g is string => typeof g === 'string'))
    : [];
  return {
    games: userGames.slice(0, capWhenAuto),
    extra: Math.max(0, userGames.length - capWhenAuto),
  };
}

/**
 * Bloc structure+équipe d'un user pour affichage sur l'OG profile.
 * Le team est optionnel (un user peut être membre d'une structure sans équipe
 * fixée). La structure est requise si le bloc est retourné.
 */
export interface UserOgStructureBlock {
  structure: {
    name: string;
    tag: string;
    logoUrl: string;
    /** Slug propre pour URLs futures (pas utilisé dans le rendu, mais on le
     *  remonte au cas où on voudrait afficher l'URL "aedral.com/.../slug"). */
    slug: string | null;
  };
  /** Première équipe trouvée dans la structure pour le jeu choisi où le user
   *  est titulaire/remplaçant/staff. Null si pas d'équipe (ex. simple membre). */
  team: {
    name: string;
    /** Game ID (rocket_league, trackmania, valorant…) — sert à colorer le tag jeu. */
    game: string;
  } | null;
}

/**
 * Charge la structure principale + équipe d'un user pour l'affichage sur l'OG.
 *
 * Logique :
 * 1. Lit `user.structurePerGame` (format mixte : string OU string[] par game).
 * 2. Choisit le game cible :
 *    - Si `ogPrefs.primaryGameForStructure` défini ET l'user y a une struct → ce game
 *    - Sinon → premier game où l'user a une structure (ordre de l'objet)
 * 3. Fetch le doc structures/{structId} — skippe si !exists ou status !== 'active'.
 * 4. Cherche dans sub_teams (where structureId, game) une équipe non-archivée
 *    où l'user est player/sub/staff. Retourne la première trouvée.
 *
 * Retourne null si :
 * - L'user n'a aucune structurePerGame
 * - La structure choisie est inactive / supprimée
 *
 * Performance : 2 reads Firestore au plus (structure doc + sub_teams query
 * filtrée). Pas de fan-out coûteux. Compatible avec le budget de génération
 * d'OG image (typiquement < 1s).
 *
 * @param data le doc user Firestore (raw)
 * @param db instance Admin Firestore
 * @param ogPrefs préférences user (lit primaryGameForStructure)
 */
export async function loadUserStructureForOg(
  data: Record<string, unknown>,
  db: import('firebase-admin').firestore.Firestore,
  ogPrefs: OgDisplayPreferences | null,
): Promise<UserOgStructureBlock | null> {
  const uid = typeof data.uid === 'string' ? data.uid : null;
  if (!uid) return null;

  const struct = (data.structurePerGame ?? {}) as Record<string, string | string[]>;
  const gameIdsWithStruct = Object.keys(struct).filter(g => {
    const v = struct[g];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });
  if (gameIdsWithStruct.length === 0) return null;

  // Game cible : préférence user si valide, sinon premier disponible.
  const preferred = ogPrefs?.primaryGameForStructure;
  const targetGame = (preferred && gameIdsWithStruct.includes(preferred))
    ? preferred
    : gameIdsWithStruct[0];

  // Structure ID (premier si array — format multi-structures par jeu).
  const structRaw = struct[targetGame];
  const structId = Array.isArray(structRaw) ? structRaw[0] : structRaw;
  if (!structId || typeof structId !== 'string') return null;

  // Fetch structure (skippe si inactive / supprimée).
  let sSnap;
  try {
    sSnap = await db.collection('structures').doc(structId).get();
  } catch {
    return null;
  }
  if (!sSnap.exists) return null;
  const sData = sSnap.data() ?? {};
  if (sData.status !== 'active') return null;
  const structure = {
    name: (typeof sData.name === 'string' ? sData.name : '') || '',
    tag: (typeof sData.tag === 'string' ? sData.tag : '') || '',
    logoUrl: (typeof sData.logoUrl === 'string' ? sData.logoUrl : '') || '',
    slug: typeof sData.slug === 'string' ? sData.slug : null,
  };

  // Cherche l'équipe du user dans cette structure pour ce jeu.
  let team: UserOgStructureBlock['team'] = null;
  try {
    const teamSnap = await db.collection('sub_teams')
      .where('structureId', '==', structId)
      .where('game', '==', targetGame)
      .get();
    for (const t of teamSnap.docs) {
      const td = t.data() ?? {};
      if ((td.status ?? 'active') === 'archived') continue;
      const playerIds = Array.isArray(td.playerIds) ? td.playerIds as string[] : [];
      const subIds = Array.isArray(td.subIds) ? td.subIds as string[] : [];
      const staffIds = Array.isArray(td.staffIds) ? td.staffIds as string[] : [];
      const captainId = typeof td.captainId === 'string' ? td.captainId : null;
      if (playerIds.includes(uid) || subIds.includes(uid) || staffIds.includes(uid) || captainId === uid) {
        team = {
          name: (typeof td.name === 'string' ? td.name : '') || '',
          game: targetGame,
        };
        break;
      }
    }
  } catch {
    /* index manquant ou erreur réseau → on continue sans équipe */
  }

  return { structure, team };
}

// ─── Contraste texte selon couleur de fond ──────────────────────────────────
/**
 * Choisit le texte (noir ou blanc) le plus lisible sur un fond donné via la
 * formule de luminance perçue (W3C). Pratique quand on rend une chip avec une
 * couleur de fond dynamique (ex: chip jeu remplie de la couleur officielle).
 *
 * @param hexBg couleur hex `#RRGGBB` ou `#RGB` (avec ou sans `#`)
 * @returns `#000000` si le bg est clair (luminance > 128), `#ffffff` sinon
 */
export function bestTextColor(hexBg: string): string {
  const m = (hexBg || '').replace('#', '').trim();
  let r = 0, g = 0, b = 0;
  if (m.length === 6) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  } else if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else {
    // Format inconnu (ex: `var(--s-...)`) → on suppose un bg foncé (majorité
    // des couleurs jeu) et on renvoie texte blanc.
    return '#ffffff';
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#ffffff';
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 128 ? '#000000' : '#ffffff';
}
