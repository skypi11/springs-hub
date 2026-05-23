// Helpers cross-platform pour Rocket League : Epic / Steam / PSN / Xbox / Switch.
// Centralise les labels UI, les placeholders d'aide, et la construction des URLs
// tracker.gg / Ballchasing à partir du couple (platform, platformId).
//
// Ce module remplace l'ancien flow basé sur `epicAccountId` + `rlTrackerUrl`
// manuel : on génère désormais les liens automatiquement.

export const RL_PLATFORMS_LIST = ['epic', 'steam', 'psn', 'xbox', 'switch'] as const;
export type RLPlatform = (typeof RL_PLATFORMS_LIST)[number];

export interface RLPlatformMeta {
  value: RLPlatform;
  label: string;          // Affiché dans le dropdown
  idLabel: string;        // Label du champ ID/pseudo
  idPlaceholder: string;  // Placeholder du champ
  idHelp: string;         // Aide contextuelle pour trouver l'ID
}

export const RL_PLATFORMS: RLPlatformMeta[] = [
  {
    value: 'epic',
    label: 'Epic Games (PC)',
    idLabel: 'Pseudo Epic',
    idPlaceholder: 'TonPseudoEpic',
    idHelp: '⚠️ Si tu changes ton pseudo Epic en jeu, pense à le mettre à jour ici (sinon le lien tracker.gg ne fonctionnera plus).',
  },
  {
    value: 'steam',
    label: 'Steam (PC)',
    idLabel: 'SteamID64',
    idPlaceholder: '76561198XXXXXXXXX',
    idHelp: '✓ Ton SteamID64 (17 chiffres) est permanent même si tu changes ton pseudo Steam. Trouve-le sur steamid.io en collant l\'URL de ton profil Steam.',
  },
  {
    value: 'psn',
    label: 'PlayStation',
    idLabel: 'PSN ID',
    idPlaceholder: 'TonPsnId',
    idHelp: '⚠️ Si tu changes ton PSN ID, pense à le mettre à jour ici.',
  },
  {
    value: 'xbox',
    label: 'Xbox',
    idLabel: 'Gamertag',
    idPlaceholder: 'Ton Gamertag',
    idHelp: '⚠️ Si tu changes ton Gamertag Xbox, pense à le mettre à jour ici.',
  },
  {
    value: 'switch',
    label: 'Nintendo Switch',
    idLabel: 'Switch ID',
    idPlaceholder: 'Ton ID Switch',
    idHelp: '⚠️ Note : la couverture Switch sur tracker.gg et Ballchasing est plus limitée que sur les autres plateformes.',
  },
];

export function isValidRLPlatform(v: unknown): v is RLPlatform {
  return typeof v === 'string' && (RL_PLATFORMS_LIST as readonly string[]).includes(v);
}

export function getRLPlatformMeta(p: RLPlatform): RLPlatformMeta {
  return RL_PLATFORMS.find(x => x.value === p) ?? RL_PLATFORMS[0];
}

// ── URL builders ──────────────────────────────────────────────────────────
// Tracker.gg et Ballchasing utilisent des identifiants de plateforme légèrement
// différents (ex: Xbox = "xbl" chez tracker.gg vs "xbox" chez Ballchasing).
// On centralise le mapping ici.

const TRACKER_GG_PLATFORM_MAP: Record<RLPlatform, string> = {
  epic: 'epic',
  steam: 'steam',
  psn: 'psn',
  xbox: 'xbl',
  switch: 'switch',
};

// Ballchasing fonctionne en RECHERCHE par nom dans les replays, pas en
// index par identifiant (sauf Steam où SteamID64 est immuable et indexé).
// Vérifié 2026-05-19 :
//   /player/epic/{pseudo} → "This player does not appear in any replay" (vide)
//   /?player-name={pseudo} → 416 résultats pour le même joueur ✓
// Donc on utilise la recherche par nom pour toutes les plateformes sauf Steam.

export function buildTrackerGgUrl(platform: RLPlatform, id: string): string {
  const p = TRACKER_GG_PLATFORM_MAP[platform];
  return `https://rocketleague.tracker.network/rocket-league/profile/${p}/${encodeURIComponent(id.trim())}/overview`;
}

export function buildBallchasingUrl(platform: RLPlatform, id: string): string {
  const trimmedId = id.trim();
  if (platform === 'steam') {
    // SteamID64 immutable + indexé chez Ballchasing → profil direct riche
    return `https://ballchasing.com/player/steam/${encodeURIComponent(trimmedId)}`;
  }
  // Epic / PSN / Xbox / Switch : recherche par nom (le profil direct
  // Ballchasing pour ces plateformes nécessite un identifiant interne UUID
  // que la plupart des users ne connaissent pas — la search marche pour
  // tout le monde et retourne tous les replays du joueur).
  return `https://ballchasing.com/?player-name=${encodeURIComponent(trimmedId)}`;
}

// ── Helper de migration / lecture ─────────────────────────────────────────
// Lit la plateforme RL effective d'un user pour construire ses URLs externes
// (tracker.gg, ballchasing). Priorité : Epic > tout le reste, parce que
// depuis le passage free-to-play la progression RL vit sur le compte Epic
// même quand le joueur lance le jeu via Steam — donc tracker.gg/steam/{id}
// est souvent vide pour ces joueurs alors que tracker.gg/epic/{pseudo} est
// peuplé. Voir docs/rl-rank-verification-plan.md.
export function getEffectiveRLPlatform(user: {
  rlPlatform?: string;
  rlPlatformId?: string;
  rlEpicName?: string;        // snapshot Lot 2 (officiel)
  epicAccountId?: string;     // legacy
  epicDisplayName?: string;   // legacy
  discordConnections?: Array<{ type: string; name: string; verified?: boolean }>;
  steamLinked?: { steamId64?: string };
}): { platform: RLPlatform; id: string } | null {
  // 1. Snapshot Epic Lot 2 — la source officielle figée par l'user.
  const epicSnapshot = user.rlEpicName?.trim();
  if (epicSnapshot) return { platform: 'epic', id: epicSnapshot };

  // 2. Connexion Epic vérifiée sur Discord — proxy fiable post-F2P, marche
  //    même quand l'user n'a pas encore confirmé son compte sur Aedral.
  const epicConn = (user.discordConnections ?? []).find(
    c => c.type === 'epicgames' && c.verified && c.name?.trim(),
  );
  if (epicConn) return { platform: 'epic', id: epicConn.name.trim() };

  // 3. Choix manuel explicite (rlPlatform/rlPlatformId) — respecte la décision
  //    si l'user a explicitement sélectionné autre chose (PSN, Xbox, Switch).
  if (isValidRLPlatform(user.rlPlatform) && user.rlPlatformId?.trim()) {
    return { platform: user.rlPlatform, id: user.rlPlatformId.trim() };
  }

  // 4. Steam OpenID lié — fallback pour les Steam-only sans aucune Epic.
  const sid = user.steamLinked?.steamId64?.trim();
  if (sid) return { platform: 'steam', id: sid };

  // 5. Legacy epicDisplayName / epicAccountId
  const legacyId = user.epicDisplayName?.trim() || user.epicAccountId?.trim();
  if (legacyId) return { platform: 'epic', id: legacyId };

  return null;
}
