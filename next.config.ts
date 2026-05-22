import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Silencieux en local, verbose dans les logs Vercel build.
  silent: !process.env.CI,

  // Masque le DSN Sentry dans les requêtes client — reverse proxy via /monitoring.
  // Protège contre les ad-blockers qui bloqueraient *.sentry.io.
  tunnelRoute: '/monitoring',

  widenClientFileUpload: true,
  disableLogger: true,
});
