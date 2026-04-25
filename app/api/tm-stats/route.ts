import { NextRequest, NextResponse } from 'next/server';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Trackmania.io API — nécessite un User-Agent custom
const TM_IO_API = 'https://trackmania.io/api';
const USER_AGENT = 'aedral/1.0 (https://aedral.com)';

// Extraire l'account ID depuis une URL trackmania.io
// Formats supportés :
//   https://trackmania.io/#/player/xxxx-xxxx-xxxx
//   https://trackmania.io/player/xxxx-xxxx-xxxx
// Nettoyer les codes de formatage Trackmania ($XXX = couleur, $S/$I/$O/$W/$N/$Z = style)
function stripTmFormatting(text: string): string {
  if (!text) return '';
  // $RGB (3 chars hex), $RRGGBB (6 chars hex), $L[url], $H[url], et lettres de style ($S, $I, $O, $W, $N, $Z, $T)
  return text
    .replace(/\$[lhp]\[[^\]]*\]/gi, '')       // $L[...], $H[...], $P[...]
    .replace(/\$[0-9a-fA-F]{3}/g, '')          // $RGB
    .replace(/\$[siownzt]/gi, '')              // style codes
    .replace(/\$\$/g, '$');                     // escaped $
}

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
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

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

      // Trophées par tier (T1=le plus bas → T9=le plus haut)
      const counts = trophyData.counts ?? [];
      // trackmania.io renvoie counts[0]=T1, counts[1]=T2, ... counts[8]=T9
      const trophyTiers: { tier: number; count: number }[] = [];
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] > 0) {
          trophyTiers.push({ tier: i + 1, count: counts[i] });
        }
      }

      // Classements par zone (Var, PACA, France, Europe, World)
      const zoneRankings: { zone: string; rank: number }[] = [];
      const zones = trophyData.zonepositions ?? [];

      // L'API renvoie les zones dans player.trophies.zone (objet imbriqué parent→enfant)
      // et les positions dans trophyData.zonepositions (array parallèle)
      if (zones.length > 0) {
        // Extraire les noms de zones depuis la structure imbriquée
        const names: string[] = [];
        let z = player.trophies?.zone;
        while (z) {
          names.push(z.name ?? z.flag ?? '');
          z = z.parent;
        }
        // names = [city, region, country, continent, world] — du plus spécifique au plus large
        // zones = positions dans le même ordre
        for (let i = 0; i < Math.min(zones.length, names.length); i++) {
          if (zones[i] > 0 && names[i]) {
            zoneRankings.push({ zone: names[i], rank: zones[i] });
          }
        }
      }

      // Club tag — nettoyer les codes de formatage TM
      const rawClubTag = player.clubtag ?? null;
      const clubTag = rawClubTag ? stripTmFormatting(rawClubTag) : null;

      // Récupérer les infos COTD si disponibles
      let cotdBestRank = null;
      let cotdBestDiv = null;
      let cotdCount = 0;
      let cotdAvgRank = null;

      try {
        const cotdRes = await fetch(`${TM_IO_API}/player/${accountId}/cotd/0`, {
          headers: { 'User-Agent': USER_AGENT },
          next: { revalidate: 3600 },
        });
        if (cotdRes.ok) {
          const cotdData = await cotdRes.json();
          const cotds = cotdData.cotds ?? [];
          cotdCount = cotdData.total ?? cotds.length;

          if (cotds.length > 0) {
            let bestRank = Infinity;
            let totalRank = 0;
            let counted = 0;
            for (const cotd of cotds) {
              const rank = cotd.rank ?? cotd.resultRank;
              if (rank && rank > 0) {
                if (rank < bestRank) {
                  bestRank = rank;
                  cotdBestDiv = cotd.div ?? Math.ceil(rank / 64);
                }
                totalRank += rank;
                counted++;
              }
            }
            if (bestRank < Infinity) cotdBestRank = bestRank;
            if (counted > 0) cotdAvgRank = Math.round(totalRank / counted);
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
        clubTag,
        trophyTiers,
        zoneRankings,
        cotdBestRank,
        cotdBestDiv,
        cotdCount,
        cotdAvgRank,
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
