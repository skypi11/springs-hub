import { NextRequest, NextResponse } from 'next/server';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

const TRN_API_KEY = process.env.TRN_API_KEY;
const TRN_BASE = 'https://public-api.tracker.gg/v2/rocket-league/standard/profile';

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  const epicId = req.nextUrl.searchParams.get('epicId');

  if (!epicId) {
    return NextResponse.json({ error: 'epicId requis' }, { status: 400 });
  }

  if (!TRN_API_KEY) {
    // En dev on renvoie un mock réaliste pour débloquer le travail local sans clé Tracker.gg.
    // On varie légèrement selon l'epicId pour que deux joueurs n'aient pas exactement le même rang.
    if (process.env.NODE_ENV === 'development') {
      const seed = Array.from(epicId).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const ranks = ['Diamant III', 'Champion I', 'Champion II', 'Champion III', 'Grand Champion I', 'Grand Champion II'];
      const rank = ranks[seed % ranks.length];
      const mmr = 1000 + (seed % 600);
      return NextResponse.json({
        rank: { rank, division: 'Division II', mmr, playlist: 'Ranked Doubles 2v2', iconUrl: '' },
        overview: {
          wins: 200 + (seed % 400),
          goals: 1200 + (seed % 800),
          assists: 600 + (seed % 400),
          mvps: 150 + (seed % 200),
          saves: 800 + (seed % 500),
        },
        trackerUrl: `https://rocketleague.tracker.gg/rocket-league/profile/epic/${encodeURIComponent(epicId)}/overview`,
        _mock: true,
      });
    }
    return NextResponse.json({ error: 'TRN API key non configurée' }, { status: 500 });
  }

  try {
    const res = await fetch(`${TRN_BASE}/epic/${encodeURIComponent(epicId)}`, {
      headers: { 'TRN-Api-Key': TRN_API_KEY },
      next: { revalidate: 3600 }, // cache 1h
    });

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Joueur non trouvé sur RL Tracker' }, { status: 404 });
      }
      const text = await res.text();
      console.error('[RL Stats] TRN API error:', res.status, text);
      return NextResponse.json({ error: 'Erreur API Tracker.gg' }, { status: res.status });
    }

    const data = await res.json();

    // Extraire les stats ranked pertinentes
    const segments = data?.data?.segments ?? [];

    // Chercher le meilleur rang parmi les playlists ranked
    const rankedPlaylists = segments.filter(
      (s: Record<string, unknown>) => s.type === 'playlist' && typeof s.metadata === 'object'
    );

    let bestRank = null;
    let bestMmr = 0;

    for (const playlist of rankedPlaylists) {
      const stats = playlist.stats as Record<string, { value?: number; metadata?: Record<string, string>; displayValue?: string }> | undefined;
      if (!stats?.rating?.value) continue;

      const mmr = stats.rating.value;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        const tier = stats.tier;
        bestRank = {
          rank: tier?.metadata?.name ?? stats.tier?.displayValue ?? '',
          division: stats.division?.metadata?.name ?? stats.division?.displayValue ?? '',
          mmr,
          playlist: (playlist.metadata as Record<string, string>)?.name ?? '',
          iconUrl: (tier?.metadata as Record<string, string>)?.iconUrl ?? '',
        };
      }
    }

    // Overview stats
    const overview = segments.find((s: Record<string, unknown>) => s.type === 'overview');
    const overviewStats = overview?.stats as Record<string, { value?: number; displayValue?: string }> | undefined;

    return NextResponse.json({
      rank: bestRank,
      overview: {
        wins: overviewStats?.wins?.value ?? null,
        goals: overviewStats?.goals?.value ?? null,
        assists: overviewStats?.assists?.value ?? null,
        mvps: overviewStats?.mVPs?.value ?? null,
        saves: overviewStats?.saves?.value ?? null,
      },
      trackerUrl: `https://rocketleague.tracker.gg/rocket-league/profile/epic/${encodeURIComponent(epicId)}/overview`,
    });
  } catch (err) {
    console.error('[RL Stats] fetch error:', err);
    return NextResponse.json({ error: 'Erreur réseau' }, { status: 500 });
  }
}
