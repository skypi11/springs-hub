// Helpers pour les slugs de structures, utilisés dans les URLs publiques type
// /community/structure/timetoshine plutôt que /community/structure/fjUNrMQfPwiEisZcVixX.
//
// Architecture calquée sur lib/user-slug.ts (testé, éprouvé sur le chantier profil).
// On veut le même niveau de qualité ici : déterministe, scalable à 2-5k users
// (potentiellement 200+ structures), rétrocompat absolue avec les anciens
// Firestore docIds (la page [id] doit accepter les deux et faire un 301 vers
// la version slug — la redirection elle-même est gérée dans la page côté
// app/community/structure/[id]/page.tsx).
//
// Source du slug = `structure.name` (ex: "TimeToShine"). On NE prend PAS le
// `tag` (3-5 lettres) car les collisions seraient ingérables à 200+ structures
// et un slug "ttc" est moins parlant qu'un "timetoshine".
//
// Le slug est figé à la création et non modifiable en self-service à ce stade —
// changer le slug après-coup casse les liens externes (Discord, partages, SEO).

import type { Firestore } from 'firebase-admin/firestore';

/** Longueur minimale d'un slug structure, évite les collisions avec des routes courtes. */
export const MIN_STRUCTURE_SLUG_LENGTH = 3;
/** Longueur maximale, au-delà l'URL devient peu pratique à partager. */
export const MAX_STRUCTURE_SLUG_LENGTH = 32;

/**
 * Slugs réservés qui ne peuvent JAMAIS être utilisés (collision avec d'autres
 * routes ou mots-clés sensibles).
 *
 * On reprend la liste générique de user-slug.ts et on ajoute les mots-clés
 * spécifiques aux pages structures (request, create, browse...).
 */
export const RESERVED_STRUCTURE_SLUGS = new Set<string>([
  // Pages techniques (idem RESERVED_SLUGS user-slug)
  'admin', 'api', 'settings', 'community', 'competitions', 'profile',
  'guide', 'login', 'logout', 'auth', 'help', 'about', 'legal', 'privacy',
  // Mots discriminants
  'aedral', 'springs', 'null', 'undefined', 'system', 'bot', 'support',
  // Patterns id legacy
  'discord', 'steam', 'epic',
  // Sous-routes & verbes des pages structures (à protéger en plus)
  'request', 'create', 'new', 'search', 'filter', 'browse',
  'all', 'list', 'my', 'manage',
]);

/**
 * Génère le slug "de base" depuis un nom de structure :
 * - Décompose les caractères accentués (é → e)
 * - Lowercase
 * - Remplace tout non-alphanumérique par un tiret
 * - Trim les tirets en début/fin, collapse les tirets multiples
 *
 * Le résultat n'est PAS garanti unique, voir generateUniqueStructureSlug pour ça.
 */
export function generateBaseStructureSlug(name: string): string {
  const normalized = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents combinants
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  // Tronque proprement à MAX_STRUCTURE_SLUG_LENGTH sans laisser un tiret final
  if (normalized.length > MAX_STRUCTURE_SLUG_LENGTH) {
    const truncated = normalized.slice(0, MAX_STRUCTURE_SLUG_LENGTH).replace(/-+$/, '');
    return truncated;
  }
  return normalized;
}

/**
 * Validation côté serveur : true si le slug est utilisable pour être stocké
 * ou exposé publiquement.
 */
export function isValidStructureSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length < MIN_STRUCTURE_SLUG_LENGTH || slug.length > MAX_STRUCTURE_SLUG_LENGTH) return false;
  // Alphanum + tirets, pas en bord (slug d'au moins 2 chars match aussi le double-borne)
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false;
  if (RESERVED_STRUCTURE_SLUGS.has(slug)) return false;
  return true;
}

/**
 * Détecte si une chaîne ressemble à un Firestore docId auto-généré (legacy URLs)
 * plutôt qu'à un slug propre.
 *
 * Critères (les deux suffisent indépendamment) :
 *  1. Contient au moins une lettre majuscule → impossible pour un slug
 *     (les slugs sont strictement lowercase + chiffres + tirets).
 *  2. Longueur exactement 20 et composé uniquement de [A-Za-z0-9] → signature
 *     très probable d'un docId Firestore auto. On garde ce check même quand
 *     le critère (1) n'est pas rempli pour couvrir le cas extrêmement rare
 *     d'un docId tombé en tout-lowercase + digits (~1 / 26^20 mais possible).
 *
 * Utilisé par /community/structure/[id]/page.tsx pour décider du lookup
 * (docId direct vs `where('slug', '==', ...)`) et déclencher un 301.
 */
export function isLegacyStructureId(idOrSlug: string): boolean {
  if (!idOrSlug || typeof idOrSlug !== 'string') return false;
  // Critère 1 : présence d'au moins une majuscule → forcément un docId
  if (/[A-Z]/.test(idOrSlug)) return true;
  // Critère 2 : longueur 20 + uniquement alphanum (pas de tiret) → signature docId
  if (idOrSlug.length === 20 && /^[a-z0-9]+$/.test(idOrSlug)) return true;
  return false;
}

/**
 * Génère un slug unique en testant l'unicité Firestore sur la collection
 * `structures`, champ `slug`.
 *
 * Si baseSlug est déjà pris, on essaye baseSlug-2, baseSlug-3, ..., -99.
 * Au-delà (cas extrême), on tombe sur un suffixe random à 4 chiffres.
 *
 * @param baseSlug           slug de base, typiquement `generateBaseStructureSlug(name)`
 * @param db                 instance Firestore Admin
 * @param excludeStructureId si on regénère pour une structure existante, ne pas
 *                           considérer son propre doc comme une collision
 */
export async function generateUniqueStructureSlug(
  baseSlug: string,
  db: Firestore,
  excludeStructureId?: string,
): Promise<string> {
  // Fallback si le baseSlug est vide ou trop court (nom uniquement composé de
  // caractères non-ASCII par exemple → tout est strippé par la normalisation).
  let safeBase = baseSlug;
  if (safeBase.length < MIN_STRUCTURE_SLUG_LENGTH) {
    safeBase = `structure-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  if (RESERVED_STRUCTURE_SLUGS.has(safeBase)) {
    safeBase = `${safeBase}-team`;
  }

  const isFree = async (candidate: string): Promise<boolean> => {
    const snap = await db.collection('structures').where('slug', '==', candidate).limit(1).get();
    if (snap.empty) return true;
    if (excludeStructureId && snap.docs[0].id === excludeStructureId) return true;
    return false;
  };

  if (await isFree(safeBase)) return safeBase;

  // Essaye baseSlug-2, baseSlug-3, ..., baseSlug-99
  for (let i = 2; i <= 99; i++) {
    const candidate = `${safeBase}-${i}`;
    if (candidate.length > MAX_STRUCTURE_SLUG_LENGTH) {
      // Tronque la base pour faire de la place au suffixe numérique
      const truncated = safeBase
        .slice(0, MAX_STRUCTURE_SLUG_LENGTH - String(i).length - 1)
        .replace(/-+$/, '');
      const altCandidate = `${truncated}-${i}`;
      if (await isFree(altCandidate)) return altCandidate;
      continue;
    }
    if (await isFree(candidate)) return candidate;
  }

  // Fallback ultra rare : suffix random 4 chiffres
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    const candidate = `${safeBase.slice(0, MAX_STRUCTURE_SLUG_LENGTH - 5)}-${suffix}`;
    if (await isFree(candidate)) return candidate;
  }

  // Catastrophe, on ne devrait jamais arriver ici en pratique
  throw new Error(`Impossible de générer un slug unique pour "${baseSlug}" après 100+ tentatives`);
}

/**
 * Helper client pour construire un href de page structure. Utilise le slug si
 * disponible, sinon fallback sur l'id Firestore (compat ascendante pendant la
 * transition vers les slugs).
 *
 * Usage : <Link href={getStructureHref(structure)}>...</Link>
 */
export function getStructureHref(
  structure: { slug?: string | null; id: string } | null | undefined,
): string {
  if (!structure) return '#';
  const slug = structure.slug?.trim();
  return slug ? `/community/structure/${slug}` : `/community/structure/${structure.id}`;
}

/**
 * Variante quand on n'a qu'un identifiant (id OU slug) sous la main, sans
 * accès à l'objet structure complet. Préférer `getStructureHref()` quand
 * possible pour bénéficier du slug.
 */
export function getStructureHrefFromId(idOrSlug: string | null | undefined): string {
  if (!idOrSlug) return '#';
  return `/community/structure/${idOrSlug}`;
}
