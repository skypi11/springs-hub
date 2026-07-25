// Garde d'usage d'un serveur Discord par une compétition.
//
// Règle : on ne peut désigner que le serveur dont on est propriétaire ou
// administrateur. Sans elle, n'importe quel identifiant de serveur où le bot
// est présent était acceptable — il suffisait de connaître celui d'une autre
// structure pour lui faire créer des rôles et des salons.
//
// Vérifiée à l'enregistrement ET rejouée au provisioning : entre les deux,
// l'organisateur a pu perdre ses droits, ou le bot être exclu du serveur.

import { describeGuildAccess, guildIdOfChannel, roleIdsOfGuild } from '@/lib/discord-competition';

/** Snowflake Discord de l'auteur, extrait de l'uid Aedral (`discord_<id>`). */
export function discordIdOfUid(uid: string): string | null {
  const id = uid.startsWith('discord_') ? uid.slice('discord_'.length) : '';
  return /^\d{17,20}$/.test(id) ? id : null;
}

/**
 * Message d'erreur si le serveur n'est pas utilisable par cet utilisateur,
 * `null` s'il l'est. Une panne Discord bloque volontairement l'écriture : mieux
 * vaut réessayer que d'enregistrer un serveur qu'on n'a pas pu vérifier.
 */
export async function guildBlocker(uid: string, guildId: string): Promise<string | null> {
  const discordUserId = discordIdOfUid(uid);
  if (!discordUserId) {
    return "Ton compte n'est pas lié à Discord : impossible de vérifier tes droits sur ce serveur.";
  }
  let access;
  try {
    access = await describeGuildAccess(guildId, discordUserId);
  } catch {
    return 'Discord est injoignable pour le moment : réessaie dans un instant.';
  }
  if (!access.botPresent) {
    return "Le bot Aedral n'est pas sur ce serveur — invite-le avant de le désigner.";
  }
  if (!access.userManages) {
    return "Tu dois être administrateur de ce serveur Discord pour l'utiliser (ou en être le propriétaire).";
  }
  return null;
}

/**
 * Les salons et rôles désignés appartiennent-ils bien AU serveur autorisé ?
 *
 * Sans ce contrôle, la garde du serveur ne servait à rien pour les cibles : le
 * format snowflake était la seule exigence, et les écritures Discord
 * (`POST /channels/{id}/messages`) ignorent le serveur. On pouvait donc faire
 * annoncer et mentionner le bot sur le Discord d'une autre structure. Le cas le
 * plus probable n'est même pas malveillant : changer le serveur d'une
 * compétition en gardant les identifiants de l'ancien.
 */
export async function discordTargetsBlocker(
  guildId: string,
  targets: { announceChannelId?: string | null; staffChannelId?: string | null; staffRoleIds?: string[] },
): Promise<string | null> {
  const channels: Array<[string, string]> = [];
  if (targets.announceChannelId) channels.push(["Le salon d'annonces", targets.announceChannelId]);
  if (targets.staffChannelId) channels.push(['Le salon du staff', targets.staffChannelId]);

  for (const [label, channelId] of channels) {
    const owner = await guildIdOfChannel(channelId);
    if (owner === null) {
      return `${label} est introuvable — choisis-le dans la liste du serveur.`;
    }
    if (owner !== guildId) {
      return `${label} appartient à un autre serveur Discord.`;
    }
  }

  const roleIds = targets.staffRoleIds ?? [];
  if (roleIds.length > 0) {
    const known = await roleIdsOfGuild(guildId);
    if (!known) return 'Les rôles de ce serveur sont illisibles pour le moment : réessaie.';
    const stranger = roleIds.find(id => !known.has(id));
    if (stranger) return "Un des rôles du staff n'existe pas sur ce serveur.";
  }
  return null;
}
