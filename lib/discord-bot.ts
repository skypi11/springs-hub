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

// Permission demandée : Administrator (8). Justification : les salons privés
// réservés aux équipes ont presque toujours des permission overrides qui
// bloquent @everyone (et donc le rôle du bot). Sans Administrator, le fondateur
// devrait ajouter le bot manuellement comme override sur CHAQUE salon d'équipe
// — c'est le cauchemar des bots de gestion esport. Administrator bypass tous
// les overrides et permet de poster partout sans config manuelle, ce qui est
// le standard pour les bots de ce type (MEE6, Carl-bot, Dyno…).
export const BOT_INVITE_PERMISSIONS = '8';

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

// Couleurs (decimal) utilisées dans les embeds selon le type d'event Springs —
// alignées sur la DA du calendrier côté site.
const EVENT_COLORS: Record<string, number> = {
  training: 0x4da6ff, // bleu clair
  scrim: 0xa364d9,    // violet Springs
  match: 0xffb800,    // or Springs
  springs: 0x5865f2,  // blurple Discord
  autre: 0x7a7a95,    // gris
};

const EVENT_LABELS: Record<string, string> = {
  training: 'Entraînement',
  scrim: 'Scrim',
  match: 'Match',
  springs: 'Évènement Springs',
  autre: 'Autre',
};

export interface EventEmbedInput {
  title: string;
  type: string;
  description?: string | null;
  location?: string | null;
  startsAtMs: number;
  endsAtMs: number;
  teamName?: string | null;
  structureName?: string | null;
  createdByName?: string | null;
  adversaire?: string | null;
  resultat?: string | null;
  siteEventUrl?: string | null;
  // Thumbnail : priorité logo équipe, fallback logo structure. URL absolue HTTPS.
  thumbnailUrl?: string | null;
  // Pings : liste d'IDs Discord à mentionner en tête de message (et dans
  // allowed_mentions pour que la notif push parte).
  pingUserIds?: string[];
  pingRoleId?: string | null;
  pingEveryone?: boolean;
}

// Poste un message + embed dans un salon Discord via le bot. Retourne l'id du
// message pour permettre un futur edit/delete. Throw en cas d'échec (l'appelant
// doit catch et rester silencieux côté UI si c'est un effet secondaire non-bloquant).
export async function postEventEmbed(channelId: string, input: EventEmbedInput): Promise<string> {
  const typeLabel = EVENT_LABELS[input.type] ?? input.type;
  const color = EVENT_COLORS[input.type] ?? 0x7a7a95;

  // Timestamps Discord : :F = date complète, :R = relative ("dans 2h"), :t = heure courte.
  const startSec = Math.floor(input.startsAtMs / 1000);
  const endSec = Math.floor(input.endsAtMs / 1000);

  // Mentions en tête de message (content). On cappe à 40 users pour éviter
  // de dépasser la limite Discord (2000 chars content).
  const userPings = (input.pingUserIds ?? []).slice(0, 40);
  const mentionsLine = [
    input.pingRoleId ? `<@&${input.pingRoleId}>` : '',
    ...userPings.map(id => `<@${id}>`),
  ].filter(Boolean).join(' ');

  // Auteur de l'embed : nom d'équipe si présent, sinon nom de structure.
  const authorName = input.teamName ?? input.structureName ?? 'Springs Hub';

  // Titre : [Type] Nom · vs Adversaire (si match/scrim)
  const adversaireSuffix = input.adversaire ? ` · vs ${input.adversaire}` : '';
  const titleWithType = `[${typeLabel}] ${input.title}${adversaireSuffix}`.slice(0, 256);

  // Fields inline pour un layout compact.
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '🗓️ Début', value: `<t:${startSec}:F>\n<t:${startSec}:R>`, inline: true },
    { name: '⏱️ Fin', value: `<t:${endSec}:t>`, inline: true },
  ];
  if (input.location) {
    fields.push({ name: '📍 Lieu', value: input.location.slice(0, 256), inline: true });
  }
  if (input.resultat) {
    fields.push({ name: '🏆 Résultat', value: input.resultat.slice(0, 64), inline: true });
  }
  // Liste des participants comme field Discord (en plus du content qui les ping).
  // Le field donne une vision "feuille de match" pérenne dans le message, même
  // quand les notifs push sont passées.
  if (userPings.length > 0) {
    const participantsValue = userPings.map(id => `<@${id}>`).join(' ');
    fields.push({
      name: `👥 Participants (${userPings.length})`,
      value: participantsValue.slice(0, 1024),
      inline: false,
    });
  }

  const embed: Record<string, unknown> = {
    color,
    author: { name: authorName },
    title: titleWithType,
    description: (input.description ?? '').slice(0, 2000) || undefined,
    fields,
    footer: {
      text: input.createdByName
        ? `Créé par ${input.createdByName} · Springs Hub`
        : 'Springs Hub',
    },
    timestamp: new Date().toISOString(),
  };
  if (input.siteEventUrl) embed.url = input.siteEventUrl;
  if (input.thumbnailUrl && /^https:\/\//.test(input.thumbnailUrl)) {
    embed.thumbnail = { url: input.thumbnailUrl };
  }

  // allowed_mentions : liste EXPLICITE des user/role IDs autorisés. Discord ne
  // pingera que ces IDs, même si le content contient d'autres mentions ou
  // @everyone. Sécurité par construction : on ne peut pas accidentellement
  // pinger quelqu'un hors liste.
  const allowedMentions: Record<string, unknown> = { parse: [] };
  if (userPings.length > 0) allowedMentions.users = userPings;
  if (input.pingRoleId) allowedMentions.roles = [input.pingRoleId];
  if (input.pingEveryone) (allowedMentions.parse as string[]).push('everyone');

  const content = mentionsLine || undefined;

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
    },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed],
      allowed_mentions: allowedMentions,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord post message failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.id as string;
}

// URL CDN de l'icône d'un serveur (ou null si pas d'icône custom).
export function guildIconUrl(guildId: string, iconHash: string | null, size = 128): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

// Types Discord channel pertinents pour poster des notifs :
//   0  = GUILD_TEXT
//   5  = GUILD_ANNOUNCEMENT (salon d'annonce "classique")
//   15 = GUILD_FORUM (on exclut : poster y est un post, pas un message)
// On ignore aussi les voice/stage/threads/categories.
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);
const CATEGORY_CHANNEL_TYPE = 4;

export interface DiscordChannel {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  position: number;
}

// Récupère la liste des salons d'un serveur filtrés aux types "postables".
// Inclut le nom de la catégorie parente si elle existe (pour regrouper côté UI).
// Nécessite que le bot soit dans le serveur + scope View Channels.
export async function getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord channels fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Array<{
    id: string;
    name: string;
    type: number;
    parent_id: string | null;
    position: number;
  }>;

  const categories = new Map<string, string>();
  for (const c of raw) {
    if (c.type === CATEGORY_CHANNEL_TYPE) categories.set(c.id, c.name);
  }

  return raw
    .filter(c => POSTABLE_CHANNEL_TYPES.has(c.type))
    .map(c => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id ?? null,
      parentName: c.parent_id ? (categories.get(c.parent_id) ?? null) : null,
      position: c.position ?? 0,
    }))
    .sort((a, b) => {
      // Tri : catégorie (nom) puis position dans la catégorie. Les salons sans
      // catégorie passent en premier.
      const pa = a.parentName ?? '';
      const pb = b.parentName ?? '';
      if (pa !== pb) return pa.localeCompare(pb);
      return a.position - b.position;
    });
}
