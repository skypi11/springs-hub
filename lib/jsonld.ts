// Builders JSON-LD schema.org pour Aedral.
//
// Objectif : enrichir les rich results Google en exposant des schemas
// structurés sur les pages publiques (layout racine, structures publiques,
// profils joueurs, articles changelog/guide, breadcrumbs des pages profondes).
//
// Convention : chaque builder est pur, sans side-effect, retourne un objet
// JSON-LD prêt à JSON.stringify. Les champs optionnels absents ne sont pas
// inclus dans la sortie (pas de `undefined` ni de `null` parasites qui
// pollueraient les Rich Results de Google).
//
// Utilisation côté UI : passer les objets au composant <JsonLd schemas={[...]}/>
// (components/seo/JsonLd.tsx) qui les injecte dans un <script type="application/ld+json">.

// Type de sortie commun : un objet JSON-LD typé "loose" mais sérialisable.
// On garde Record<string, unknown> pour éviter d'avoir à modéliser tout
// schema.org en TypeScript — l'important c'est que ce soit JSON-safe.
export type JsonLdObject = Record<string, unknown>;

// Contexte JSON-LD partagé par tous les schemas schema.org.
const SCHEMA_CONTEXT = 'https://schema.org';

// ===========================================================================
// WebSite — pour le layout racine de aedral.com.
// Permet à Google d'afficher une sitelinks search box si searchUrl est fourni.
// ===========================================================================

export interface WebsiteSchemaInput {
  url: string;
  name: string;
  description?: string;
  /** URL template avec placeholder `{search_term_string}` pour la sitelinks search box Google. */
  searchUrl?: string;
}

/** Builder WebSite — utilisé une seule fois dans le layout racine. */
export function websiteSchema(input: WebsiteSchemaInput): JsonLdObject {
  const out: JsonLdObject = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'WebSite',
    url: input.url,
    name: input.name,
  };
  if (input.description) out.description = input.description;
  if (input.searchUrl) {
    out.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: input.searchUrl,
      },
      'query-input': 'required name=search_term_string',
    };
  }
  return out;
}

// ===========================================================================
// Organization — pour le layout racine (Aedral en tant qu'éditeur).
// ===========================================================================

export interface OrganizationSchemaInput {
  url: string;
  name: string;
  logo: string;
  /** Profils sociaux officiels (Discord, Twitter, etc.). */
  sameAs?: string[];
}

/** Builder Organization — utilisé dans le layout racine pour identifier Aedral. */
export function organizationSchema(input: OrganizationSchemaInput): JsonLdObject {
  const out: JsonLdObject = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Organization',
    url: input.url,
    name: input.name,
    logo: input.logo,
  };
  if (input.sameAs && input.sameAs.length > 0) {
    out.sameAs = [...input.sameAs];
  }
  return out;
}

// ===========================================================================
// SportsOrganization — pour les pages publiques de structures.
// Sous-type d'Organization, dédié aux clubs/équipes sportives (esport inclus).
// ===========================================================================

export interface SportsOrganizationSchemaInput {
  url: string;
  name: string;
  logo?: string;
  description?: string;
  /** Discipline pratiquée. Par défaut "Esport". */
  sport?: string;
  /** Date ISO YYYY-MM-DD de création de la structure. */
  foundingDate?: string;
}

/** Builder SportsOrganization — utilisé sur /community/structure/[id]. */
export function sportsOrganizationSchema(input: SportsOrganizationSchemaInput): JsonLdObject {
  const out: JsonLdObject = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'SportsOrganization',
    url: input.url,
    name: input.name,
    sport: input.sport ?? 'Esport',
  };
  if (input.logo) out.logo = input.logo;
  if (input.description) out.description = input.description;
  if (input.foundingDate) out.foundingDate = input.foundingDate;
  return out;
}

// ===========================================================================
// Person — pour les pages publiques de profils joueurs (/profile/[slug]).
// `knowsAbout` = jeux pratiqués (RL, TM, Valorant).
// ===========================================================================

export interface PersonSchemaInput {
  url: string;
  name: string;
  image?: string;
  /** Pays (ISO ou nom complet). */
  nationality?: string;
  /** Sujets connus — typiquement les jeux pratiqués. */
  knowsAbout?: string[];
}

/** Builder Person — utilisé sur /profile/[slug]. Pas d'image si absente. */
export function personSchema(input: PersonSchemaInput): JsonLdObject {
  const out: JsonLdObject = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Person',
    url: input.url,
    name: input.name,
  };
  if (input.image) out.image = input.image;
  if (input.nationality) out.nationality = input.nationality;
  if (input.knowsAbout && input.knowsAbout.length > 0) {
    out.knowsAbout = [...input.knowsAbout];
  }
  return out;
}

// ===========================================================================
// BreadcrumbList — pour toute page profonde (structure, profil, changelog…).
// Améliore l'affichage du chemin de navigation dans les SERP Google.
// ===========================================================================

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Builder BreadcrumbList — position auto-incrémentée (1, 2, 3…).
 * Utilisé sur toute page profonde pour afficher le fil d'Ariane dans Google.
 */
export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': SCHEMA_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ===========================================================================
// Article — pour /changelog et /guide.
// ===========================================================================

export interface ArticleSchemaInput {
  url: string;
  headline: string;
  description: string;
  /** Date ISO 8601 (YYYY-MM-DD ou full datetime). */
  datePublished?: string;
  /** Date ISO 8601 de dernière modif. */
  dateModified?: string;
  /** Nom de l'auteur (Person). Par défaut on suppose une Organization (Aedral). */
  author?: string;
}

/** Builder Article — utilisé sur /changelog (chaque patch note) et /guide. */
export function articleSchema(input: ArticleSchemaInput): JsonLdObject {
  const out: JsonLdObject = {
    '@context': SCHEMA_CONTEXT,
    '@type': 'Article',
    url: input.url,
    headline: input.headline,
    description: input.description,
  };
  if (input.datePublished) out.datePublished = input.datePublished;
  if (input.dateModified) out.dateModified = input.dateModified;
  if (input.author) {
    out.author = {
      '@type': 'Person',
      name: input.author,
    };
  }
  return out;
}
