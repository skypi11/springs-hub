import type { Metadata } from 'next';
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

async function loadProfile(id: string): Promise<ProfilePublicData> {
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
