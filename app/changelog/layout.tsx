import type { Metadata } from 'next';

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
  return children;
}
