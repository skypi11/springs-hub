import type { MetadataRoute } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';

// Sitemap dynamique d'Aedral — listé dans robots.ts. Sert à Google/Bing pour
// découvrir les pages indexables sans avoir à crawler tout le site.
//
// Composition :
//   - Pages statiques publiques (racine, guide, changelog, annuaires)
//   - Structures actives (1 URL par structure)
//   - Profils joueurs avec slug (les uid legacy `discord_SNOWFLAKE` sont exclus
//     pour ne pas exposer les snowflakes Discord à Google — voir mémoire
//     project_profile_slugs)
//
// Revalidate : 1 heure. Le sitemap n'a pas besoin d'être en temps réel —
// Google le recrawle tous les jours en pratique. 1h est un bon compromis
// fraicheur / coût Firestore.
export const revalidate = 3600;

const SITE_URL = 'https://aedral.com';

// Hard cap pour éviter qu'un bug ou une croissance imprévue ne génère
// un sitemap énorme. Au-delà, il faudra splitter en plusieurs sitemaps
// indexés via un sitemap-index.xml.
const MAX_STRUCTURES = 5000;
const MAX_PROFILES = 10000;

type SitemapEntry = MetadataRoute.Sitemap[number];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // Pages statiques. Priority indicative (Google les utilise peu, mais ça
  // ne coûte rien d'être explicite sur la hiérarchie).
  const staticEntries: SitemapEntry[] = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${SITE_URL}/community/structures`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/community/players`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/guide`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/changelog`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/competitions`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/legal/mentions`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/legal/confidentialite`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Si Firestore est down ou que la build tourne hors-ligne, on retourne
  // au moins les pages statiques plutôt que de péter complètement.
  let dynamicEntries: SitemapEntry[] = [];
  try {
    dynamicEntries = await loadDynamicEntries();
  } catch (err) {
    console.warn('[sitemap] Erreur fetch dynamic entries — sitemap statique uniquement', err);
  }

  return [...staticEntries, ...dynamicEntries];
}

async function loadDynamicEntries(): Promise<SitemapEntry[]> {
  const db = getAdminDb();

  // Charger structures actives + profils en parallèle pour minimiser le temps
  // de build du sitemap.
  const [structuresSnap, usersSnap] = await Promise.all([
    db.collection('structures')
      .where('status', '==', 'active')
      .limit(MAX_STRUCTURES)
      .get(),
    // Tous les profils — on filtre côté code (pas de slug, banni, dev) car
    // Firestore ne sait pas combiner where('isBanned', '!=', true) + where('slug', '!=', null).
    db.collection('users').limit(MAX_PROFILES).get(),
  ]);

  const entries: SitemapEntry[] = [];

  // Structures
  for (const doc of structuresSnap.docs) {
    const data = doc.data();
    if (data.isDev === true) continue;
    const updatedAt = data.updatedAt?.toDate?.() ?? data.createdAt?.toDate?.() ?? new Date();
    entries.push({
      url: `${SITE_URL}/community/structure/${doc.id}`,
      lastModified: updatedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // Profils avec slug uniquement — les uid `discord_SNOWFLAKE` ne doivent pas
  // être indexés (privacy : on n'expose pas les snowflakes Discord à Google).
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (data.isBanned === true) continue;
    const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
    if (!slug) continue;
    const updatedAt = data.updatedAt?.toDate?.() ?? data.createdAt?.toDate?.() ?? new Date();
    entries.push({
      url: `${SITE_URL}/profile/${slug}`,
      lastModified: updatedAt,
      changeFrequency: 'weekly',
      priority: 0.5,
    });
  }

  return entries;
}
