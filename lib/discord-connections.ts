// Helper pour gérer les connexions Discord (Twitch, YouTube, Spotify, Epic, Steam, etc.)
// récupérées via le scope OAuth `connections` au login. Centralise les metadata
// (labels, URLs publiques, mapping vers plateformes RL) pour qu'on n'ait pas à
// dupliquer la logique partout dans le code.
//
// Doc Discord : https://discord.com/developers/docs/resources/user#connection-object

export interface DiscordConnection {
  type: string;              // 'epicgames', 'twitch', 'youtube', 'spotify', etc.
  id: string;                // identifiant côté plateforme (souvent immuable)
  name: string;              // pseudo/handle actuel affiché
  verified: boolean;         // Discord a vérifié que l'user possède bien ce compte
  visibleOnProfile?: boolean; // toggle user — affiché sur profil Aedral public
  fetchedAt?: string;        // ISO date dernière sync depuis Discord
}

export interface ConnectionMeta {
  label: string;             // Nom affiché ("Twitch", "Epic Games"…)
  category: 'gaming' | 'streaming' | 'social' | 'music' | 'dev';
  // Construit l'URL publique du profil. null = pas d'URL publique connue.
  buildUrl: (id: string, name: string) => string | null;
  // Indique si cette connexion correspond à une plateforme RL d'Aedral
  // (utilisée pour pré-remplir rlPlatform/rlPlatformId)
  rlPlatform?: 'epic' | 'steam' | 'psn' | 'xbox' | 'switch';
}

// Mapping des types Discord → métadonnées Aedral. Ordre de priorité pour l'affichage.
export const CONNECTION_META: Record<string, ConnectionMeta> = {
  // ── Gaming ────────────────────────────────────────────────────────
  epicgames: {
    label: 'Epic Games',
    category: 'gaming',
    buildUrl: () => null, // Epic n'a pas d'URL publique de profil
    rlPlatform: 'epic',
  },
  steam: {
    label: 'Steam',
    category: 'gaming',
    buildUrl: (id) => `https://steamcommunity.com/profiles/${id}`,
    rlPlatform: 'steam',
  },
  playstation: {
    label: 'PlayStation',
    category: 'gaming',
    buildUrl: () => null, // Pas d'URL publique PSN
    rlPlatform: 'psn',
  },
  xbox: {
    label: 'Xbox Live',
    category: 'gaming',
    buildUrl: (_id, name) => `https://www.xbox.com/play/user/${encodeURIComponent(name)}`,
    rlPlatform: 'xbox',
  },
  battlenet: {
    label: 'Battle.net',
    category: 'gaming',
    buildUrl: () => null,
  },
  riotgames: {
    label: 'Riot Games',
    category: 'gaming',
    buildUrl: () => null,
  },
  leagueoflegends: {
    label: 'League of Legends',
    category: 'gaming',
    buildUrl: () => null,
  },
  // ── Streaming ─────────────────────────────────────────────────────
  twitch: {
    label: 'Twitch',
    category: 'streaming',
    buildUrl: (_id, name) => `https://www.twitch.tv/${encodeURIComponent(name)}`,
  },
  youtube: {
    label: 'YouTube',
    category: 'streaming',
    buildUrl: (id) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`,
  },
  // ── Music ────────────────────────────────────────────────────────
  spotify: {
    label: 'Spotify',
    category: 'music',
    buildUrl: (id) => `https://open.spotify.com/user/${encodeURIComponent(id)}`,
  },
  // ── Social ────────────────────────────────────────────────────────
  twitter: {
    label: 'X (Twitter)',
    category: 'social',
    buildUrl: (_id, name) => `https://x.com/${encodeURIComponent(name)}`,
  },
  tiktok: {
    label: 'TikTok',
    category: 'social',
    buildUrl: (_id, name) => `https://www.tiktok.com/@${encodeURIComponent(name)}`,
  },
  instagram: {
    label: 'Instagram',
    category: 'social',
    buildUrl: (_id, name) => `https://www.instagram.com/${encodeURIComponent(name)}`,
  },
  reddit: {
    label: 'Reddit',
    category: 'social',
    buildUrl: (_id, name) => `https://www.reddit.com/user/${encodeURIComponent(name)}`,
  },
  // ── Dev ───────────────────────────────────────────────────────────
  github: {
    label: 'GitHub',
    category: 'dev',
    buildUrl: (_id, name) => `https://github.com/${encodeURIComponent(name)}`,
  },
};

export function getConnectionMeta(type: string): ConnectionMeta | null {
  return CONNECTION_META[type] ?? null;
}

export function buildConnectionUrl(conn: DiscordConnection): string | null {
  const meta = getConnectionMeta(conn.type);
  if (!meta) return null;
  return meta.buildUrl(conn.id, conn.name);
}

// Fetch les connexions depuis l'API Discord (utilise un access token OAuth)
export async function fetchDiscordConnections(accessToken: string): Promise<DiscordConnection[]> {
  const res = await fetch('https://discord.com/api/users/@me/connections', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error('[Discord] fetch connections failed:', res.status);
    return [];
  }
  const raw = (await res.json()) as Array<{
    type: string;
    id: string;
    name: string;
    verified?: boolean;
  }>;
  return raw.map(c => ({
    type: c.type,
    id: c.id,
    name: c.name,
    verified: !!c.verified,
  }));
}

// Extrait l'identité Rocket League d'une connexion Discord si applicable.
// - Steam : on utilise l'ID (SteamID64, immuable)
// - Autres plateformes gaming : on utilise le pseudo (Discord garde à jour)
export function getRLIdentityFromConnection(
  conn: DiscordConnection
): { platform: NonNullable<ConnectionMeta['rlPlatform']>; id: string } | null {
  const meta = getConnectionMeta(conn.type);
  if (!meta?.rlPlatform) return null;
  const id = meta.rlPlatform === 'steam' ? conn.id : conn.name;
  if (!id) return null;
  return { platform: meta.rlPlatform, id };
}

// Priorité quand un user a plusieurs comptes gaming liés à Discord.
// Steam d'abord car immuable (link tracker.gg ne casse jamais), puis Epic
// (plus courant pour RL), puis consoles.
const RL_PLATFORM_PRIORITY: Array<NonNullable<ConnectionMeta['rlPlatform']>> = [
  'steam', 'epic', 'psn', 'xbox', 'switch',
];

export function pickBestRLConnection(
  connections: DiscordConnection[],
): { platform: NonNullable<ConnectionMeta['rlPlatform']>; id: string } | null {
  for (const target of RL_PLATFORM_PRIORITY) {
    const conn = connections.find(c => {
      const meta = getConnectionMeta(c.type);
      return meta?.rlPlatform === target;
    });
    if (conn) {
      const identity = getRLIdentityFromConnection(conn);
      if (identity) return identity;
    }
  }
  return null;
}

/**
 * Extrait le RiotID Valorant depuis la connexion Discord 'riotgames'.
 *
 * Discord stocke en pratique :
 * - `connection.id` : PUUID Riot encrypted (toujours présent, immuable)
 * - `connection.name` : soit "Name#TAG" complet, soit juste "Name" sans tag
 *   (le format dépend du contexte et peut évoluer)
 *
 * On retourne :
 * - `puuid` toujours (clé immuable pour appels HenrikDev futurs)
 * - `name` et `tag` si on peut les extraire de `connection.name`. Sinon `tag: ''`
 *   et `name: connection.name` (utiliser fetchValorantAccountByPuuid pour résoudre).
 *
 * @returns `{ name, tag, puuid }` (tag peut être vide) ou null si pas de connexion Riot.
 */
export function pickValorantRiotId(
  connections: DiscordConnection[] | null | undefined,
): { name: string; tag: string; puuid: string } | null {
  if (!connections) return null;
  const conn = connections.find(c => c.type === 'riotgames');
  if (!conn || !conn.id) return null;
  const rawName = (conn.name ?? '').trim();
  const hashIdx = rawName.lastIndexOf('#');
  // Format "Name#TAG" complet
  if (hashIdx >= 1 && hashIdx < rawName.length - 1) {
    return {
      name: rawName.slice(0, hashIdx).trim(),
      tag: rawName.slice(hashIdx + 1).trim(),
      puuid: conn.id,
    };
  }
  // Format partiel — pas de tag dans name. On retourne ce qu'on a, le caller
  // peut résoudre via HenrikDev fetchValorantAccountByPuuid si nécessaire.
  return { name: rawName, tag: '', puuid: conn.id };
}

// Merge les nouvelles connexions fetchées avec celles déjà en Firestore,
// en préservant les toggles `visibleOnProfile` existants. Retire celles qui
// ont disparu côté Discord (user les a déliées).
export function mergeConnections(
  fresh: DiscordConnection[],
  existing: DiscordConnection[] | undefined,
): DiscordConnection[] {
  const now = new Date().toISOString();
  const existingByType = new Map((existing ?? []).map(c => [c.type, c]));
  return fresh.map(c => {
    const prev = existingByType.get(c.type);
    return {
      ...c,
      visibleOnProfile: prev?.visibleOnProfile ?? false,
      fetchedAt: now,
    };
  });
}
