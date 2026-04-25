import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/public/stats — compteurs globaux pour la page d'accueil.
//
// Utilise les `count()` aggregates Firestore : ~6 reads totales par appel,
// peu importe la taille des collections. Avec le cache CDN Vercel
// (s-maxage=300), 1 régénération toutes les 5 min suffit pour tous les
// visiteurs → ~12 reads/heure au total.
//
// Filtre les docs dev (`isDev === true`) pour rester cohérent avec ce qui
// est affiché sur /community/structures et /community/players.
export async function GET(req: NextRequest) {
  try {
    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
    if (blocked) return blocked;

    const db = getAdminDb();

    const structuresQuery = db.collection('structures').where('status', '==', 'active');
    const usersQuery = db.collection('users');
    const recruitingQuery = db.collection('users').where('isAvailableForRecruitment', '==', true);

    const [
      structuresAll, structuresDev,
      usersAll, usersDev,
      recruitingAll, recruitingDev,
    ] = await Promise.all([
      structuresQuery.count().get(),
      structuresQuery.where('isDev', '==', true).count().get(),
      usersQuery.count().get(),
      usersQuery.where('isDev', '==', true).count().get(),
      recruitingQuery.count().get(),
      recruitingQuery.where('isDev', '==', true).count().get(),
    ]);

    const stats = {
      structures: structuresAll.data().count - structuresDev.data().count,
      players: usersAll.data().count - usersDev.data().count,
      recruitingPlayers: recruitingAll.data().count - recruitingDev.data().count,
    };

    return NextResponse.json(stats, {
      headers: {
        // CDN Vercel : 5 min frais, 15 min stale-while-revalidate.
        // Le 1er visiteur après expiration trigger une régénération en arrière-plan
        // pendant que les visiteurs suivants reçoivent encore la version cached.
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      },
    });
  } catch (err) {
    captureApiError('API Public Stats GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
