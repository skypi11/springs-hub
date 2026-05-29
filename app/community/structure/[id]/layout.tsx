import type { Metadata } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';
import JsonLd from '@/components/seo/JsonLd';
import { sportsOrganizationSchema, breadcrumbSchema } from '@/lib/jsonld';

// Données minimales sur la structure utilisées à la fois par la metadata et par
// le JSON-LD rendu côté server. On les fetche une fois dans `loadStructure`,
// puis le layout les ré-utilise dans `generateMetadata` ET dans le render.
interface StructurePublicData {
  name: string;
  tag: string;
  description: string;
  logoUrl: string;
  games: string[];
  /** Date ISO YYYY-MM-DD si on a réussi à parser createdAt, sinon vide. */
  foundingDate: string;
  active: boolean;
}

const EMPTY: StructurePublicData = {
  name: '',
  tag: '',
  description: '',
  logoUrl: '',
  games: [],
  foundingDate: '',
  active: false,
};

async function loadStructure(id: string): Promise<StructurePublicData> {
  try {
    const db = getAdminDb();
    const snap = await db.collection('structures').doc(id).get();
    if (!snap.exists) return EMPTY;
    const data = snap.data()!;
    // On ne traite comme "publique active" que les structures status === 'active'.
    // Les pending/suspended retombent sur le fallback (pas de JSON-LD, metadata minimale).
    if (data.status !== 'active') return EMPTY;

    // createdAt peut être un Firestore Timestamp ou un Date — on essaie de le
    // sérialiser en ISO YYYY-MM-DD pour `foundingDate` du schema.
    let foundingDate = '';
    try {
      const c = data.createdAt;
      if (c && typeof c.toDate === 'function') {
        foundingDate = (c.toDate() as Date).toISOString().slice(0, 10);
      } else if (c instanceof Date) {
        foundingDate = c.toISOString().slice(0, 10);
      }
    } catch {
      foundingDate = '';
    }

    return {
      name: typeof data.name === 'string' ? data.name : '',
      tag: typeof data.tag === 'string' ? data.tag : '',
      description: typeof data.description === 'string' ? data.description : '',
      logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : '',
      games: Array.isArray(data.games) ? data.games : [],
      foundingDate,
      active: true,
    };
  } catch (err) {
    console.warn('[structure metadata] fetch error', err);
    return EMPTY;
  }
}

// Metadata SEO dynamique pour les pages publiques de structure.
// Fetch direct via Admin SDK (pas via HTTP) pour éviter une boucle réseau
// pendant le rendu serveur. Si la structure n'existe pas ou est privée,
// on retourne un title générique sans 404 (la page elle-même gère l'erreur).
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const s = await loadStructure(id);

  // Fallback si structure introuvable ou non active
  if (!s.active || !s.name) {
    return {
      title: 'Structure',
      description: "Page publique d'une structure esport amateur sur Aedral.",
      alternates: { canonical: `/community/structure/${id}` },
    };
  }

  // Tronque la description structure pour rester dans les ~155 chars Google
  const cleanDesc = s.description.replace(/\s+/g, ' ').trim();
  const shortDesc = cleanDesc.length > 0
    ? (cleanDesc.length > 150 ? cleanDesc.slice(0, 147) + '…' : cleanDesc)
    : `${s.name}, structure esport amateur sur Aedral${s.games.length > 0 ? ` (${s.games.length} jeu${s.games.length > 1 ? 'x' : ''})` : ''}.`;

  const title = s.tag ? `${s.name} [${s.tag}]` : s.name;
  const url = `/community/structure/${id}`;

  // OG image dynamique générée par /api/og/structure/[id] (bannière 1200×630
  // riche : nom, tag, logo, jeux). On utilise l'URL absolue car Discord/Twitter
  // refusent les paths relatifs même avec metadataBase configuré.
  const ogImageUrl = `https://aedral.com/api/og/structure/${id}`;
  const ogImages: { url: string; alt: string }[] = [
    { url: ogImageUrl, alt: `${s.name} sur Aedral` },
  ];
  // Logo direct en fallback secondaire (utilisé si la bannière OG plante).
  if (s.logoUrl) {
    ogImages.push({ url: s.logoUrl, alt: `Logo ${s.name}` });
  }

  return {
    title,
    description: shortDesc,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} · Aedral`,
      description: shortDesc,
      url,
      type: 'profile',
      images: ogImages,
    },
    twitter: {
      title: `${title} · Aedral`,
      description: shortDesc,
      images: ogImages.map((img) => img.url),
    },
  };
}

export default async function StructureLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const s = await loadStructure(id);

  // Pas de JSON-LD si la structure n'est pas active : on n'a aucune raison de
  // proposer une entité publique à Google pour une structure introuvable, en
  // attente de validation, ou suspendue.
  if (!s.active || !s.name) {
    return <>{children}</>;
  }

  const url = `https://aedral.com/community/structure/${id}`;
  const cleanDesc = s.description.replace(/\s+/g, ' ').trim();

  const schemas = [
    sportsOrganizationSchema({
      url,
      name: s.name,
      logo: s.logoUrl || undefined,
      description: cleanDesc || undefined,
      foundingDate: s.foundingDate || undefined,
    }),
    breadcrumbSchema([
      { name: 'Aedral', url: 'https://aedral.com' },
      { name: 'Communauté', url: 'https://aedral.com/community' },
      { name: 'Structures', url: 'https://aedral.com/community/structures' },
      { name: s.tag ? `${s.name} [${s.tag}]` : s.name, url },
    ]),
  ];

  return (
    <>
      <JsonLd schemas={schemas} />
      {children}
    </>
  );
}
