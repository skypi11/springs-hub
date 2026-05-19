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
