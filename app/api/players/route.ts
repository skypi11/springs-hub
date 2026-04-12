import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Plafond dur — protège contre les coûts qui explosent quand l'annuaire grossit.
// La recherche/le filtrage par texte se fait toujours côté client sur ce sous-ensemble.
// Pour passer à l'échelle (>500 users) il faudra un service de recherche (Algolia, Meilisearch)
// car Firestore n'a pas de full-text search.
const MAX_PLAYERS = 200;

// GET /api/players — liste publique des joueurs
export async function GET(req: NextRequest) {
  try {
    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
    if (blocked) return blocked;

    const db = getAdminDb();
    const game = req.nextUrl.searchParams.get('game');
    const recruitingOnly = req.nextUrl.searchParams.get('recruiting') === 'true';

    // Filtres poussés côté Firestore quand c'est possible
    let query: FirebaseFirestore.Query = db.collection('users');
    if (recruitingOnly) {
      query = query.where('isAvailableForRecruitment', '==', true);
    }
    if (game) {
      // array-contains : nécessite un index simple sur `games`
      query = query.where('games', 'array-contains', game);
    }

    const snap = await query.limit(MAX_PLAYERS).get();

    const players = [];
    for (const doc of snap.docs) {
      const data = doc.data();

      players.push({
        uid: doc.id,
        displayName: data.displayName || data.discordUsername || '',
        discordAvatar: data.discordAvatar || '',
        avatarUrl: data.avatarUrl || '',
        country: data.country || '',
        games: data.games || [],
        isAvailableForRecruitment: data.isAvailableForRecruitment || false,
        recruitmentRole: data.recruitmentRole || '',
        recruitmentMessage: data.recruitmentMessage || '',
        // RL stats
        rlRank: data.rlStats?.rank || data.rlRank || '',
        rlMmr: data.rlStats?.mmr || data.rlMmr || null,
        rlIconUrl: data.rlStats?.iconUrl || '',
        // TM stats
        pseudoTM: data.pseudoTM || '',
        tmTrophies: data.tmStats?.trophies || null,
        tmEchelon: data.tmStats?.echelon || null,
        // Structure info
        structurePerGame: data.structurePerGame || {},
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    // Trier : dispo au recrutement en premier, puis par nom
    players.sort((a, b) => {
      if (a.isAvailableForRecruitment && !b.isAvailableForRecruitment) return -1;
      if (!a.isAvailableForRecruitment && b.isAvailableForRecruitment) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return NextResponse.json({
      players,
      truncated: snap.size >= MAX_PLAYERS,
      max: MAX_PLAYERS,
    });
  } catch (err) {
    captureApiError('API Players GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
