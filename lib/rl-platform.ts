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
// Lit la plateforme RL effective d'un user, avec fallback legacy sur
// epicAccountId/epicDisplayName si les nouveaux champs ne sont pas remplis.
export function getEffectiveRLPlatform(user: {
  rlPlatform?: string;
  rlPlatformId?: string;
  epicAccountId?: string;
  epicDisplayName?: string;
}): { platform: RLPlatform; id: string } | null {
  // Préférer les nouveaux champs si renseignés et valides
  if (isValidRLPlatform(user.rlPlatform) && user.rlPlatformId?.trim()) {
    return { platform: user.rlPlatform, id: user.rlPlatformId.trim() };
  }
  // Fallback legacy : ancien flow stockait epicDisplayName (pseudo) + epicAccountId (ID résolu via TRN)
  const legacyId = user.epicDisplayName?.trim() || user.epicAccountId?.trim();
  if (legacyId) {
    return { platform: 'epic', id: legacyId };
  }
  return null;
}
