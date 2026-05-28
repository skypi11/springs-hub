import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';

// GET /api/changelog/latest
// Endpoint léger pour l'indicateur sidebar "Nouveau" (dot rouge).
// Renvoie juste le publishedAt du dernier patch publié sur le site.
// Le client compare avec user.lastChangelogSeenAt pour décider si afficher
// le dot. Cache CDN 60s, la timeline change rarement.

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    const snap = await db
      .collection('announce_templates')
      .where('publishOnSite', '==', true)
      .orderBy('publishedAt', 'desc')
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ publishedAt: null });
    }
    const publishedAt = snap.docs[0].data().publishedAt?.toDate?.()?.toISOString?.() ?? null;
    return NextResponse.json(
      { publishedAt },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (err) {
    // Index Firestore en cours de build → graceful (pas de dot rouge spurieux).
    if (err instanceof Error && /FAILED_PRECONDITION|requires an index/i.test(err.message)) {
      console.warn('[API changelog/latest] index Firestore en construction :', err.message);
      return NextResponse.json({ publishedAt: null });
    }
    captureApiError('API changelog/latest GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
