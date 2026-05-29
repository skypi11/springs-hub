import type { Metadata } from 'next';
import JsonLd from '@/components/seo/JsonLd';
import { articleSchema, breadcrumbSchema } from '@/lib/jsonld';

// Metadata SEO pour la page Changelog (rendu client).
export const metadata: Metadata = {
  title: 'Nouveautés',
  description:
    "Tout ce qui a changé sur Aedral, dans l'ordre du plus récent. Patch notes par catégorie : nouvelles features, améliorations UX, corrections, sécurité.",
  alternates: { canonical: '/changelog' },
  openGraph: {
    title: 'Nouveautés Aedral',
    description: "Tout ce qui a changé sur Aedral, dans l'ordre du plus récent.",
    url: '/changelog',
    type: 'article',
  },
  twitter: {
    title: 'Nouveautés Aedral',
    description: "Patch notes par catégorie : features, UX, fixes, sécurité.",
  },
};

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  // JSON-LD : Article (Google traite la page Nouveautés comme un contenu
  // éditorial) + Breadcrumb (Aedral → Nouveautés).
  const schemas = [
    articleSchema({
      url: 'https://aedral.com/changelog',
      headline: 'Nouveautés Aedral',
      description:
        "Tout ce qui a changé sur Aedral, dans l'ordre du plus récent. Patch notes par catégorie : nouvelles features, améliorations UX, corrections, sécurité.",
      author: 'Aedral',
    }),
    breadcrumbSchema([
      { name: 'Aedral', url: 'https://aedral.com' },
      { name: 'Nouveautés', url: 'https://aedral.com/changelog' },
    ]),
  ];

  return (
    <>
      <JsonLd schemas={schemas} />
      {children}
    </>
  );
}
