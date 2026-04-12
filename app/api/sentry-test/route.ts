import { NextResponse } from 'next/server';
import { captureApiError } from '@/lib/sentry';

// GET /api/sentry-test — endpoint de test pour vérifier que Sentry reçoit bien
// les erreurs en prod. À SUPPRIMER une fois Sentry validé.
export async function GET() {
  try {
    throw new Error('Sentry test error — si tu lis ça dans Sentry, tout fonctionne !');
  } catch (err) {
    captureApiError('API SentryTest', err);
    return NextResponse.json({ error: 'Test error envoyé à Sentry' }, { status: 500 });
  }
}
