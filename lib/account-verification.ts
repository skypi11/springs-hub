// État de vérification des comptes de jeu d'un user, côté client.
//
// Source de vérité unique pour : le nudge de vérif (dashboard/profil), et plus
// tard le gate compétitif (être aligné en roster / s'inscrire à un scrim). On
// dérive, par jeu vérifiable (RL, Valorant), si le compte est vérifié et quelle
// action est dispo — surtout le « 1-clic » quand la connection Discord est déjà
// là (le gros levier : la donnée est capturée, il manque juste le clic).
//
// NB : TM n'est pas « vérifiable » (rang déclaratif, pas d'API anti-mensonge).

import type { SpringsUser } from '@/types';
import { findVerifiedEpicConnection, isValidSteamId64, hasOfficialRlIdentity } from '@/lib/rl-identity';
import { pickValorantRiotId } from '@/lib/discord-connections';

export type VerifyGame = 'rocket_league' | 'valorant';

export type VerifyAction =
  // 1-clic : la preuve est déjà dans le Discord du user, un POST suffit.
  | { kind: 'oneClickEpic'; apiPath: '/api/profile/rl-epic-link'; accountName: string }
  | { kind: 'oneClickValorant'; apiPath: '/api/profile/sync-valorant-rank'; accountName: string }
  | { kind: 'confirmSteam'; apiPath: '/api/profile/rl-steam-link'; accountName: string }
  // Pas de connection Discord du jeu → il faut la lier en amont (étape manuelle).
  | { kind: 'linkInDiscord'; what: string };

export type VerifyItem = {
  game: VerifyGame;
  label: string;
  verified: boolean;
  /** null si déjà vérifié. */
  action: VerifyAction | null;
};

export function getVerificationItems(user: SpringsUser | null): VerifyItem[] {
  if (!user) return [];
  const games = user.games ?? [];
  const items: VerifyItem[] = [];

  if (games.includes('rocket_league')) {
    const verified = hasOfficialRlIdentity(user);
    let action: VerifyAction | null = null;
    if (!verified) {
      const epic = findVerifiedEpicConnection(user.discordConnections);
      if (epic) {
        action = { kind: 'oneClickEpic', apiPath: '/api/profile/rl-epic-link', accountName: epic.name || 'compte Epic' };
      } else if (isValidSteamId64(user.steamLinked?.steamId64)) {
        action = { kind: 'confirmSteam', apiPath: '/api/profile/rl-steam-link', accountName: user.steamLinked?.personaName || 'compte Steam' };
      } else {
        action = { kind: 'linkInDiscord', what: 'Epic ou Steam' };
      }
    }
    items.push({ game: 'rocket_league', label: 'Rocket League', verified, action });
  }

  if (games.includes('valorant')) {
    const verified = !!user.valorantPuuid;
    let action: VerifyAction | null = null;
    if (!verified) {
      const riot = pickValorantRiotId(user.discordConnections);
      if (riot) {
        const name = riot.tag ? `${riot.name}#${riot.tag}` : (riot.name || 'compte Riot');
        action = { kind: 'oneClickValorant', apiPath: '/api/profile/sync-valorant-rank', accountName: name };
      } else {
        action = { kind: 'linkInDiscord', what: 'Riot' };
      }
    }
    items.push({ game: 'valorant', label: 'Valorant', verified, action });
  }

  return items;
}

export type VerificationSummary = {
  /** Nb de jeux vérifiables pratiqués (RL/Valorant). */
  verifiable: number;
  verified: number;
  /** Nb d'items vérifiables en 1 clic (connection Discord déjà présente). */
  oneClickReady: number;
  hasUnverified: boolean;
  allVerified: boolean;
};

export function getVerificationSummary(user: SpringsUser | null): VerificationSummary {
  const items = getVerificationItems(user);
  const verifiable = items.length;
  const verified = items.filter(i => i.verified).length;
  const oneClickReady = items.filter(i => i.action && i.action.kind !== 'linkInDiscord').length;
  return {
    verifiable,
    verified,
    oneClickReady,
    hasUnverified: verified < verifiable,
    allVerified: verifiable > 0 && verified === verifiable,
  };
}
