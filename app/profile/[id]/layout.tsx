import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import { isLegacyUid } from '@/lib/user-slug';

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

  let displayName = '';
  let bio = '';
  let avatarUrl = '';
  let isBanned = false;
  let resolvedSlug = '';

  try {
    const db = getAdminDb();
    let userData: FirebaseFirestore.DocumentData | null = null;

    if (isLegacyUid(id)) {
      const snap = await db.collection('users').doc(id).get();
      if (snap.exists) userData = snap.data() ?? null;
    } else {
      // Lookup par slug
      const snap = await db.collection('users')
        .where('slug', '==', id)
        .limit(1)
        .get();
      if (!snap.empty) userData = snap.docs[0].data();
    }

    if (userData) {
      isBanned = userData.isBanned === true;
      displayName = typeof userData.displayName === 'string' ? userData.displayName : '';
      bio = typeof userData.bio === 'string' ? userData.bio : '';
      avatarUrl = typeof userData.discordAvatar === 'string' ? userData.discordAvatar : '';
      resolvedSlug = typeof userData.slug === 'string' ? userData.slug : '';
    }
  } catch (err) {
    console.warn('[profile metadata] fetch error', err);
  }

  // Banni ou introuvable → metadata minimale + noindex pour ne pas polluer Google
  if (isBanned || !displayName) {
    return {
      title: 'Profil joueur',
      description: 'Profil joueur sur Aedral.',
      robots: { index: false, follow: false },
    };
  }

  // Canonical : si on a un slug, c'est la version canonique de l'URL.
  // Si on est arrivé via l'uid legacy, on pointe vers la version slug pour
  // éviter le duplicate content (Google dédupliquera).
  const canonical = resolvedSlug ? `/profile/${resolvedSlug}` : `/profile/${id}`;

  const cleanBio = bio.replace(/\s+/g, ' ').trim();
  const shortDesc = cleanBio.length > 0
    ? (cleanBio.length > 150 ? cleanBio.slice(0, 147) + '…' : cleanBio)
    : `Profil de ${displayName} sur Aedral, plateforme communautaire esport amateur.`;

  return {
    title: displayName,
    description: shortDesc,
    alternates: { canonical },
    openGraph: {
      title: `${displayName} · Aedral`,
      description: shortDesc,
      url: canonical,
      type: 'profile',
      ...(avatarUrl ? { images: [{ url: avatarUrl, alt: `Avatar de ${displayName}` }] } : {}),
    },
    twitter: {
      title: `${displayName} · Aedral`,
      description: shortDesc,
      ...(avatarUrl ? { images: [avatarUrl] } : {}),
    },
  };
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
