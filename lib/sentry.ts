import * as Sentry from '@sentry/nextjs';

// Helper centralisé pour logger une erreur d'API route.
// - console.error pour garder les logs Vercel lisibles
// - Sentry.captureException pour l'alerte + contexte
export function captureApiError(context: string, err: unknown): void {
  console.error(`[${context}]`, err);
  Sentry.captureException(err, {
    tags: { source: 'api', route: context },
  });
}
