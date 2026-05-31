// Client minimal pour l'API trackmania.io (community-driven, gratuite avec
// User-Agent custom). Utilisé par le cron de sync trophées + le bouton
// "Sync mes trophées maintenant" dans Settings.
//
// L'API est documentée informellement sur https://trackmania.io/api/ — pas
// d'auth requise, juste un User-Agent identifiant l'app pour les responsables.
//
// On expose :
//   - extractAccountId(url) : sort le UUID account depuis une URL tm.io
//   - fetchTmStats(accountId) : récupère trophées + COTD + meta en 2 requêtes
//
// Cohérent avec app/api/tm-stats/route.ts qui fait la même chose à la demande.

const TM_IO_API = 'https://trackmania.io/api';
const USER_AGENT = 'aedral/1.0 (https://aedral.com)';

/** Stats Trackmania d'un joueur, telles que stockées en BD après sync. */
export interface TmStats {
  accountId: string;
  displayName: string;
  trophies: number;            // points trophées totaux
  echelon: number;             // niveau échelon
  clubTag: string | null;
  cotdBestRank: number | null;
  cotdBestDiv: number | null;
  cotdCount: number;
  cotdAvgRank: number | null;
}

export type TmFetchResult =
  | { ok: true; data: TmStats }
  | { ok: false; status: number; message?: string };

/** Extrait l'account UUID d'une URL trackmania.io (formats avec ou sans hash). */
export function extractAccountId(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  const hashMatch = s.match(/trackmania\.io\/#\/player\/([a-f0-9-]{36})/i);
  if (hashMatch) return hashMatch[1];
  const pathMatch = s.match(/trackmania\.io\/player\/([a-f0-9-]{36})/i);
  if (pathMatch) return pathMatch[1];
  // L'input PEUT être directement l'account UUID (déjà extrait précédemment)
  if (/^[a-f0-9-]{36}$/i.test(s)) return s;
  return null;
}

// Nettoie les codes de formatage Trackmania (couleurs $RGB, styles $S/$I/$O,
// liens $L[url]). Cohérent avec /api/tm-stats.
function stripTmFormatting(text: string): string {
  if (!text) return '';
  return text
    .replace(/\$[lhp]\[[^\]]*\]/gi, '')
    .replace(/\$[0-9a-fA-F]{3}/g, '')
    .replace(/\$[siownzt]/gi, '')
    .replace(/\$\$/g, '$');
}

/**
 * Récupère les stats d'un joueur Trackmania via tm.io.
 * Fait 2 requêtes en série : player (trophées + clubTag) puis cotd (rang COTD).
 * Si la 2e échoue, on renvoie quand même les stats player (COTD optionnel).
 */
export async function fetchTmStats(accountId: string): Promise<TmFetchResult> {
  if (!/^[a-f0-9-]{36}$/i.test(accountId)) {
    return { ok: false, status: 400, message: 'accountId invalide' };
  }

  // Requête 1 : profil player
  let player: Record<string, unknown>;
  try {
    const res = await fetch(`${TM_IO_API}/player/${accountId}`, {
      headers: { 'User-Agent': USER_AGENT },
      // Cache : 1h pour les calls côté ISR Next, mais pour notre cron node-fetch
      // côté serveur ça revient à pas de cache → on assume.
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `tm.io player ${res.status}` };
    }
    player = await res.json() as Record<string, unknown>;
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'fetch failed' };
  }

  const trophyData = (player.trophies ?? {}) as Record<string, unknown>;
  const trophies = typeof trophyData.points === 'number' ? trophyData.points : 0;
  const echelon = typeof trophyData.echelon === 'number' ? trophyData.echelon : 0;
  const rawClubTag = typeof player.clubtag === 'string' ? player.clubtag : null;
  const clubTag = rawClubTag ? stripTmFormatting(rawClubTag) : null;
  const displayName = typeof player.displayname === 'string'
    ? player.displayname
    : (typeof (player.player as Record<string, unknown> | undefined)?.name === 'string'
      ? (player.player as Record<string, string>).name
      : '');

  // Requête 2 : COTD (optionnelle, best-effort)
  let cotdBestRank: number | null = null;
  let cotdBestDiv: number | null = null;
  let cotdCount = 0;
  let cotdAvgRank: number | null = null;
  try {
    const cotdRes = await fetch(`${TM_IO_API}/player/${accountId}/cotd/0`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (cotdRes.ok) {
      const cotdData = await cotdRes.json() as Record<string, unknown>;
      const cotds = Array.isArray(cotdData.cotds) ? cotdData.cotds as Array<Record<string, unknown>> : [];
      cotdCount = typeof cotdData.total === 'number' ? cotdData.total : cotds.length;
      if (cotds.length > 0) {
        let bestRank = Infinity;
        let totalRank = 0;
        let counted = 0;
        for (const cotd of cotds) {
          const rank = typeof cotd.rank === 'number' ? cotd.rank
            : typeof cotd.resultRank === 'number' ? cotd.resultRank : null;
          if (rank && rank > 0) {
            if (rank < bestRank) {
              bestRank = rank;
              const div = typeof cotd.div === 'number' ? cotd.div : Math.ceil(rank / 64);
              cotdBestDiv = div;
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
    // COTD optionnel : on n'échoue pas le sync entier si tm.io râle juste sur COTD
  }

  return {
    ok: true,
    data: {
      accountId,
      displayName,
      trophies,
      echelon,
      clubTag,
      cotdBestRank,
      cotdBestDiv,
      cotdCount,
      cotdAvgRank,
    },
  };
}
