// Identité Rocket League OFFICIELLE d'un joueur — la source de vérité pour le
// rang vérifié et l'anti-mensonge. Voir docs/rl-rank-verification-plan.md.
//
// Deux voies équivalentes peuvent fournir l'identité officielle :
//   1. Epic — `rlEpicId` (snapshot 32-hex de la connexion Epic Discord vérifiée).
//      C'est la voie principale post-F2P : la progression RL vit sur Epic.
//   2. Steam — `steamLinked.steamId64` (Steam OpenID, déjà existant). Tient lieu
//      d'identité officielle pour les joueurs qui ont lié Steam.
//
// Les deux sont "sticky" — figés une fois posés, modifiables seulement sur
// demande admin (sera implémenté en Lot 6). Le pseudo (`rlEpicName` côté Epic,
// `personaName` côté Steam) peut, lui, se rafraîchir librement.

import type { SpringsUser } from '@/types';
import type { DiscordConnection } from '@/lib/discord-connections';

// Un ID de compte Epic Games est un identifiant hexadécimal minuscule de 32
// caractères, ex. `ec1ab5d08131431794f74a98c891b86d`. Vérifié sur les comptes
// réels stockés via la connexion Discord d'Aedral (2026-05-22).
export const EPIC_ID_RE = /^[0-9a-f]{32}$/;

export function isValidEpicId(s: unknown): s is string {
  return typeof s === 'string' && EPIC_ID_RE.test(s);
}

// Cherche la connexion Discord `epicgames` vérifiée d'un user. Renvoie null si
// elle manque, n'est pas vérifiée, ou si son `id` n'a pas le format Epic
// attendu (32-hex). C'est cette connexion qui sert à proposer le snapshot
// initial du rlEpicId (Lot 2).
export function findVerifiedEpicConnection(
  connections: DiscordConnection[] | undefined,
): DiscordConnection | null {
  if (!Array.isArray(connections)) return null;
  for (const c of connections) {
    if (c.type === 'epicgames' && c.verified && isValidEpicId(c.id)) return c;
  }
  return null;
}

// Représente l'identité RL officielle d'un user pour l'affichage et la
// construction d'URLs (tracker, ballchasing). `anchorId` est l'identifiant
// stable (rlEpicId pour Epic, SteamID64 pour Steam) ; `displayName` est le
// pseudo affiché ; `source` indique d'où vient l'identité.
export type RlOfficialIdentity =
  | { platform: 'epic'; anchorId: string; displayName: string; source: 'epic_discord' | 'epic_admin' }
  | { platform: 'steam'; anchorId: string; displayName: string; source: 'steam_openid' };

// True si le user a *au moins une* identité RL officielle (Epic ou Steam).
// Sert à savoir si on peut afficher son rang ("non renseigné" sinon).
export function hasOfficialRlIdentity(user: Pick<SpringsUser, 'rlEpicId' | 'steamLinked'>): boolean {
  if (isValidEpicId(user.rlEpicId)) return true;
  if (user.steamLinked?.steamId64) return true;
  return false;
}

// Retourne l'identité officielle préférentielle d'un user. Epic en premier
// (carte d'identité RL post-F2P), Steam en fallback. Null si aucune des deux.
export function getOfficialRlIdentity(
  user: Pick<SpringsUser, 'rlEpicId' | 'rlEpicName' | 'rlEpicLinkSource' | 'steamLinked'>,
): RlOfficialIdentity | null {
  if (isValidEpicId(user.rlEpicId)) {
    return {
      platform: 'epic',
      anchorId: user.rlEpicId,
      displayName: (user.rlEpicName ?? '').trim() || user.rlEpicId,
      source: user.rlEpicLinkSource === 'admin' ? 'epic_admin' : 'epic_discord',
    };
  }
  const sid = user.steamLinked?.steamId64;
  if (sid) {
    return {
      platform: 'steam',
      anchorId: sid,
      displayName: (user.steamLinked?.personaName ?? '').trim() || sid,
      source: 'steam_openid',
    };
  }
  return null;
}
