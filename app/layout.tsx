import type { Metadata } from 'next';
import { Outfit, Bebas_Neue } from 'next/font/google';
import './globals.css';
import LayoutShell from '@/components/layout/LayoutShell';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmModal';
import QueryProvider from '@/components/providers/QueryProvider';
import CommandPalette from '@/components/ui/CommandPalette';
import ProfileCompletionGate from '@/components/auth/ProfileCompletionGate';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Suspense } from 'react';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';
import AuthErrorBanner from '@/components/auth/AuthErrorBanner';
import JsonLd from '@/components/seo/JsonLd';
import { websiteSchema, organizationSchema } from '@/lib/jsonld';
import { AEDRAL_DISCORD_INVITE_URL } from '@/components/icons/DiscordIcon';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
});

const bebasNeue = Bebas_Neue({
  variable: '--font-bebas',
  subsets: ['latin'],
  weight: '400',
});

// `metadataBase` est utilisé par Next.js pour résoudre les URLs relatives des
// images OG/twitter et générer les balises canoniques sur chaque page. Sans ça,
// les partages sur Discord/Twitter/Facebook tombent sur des URLs cassées.
export const metadata: Metadata = {
  metadataBase: new URL('https://aedral.com'),
  title: {
    default: 'Aedral, plateforme communautaire esport',
    // Template appliqué quand une page enfant définit son propre `title`.
    // Ex: "Mon Équipe" devient "Mon Équipe · Aedral" dans l'onglet du navigateur.
    template: '%s · Aedral',
  },
  description:
    "La plateforme tout-en-un pour structures esport amateur : gestion d'équipes, calendrier collaboratif avec consensus automatique des dispos, recrutement, suivi des exercices, replays. Rocket League, Trackmania et Valorant supportés.",
  applicationName: 'Aedral',
  keywords: [
    'esport amateur', 'structure esport', 'gestion équipe esport',
    'recrutement esport', 'plateforme esport', 'calendrier esport',
    'rocket league', 'trackmania', 'valorant',
    'aedral',
  ],
  authors: [{ name: 'Matt Molines' }],
  creator: 'Matt Molines',
  publisher: 'Matt Molines',
  // Le favicon est auto-géré par Next.js via app/icon.svg, l'icône Apple via
  // app/apple-icon.png, l'image OG via app/opengraph-image.png.
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'fr_FR',
    url: 'https://aedral.com/',
    siteName: 'Aedral',
    title: 'Aedral, plateforme communautaire esport',
    description:
      "La plateforme tout-en-un pour structures esport amateur : gestion d'équipes, calendrier collaboratif, recrutement, suivi des exercices, replays.",
    // L'image OG est auto-récupérée depuis app/opengraph-image.png (1200×630).
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Aedral, plateforme communautaire esport',
    description:
      "La plateforme tout-en-un pour structures esport amateur : gestion d'équipes, calendrier collaboratif, recrutement, suivi des exercices.",
    // L'image Twitter est aussi auto-récupérée depuis app/opengraph-image.png.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // JSON-LD racine — émis le plus haut possible dans le <body> pour que Google
  // l'indexe en priorité. WebSite + Organization identifient le site et son
  // éditeur (Aedral). sameAs liste les profils sociaux officiels.
  const rootSchemas = [
    websiteSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      description:
        "La plateforme tout-en-un pour structures esport amateur : gestion d'équipes, calendrier collaboratif, recrutement, suivi des exercices, replays.",
    }),
    organizationSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      logo: 'https://aedral.com/aedral/mark-light.webp',
      sameAs: [
        AEDRAL_DISCORD_INVITE_URL,
        'https://github.com/skypi11/springs-hub',
      ],
    }),
  ];

  return (
    <html lang="fr" className={`${outfit.variable} ${bebasNeue.variable} h-full`}>
      <body className="h-full flex" style={{ background: '#080808', color: '#f0f0f8' }}>
        <JsonLd schemas={rootSchemas} />
        <QueryProvider>
          <AuthProvider>
            {/* Banner d'erreur d'auth (cookie bloqué par Brave Shield / adblock).
                DOIT être DANS AuthProvider (useAuth) mais HORS du Suspense pour
                rester visible même si PostHog plante / suspense ne résout pas.
                Position fixed top-0 → ne perturbe pas le flex flow du body. */}
            <AuthErrorBanner />
            {/* PostHog : DOIT être DANS AuthProvider (useAuth pour identify),
                wrappé en Suspense car PostHogProvider utilise useSearchParams
                qui force le bailout statique sinon. */}
            <Suspense fallback={null}>
              <PostHogProvider>
                <ToastProvider>
                  <ConfirmProvider>
                    <ProfileCompletionGate />
                    <LayoutShell>{children}</LayoutShell>
                    <CommandPalette />
                  </ConfirmProvider>
                </ToastProvider>
              </PostHogProvider>
            </Suspense>
          </AuthProvider>
        </QueryProvider>
        {/* Vercel, fréquentation (Analytics) et perfs réelles (Speed Insights) */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
