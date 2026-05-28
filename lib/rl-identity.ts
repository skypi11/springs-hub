// Identité Rocket League OFFICIELLE d'un joueur, la source de vérité pour le
// rang vérifié et l'anti-mensonge. Voir docs/rl-rank-verification-plan.md.
//
// Deux voies symétriques peuvent fournir l'identité officielle :
//   1. Epic, `rlEpicId` (snapshot 32-hex de la connexion Epic Discord vérifiée).
//      C'est la voie principale post-F2P : la progression RL vit sur Epic.
//   2. Steam, `rlSteamId` (snapshot SteamID64 de la liaison Steam OpenID
//      Aedral, confirmée par le joueur comme étant son compte RL).
//      Distinct de `steamLinked.steamId64` brut qui ne prouve pas que le
//      joueur joue RL sur Steam, la confirmation est requise.
//
// Les deux sont "sticky", figés une fois posés, modifiables seulement sur
// demande admin (voir /admin/rl-link-changes). Le pseudo (`rlEpicName` côté
// Epic, `rlSteamName` côté Steam) peut, lui, se rafraîchir librement.

import type { SpringsUser } from '@/types';
import type { DiscordConnection } from '@/lib/discord-connections';

// Un ID de compte Epic Games est un identifiant hexadécimal minuscule de 32
// caractères, ex. `ec1ab5d08131431794f74a98c891b86d`. Vérifié sur les comptes
// réels stockés via la connexion Discord d'Aedral (2026-05-22).
export const EPIC_ID_RE = /^[0-9a-f]{32}$/;

export function isValidEpicId(s: unknown): s is string {
  return typeof s === 'string' && EPIC_ID_RE.test(s);
}

// Un SteamID64 est un identifiant numérique de 17 chiffres, commençant par
// `7656119`. Format standard utilisé partout (Steam, tracker.gg, ballchasing).
export const STEAM_ID64_RE = /^7656119\d{10}$/;

export function isValidSteamId64(s: unknown): s is string {
  return typeof s === 'string' && STEAM_ID64_RE.test(s);
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
// stable (rlEpicId pour Epic, rlSteamId pour Steam) ; `displayName` est le
// pseudo affiché ; `source` indique d'où vient l'identité.
export type RlOfficialIdentity =
  | { platform: 'epic'; anchorId: string; displayName: string; source: 'epic_discord' | 'epic_admin' }
  | { platform: 'steam'; anchorId: string; displayName: string; source: 'steam_openid' | 'steam_admin' };

// True si le user a *au moins une* identité RL officielle (Epic ou Steam).
// Sert à savoir si on peut afficher son rang ("non renseigné" sinon).
// Steam pur (steamLinked sans rlSteamId) NE compte pas, il faut une
// confirmation explicite que le compte Steam est bien le compte RL.
export function hasOfficialRlIdentity(
  user: Pick<SpringsUser, 'rlEpicId' | 'rlSteamId'>,
): boolean {
  if (isValidEpicId(user.rlEpicId)) return true;
  if (isValidSteamId64(user.rlSteamId)) return true;
  return false;
}

// Retourne l'identité officielle préférentielle d'un user. Epic en premier
// (carte d'identité RL post-F2P), Steam en fallback. Null si aucune des deux.
export function getOfficialRlIdentity(
  user: Pick<SpringsUser, 'rlEpicId' | 'rlEpicName' | 'rlEpicLinkSource' | 'rlSteamId' | 'rlSteamName' | 'rlSteamLinkSource'>,
): RlOfficialIdentity | null {
  if (isValidEpicId(user.rlEpicId)) {
    return {
      platform: 'epic',
      anchorId: user.rlEpicId,
      displayName: (user.rlEpicName ?? '').trim() || user.rlEpicId,
      source: user.rlEpicLinkSource === 'admin' ? 'epic_admin' : 'epic_discord',
    };
  }
  if (isValidSteamId64(user.rlSteamId)) {
    return {
      platform: 'steam',
      anchorId: user.rlSteamId,
      displayName: (user.rlSteamName ?? '').trim() || user.rlSteamId,
      source: user.rlSteamLinkSource === 'admin' ? 'steam_admin' : 'steam_openid',
    };
  }
  return null;
}
