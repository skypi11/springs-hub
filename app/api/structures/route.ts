import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/structures, liste publique des structures actives
export async function GET(req: NextRequest) {
  try {
    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
    if (blocked) return blocked;

    const db = getAdminDb();
    const game = req.nextUrl.searchParams.get('game');

    // Charge les structures actives, puis les memberCount via aggregate count()
    // par structure en parallèle. Avant : full-scan de TOUTE la collection
    // structure_members pour compter (= N reads où N = total membres). Avec
    // l'aggregate, Firestore facture ~1 read / 1000 docs scannés par requête →
    // gain ~1000× à grosse échelle (audit 30/05 — scalabilité 2-5k users visée).
    const structuresSnap = await db.collection('structures').where('status', '==', 'active').get();

    // Filtre pré-comptage (isDev, game) pour ne pas faire d'aggregate sur des
    // structures qu'on va de toute façon dropper de la réponse.
    const visibleDocs = structuresSnap.docs.filter(doc => {
      const d = doc.data();
      if (d.isDev === true) return false;
      if (game && !(d.games || []).includes(game)) return false;
      return true;
    });

    const counts = await Promise.all(
      visibleDocs.map(async doc => {
        try {
          const agg = await db.collection('structure_members')
            .where('structureId', '==', doc.id)
            .count()
            .get();
          return agg.data().count || 0;
        } catch {
          return 0;
        }
      }),
    );

    const structures = visibleDocs.map((doc, i) => {
      const data = doc.data();
      return {
        id: doc.id,
        // Slug propre pour construire l'URL publique côté client via
        // getStructureHref(). Null si la structure n'est pas backfillée — le
        // helper fallback automatiquement sur l'id.
        slug: typeof data.slug === 'string' ? data.slug : null,
        name: data.name,
        tag: data.tag,
        logoUrl: data.logoUrl || '',
        games: data.games || [],
        recruiting: data.recruiting || { active: false, positions: [] },
        memberCount: counts[i],
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // Trier par nombre de membres décroissant
    structures.sort((a, b) => b.memberCount - a.memberCount);

    return NextResponse.json({ structures });
  } catch (err) {
    captureApiError('API Structures GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
