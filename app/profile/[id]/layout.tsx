import type { Metadata } from 'next';
import { cache } from 'react';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyUid } from '@/lib/user-slug';
import JsonLd from '@/components/seo/JsonLd';
import { personSchema, breadcrumbSchema } from '@/lib/jsonld';
import { getGameLabel } from '@/lib/games-registry';

// Données publiques sur le profil, partagées entre `generateMetadata` et le
// render server du layout. Si `isBanned` ou pas de `displayName`, on émet zéro
// JSON-LD et la metadata bascule sur noindex (déjà géré).
interface ProfilePublicData {
  displayName: string;
  bio: string;
  avatarUrl: string;
  slug: string;
  country: string;
  games: string[];
  isBanned: boolean;
  found: boolean;
}

const EMPTY: ProfilePublicData = {
  displayName: '',
  bio: '',
  avatarUrl: '',
  slug: '',
  country: '',
  games: [],
  isBanned: false,
  found: false,
};

/**
 * ⚠️ ENVELOPPÉ DANS `cache()` — ET CE N'EST PAS DÉCORATIF.
 *
 * Cette fonction est appelée DEUX FOIS par affichage de page : une fois par
 * `generateMetadata`, une fois par le layout lui-même. Sans mémoïsation, c'était
 * donc deux lectures Firestore identiques à chaque visite (constaté le
 * 11/08/2026 en cherchant d'où venait la consommation processeur du site).
 *
 * `cache()` de React mémoïse pour la DURÉE D'UNE REQUÊTE : les deux appels
 * partagent désormais un seul aller-retour, et rien n'est conservé d'une visite
 * à l'autre — aucun risque de servir le profil d'un joueur à la place d'un autre.
 */
const loadProfile = cache(async function loadProfile(id: string): Promise<ProfilePublicData> {
  try {
    const db = getAdminDb();
    let userData: FirebaseFirestore.DocumentData | null = null;

    if (isLegacyUid(id)) {
      const snap = await db.collection('users').doc(id).get();
      if (snap.exists) userData = snap.data() ?? null;
    } else {
      const snap = await db.collection('users')
        .where('slug', '==', id)
        .limit(1)
        .get();
      if (!snap.empty) userData = snap.docs[0].data();
    }

    if (!userData) return EMPTY;

    return {
      displayName: typeof userData.displayName === 'string' ? userData.displayName : '',
      bio: typeof userData.bio === 'string' ? userData.bio : '',
      avatarUrl: typeof userData.discordAvatar === 'string' ? userData.discordAvatar : '',
      slug: typeof userData.slug === 'string' ? userData.slug : '',
      country: typeof userData.country === 'string' ? userData.country : '',
      games: Array.isArray(userData.games) ? userData.games : [],
      isBanned: userData.isBanned === true,
      found: true,
    };
  } catch (err) {
    console.warn('[profile metadata] fetch error', err);
    return EMPTY;
  }
});

/**
 * La page se met en cache, et c'est sans conséquence visible.
 *
 * Ce layout ne rend QUE des métadonnées (titre, description, image de partage)
 * et du JSON-LD. La page elle-même est un composant client : tout ce que le
 * joueur lit — pseudo, bio, rangs, équipes — est chargé par l'API après
 * affichage. **Le HTML produit ici ne contient donc aucune donnée de visiteur**,
 * et le mettre en cache ne peut pas montrer le profil de l'un à un autre.
 *
 * Sans cette ligne, la lecture Firestore ci-dessus interdit à Next.js de
 * pré-rendre : chaque visite, chaque passage de robot d'indexation payait un
 * rendu serveur complet. `/profile/[id]` était de loin la route la plus
 * coûteuse du site (mesuré le 11/08 : 20 invocations, plus que toutes les
 * routes d'API réunies).
 *
 * 15 minutes : assez long pour absorber les rafales de robots, assez court pour
 * qu'un joueur qui vient de changer son pseudo retrouve un partage Discord à
 * jour rapidement. Un changement de profil reste visible IMMÉDIATEMENT sur le
 * site — seules les métadonnées attendent.
 */
export const revalidate = 900;

/**
 * Liste VIDE, et c'est volontaire : on ne pré-génère aucun profil au build.
 *
 * Sans cette fonction, Next.js traite une route à paramètre comme entièrement
 * dynamique et **ignore le `revalidate` ci-dessus** — vérifié le 11/08/2026 en
 * lisant l'en-tête de réponse en local, qui sortait en `no-cache, no-store`
 * malgré le réglage. La déclarer, même vide, fait basculer la route en cache à
 * la demande : le premier visiteur d'un profil paie le rendu, les suivants sont
 * servis depuis le cache pendant 15 minutes.
 *
 * On ne pré-génère pas la liste des profils au build parce qu'elle changerait à
 * chaque inscription : il faudrait recompiler le site pour qu'un nouveau joueur
 * ait une page.
 */
export async function generateStaticParams() {
  return [];
}

// Metadata SEO dynamique pour les pages publiques de profil joueur.
// Le param [id] peut être :
//   - un slug ("noxx") → lookup via where('slug', '==', id)
//   - un uid legacy ("discord_SNOWFLAKE") → lookup direct par doc id
//     ⚠️ Les uid legacy ne sont PAS indexés par le sitemap pour ne pas
//        exposer les snowflakes Discord à Google (privacy). Mais on génère
//        quand même la metadata si quelqu'un atterrit dessus via lien direct.
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const p = await loadProfile(id);

  // Banni ou introuvable → metadata minimale + noindex pour ne pas polluer Google
  if (p.isBanned || !p.displayName) {
    return {
      title: 'Profil joueur',
      description: 'Profil joueur sur Aedral.',
      robots: { index: false, follow: false },
    };
  }

  // Canonical : si on a un slug, c'est la version canonique de l'URL.
  // Si on est arrivé via l'uid legacy, on pointe vers la version slug pour
  // éviter le duplicate content (Google dédupliquera).
  const canonical = p.slug ? `/profile/${p.slug}` : `/profile/${id}`;

  const cleanBio = p.bio.replace(/\s+/g, ' ').trim();
  const shortDesc = cleanBio.length > 0
    ? (cleanBio.length > 150 ? cleanBio.slice(0, 147) + '…' : cleanBio)
    : `Profil de ${p.displayName} sur Aedral, plateforme communautaire esport amateur.`;

  // OG image dynamique via /api/og/profile/[slug]. On NE génère la bannière
  // riche QUE si on a un slug — pour ne PAS exposer le snowflake Discord dans
  // une URL publique d'embed (cf. mémoire `project_profile_slugs`). Sans slug,
  // fallback sur l'avatar Discord seul.
  //
  // IMPORTANT — UNE SEULE og:image : si on en passe plusieurs (bannière +
  // avatar), Discord choisit l'une comme thumbnail (petite, à gauche) et
  // l'autre comme image principale (à droite) → embed moche. On choisit la
  // bannière en priorité, sinon l'avatar seul.
  const ogImageUrl = p.slug
    ? `https://aedral.com/api/og/profile/${p.slug}`
    : (p.avatarUrl || null);
  const ogImage = ogImageUrl
    ? (p.slug
        ? { url: ogImageUrl, width: 1200, height: 630, alt: `${p.displayName} sur Aedral` }
        : { url: ogImageUrl, alt: `Avatar de ${p.displayName}` })
    : null;

  return {
    title: p.displayName,
    description: shortDesc,
    alternates: { canonical },
    openGraph: {
      title: `${p.displayName} · Aedral`,
      description: shortDesc,
      url: canonical,
      type: 'profile',
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: `${p.displayName} · Aedral`,
      description: shortDesc,
      ...(ogImage ? { images: [ogImage.url] } : {}),
    },
  };
}

export default async function ProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await loadProfile(id);

  // Banni / introuvable → noindex déjà géré par metadata + zéro JSON-LD pour
  // ne surtout pas exposer une entité Person à Google sur un profil masqué.
  if (p.isBanned || !p.displayName) {
    return <>{children}</>;
  }

  // URL canonique pour le JSON-LD : on utilise TOUJOURS le slug si dispo, jamais
  // l'uid legacy `discord_SNOWFLAKE` (privacy — l'uid ne doit jamais apparaître
  // en clair dans un embed Google). Si pas de slug, on omet le JSON-LD.
  if (!p.slug) {
    return <>{children}</>;
  }

  const publicUrl = `https://aedral.com/profile/${p.slug}`;
  // knowsAbout = jeux pratiqués, traduits via la registry pour avoir des labels
  // propres et localisés (Rocket League, Trackmania, Valorant…).
  const knowsAbout = p.games
    .map((g) => getGameLabel(g))
    .filter((label): label is string => typeof label === 'string' && label.length > 0);

  const schemas = [
    personSchema({
      url: publicUrl,
      name: p.displayName,
      image: p.avatarUrl || undefined,
      nationality: p.country || undefined,
      knowsAbout: knowsAbout.length > 0 ? knowsAbout : undefined,
    }),
    breadcrumbSchema([
      { name: 'Aedral', url: 'https://aedral.com' },
      { name: 'Communauté', url: 'https://aedral.com/community' },
      { name: 'Joueurs', url: 'https://aedral.com/community/players' },
      { name: p.displayName, url: publicUrl },
    ]),
  ];

  return (
    <>
      <JsonLd schemas={schemas} />
      {children}
    </>
  );
}
