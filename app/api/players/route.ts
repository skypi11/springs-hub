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

    const isDevEnv = process.env.NODE_ENV === 'development';
    const players = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.isDev === true && !isDevEnv) continue;

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
        // Identité RL officielle (anti-mensonge — voir docs/rl-rank-verification-plan.md).
        // verified = passé par le flow Lot 2 (snapshot Epic via Discord) OU Steam OpenID lié.
        rlAccountVerified: !!data.rlEpicId || !!data.steamLinked?.steamId64,
        // Pour le lien tracker.gg : on préfère TOUJOURS Epic quand on l'a quelque
        // part (snapshot OU connexion Discord vérifiée), parce que post-free-to-play
        // les stats RL vivent sur Epic même pour les joueurs qui lancent via Steam
        // (tracker.gg/steam/{id} renvoie souvent une page vide pour eux).
        rlAccountName: (() => {
          const epicConn = (data.discordConnections || []).find(
            (c: { type: string; name: string; verified?: boolean }) => c?.type === 'epicgames' && c?.verified && c?.name,
          );
          return (data.rlEpicName as string)
            || epicConn?.name
            || (data.steamLinked?.personaName as string)
            || '';
        })(),
        rlAccountPlatform: (() => {
          const epicConn = (data.discordConnections || []).find(
            (c: { type: string; name: string; verified?: boolean }) => c?.type === 'epicgames' && c?.verified && c?.name,
          );
          if (data.rlEpicName || epicConn?.name) return 'epic';
          if (data.steamLinked?.steamId64) return 'steam';
          return '';
        })(),
        // SteamID64 exposé uniquement pour les fallbacks Steam (sert au lien tracker)
        rlSteamId64: data.steamLinked?.steamId64 || '',
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
