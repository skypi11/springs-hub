import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 10% des transactions côté client — suffisant pour détecter les tendances
  // sans exploser le quota free tier (5000 events/mois).
  tracesSampleRate: 0.1,

  // Pas de session replay pour l'instant — à activer plus tard si besoin de
  // voir les interactions utilisateur qui précèdent un crash.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Filtre le bruit : erreurs d'extensions navigateur, crawlers, etc.
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Non-Error promise rejection captured',
  ],

  environment: process.env.NODE_ENV,
});
