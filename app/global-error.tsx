'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#08080f', color: '#eaeaf0', fontFamily: 'system-ui, sans-serif', padding: '24px' }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <h1 style={{ fontSize: '28px', marginBottom: '12px' }}>Une erreur est survenue</h1>
            <p style={{ color: '#7a7a95', marginBottom: '24px', fontSize: '14px' }}>
              L&apos;équipe Springs a été notifiée automatiquement. Tu peux réessayer ou revenir à l&apos;accueil.
            </p>
            <a href="/" style={{ display: 'inline-block', padding: '10px 20px', background: '#FFB800', color: '#000', textDecoration: 'none', fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Retour à l&apos;accueil
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
