import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Les routes serveur sont plus critiques — on capture 100% des transactions
  // pour ne rien rater. Reste dans le budget free tier.
  tracesSampleRate: 1.0,

  environment: process.env.NODE_ENV,
});
