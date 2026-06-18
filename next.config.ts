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
