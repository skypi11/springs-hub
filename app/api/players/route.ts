import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/players — liste publique des joueurs
export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const game = req.nextUrl.searchParams.get('game');
    const recruitingOnly = req.nextUrl.searchParams.get('recruiting') === 'true';

    const snap = await db.collection('users').get();

    const players = [];
    for (const doc of snap.docs) {
      const data = doc.data();

      // Filtre par jeu si demandé
      if (game && !(data.games || []).includes(game)) continue;

      // Filtre recrutement
      if (recruitingOnly && !data.isAvailableForRecruitment) continue;

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

    return NextResponse.json({ players });
  } catch (err) {
    console.error('[API Players] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
