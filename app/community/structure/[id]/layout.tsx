import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';

// Metadata SEO dynamique pour les pages publiques de structure.
// Fetch direct via Admin SDK (pas via HTTP) pour éviter une boucle réseau
// pendant le rendu serveur. Si la structure n'existe pas ou est privée,
// on retourne un title générique sans 404 (la page elle-même gère l'erreur).
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;

  let name = '';
  let tag = '';
  let description = '';
  let logoUrl = '';
  let games: string[] = [];

  try {
    const db = getAdminDb();
    const snap = await db.collection('structures').doc(id).get();
    if (snap.exists) {
      const data = snap.data()!;
      // On ne génère du SEO que pour les structures actives (les pending/suspended
      // restent indexées avec un titre minimal sans dévoiler de détails).
      if (data.status === 'active') {
        name = typeof data.name === 'string' ? data.name : '';
        tag = typeof data.tag === 'string' ? data.tag : '';
        description = typeof data.description === 'string' ? data.description : '';
        logoUrl = typeof data.logoUrl === 'string' ? data.logoUrl : '';
        games = Array.isArray(data.games) ? data.games : [];
      }
    }
  } catch (err) {
    console.warn('[structure metadata] fetch error', err);
  }

  // Fallback si structure introuvable ou non active
  if (!name) {
    return {
      title: 'Structure',
      description: "Page publique d'une structure esport amateur sur Aedral.",
      alternates: { canonical: `/community/structure/${id}` },
    };
  }

  // Tronque la description structure pour rester dans les ~155 chars Google
  const cleanDesc = description.replace(/\s+/g, ' ').trim();
  const shortDesc = cleanDesc.length > 0
    ? (cleanDesc.length > 150 ? cleanDesc.slice(0, 147) + '…' : cleanDesc)
    : `${name} — structure esport amateur sur Aedral${games.length > 0 ? ` (${games.length} jeu${games.length > 1 ? 'x' : ''})` : ''}.`;

  const title = tag ? `${name} [${tag}]` : name;
  const url = `/community/structure/${id}`;

  return {
    title,
    description: shortDesc,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} — Aedral`,
      description: shortDesc,
      url,
      type: 'profile',
      // Si la structure a un logo custom, on l'utilise en OG image — sinon
      // fallback sur l'image OG racine d'Aedral (auto via Next.js).
      ...(logoUrl ? { images: [{ url: logoUrl, alt: `Logo ${name}` }] } : {}),
    },
    twitter: {
      title: `${title} — Aedral`,
      description: shortDesc,
      ...(logoUrl ? { images: [logoUrl] } : {}),
    },
  };
}

export default function StructureLayout({ children }: { children: React.ReactNode }) {
  return children;
}
