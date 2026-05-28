import type { Metadata } from 'next';

// Metadata SEO pour la page Guide (rendu client). Le layout reste passif —
// il ne fait que poser les balises et laisser passer les children.
export const metadata: Metadata = {
  title: 'Guide : découvrir Aedral',
  description:
    "Le guide complet d'Aedral : profils vérifiés, structures et équipes, calendrier collaboratif avec consensus auto des dispos, recrutement, exercices, replays, bot Discord. Tout ce que tu peux faire sur la plateforme.",
  alternates: { canonical: '/guide' },
  openGraph: {
    title: 'Guide : découvrir Aedral',
    description:
      "Le guide complet d'Aedral : profils, structures, calendrier, recrutement, exercices, replays, bot Discord.",
    url: '/guide',
    type: 'article',
  },
  twitter: {
    title: 'Guide : découvrir Aedral',
    description: "Le guide complet d'Aedral : tout ce que tu peux faire sur la plateforme.",
  },
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
