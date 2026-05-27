import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';

// POST /api/profile/mark-changelog-seen
// Marque le changelog comme vu pour l'user authentifié (= update
// users.{uid}.lastChangelogSeenAt à maintenant). Appelé quand l'user
// ouvre la page /changelog. Le dot rouge sidebar disparaît jusqu'au
// prochain patch publié après cette date.
//
// Pas de body (toujours = serverTimestamp). Réponse minimale.

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Rate limit léger — l'user peut spammer le bouton mais c'est juste un update.
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    await db.collection('users').doc(uid).update({
      lastChangelogSeenAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API profile/mark-changelog-seen POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
