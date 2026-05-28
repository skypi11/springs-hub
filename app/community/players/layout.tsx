import type { Metadata } from 'next';

// Metadata SEO pour l'annuaire public des joueurs (rendu client).
export const metadata: Metadata = {
  title: 'Annuaire joueurs',
  description:
    "Annuaire des joueurs esport amateur sur Aedral. Filtre par jeu, pays, rang, statut de recrutement. Trouve tes prochains coéquipiers ou repère des talents pour ta structure.",
  alternates: { canonical: '/community/players' },
  openGraph: {
    title: 'Annuaire joueurs — Aedral',
    description:
      "Annuaire des joueurs esport amateur. Filtre par jeu, pays, rang, statut recrutement.",
    url: '/community/players',
    type: 'website',
  },
  twitter: {
    title: 'Annuaire joueurs — Aedral',
    description: "Annuaire des joueurs esport amateur.",
  },
};

export default function PlayersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
