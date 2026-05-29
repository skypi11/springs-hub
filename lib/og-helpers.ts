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
