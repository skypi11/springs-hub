import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';

// GET /api/changelog
// Endpoint public (pas d'auth requise) qui sert la timeline pour la page
// /changelog. Lit la collection `announce_templates` filtrée sur
// publishOnSite === true, triée par publishedAt desc, limité à 100 dernières
// (largement assez, on aura jamais 100 patches).
//
// Pas de pagination pour l'instant (limite 100). Si on dépasse, ajouter
// un cursor `?before=ISO`.

export interface ChangelogItem {
  id: string;
  key: string;
  title: string;
  description: string;     // markdown brut
  category: string;        // 'feature' | 'ux' | 'tech' | 'fix' | 'security'
  publishedAt: string;     // ISO
}

const MAX_ITEMS = 100;

export async function GET(req: NextRequest) {
  // Rate-limit serré (limiters.write au lieu de read) keyé par IP, car la
  // route est publique sans auth. Le contenu est public mais on évite
  // qu'un script puisse scraper la timeline en boucle (le bénéfice du CDN
  // cache 5 min ci-dessous limite déjà l'impact concret côté Firestore).
  // Audit 30/05 (🟡 1).
  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    const snap = await db
      .collection('announce_templates')
      .where('publishOnSite', '==', true)
      .orderBy('publishedAt', 'desc')
      .limit(MAX_ITEMS)
      .get();

    const items: ChangelogItem[] = snap.docs
      .map(d => {
        const data = d.data();
        // publishedAt peut être null (toggled true mais jamais set), on skip
        const publishedAt = data.publishedAt?.toDate?.()?.toISOString?.();
        if (!publishedAt) return null;
        return {
          id: d.id,
          key: (data.key as string) ?? d.id,
          title: (data.title as string) ?? '(sans titre)',
          description: (data.description as string) ?? '',
          category: (data.category as string) ?? 'feature',
          publishedAt,
        };
      })
      .filter((x): x is ChangelogItem => x !== null);

    // Headers cache : la timeline change rarement (1-3 entrées par semaine
    // grand max). Cache CDN de 5 min + stale-while-revalidate 1h absorbe la
    // quasi-totalité du trafic sans toucher Firestore. Trade-off : un patch
    // publié peut mettre jusqu'à 5 min à apparaître pour les visiteurs (OK,
    // c'est de la timeline pas du critique).
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
    );
  } catch (err) {
    // Index Firestore en cours de construction (juste après un deploy) →
    // graceful empty au lieu de planter Sentry / 500 visible côté user.
    if (err instanceof Error && /FAILED_PRECONDITION|requires an index/i.test(err.message)) {
      console.warn('[API changelog] index Firestore en construction, retour vide :', err.message);
      return NextResponse.json({ items: [] });
    }
    captureApiError('API changelog GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
