import type { MetadataRoute } from 'next';

// Directives d'indexation pour les crawlers (Google, Bing, etc.).
//
// Stratégie :
//   - Autoriser l'indexation de tout le site public par défaut
//   - Bloquer explicitement les sections privées ou non destinées au SEO :
//     /api/* (endpoints back), /admin (panel admin), /settings (espace perso),
//     /community/my-* (dashboard structure perso), /calendar (mon calendrier),
//     /onboarding (flow), pages d'erreur ?error=
//   - Pointer vers le sitemap pour la découverte
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/settings',
          '/settings/',
          '/onboarding',
          '/onboarding/',
          '/calendar',
          '/calendar/',
          '/community/my-structure',
          '/community/my-applications',
          '/community/create-structure',
          // Pages qui peuvent contenir des params d'erreur sensibles (auth_error=...)
          '/*?error=*',
          '/*?auth_error=*',
        ],
      },
    ],
    sitemap: 'https://aedral.com/sitemap.xml',
    host: 'https://aedral.com',
  };
}
