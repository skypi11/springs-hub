// Helpers pour les slugs utilisateur, utilisés dans les URLs publiques de profil.
// On préfère exposer /profile/noxx-26 plutôt que /profile/discord_1432... pour 3 raisons :
//   1. Sécurité : le Discord snowflake permet d'être mentionné en raw (<@id>)
//      dans n'importe quel guild commun → facilite le ping ciblé.
//   2. UX : URLs lisibles, partageables, mémorisables.
//   3. Alignement industrie : FACEIT, Tracker.gg, Battlefy, Twitch utilisent
//      tous des slugs publics, jamais l'ID interne.
//
// Le slug est généré 1 fois au signup à partir du displayName, puis figé.
// L'user peut le changer plus tard dans ses settings (à coder dans un lot
// dédié, pour l'instant le slug est read-only après création).

import type { Firestore } from 'firebase-admin/firestore';

/** Longueur minimale d'un slug, évite les collisions avec d'autres routes courtes. */
export const MIN_SLUG_LENGTH = 3;
/** Longueur maximale, au-delà l'URL devient peu pratique. */
export const MAX_SLUG_LENGTH = 32;

/** Slugs réservés qui ne peuvent JAMAIS être utilisés (collision avec d'autres routes ou mots-clés sensibles). */
const RESERVED_SLUGS = new Set([
  // Pages techniques
  'admin', 'api', 'settings', 'community', 'competitions', 'profile',
  'guide', 'login', 'logout', 'auth', 'help', 'about', 'legal', 'privacy',
  // Mots discriminants
  'aedral', 'springs', 'null', 'undefined', 'system', 'bot', 'support',
  // Patterns id legacy
  'discord', 'steam', 'epic',
]);

/**
 * Génère le slug "de base" depuis un displayName :
 * - Décompose les caractères accentués (é → e)
 * - Lowercase
 * - Remplace tout non-alphanumérique par un tiret
 * - Trim les tirets en début/fin, collapse les tirets multiples
 *
 * Le résultat n'est PAS garanti unique, voir generateUniqueSlug pour ça.
 */
export function generateBaseSlug(displayName: string): string {
  const normalized = (displayName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  // Tronque proprement à MAX_SLUG_LENGTH sans couper en plein milieu d'un tiret
  if (normalized.length > MAX_SLUG_LENGTH) {
    const truncated = normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
    return truncated;
  }
  return normalized;
}

/** Validation côté serveur, true si le slug est valide pour être stocké/utilisé. */
export function isValidSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false; // alphanum + tirets, pas en bord
  if (RESERVED_SLUGS.has(slug)) return false;
  // Empêche les patterns ressemblant à un uid Discord legacy
  if (slug.startsWith('discord-') || /^\d{15,20}$/.test(slug)) return false;
  return true;
}

/**
 * Détecte si une chaîne est un uid legacy `discord_SNOWFLAKE` (vs un slug).
 * Utilisé par la route /profile/[id] pour décider du lookup (uid direct vs slug).
 */
export function isLegacyUid(idOrSlug: string): boolean {
  return /^discord_\d{15,20}$/.test(idOrSlug);
}

/**
 * Génère un slug unique en testant l'unicité Firestore.
 * Si baseSlug est déjà pris, on essaye baseSlug-2, baseSlug-3, etc. jusqu'à 99.
 * Au-delà (cas extrême), on tombe sur un suffixe random à 4 chiffres.
 *
 * @param baseSlug   slug de base (souvent `generateBaseSlug(displayName)`)
 * @param db         instance Firestore Admin
 * @param excludeUid si on regénère pour un user existant, ne pas considérer
 *                   son propre doc comme une collision
 */
export async function generateUniqueSlug(
  baseSlug: string,
  db: Firestore,
  excludeUid?: string,
): Promise<string> {
  // Fallback si le baseSlug est vide ou trop court (cas d'un displayName uniquement composé de caractères non-ASCII)
  let safeBase = baseSlug;
  if (safeBase.length < MIN_SLUG_LENGTH) {
    safeBase = `user-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  if (RESERVED_SLUGS.has(safeBase)) {
    safeBase = `${safeBase}-user`;
  }

  const isFree = async (candidate: string): Promise<boolean> => {
    const snap = await db.collection('users').where('slug', '==', candidate).limit(1).get();
    if (snap.empty) return true;
    if (excludeUid && snap.docs[0].id === excludeUid) return true;
    return false;
  };

  if (await isFree(safeBase)) return safeBase;

  // Essaye baseSlug-2, baseSlug-3, ..., baseSlug-99
  for (let i = 2; i <= 99; i++) {
    const candidate = `${safeBase}-${i}`;
    if (candidate.length > MAX_SLUG_LENGTH) {
      // Tronque la base pour faire de la place au suffixe
      const truncated = safeBase.slice(0, MAX_SLUG_LENGTH - String(i).length - 1).replace(/-+$/, '');
      const altCandidate = `${truncated}-${i}`;
      if (await isFree(altCandidate)) return altCandidate;
      continue;
    }
    if (await isFree(candidate)) return candidate;
  }

  // Fallback ultra rare : suffix random 4 chiffres
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    const candidate = `${safeBase.slice(0, MAX_SLUG_LENGTH - 5)}-${suffix}`;
    if (await isFree(candidate)) return candidate;
  }

  // Catastrophe, on ne devrait jamais arriver ici en pratique
  throw new Error(`Impossible de générer un slug unique pour "${baseSlug}" après 100+ tentatives`);
}

/**
 * Helper client pour construire un href profil. Utilise le slug si disponible,
 * sinon fallback sur l'uid legacy (compat ascendante pendant la transition).
 *
 * Usage : <Link href={getProfileHref(user)}>...</Link>
 */
export function getProfileHref(user: { slug?: string | null; uid: string } | null | undefined): string {
  if (!user) return '#';
  const slug = user.slug?.trim();
  return slug ? `/profile/${slug}` : `/profile/${user.uid}`;
}

/**
 * Variante quand on n'a qu'un identifiant (uid OU slug) sous la main.
 * Pas idéal, préférer getProfileHref() avec l'objet user complet.
 */
export function getProfileHrefFromId(idOrSlug: string | null | undefined): string {
  if (!idOrSlug) return '#';
  return `/profile/${idOrSlug}`;
}
