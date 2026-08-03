import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Hosts autorisés pour next/image. Sans ça, l'optimiseur REFUSE l'image et le
// <Image> casse (affiche l'alt text). Discord = avatars ; *.r2.dev = TOUS nos
// uploads (logos structure/équipe, bannières, avatars custom) servis depuis R2.
const remotePatterns: NonNullable<NonNullable<NextConfig['images']>['remotePatterns']> = [
  { protocol: 'https', hostname: 'cdn.discordapp.com' },
  { protocol: 'https', hostname: '*.r2.dev' },
];
// Si R2_PUBLIC_URL est un domaine CUSTOM (hors r2.dev), on l'ajoute dynamiquement
// pour ne pas avoir à retoucher cette config lors d'une migration de bucket.
try {
  const r2Host = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL).hostname : '';
  if (r2Host && !r2Host.endsWith('.r2.dev') && !remotePatterns.some(p => p.hostname === r2Host)) {
    remotePatterns.push({ protocol: 'https', hostname: r2Host });
  }
} catch {
  // R2_PUBLIC_URL invalide → on garde les patterns statiques.
}

const nextConfig: NextConfig = {
  images: { remotePatterns },

  // Le domaine public est aedral.com. `springs-hub.vercel.app` (domaine Vercel
  // par défaut du projet) servait le MÊME contenu en 200 : deux origines actives
  // = chaque intégration OAuth à déclarer deux fois (Discord, Nadeo, Firebase,
  // reCAPTCHA), sessions non partagées entre les deux domaines, et l'ancien nom
  // visible dans la barre d'adresse malgré le rebrand. On le renvoie en 308.
  //
  // ⚠️ `/api` et `/monitoring` sont EXCLUS volontairement. Ces routes sont
  // appelées par des machines en POST : Interactions Endpoint URL de l'app
  // Discord (`/api/discord/interactions`), crons Vercel, tunnel Sentry. Une 308
  // n'est pas suivie par la plupart des clients HTTP — les rediriger casserait
  // ces intégrations, dont l'URL est déclarée dans des portails externes qu'on
  // ne peut pas auditer depuis le repo. Elles restent donc joignables sur les
  // deux domaines ; seuls les humains sont renvoyés sur aedral.com.
  //
  // Les URLs de preview (springs-hub-git-*.vercel.app) ne matchent pas ce host
  // exact et continuent de fonctionner normalement.
  async redirects() {
    const has = [{ type: 'host' as const, value: 'springs-hub.vercel.app' }];
    return [
      // La racine ne matche pas le pattern paramétré ci-dessous → règle dédiée.
      { source: '/', has, destination: 'https://aedral.com/', permanent: true },
      {
        source: '/:path((?!api/|monitoring).*)',
        has,
        destination: 'https://aedral.com/:path',
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Silencieux en local, verbose dans les logs Vercel build.
  silent: !process.env.CI,

  // Masque le DSN Sentry dans les requêtes client, reverse proxy via /monitoring.
  // Protège contre les ad-blockers qui bloqueraient *.sentry.io.
  tunnelRoute: '/monitoring',

  widenClientFileUpload: true,
  disableLogger: true,
});
