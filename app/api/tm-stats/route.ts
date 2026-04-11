import { NextRequest, NextResponse } from 'next/server';

// Trackmania.io API — nécessite un User-Agent custom
const TM_IO_API = 'https://trackmania.io/api';
const USER_AGENT = 'springs-hub/1.0 (https://springs-hub.vercel.app)';

// Extraire l'account ID depuis une URL trackmania.io
// Formats supportés :
//   https://trackmania.io/#/player/xxxx-xxxx-xxxx
//   https://trackmania.io/player/xxxx-xxxx-xxxx
function extractAccountId(url: string): string | null {
  // Format avec hash : /#/player/ACCOUNT_ID
  const hashMatch = url.match(/trackmania\.io\/#\/player\/([a-f0-9-]{36})/i);
  if (hashMatch) return hashMatch[1];

  // Format sans hash : /player/ACCOUNT_ID
  const pathMatch = url.match(/trackmania\.io\/player\/([a-f0-9-]{36})/i);
  if (pathMatch) return pathMatch[1];

  // Peut-être que l'URL EST l'account ID directement
  const directMatch = url.match(/^[a-f0-9-]{36}$/i);
  if (directMatch) return url;

  return null;
}

export async function GET(req: NextRequest) {
  const tmIoUrl = req.nextUrl.searchParams.get('url');
  const pseudoTM = req.nextUrl.searchParams.get('pseudo');

  if (!tmIoUrl && !pseudoTM) {
    return NextResponse.json({ error: 'url ou pseudo requis' }, { status: 400 });
  }

  try {
    let accountId: string | null = null;

    if (tmIoUrl) {
      accountId = extractAccountId(tmIoUrl);
      if (!accountId) {
        return NextResponse.json({ error: 'URL trackmania.io invalide' }, { status: 400 });
      }
    }

    // Si on a un account ID, récupérer le profil directement
    if (accountId) {
      const playerRes = await fetch(`${TM_IO_API}/player/${accountId}`, {
        headers: { 'User-Agent': USER_AGENT },
        next: { revalidate: 3600 },
      });

      if (!playerRes.ok) {
        if (playerRes.status === 404) {
          return NextResponse.json({ error: 'Joueur non trouvé' }, { status: 404 });
        }
        return NextResponse.json({ error: 'Erreur API trackmania.io' }, { status: playerRes.status });
      }

      const player = await playerRes.json();

      // Récupérer les trophées
      const trophyData = player.trophies ?? {};
      const echelon = trophyData.echelon ?? 0;
      const points = trophyData.points ?? 0;

      // Récupérer les infos COTD si disponibles
      let cotdBestRank = null;
      let cotdBestDiv = null;

      try {
        const cotdRes = await fetch(`${TM_IO_API}/player/${accountId}/cotd/0`, {
          headers: { 'User-Agent': USER_AGENT },
          next: { revalidate: 3600 },
        });
        if (cotdRes.ok) {
          const cotdData = await cotdRes.json();
          const cotds = cotdData.cotds ?? [];
          if (cotds.length > 0) {
            // Trouver le meilleur résultat
            let bestRank = Infinity;
            for (const cotd of cotds) {
              const rank = cotd.rank ?? cotd.resultRank;
              if (rank && rank < bestRank) {
                bestRank = rank;
                cotdBestDiv = cotd.div ?? Math.ceil(rank / 64);
              }
            }
            if (bestRank < Infinity) cotdBestRank = bestRank;
          }
        }
      } catch {
        // COTD optionnel — pas grave si ça échoue
      }

      return NextResponse.json({
        displayName: player.displayname ?? player.player?.name ?? pseudoTM ?? '',
        accountId,
        trophies: points,
        echelon,
        cotdBestRank,
        cotdBestDiv,
        profileUrl: `https://trackmania.io/#/player/${accountId}`,
      });
    }

    // Pas d'account ID — retourner juste le pseudo
    return NextResponse.json({
      displayName: pseudoTM ?? '',
      accountId: null,
      trophies: null,
      echelon: null,
      cotdBestRank: null,
      cotdBestDiv: null,
      profileUrl: null,
    });
  } catch (err) {
    console.error('[TM Stats] error:', err);
    return NextResponse.json({ error: 'Erreur réseau' }, { status: 500 });
  }
}
