import type { NextConfig } from "next";

// ⚠️ CONTOURNEMENT TEMPORAIRE — incident pipeline Vercel.
// L'étape interne « modifyConfig from Vercel » a régressé et plante
// (TypeError: path undefined) sur la config enrichie par withSentryConfig,
// alors que le MÊME code passait ~1h plus tôt. On exporte une config Next
// simple pour éviter le chemin de build buggé côté Vercel.
// Sentry continue de fonctionner au RUNTIME via instrumentation.ts /
// instrumentation-client.ts (capture des erreurs intacte). On perd seulement,
// le temps de l'incident : le tunnel `/monitoring` et le tree-shaking des logs.
// À RÉTABLIR dès que Vercel a corrigé : réimporter `withSentryConfig` et
// re-wrapper l'export avec { tunnelRoute: '/monitoring', widenClientFileUpload }.

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

export default nextConfig;
