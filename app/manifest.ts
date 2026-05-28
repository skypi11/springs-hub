import type { MetadataRoute } from 'next';

// PWA manifest — Next.js auto-serve /manifest.webmanifest depuis ce fichier.
// Icons générés par scripts/generate-png-derivatives.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aedral, plateforme communautaire esport',
    short_name: 'Aedral',
    description:
      'La plateforme communautaire esport pour structures et joueurs. Gère ta structure, suis les compétitions, rejoins la communauté.',
    start_url: '/',
    display: 'standalone',
    background_color: '#08080F',
    theme_color: '#08080F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
