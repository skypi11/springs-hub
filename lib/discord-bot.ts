// Helpers REST pour l'API Discord, côté serveur uniquement.
// Le token du bot n'est JAMAIS exposé au client — ces fonctions sont appelées
// depuis les Route Handlers Next.js (runtime serveur).

const DISCORD_API = 'https://discord.com/api/v10';

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error('DISCORD_BOT_TOKEN manquant');
  return t;
}

function clientId(): string {
  const v = process.env.DISCORD_BOT_CLIENT_ID;
  if (!v) throw new Error('DISCORD_BOT_CLIENT_ID manquant');
  return v;
}

function clientSecret(): string {
  const v = process.env.DISCORD_BOT_CLIENT_SECRET;
  if (!v) throw new Error('DISCORD_BOT_CLIENT_SECRET manquant');
  return v;
}

export interface DiscordGuildInfo {
  id: string;
  name: string;
  iconHash: string | null;
}

// Permissions minimales demandées au moment de l'invite : View Channels (1024)
// + Send Messages (2048) + Embed Links (16384) = 19456. Aligné avec ce qui
// est affiché dans Discord Developer Portal → Bot → Permissions.
export const BOT_INVITE_PERMISSIONS = '19456';

// Construit l'URL vers laquelle on redirige le fondateur pour qu'il invite le bot
// dans un de ses serveurs. `state` est un nonce CSRF, stocké en cookie côté Next.
export function buildInstallUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    permissions: BOT_INVITE_PERMISSIONS,
    scope: 'bot',
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// Échange le code OAuth contre un access token (officiellement pour l'utilisateur,
// mais on l'utilise surtout pour valider que le code est légitime). Discord
// renvoie aussi `guild` dans la réponse quand scope=bot.
export async function exchangeInstallCode(code: string, redirectUri: string): Promise<{
  accessToken: string;
  guild: { id: string; name: string; icon: string | null } | null;
}> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const g = data.guild as { id?: string; name?: string; icon?: string | null } | undefined;
  return {
    accessToken: data.access_token as string,
    guild: g && g.id && g.name ? { id: g.id, name: g.name, icon: g.icon ?? null } : null,
  };
}

// Récupère les infos d'un serveur via le token bot. Nécessite que le bot soit
// déjà dans ce serveur (sinon 403).
export async function getGuildInfo(guildId: string): Promise<DiscordGuildInfo> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord guild fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    id: data.id as string,
    name: data.name as string,
    iconHash: (data.icon as string | null) ?? null,
  };
}

// URL CDN de l'icône d'un serveur (ou null si pas d'icône custom).
export function guildIconUrl(guildId: string, iconHash: string | null, size = 128): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}
