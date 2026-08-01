import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { getRulebookByScope } from '@/lib/competitions/rulebooks';
import { MANIA_CUP_DOCS } from '@/lib/mania-cup';

// GET /api/mania-cup/rulebook[?doc=faq] — textes publics de la Mania Cup.
//
// PUBLIC et sans compte : un joueur doit pouvoir lire ce à quoi il s'engage
// AVANT de créer un compte. Aucune raison de gater ce texte derrière le drapeau
// de publication non plus — s'il est rédigé, c'est qu'il est destiné à être lu.
export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const doc = req.nextUrl.searchParams.get('doc') === 'faq'
      ? MANIA_CUP_DOCS.faq
      : MANIA_CUP_DOCS.rules;
    const rulebook = await getRulebookByScope(getAdminDb(), { eventSlug: doc });
    return NextResponse.json({ rulebook });
  } catch (err) {
    captureApiError('mania-cup/rulebook:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
