// OAuth Trackmania (Nadeo) — « Se connecter avec Ubisoft ».
//
// Pourquoi : Discord n'expose PAS Ubisoft dans ses connexions de compte (c'est
// une demande communautaire jamais implémentée), donc impossible de récupérer
// l'identité Trackmania d'un joueur par ce biais. Nadeo fournit en revanche un
// OAuth officiel qui renvoie l'`accountId` (UUID stable) et le `displayName`.
//
// L'enjeu dépasse le confort de saisie : le serveur de jeu remonte les
// résultats avec ces identifiants. Un `accountId` vérifié à l'inscription =
// rapprochement automatique entre un inscrit et ses résultats, sans pseudo
// tapé à la main ni faute de frappe à rattraper le jour de la LAN.
//
// Enregistrement de l'app : https://api.trackmania.com (connexion avec un
// compte Ubisoft, qui devient le gestionnaire de l'application).
// Doc de référence : https://webservices.openplanet.dev/oauth/auth

const TM_AUTHORIZE_URL = 'https://api.trackmania.com/oauth/authorize';
const TM_TOKEN_URL = 'https://api.trackmania.com/api/access_token';
const TM_USER_URL = 'https://api.trackmania.com/api/user';

export interface TrackmaniaIdentity {
  /** UUID Nadeo, stable et immuable — c'est LUI qui sert de clé de rapprochement. */
  accountId: string;
  /** Pseudo affiché en jeu. Unique, mais modifiable une fois tous les 30 jours :
   *  à rafraîchir, jamais à utiliser comme identifiant. */
  displayName: string;
}

export function isTrackmaniaOAuthConfigured(): boolean {
  return Boolean(process.env.TM_OAUTH_CLIENT_ID && process.env.TM_OAUTH_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TM_OAUTH_CLIENT_ID;
  const clientSecret = process.env.TM_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TM_OAUTH_CLIENT_ID / TM_OAUTH_CLIENT_SECRET manquants');
  }
  return { clientId, clientSecret };
}

export function trackmaniaRedirectUri(origin: string): string {
  return `${origin}/api/auth/trackmania/callback`;
}

/**
 * URL vers laquelle envoyer le joueur. Aucun `scope` n'est demandé : les scopes
 * Nadeo (`clubs`, `read_favorite`, `write_favorite`) donnent accès à des données
 * dont on n'a pas besoin. Le flux nu suffit à obtenir l'identité, et on ne
 * réclame donc aucune permission superflue au joueur.
 */
export function buildTrackmaniaAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const { clientId } = credentials();
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `${TM_AUTHORIZE_URL}?${qs.toString()}`;
}

/** Échange le `code` de retour contre un access token. Serveur uniquement :
 *  le client_secret ne doit jamais atteindre le navigateur. */
export async function exchangeTrackmaniaCode(params: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(TM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Échange du code Trackmania refusé (${res.status}) ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Réponse Trackmania sans access_token');
  return json.access_token;
}

/** Identité du joueur derrière le token. Renvoie { accountId, displayName }. */
export async function fetchTrackmaniaIdentity(accessToken: string): Promise<TrackmaniaIdentity> {
  const res = await fetch(TM_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Lecture du compte Trackmania refusée (${res.status}) ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as Partial<TrackmaniaIdentity>;
  if (!json.accountId || !json.displayName) {
    throw new Error('Réponse Trackmania incomplète (accountId/displayName)');
  }
  return { accountId: json.accountId, displayName: json.displayName };
}
