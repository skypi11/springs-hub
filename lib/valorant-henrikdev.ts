// Wrapper minimaliste autour de l'API HenrikDev pour récupérer le rang
// Valorant d'un joueur via son RiotID (`Name#TAG`) ou son PUUID.
//
// HenrikDev est une API community-maintained qui scrape les data publiques
// de Riot. Pas d'approval Riot Production API Key nécessaire — pratique pour
// un site tiers comme Aedral. Risque accepté : si HenrikDev casse un jour,
// fallback gracieux sur le rang déclaratif (saisi par le user dans /settings).
//
// Docs : https://docs.henrikdev.xyz/valorant.html
// API key : optionnelle, augmente le rate limit (60 req/min vs 30). On la
// passe via header HDEV-API-Key si HENRIKDEV_API_KEY est dans l'env.

const HENRIKDEV_BASE = 'https://api.henrikdev.xyz/valorant';

// Régions supportées par HenrikDev. EU couvre la France, on default sur eu.
export type ValorantRegion = 'eu' | 'na' | 'kr' | 'ap' | 'latam' | 'br';

export interface HenrikMmrResult {
  /** Rang complet ex "Diamond 2", "Radiant" (déjà au format affichage Aedral) */
  rank: string;
  /** Rank Rating courant (0-100) */
  rr: number;
  /** PUUID Riot encrypted, à mémoriser pour les sync futurs */
  puuid: string;
  /** Région détectée par HenrikDev */
  region: string;
}

export interface HenrikMmrError {
  ok: false;
  /** 404 = compte introuvable, 429 = rate limit, 5xx = HenrikDev down */
  status: number;
  message: string;
}

export interface HenrikMmrOk {
  ok: true;
  data: HenrikMmrResult;
}

/**
 * Récupère le rang Valorant actuel d'un joueur via son RiotID.
 *
 * @example
 *   const res = await fetchValorantMmr({ name: 'Skypi', tag: 'EUW', region: 'eu' });
 *   if (res.ok) console.log(res.data.rank); // "Diamond 2"
 */
export async function fetchValorantMmr(params: {
  name: string;
  tag: string;
  region?: ValorantRegion;
}): Promise<HenrikMmrOk | HenrikMmrError> {
  const region = params.region ?? 'eu';
  const name = encodeURIComponent(params.name.trim());
  const tag = encodeURIComponent(params.tag.trim());
  const url = `${HENRIKDEV_BASE}/v2/mmr/${region}/${name}/${tag}`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.HENRIKDEV_API_KEY;
  if (apiKey) headers['Authorization'] = apiKey;

  try {
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `HenrikDev HTTP ${res.status}`,
      };
    }
    const json = await res.json() as {
      status?: number;
      data?: {
        current_data?: {
          currenttierpatched?: string;
          ranking_in_tier?: number;
        };
        puuid?: string;
        name?: string;
        tag?: string;
      };
    };
    const current = json.data?.current_data;
    if (!current?.currenttierpatched) {
      return { ok: false, status: 404, message: 'Rang absent dans la réponse HenrikDev (joueur non classé ?)' };
    }
    return {
      ok: true,
      data: {
        rank: current.currenttierpatched,
        rr: typeof current.ranking_in_tier === 'number' ? current.ranking_in_tier : 0,
        puuid: json.data?.puuid ?? '',
        region,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? err.message : 'HenrikDev fetch failed',
    };
  }
}
