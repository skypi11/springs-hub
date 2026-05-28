import type { Metadata } from 'next';

// Metadata SEO pour l'annuaire public des structures (rendu client).
export const metadata: Metadata = {
  title: 'Structures esport',
  description:
    "Annuaire public des structures esport amateur sur Aedral. Filtre par jeu (Rocket League, Trackmania, Valorant), découvre les organisations qui recrutent et postule directement.",
  alternates: { canonical: '/community/structures' },
  openGraph: {
    title: 'Structures esport · Aedral',
    description:
      "Annuaire public des structures esport amateur. Filtre par jeu, découvre celles qui recrutent.",
    url: '/community/structures',
    type: 'website',
  },
  twitter: {
    title: 'Structures esport · Aedral',
    description: "Annuaire public des structures esport amateur.",
  },
};

export default function StructuresLayout({ children }: { children: React.ReactNode }) {
  return children;
}
