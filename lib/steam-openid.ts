// Steam OpenID 2.0 — flow d'auth officiel Steam pour récupérer le SteamID64
// permanent d'un user. Une fois récupéré, il ne change JAMAIS même si le user
// modifie son pseudo Steam — donc les URLs tracker.gg / Ballchasing basées
// sur SteamID64 sont blindées contre les changements de pseudo.
//
// Doc Steam : https://partner.steamgames.com/doc/features/auth#website
//
// Sécurité critique : on doit VÉRIFIER la signature du payload OpenID en
// POSTant les params reçus avec openid.mode=check_authentication sur le
// même endpoint Steam. Sans ça, n'importe qui peut forger un payload.

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_CLAIMED_ID_RE = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

/**
 * Construit l'URL de redirection vers Steam pour lancer le flow OpenID.
 * @param returnToUrl L'URL absolue de notre endpoint callback (doit être sur `realm`).
 * @param realm L'origin de notre site (ex: 'https://aedral.com').
 */
export function buildSteamLoginUrl(returnToUrl: string, realm: string): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnToUrl,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/**
 * Vérifie un payload OpenID reçu en callback en interrogeant Steam.
 * Retourne le SteamID64 si valide, null sinon.
 *
 * On copie tous les openid.* paramètres tels quels et on remplace juste
 * openid.mode=check_authentication. Steam répond is_valid:true ou false.
 */
export async function verifySteamOpenIdResponse(
  searchParams: URLSearchParams,
): Promise<string | null> {
  // 1. Extraction du SteamID64 depuis openid.claimed_id
  const claimedId = searchParams.get('openid.claimed_id');
  if (!claimedId) return null;
  const match = STEAM_CLAIMED_ID_RE.exec(claimedId);
  if (!match) return null;
  const steamId64 = match[1];

  // 2. Vérification : on renvoie tous les params à Steam avec mode=check_authentication
  const verifyBody = new URLSearchParams();
  for (const [k, v] of searchParams.entries()) {
    if (k.startsWith('openid.')) verifyBody.append(k, v);
  }
  verifyBody.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyBody.toString(),
  });
  if (!res.ok) return null;
  const body = await res.text();
  // Format de réponse Steam : "ns:http://...\nis_valid:true\n"
  if (!/^is_valid:true$/m.test(body)) return null;

  return steamId64;
}

export interface SteamProfile {
  steamId64: string;
  personaName?: string;
  avatarUrl?: string;
  profileUrl?: string;
}

/**
 * Enrichit un SteamID64 avec le pseudo et l'avatar via la Steam Web API.
 * Nécessite STEAM_WEB_API_KEY dans les env vars (gratuit, à récupérer sur
 * https://steamcommunity.com/dev/apikey).
 *
 * Si la clé n'est pas configurée ou que l'appel échoue, on retourne juste
 * le SteamID64 sans les champs optionnels — le système reste fonctionnel.
 */
export async function fetchSteamProfile(steamId64: string): Promise<SteamProfile> {
  const apiKey = process.env.STEAM_WEB_API_KEY;
  if (!apiKey) return { steamId64 };
  try {
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId64);
    const res = await fetch(url.toString());
    if (!res.ok) return { steamId64 };
    const data = (await res.json()) as {
      response?: {
        players?: Array<{
          steamid: string;
          personaname?: string;
          avatarfull?: string;
          profileurl?: string;
        }>;
      };
    };
    const player = data.response?.players?.[0];
    if (!player) return { steamId64 };
    return {
      steamId64,
      personaName: player.personaname,
      avatarUrl: player.avatarfull,
      profileUrl: player.profileurl,
    };
  } catch {
    return { steamId64 };
  }
}
