// Avatars Discord : construction d'URL + rafraîchissement via le bot.
//
// Problème : on stocke `discordAvatar` comme URL CDN contenant le HASH de
// l'avatar (cdn.discordapp.com/avatars/<id>/<hash>.png). Ce hash change quand
// le joueur change/retire son avatar Discord. Comme on ne rafraîchit
// `discordAvatar` qu'au login, les URLs deviennent périmées → 404 (≈20 % de
// l'annuaire constaté le 24/06).
//
// Solution : le bot Discord peut lire l'avatar ACTUEL de n'importe quel user
// via GET /users/{id} (Authorization: Bot …), sans que le joueur se reconnecte.
// Utilisé par la passe nocturne (cron expire-invitations) + le backfill one-shot
// `scripts/refresh-discord-avatars.mjs`.

// Construit l'URL CDN de l'avatar (même format que le callback OAuth).
// `avatarHash` null → avatar par défaut Discord (gère le nouveau système de
// pseudo unique où discriminator vaut "0").
export function buildDiscordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
  discriminator?: string | null,
): string {
  if (avatarHash) {
    // Les avatars animés (hash `a_…`) sont aussi servis en .png (statique).
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
  }
  let index: number;
  if (!discriminator || discriminator === '0') {
    // Nouveau système (pseudo unique) : (id >> 22) % 6
    try {
      index = Number((BigInt(userId) >> BigInt(22)) % BigInt(6));
    } catch {
      index = 0;
    }
  } else {
    // Système legacy (discriminator #1234) : discriminator % 5
    index = Number(discriminator) % 5;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

// Récupère l'URL de l'avatar ACTUEL d'un user via le bot Discord.
// Renvoie null si : pas de token, user introuvable (compte supprimé), rate-limit
// (429) ou erreur réseau → l'appelant garde l'ancienne valeur et retentera.
export async function fetchDiscordAvatarUrlViaBot(discordUserId: string): Promise<string | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${discordUserId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; avatar?: string | null; discriminator?: string | null };
    if (!u?.id) return null;
    return buildDiscordAvatarUrl(u.id, u.avatar ?? null, u.discriminator ?? null);
  } catch {
    return null;
  }
}
