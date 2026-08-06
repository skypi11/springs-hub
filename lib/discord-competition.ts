// Provisioning Discord du moteur de compétitions (spec Legends §7, archi §6).
// Côté serveur uniquement — le token bot ne quitte jamais les Route Handlers.
//
// Volumétrie : ~10-15 calls Discord par équipe (rôle + 2 salons + assignations
// × 3-5 membres) → 300-500 calls pour 32 équipes, sur des endpoints à
// rate-limit serré. D'où les deux principes de ce module :
//   1. BACKOFF 429 générique (respect de `retry_after`) sur chaque call.
//   2. REPRISE IDEMPOTENTE : l'appelant stocke chaque ID créé au fil de l'eau
//      sur le doc Firestore — un batch interrompu (timeout, 5xx) se relance
//      sans rien recréer.
//
// L'approbation d'une inscription n'appelle JAMAIS Discord en synchrone : elle
// pose `discord.provisioningStatus = 'queued'`, et le bouton console
// « Provisionner » traite la file (route /api/admin/competitions/[id]/provision).

import { FieldValue, type Firestore } from 'firebase-admin/firestore';

const DISCORD_API = 'https://discord.com/api/v10';

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error('DISCORD_BOT_TOKEN manquant');
  return t;
}

// ── Fetch avec backoff 429 + retry 5xx ──────────────────────────────────────

// Permission bits (API v10). Nombres < 2^31 → pas de BigInt (cible < ES2020,
// piège documenté — mémoire project_discord_avatar_refresh).
const PERM = {
  MANAGE_CHANNELS: 1 << 4,
  ADMINISTRATOR: 1 << 3,
  MANAGE_GUILD: 1 << 5,
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  MANAGE_MESSAGES: 1 << 13,
  EMBED_LINKS: 1 << 14,
  ATTACH_FILES: 1 << 15,
  READ_MESSAGE_HISTORY: 1 << 16,
  CONNECT: 1 << 20,
  SPEAK: 1 << 21,
  MUTE_MEMBERS: 1 << 22,
  MANAGE_ROLES: 1 << 28,
} as const;

/**
 * Ce que le bot accorde dans les salons qu'il crée. Aucune de ces valeurs
 * n'est réglable : exposer les quarante cases de Discord reviendrait à
 * déplacer le travail sur l'organisateur au lieu de le lui épargner. Il
 * choisit QUI a accès ; le QUOI est ce tableau, affiché tel quel à l'écran.
 */
export const CHANNEL_GRANTS = {
  /** Joueurs de l'équipe — salon texte. Les fichiers sont autorisés : une
   *  capture de score ou de litige doit pouvoir se poster ici, sinon la preuve
   *  repart en DM et se perd. */
  playersText: PERM.VIEW_CHANNEL + PERM.SEND_MESSAGES + PERM.READ_MESSAGE_HISTORY
    + PERM.ATTACH_FILES + PERM.EMBED_LINKS,
  playersVoice: PERM.VIEW_CHANNEL + PERM.CONNECT + PERM.SPEAK,
  /** Staff de l'organisateur : comme les joueurs, plus la modération. */
  staffText: PERM.VIEW_CHANNEL + PERM.SEND_MESSAGES + PERM.READ_MESSAGE_HISTORY
    + PERM.ATTACH_FILES + PERM.EMBED_LINKS + PERM.MANAGE_MESSAGES,
  staffVoice: PERM.VIEW_CHANNEL + PERM.CONNECT + PERM.SPEAK + PERM.MUTE_MEMBERS,
} as const;

/** Un bitfield de permissions Discord peut dépasser 2^53 : le test passe par
 *  BigInt, sinon les bits bas se perdent à la conversion en nombre. */
function hasPermissionBit(permissions: string | undefined, bit: number): boolean {
  if (!permissions) return false;
  try {
    const mask = BigInt(bit);
    return (BigInt(permissions) & mask) === mask;
  } catch {
    return false;
  }
}

const MAX_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 15_000;

/**
 * fetch Discord authentifié bot, avec backoff :
 * - 429 → attend `retry_after` (body JSON ou header), retente jusqu'à
 *   MAX_RETRIES fois (attente cappée à 15 s par tentative).
 * - 502/503/504 → backoff exponentiel court (1 s, 2 s, 4 s).
 * Retourne la Response finale telle quelle : l'appelant décide quoi faire des
 * autres statuts (404 = pas membre, 403 = permissions…).
 */
export async function discordFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    Authorization: `Bot ${botToken()}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };
  let res: Response = await fetch(`${DISCORD_API}${path}`, { ...init, headers });
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (res.status === 429) {
      const body = await res.clone().json().catch(() => ({} as { retry_after?: number }));
      const retryAfterHeader = Number(res.headers.get('Retry-After'));
      const retryAfterSec = typeof body.retry_after === 'number'
        ? body.retry_after
        : Number.isFinite(retryAfterHeader) ? retryAfterHeader : 1;
      const waitMs = Math.min(MAX_RETRY_WAIT_MS, Math.max(250, Math.round(retryAfterSec * 1000) + 100));
      await new Promise(r => setTimeout(r, waitMs));
    } else if (res.status >= 502 && res.status <= 504) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    } else {
      return res;
    }
    res = await fetch(`${DISCORD_API}${path}`, { ...init, headers });
  }
  return res;
}

async function discordError(res: Response, label: string): Promise<Error> {
  const body = await res.text().catch(() => '');
  return new Error(`${label}: ${res.status} ${body.slice(0, 200)}`);
}

// ── Primitives de provisioning ──────────────────────────────────────────────

const AUDIT_REASON = { 'X-Audit-Log-Reason': 'Aedral - provisioning competition' };

export async function createGuildRole(
  guildId: string,
  name: string,
  opts: { color?: number } = {},
): Promise<string> {
  const res = await discordFetch(`/guilds/${guildId}/roles`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: name.slice(0, 100),
      color: opts.color ?? 0,
      mentionable: true,
      hoist: false,
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create role failed');
  const data = await res.json();
  return data.id as string;
}

export async function createCategory(guildId: string, name: string): Promise<string> {
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({ name: name.slice(0, 100), type: 4 }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create category failed');
  const data = await res.json();
  return data.id as string;
}

/**
 * Salon privé d'équipe (texte type 0 ou vocal type 2) : @everyone ne voit pas,
 * le rôle d'équipe voit/écrit/parle. Les admins du serveur voient tout via
 * leur permission Administrator (le staff, spec §7) — le bot aussi.
 */
export async function createTeamChannel(
  guildId: string,
  opts: {
    name: string;
    type: 0 | 2;
    categoryId: string | null;
    teamRoleId: string;
    /** Rôles du staff de l'organisateur : sans eux, seuls les administrateurs
     *  du serveur voyaient les salons d'équipe — un modérateur n'y avait aucun
     *  accès, et devait tout refaire à la main. */
    staffRoleIds?: string[];
  },
): Promise<string> {
  const isText = opts.type === 0;
  const teamAllow = isText ? CHANNEL_GRANTS.playersText : CHANNEL_GRANTS.playersVoice;
  const staffAllow = isText ? CHANNEL_GRANTS.staffText : CHANNEL_GRANTS.staffVoice;
  const staffRoleIds = (opts.staffRoleIds ?? []).filter(id => id && id !== opts.teamRoleId && id !== guildId);

  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: opts.name.slice(0, 100),
      type: opts.type,
      parent_id: opts.categoryId ?? undefined,
      permission_overwrites: [
        { id: guildId, type: 0, deny: String(PERM.VIEW_CHANNEL), allow: '0' },
        { id: opts.teamRoleId, type: 0, allow: String(teamAllow), deny: '0' },
        ...staffRoleIds.map(id => ({ id, type: 0, allow: String(staffAllow), deny: '0' })),
      ],
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create channel failed');
  const data = await res.json();
  return data.id as string;
}

/**
 * Salon d'annonces du tournoi : VISIBLE de tout le serveur (c'est le but), mais
 * seuls le bot et le staff y écrivent — un salon d'annonces où tout le monde
 * répond devient vite illisible.
 */
export async function createAnnounceChannel(
  guildId: string,
  opts: { name: string; categoryId: string | null; staffRoleIds?: string[] },
): Promise<string> {
  const staffRoleIds = (opts.staffRoleIds ?? []).filter(id => id && id !== guildId);
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: opts.name.slice(0, 100),
      type: 0,
      parent_id: opts.categoryId ?? undefined,
      permission_overwrites: [
        {
          id: guildId,
          type: 0,
          allow: String(PERM.VIEW_CHANNEL + PERM.READ_MESSAGE_HISTORY),
          deny: String(PERM.SEND_MESSAGES),
        },
        ...staffRoleIds.map(id => ({
          id, type: 0,
          allow: String(CHANNEL_GRANTS.staffText),
          deny: '0',
        })),
      ],
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create announce channel failed');
  const data = await res.json();
  return data.id as string;
}

/**
 * Salon des résultats : lisible de tout le serveur (les affiches sont faites
 * pour être vues et republiées), écrit par le bot et le staff seuls. Mêmes
 * permissions que le salon d'annonces — un fil de résultats où chacun commente
 * devient vite illisible.
 */
export async function createResultsChannel(
  guildId: string,
  opts: { name: string; categoryId: string | null; staffRoleIds?: string[] },
): Promise<string> {
  return createAnnounceChannel(guildId, opts);
}

/**
 * Salon général des participants : le seul endroit où les équipes se parlent
 * entre elles. Réservé au rôle participant — @everyone n'y a pas accès, sinon
 * ce n'est plus un salon de tournoi mais un salon de serveur.
 */
export async function createGeneralChannel(
  guildId: string,
  opts: { name: string; categoryId: string | null; participantRoleId: string; staffRoleIds?: string[] },
): Promise<string> {
  const staffRoleIds = (opts.staffRoleIds ?? []).filter(id => id && id !== guildId && id !== opts.participantRoleId);
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: opts.name.slice(0, 100),
      type: 0,
      parent_id: opts.categoryId ?? undefined,
      permission_overwrites: [
        { id: guildId, type: 0, deny: String(PERM.VIEW_CHANNEL), allow: '0' },
        { id: opts.participantRoleId, type: 0, allow: String(CHANNEL_GRANTS.playersText), deny: '0' },
        ...staffRoleIds.map(id => ({ id, type: 0, allow: String(CHANNEL_GRANTS.staffText), deny: '0' })),
      ],
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create general channel failed');
  const data = await res.json();
  return data.id as string;
}

/**
 * Salon privé du staff : ni les joueurs ni le reste du serveur n'y ont accès.
 * Sert aux alertes du jour J (litige ouvert, forfait à valider) — sans lui,
 * un litige n'existe que dans la console, et deux équipes attendent pendant
 * que personne ne regarde.
 */
export async function createStaffChannel(
  guildId: string,
  opts: { name: string; categoryId: string | null; staffRoleIds?: string[] },
): Promise<string> {
  const staffRoleIds = (opts.staffRoleIds ?? []).filter(id => id && id !== guildId);
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: opts.name.slice(0, 100),
      type: 0,
      parent_id: opts.categoryId ?? undefined,
      permission_overwrites: [
        { id: guildId, type: 0, deny: String(PERM.VIEW_CHANNEL), allow: '0' },
        ...staffRoleIds.map(id => ({ id, type: 0, allow: String(CHANNEL_GRANTS.staffText), deny: '0' })),
      ],
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create staff channel failed');
  const data = await res.json();
  return data.id as string;
}

/** Discord refuse au-delà de 50 salons dans une même catégorie. Une Qualif à
 *  32 équipes en texte + vocal en demande 64 : sans débordement, le
 *  provisioning casserait au 51e, le jour du tournoi. */
export const MAX_CHANNELS_PER_CATEGORY = 50;

/**
 * Salons déjà rangés dans une catégorie (pour savoir quand déborder).
 * `null` si Discord n'a pas répondu : renvoyer 0 éteindrait le garde-fou en
 * silence et le provisioning casserait au 51e salon.
 */
export async function countChannelsInCategory(guildId: string, categoryId: string): Promise<number | null> {
  const res = await discordFetch(`/guilds/${guildId}/channels`);
  if (!res.ok) return null;
  const channels = await res.json() as Array<{ parent_id?: string | null }>;
  return channels.filter(c => c.parent_id === categoryId).length;
}

/** Serveur auquel appartient un salon — `null` si illisible ou inexistant.
 *  Sert à refuser d'écrire (ou de supprimer) hors du serveur autorisé. */
export async function guildIdOfChannel(channelId: string): Promise<string | null> {
  const res = await discordFetch(`/channels/${channelId}`);
  if (!res.ok) return null;
  const channel = await res.json() as { guild_id?: string };
  return channel.guild_id ?? null;
}

/** Identifiants de rôles existants sur un serveur (`null` si illisible). */
export async function roleIdsOfGuild(guildId: string): Promise<Set<string> | null> {
  const res = await discordFetch(`/guilds/${guildId}/roles`);
  if (!res.ok) return null;
  const roles = await res.json() as Array<{ id: string }>;
  return new Set(roles.map(r => r.id));
}

/** Supprime un salon (nettoyage de fin de tournoi). 404 = déjà supprimé. */
export async function deleteChannel(channelId: string): Promise<boolean> {
  const res = await discordFetch(`/channels/${channelId}`, { method: 'DELETE', headers: AUDIT_REASON });
  return res.ok || res.status === 404;
}

/** Supprime un rôle (nettoyage de fin de tournoi). 404 = déjà supprimé. */
export async function deleteGuildRole(guildId: string, roleId: string): Promise<boolean> {
  const res = await discordFetch(`/guilds/${guildId}/roles/${roleId}`, {
    method: 'DELETE', headers: AUDIT_REASON,
  });
  return res.ok || res.status === 404;
}

/**
 * Assigne un rôle à un membre. `notMember: true` si l'utilisateur n'est pas
 * (ou plus) sur le serveur — warning non bloquant côté appelant (archi §6),
 * jamais une erreur. Un 404 est AMBIGU chez Discord : on lit le code d'erreur
 * JSON pour distinguer Unknown Member (10007, cas normal) d'un rôle supprimé
 * à la main (10011 Unknown Role → `staleRole`, l'appelant doit invalider l'ID
 * stocké et re-provisionner, sinon le batch serait silencieusement faux).
 */
export async function addMemberRole(
  guildId: string,
  discordUserId: string,
  roleId: string,
): Promise<{ ok: boolean; notMember: boolean; staleRole: boolean }> {
  const res = await discordFetch(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: 'PUT',
    headers: AUDIT_REASON,
  });
  if (res.status === 204) return { ok: true, notMember: false, staleRole: false };
  if (res.status === 404) {
    const body = await res.json().catch(() => ({} as { code?: number }));
    if (body.code === 10011) return { ok: false, notMember: false, staleRole: true };
    return { ok: false, notMember: true, staleRole: false };
  }
  throw await discordError(res, 'Discord add member role failed');
}

/**
 * Retire un rôle à UN membre (changement de roster : le joueur sortant perd
 * l'accès aux salons privés de l'équipe). Même sémantique 404 tolérante que
 * `addMemberRole` — un membre parti ou un rôle déjà retiré n'est jamais une
 * erreur. Le rôle Participant COMMUN au circuit n'est pas retiré par cette
 * voie (partagé — seul le déprovisionnement d'équipe le fait).
 */
export async function removeMemberRole(
  guildId: string,
  discordUserId: string,
  roleId: string,
): Promise<{ ok: boolean }> {
  const res = await discordFetch(`/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: AUDIT_REASON,
  });
  if (res.status === 204 || res.status === 404) return { ok: res.status === 204 };
  throw await discordError(res, 'Discord remove member role failed');
}

/**
 * Le joueur est-il membre du serveur ? `null` = indéterminé (erreur API après
 * backoff) — l'appelant ne doit pas conclure à une absence.
 */
export async function isGuildMember(guildId: string, discordUserId: string): Promise<boolean | null> {
  const res = await discordFetch(`/guilds/${guildId}/members/${discordUserId}`);
  if (res.ok) return true;
  if (res.status === 404) return false;
  return null;
}

/** Adhésion à un serveur, dans le détail. */
export type GuildMembership =
  /** Membre à part entière : il voit les salons et peut être joint. */
  | 'member'
  /** A rejoint mais n'a pas franchi l'écran d'accueil du serveur (règles à
   *  accepter). Il ne voit AUCUN salon et ne recevra aucune information. */
  | 'pending'
  | 'absent'
  /** Discord illisible : bot absent, jeton manquant, panne. Ne jamais bloquer
   *  quelqu'un là-dessus, ce n'est pas sa faute. */
  | 'unknown';

/**
 * Comme `isGuildMember`, mais distingue le membre en attente de validation.
 *
 * Un serveur avec écran d'accueil (`MEMBER_VERIFICATION_GATE_ENABLED`, ce qui
 * est le cas du Discord de Springs) place les arrivants en `pending` tant
 * qu'ils n'ont pas accepté les règles. Ils ne voient alors aucun salon. Répondre
 * « tu es bien sur le Discord » à quelqu'un dans cet état, c'est valider une
 * condition qui n'est pas remplie : on exige l'adhésion précisément pour
 * pouvoir le joindre, et il ne recevra rien.
 *
 * Fonction distincte, et non un changement de `isGuildMember` : celle-ci sert
 * aussi au module compétitions, dont ce n'est pas le sujet.
 */
export async function guildMembershipState(
  guildId: string,
  discordUserId: string
): Promise<GuildMembership> {
  const res = await discordFetch(`/guilds/${guildId}/members/${discordUserId}`);
  if (res.status === 404) return 'absent';
  if (!res.ok) return 'unknown';
  const member = (await res.json().catch(() => null)) as { pending?: boolean } | null;
  if (!member) return 'unknown';
  return member.pending === true ? 'pending' : 'member';
}

// ── Contrôle d'accès au serveur ─────────────────────────────────────────────

export interface GuildAccessReport {
  guildId: string;
  /** null quand le bot n'est pas (ou plus) sur le serveur. */
  guildName: string | null;
  botPresent: boolean;
  /** L'utilisateur est propriétaire ou administrateur DE CE SERVEUR. */
  userManages: boolean;
  /** Ce qui manque, en clair, pour affichage — jamais un code d'erreur brut. */
  problems: string[];
  botCanManageRoles: boolean;
  botCanManageChannels: boolean;
  /** Position du rôle le plus haut du bot : il ne peut attribuer que des rôles
   *  situés SOUS lui dans la liste du serveur. */
  botHighestPosition: number;
}

interface GuildRoleRaw { id: string; name: string; position: number; permissions?: string }

/** Identifiant du bot, mis en cache : il ne change jamais pour un token donné. */
let cachedBotUserId: string | null = null;
async function botUserIdOf(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;
  const res = await discordFetch('/users/@me');
  if (!res.ok) return null;
  const me = await res.json() as { id?: string };
  cachedBotUserId = me.id ?? null;
  return cachedBotUserId;
}

/**
 * Qui a le droit de faire quoi sur ce serveur — le garde-fou de la
 * configuration Discord d'une compétition.
 *
 * Sans lui, n'importe quel ID de serveur où le bot est présent était
 * acceptable : on pouvait faire créer rôles et salons sur le Discord d'une
 * AUTRE structure. La règle est désormais : seul le propriétaire ou un
 * administrateur du serveur peut le désigner. Vérifié ici, donc côté serveur,
 * donc incontournable — et rejoué au provisioning, les droits ayant pu changer.
 */
export async function describeGuildAccess(
  guildId: string,
  discordUserId: string,
): Promise<GuildAccessReport> {
  const report: GuildAccessReport = {
    guildId,
    guildName: null,
    botPresent: false,
    userManages: false,
    problems: [],
    botCanManageRoles: false,
    botCanManageChannels: false,
    botHighestPosition: 0,
  };

  const guildRes = await discordFetch(`/guilds/${guildId}`);
  if (!guildRes.ok) {
    report.problems.push(guildRes.status === 404
      ? "Le bot Aedral n'est pas sur ce serveur — invite-le d'abord."
      : `Serveur illisible (erreur ${guildRes.status}).`);
    return report;
  }
  const guild = await guildRes.json() as { name?: string; owner_id?: string };
  report.botPresent = true;
  report.guildName = guild.name ?? null;

  const rolesRes = await discordFetch(`/guilds/${guildId}/roles`);
  const roles: GuildRoleRaw[] = rolesRes.ok ? await rolesRes.json() : [];
  const roleById = new Map(roles.map(r => [r.id, r]));

  // L'utilisateur : propriétaire, ou porteur d'un rôle Administrator.
  if (guild.owner_id && guild.owner_id === discordUserId) {
    report.userManages = true;
  } else {
    const memberRes = await discordFetch(`/guilds/${guildId}/members/${discordUserId}`);
    if (memberRes.status === 404) {
      report.problems.push("Tu n'es pas membre de ce serveur.");
    } else if (!memberRes.ok) {
      report.problems.push(`Impossible de vérifier tes droits (erreur ${memberRes.status}).`);
    } else {
      const member = await memberRes.json() as { roles?: string[] };
      const admin = (member.roles ?? []).some(id =>
        hasPermissionBit(roleById.get(id)?.permissions, PERM.ADMINISTRATOR));
      if (admin) report.userManages = true;
      else report.problems.push("Tu n'es pas administrateur de ce serveur.");
    }
  }

  // Le bot : ses permissions cumulées et sa position dans la hiérarchie.
  // ATTENTION : `/guilds/{id}/members/@me` n'existe pas — Discord répond 400
  // (« @me n'est pas un snowflake »), et la lecture échouait en silence : le
  // bot passait pour dépourvu de tout droit alors qu'il était administrateur.
  const botUserId = await botUserIdOf();
  const botRes = botUserId
    ? await discordFetch(`/guilds/${guildId}/members/${botUserId}`)
    : null;
  if (!botRes?.ok) {
    // Ne jamais conclure « pas de permission » sur une lecture ratée : le
    // message enverrait l'organisateur régler un problème qui n'existe pas.
    report.problems.push('Impossible de lire les droits du bot sur ce serveur — réessaie.');
    return report;
  }

  const bot = await botRes.json() as { roles?: string[] };
  // Le rôle @everyone (id = guildId) compte dans le cumul.
  const botRoles = [guildId, ...(bot.roles ?? [])]
    .map(id => roleById.get(id))
    .filter((r): r is GuildRoleRaw => !!r);
  // Administrator emporte tout le reste : inutile de chercher les bits fins.
  const isAdministrator = botRoles.some(r => hasPermissionBit(r.permissions, PERM.ADMINISTRATOR));
  report.botCanManageRoles = isAdministrator
    || botRoles.some(r => hasPermissionBit(r.permissions, PERM.MANAGE_ROLES));
  report.botCanManageChannels = isAdministrator
    || botRoles.some(r => hasPermissionBit(r.permissions, PERM.MANAGE_CHANNELS));
  report.botHighestPosition = botRoles.reduce((max, r) => Math.max(max, r.position ?? 0), 0);

  if (!report.botCanManageRoles) {
    report.problems.push("Le bot n'a pas la permission « Gérer les rôles » sur ce serveur.");
  }
  if (!report.botCanManageChannels) {
    report.problems.push("Le bot n'a pas la permission « Gérer les salons » sur ce serveur.");
  }
  // PAS d'avertissement sur la position du rôle du bot, contrairement à ce
  // qu'on croirait : les rôles que le bot crée arrivent eux aussi en bas de la
  // liste, donc sous le sien, et s'attribuent normalement. Vérifié contre un
  // vrai serveur (bot en position 1, rôle créé en position 1 → attribution
  // 204). Le message d'origine se déclenchait sur TOUT serveur fraîchement
  // invité — le cas le plus courant — et envoyait l'organisateur régler un
  // problème inexistant, au milieu des vrais.
  return report;
}

// ── Orchestration idempotente ───────────────────────────────────────────────

export interface CompetitionDiscordShared {
  guildId: string;
  participantRoleId: string;
  /** Salon des résultats (créé ou désigné). null = pas d'affiches publiées. */
  resultsChannelId?: string | null;
  /** null quand la compétition ne veut aucun salon créé par le bot : il n'y a
   *  alors aucune catégorie à poser sur le serveur de l'organisateur. */
  categoryId: string | null;
  /** Salon public du tournoi (créé ou désigné). null = pas d'annonces. */
  announceChannelId: string | null;
  /** Salon privé du staff pour les alertes du jour J. */
  staffChannelId: string | null;
}

/**
 * Ressources partagées de la compétition : rôle participant + catégorie des
 * salons d'équipe. Créées une seule fois, IDs stockés immédiatement après
 * chaque création (reprise idempotente).
 *
 * Le rôle participant est COMMUN AU CIRCUIT (spec §7 : « Participant Legend »
 * partagé par les 4 Qualifs) : quand la compétition appartient à un circuit,
 * l'ID vit sur `circuits/{id}.discord` et est réutilisé — recopié sur le doc
 * compétition pour l'affichage. Réutilisation uniquement si le serveur Discord
 * est le même ; une compétition hors circuit garde son rôle à elle.
 */
export async function ensureCompetitionShared(
  db: Firestore,
  competitionId: string,
  input: {
    guildId: string;
    circuitId: string | null;
    participantRoleId: string | null;
    categoryId: string | null;
    participantRoleLabel: string;   // "Participant · Legends Springs Cup"
    categoryLabel: string;          // nom de la catégorie (réglable)
    /** Salons privés par équipe : sans eux, pas de catégorie à créer. */
    teamChannels?: boolean;
    /** Salon d'annonces à créer (le bot le range dans la catégorie du tournoi
     *  et le laisse visible de tout le serveur). */
    announce?: { create: boolean; name: string; existingId: string | null };
    /** Salon privé du staff pour les alertes du jour J. */
    staffChannel?: { create: boolean; name: string; existingId: string | null };
    /** Salon des résultats : les affiches de fin de match. */
    resultsChannel?: { create: boolean; name: string; existingId: string | null };
    /** Salon général : le seul où les équipes se parlent entre elles. */
    generalChannel?: { create: boolean; name: string; existingId: string | null };
    staffRoleIds?: string[];
  },
): Promise<CompetitionDiscordShared> {
  const compRef = db.collection('competitions').doc(competitionId);

  let participantRoleId = input.participantRoleId;
  if (!participantRoleId && input.circuitId) {
    const circuitRef = db.collection('circuits').doc(input.circuitId);
    const circuitSnap = await circuitRef.get();
    const circuitDiscord = circuitSnap.data()?.discord as { guildId?: string; participantRoleId?: string } | undefined;
    if (circuitDiscord?.participantRoleId && circuitDiscord.guildId === input.guildId) {
      participantRoleId = circuitDiscord.participantRoleId;
    } else {
      const created = await createGuildRole(input.guildId, input.participantRoleLabel, { color: 0xffb800 });
      // Le rôle appartient au CIRCUIT, mais le verrou de provisioning est posé
      // par compétition : deux étapes provisionnées en parallèle en créaient
      // chacune un. On adopte celui qui a gagné la course et on retire le
      // nôtre, plutôt que de laisser deux rôles identiques sur le serveur.
      const fresh = (await circuitRef.get()).data()?.discord as { guildId?: string; participantRoleId?: string } | undefined;
      if (fresh?.participantRoleId && fresh.guildId === input.guildId) {
        participantRoleId = fresh.participantRoleId;
        await deleteGuildRole(input.guildId, created).catch(() => {});
      } else {
        participantRoleId = created;
        await circuitRef.update({
          discord: { guildId: input.guildId, participantRoleId },
        });
      }
    }
    await compRef.update({ 'discord.participantRoleId': participantRoleId });
  } else if (!participantRoleId) {
    participantRoleId = await createGuildRole(input.guildId, input.participantRoleLabel, { color: 0xffb800 });
    await compRef.update({ 'discord.participantRoleId': participantRoleId });
  }

  // Catégorie : elle range les salons du tournoi. Si l'organisateur ne veut ni
  // salons d'équipe ni salons créés par le bot, rien n'est créé chez lui.
  const needsCategory = input.teamChannels !== false
    || input.announce?.create === true
    || input.staffChannel?.create === true;
  let categoryId = input.categoryId;
  if (!categoryId && needsCategory) {
    categoryId = await createCategory(input.guildId, input.categoryLabel);
    // `categoryIds` liste TOUTES les catégories créées (la principale et les
    // débordements) : c'est ce registre qui permet de les réutiliser à la
    // relance et de ne supprimer au nettoyage que ce que le bot a posé.
    await compRef.update({
      'discord.categoryId': categoryId,
      'discord.categoryIds': FieldValue.arrayUnion(categoryId),
    });
  }

  // Salon d'annonces : créé à la demande, sinon celui que l'organisateur a
  // désigné. Rangé dans la catégorie du tournoi, visible de tout le serveur.
  let announceChannelId = input.announce?.existingId ?? null;
  if (!announceChannelId && input.announce?.create) {
    announceChannelId = await createAnnounceChannel(input.guildId, {
      name: input.announce.name,
      categoryId,
      staffRoleIds: input.staffRoleIds,
    });
    // Tracé comme créé PAR LE BOT : le nettoyage ne supprime que ce registre,
    // jamais un salon que l'organisateur a désigné parmi les siens.
    await compRef.update({
      'discord.options.announceChannelId': announceChannelId,
      'discord.createdChannelIds': FieldValue.arrayUnion(announceChannelId),
    });
  }

  let staffChannelId = input.staffChannel?.existingId ?? null;
  if (!staffChannelId && input.staffChannel?.create) {
    staffChannelId = await createStaffChannel(input.guildId, {
      name: input.staffChannel.name,
      categoryId,
      staffRoleIds: input.staffRoleIds,
    });
    await compRef.update({
      'discord.options.staffChannelId': staffChannelId,
      'discord.createdChannelIds': FieldValue.arrayUnion(staffChannelId),
    });
  }

  let resultsChannelId = input.resultsChannel?.existingId ?? null;
  if (!resultsChannelId && input.resultsChannel?.create) {
    resultsChannelId = await createResultsChannel(input.guildId, {
      name: input.resultsChannel.name,
      categoryId,
      staffRoleIds: input.staffRoleIds,
    });
    await compRef.update({
      'discord.options.resultsChannelId': resultsChannelId,
      'discord.createdChannelIds': FieldValue.arrayUnion(resultsChannelId),
    });
  }

  // Salon général : réservé au rôle participant, donc créé APRÈS lui.
  let generalChannelId = input.generalChannel?.existingId ?? null;
  if (!generalChannelId && input.generalChannel?.create) {
    generalChannelId = await createGeneralChannel(input.guildId, {
      name: input.generalChannel.name,
      categoryId,
      participantRoleId,
      staffRoleIds: input.staffRoleIds,
    });
    await compRef.update({
      'discord.options.generalChannelId': generalChannelId,
      'discord.createdChannelIds': FieldValue.arrayUnion(generalChannelId),
    });
  }

  return {
    guildId: input.guildId, participantRoleId, categoryId,
    announceChannelId, staffChannelId, resultsChannelId,
  };
}

export interface ProvisionRegistrationInput {
  registrationId: string;
  teamName: string;
  roster: Array<{ discordId: string; displayName: string }>;
  discord: {
    roleId: string | null;
    textChannelId: string | null;
    voiceChannelId: string | null;
  };
}

export interface ProvisionResult {
  status: 'done' | 'partial';
  warnings: string[];
  /** Salons RÉELLEMENT créés pendant ce passage. L'appelant suit ainsi le
   *  remplissage de la catégorie : compter « ce qu'une équipe devrait avoir »
   *  surestimait à chaque reprise (les équipes déjà provisionnées ne créent
   *  plus rien) et faisait déborder trop tôt. */
  channelsCreated: number;
}

// Nom de salon texte : Discord force minuscules/tirets — on slugifie nous-mêmes
// pour un rendu propre et stable.
function textChannelName(teamName: string): string {
  const slug = teamName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || 'equipe';
}

/**
 * Provisionne UNE équipe validée : rôle d'équipe + salon texte + salon vocal
 * privés + assignation (rôle équipe + rôle participant) à chaque joueur du
 * roster. Chaque ID créé est écrit sur le doc registration AVANT de passer à
 * l'étape suivante → un batch interrompu reprend exactement où il s'est arrêté.
 *
 * - Joueur absent du serveur → warning non bloquant (archi §6).
 * - Rôle supprimé à la main sur Discord (Unknown Role) → l'ID stocké est
 *   invalidé et l'équipe repasse en erreur : le prochain passage recrée.
 * - `deadlineAtMs` : une équipe seule sous 429 répétés peut consommer tout le
 *   budget de la route — on vérifie la deadline ENTRE chaque call et on sort
 *   en partial plutôt que de laisser Vercel tuer la fonction (rapport perdu).
 */
export async function provisionRegistration(
  db: Firestore,
  shared: CompetitionDiscordShared,
  input: ProvisionRegistrationInput,
  opts: {
    deadlineAtMs?: number;
    teamChannels?: boolean;
    /** Salon vocal en plus du texte (désactivé par défaut : deux salons par
     *  équipe saturent vite une catégorie, et la plupart des équipes ont déjà
     *  leur vocal). */
    voiceChannels?: boolean;
    staffRoleIds?: string[];
    /** Catégorie à utiliser pour CETTE équipe (débordement au-delà de 50). */
    categoryId?: string | null;
    /** Message posté à la création du salon : une équipe qui débarque dans un
     *  salon vide ne sait pas à quoi il sert. */
    welcome?: { title: string; message: string; link?: string | null };
  } = {},
): Promise<ProvisionResult> {
  const regRef = db.collection('competition_registrations').doc(input.registrationId);
  const warnings: string[] = [];
  let channelsCreated = 0;
  const pastDeadline = () => opts.deadlineAtMs !== undefined && Date.now() > opts.deadlineAtMs;

  const bailPartial = async (): Promise<ProvisionResult> => {
    warnings.push('Interrompu par la limite de temps — relance le provisioning pour continuer');
    await regRef.update({ 'discord.provisioningStatus': 'partial', 'discord.warnings': warnings });
    return { status: 'partial', warnings, channelsCreated };
  };

  let roleId = input.discord.roleId;
  if (!roleId) {
    if (pastDeadline()) return bailPartial();
    roleId = await createGuildRole(shared.guildId, input.teamName);
    await regRef.update({ 'discord.roleId': roleId });
  }

  // Salons d'équipe : réglage de la compétition. Coupés, le rôle d'équipe est
  // quand même créé et assigné (il sert aux mentions et aux permissions), et
  // les messages qui visaient le salon d'équipe sont simplement sautés côté
  // appelant (`if (channelId)` partout).
  const categoryId = opts.categoryId !== undefined ? opts.categoryId : shared.categoryId;
  const wantsChannels = opts.teamChannels !== false && categoryId !== null;
  let textChannelId = input.discord.textChannelId;
  if (!textChannelId && wantsChannels) {
    if (pastDeadline()) return bailPartial();
    textChannelId = await createTeamChannel(shared.guildId, {
      name: textChannelName(input.teamName),
      type: 0,
      categoryId,
      teamRoleId: roleId,
      staffRoleIds: opts.staffRoleIds,
    });
    await regRef.update({ 'discord.textChannelId': textChannelId });
    channelsCreated += 1;

    // Message d'accueil, une seule fois : à la création du salon. Best-effort,
    // une panne d'envoi ne doit pas faire échouer le provisioning.
    if (opts.welcome) {
      try {
        await sendCompetitionChannelMessage(textChannelId, {
          title: opts.welcome.title,
          message: opts.welcome.message,
          link: opts.welcome.link ?? null,
          mentionRoleId: roleId,
        });
      } catch {
        warnings.push("Message d'accueil non envoyé dans le salon de l'équipe");
      }
    }
  }

  let voiceChannelId = input.discord.voiceChannelId;
  if (!voiceChannelId && wantsChannels && opts.voiceChannels === true) {
    if (pastDeadline()) return bailPartial();
    voiceChannelId = await createTeamChannel(shared.guildId, {
      name: input.teamName,
      type: 2,
      categoryId,
      teamRoleId: roleId,
      staffRoleIds: opts.staffRoleIds,
    });
    await regRef.update({ 'discord.voiceChannelId': voiceChannelId });
    channelsCreated += 1;
  }

  for (const member of input.roster) {
    if (!member.discordId) {
      warnings.push(`${member.displayName} : identifiant Discord manquant`);
      continue;
    }
    if (pastDeadline()) return bailPartial();
    const teamAssign = await addMemberRole(shared.guildId, member.discordId, roleId);
    if (teamAssign.staleRole) {
      // Le rôle d'équipe a été supprimé à la main : on invalide l'ID pour que
      // le prochain passage le recrée, et on sort en erreur franche.
      await regRef.update({ 'discord.roleId': null });
      throw new Error(`Le rôle Discord de ${input.teamName} a été supprimé à la main — relance le provisioning pour le recréer.`);
    }
    if (teamAssign.notMember) {
      warnings.push(`${member.displayName} n'est pas sur le serveur Discord`);
      continue;
    }
    const partAssign = await addMemberRole(shared.guildId, member.discordId, shared.participantRoleId);
    if (partAssign.staleRole) {
      // Rôle participant supprimé à la main : invalider l'ID partagé (circuit
      // ET compétition) puis erreur franche — recréé au prochain passage.
      await invalidateParticipantRole(db, input.registrationId, shared.participantRoleId);
      throw new Error('Le rôle participant Discord a été supprimé à la main — relance le provisioning pour le recréer.');
    }
  }

  const status: ProvisionResult['status'] = warnings.length > 0 ? 'partial' : 'done';
  await regRef.update({
    'discord.provisioningStatus': status,
    'discord.warnings': warnings,
    'discord.errorMessage': null,
  });
  return { status, warnings, channelsCreated };
}

// Invalide un rôle participant périmé partout où son ID est stocké (docs
// competitions + circuits qui le référencent).
async function invalidateParticipantRole(
  db: Firestore,
  registrationId: string,
  participantRoleId: string,
): Promise<void> {
  const regSnap = await db.collection('competition_registrations').doc(registrationId).get();
  const competitionId = regSnap.data()?.competitionId as string | undefined;
  if (!competitionId) return;
  const compRef = db.collection('competitions').doc(competitionId);
  const compSnap = await compRef.get();
  if (compSnap.data()?.discord?.participantRoleId === participantRoleId) {
    await compRef.update({ 'discord.participantRoleId': null });
  }
  const circuitId = compSnap.data()?.circuitId as string | null | undefined;
  if (circuitId) {
    const circuitRef = db.collection('circuits').doc(circuitId);
    const circuitSnap = await circuitRef.get();
    if (circuitSnap.data()?.discord?.participantRoleId === participantRoleId) {
      await circuitRef.update({ 'discord.participantRoleId': null });
    }
  }
}

/**
 * Compétitions qui partagent le MÊME rôle participant que celle-ci : elle seule
 * si elle est isolée, toutes les étapes du circuit hébergées sur le même
 * serveur sinon (le rôle est commun au circuit — spec §7).
 */
async function competitionsSharingParticipantRole(
  db: Firestore,
  opts: { competitionId: string; circuitId: string | null; guildId: string },
): Promise<string[]> {
  if (!opts.circuitId) return [opts.competitionId];
  const snap = await db.collection('competitions').where('circuitId', '==', opts.circuitId).get();
  const ids = snap.docs
    .filter(d => (d.data().discord?.guildId ?? null) === opts.guildId)
    .map(d => d.id);
  return ids.includes(opts.competitionId) ? ids : [...ids, opts.competitionId];
}

/**
 * Joueurs encore engagés sous ce rôle participant, une fois l'inscription
 * `excludeRegistrationId` écartée.
 *
 * Le rôle participant est PARTAGÉ par les étapes d'un circuit : sans ce
 * décompte, refuser (ou retirer) une équipe à la Qualif 2 retirait le rôle à
 * des joueurs validés à la Qualif 1, qui perdaient l'accès aux salons du
 * tournoi alors qu'ils y jouaient toujours.
 */
export async function discordIdsStillParticipating(
  db: Firestore,
  opts: { competitionId: string; circuitId: string | null; guildId: string; excludeRegistrationId: string },
): Promise<Set<string>> {
  const scope = await competitionsSharingParticipantRole(db, opts);
  const still = new Set<string>();
  // `in` est borné à 30 valeurs côté Firestore — un circuit en compte une
  // poignée, mais le découpage évite une panne si un jour ce n'est plus vrai.
  for (let i = 0; i < scope.length; i += 30) {
    const snap = await db.collection('competition_registrations')
      .where('competitionId', 'in', scope.slice(i, i + 30))
      .where('status', '==', 'approved')
      .get();
    for (const doc of snap.docs) {
      if (doc.id === opts.excludeRegistrationId) continue;
      for (const m of (doc.data().roster ?? []) as Array<{ discordId?: string }>) {
        if (m.discordId) still.add(m.discordId);
      }
    }
  }
  return still;
}

/**
 * Déprovisionne UNE équipe (reject/unapprove d'une inscription déjà
 * provisionnée) : supprime les salons privés et le rôle d'équipe, best-effort
 * — une équipe refusée ne doit pas garder l'accès à son salon ni le rôle
 * participant. Les 404 (déjà supprimé à la main) sont ignorés. Retourne les
 * échecs restants pour affichage console ; ne throw jamais.
 *
 * Le rôle participant n'est retiré qu'aux joueurs qui ne participent plus
 * NULLE PART sous ce rôle (voir `discordIdsStillParticipating`).
 */
export async function deprovisionRegistration(
  db: Firestore,
  guildId: string,
  input: {
    registrationId: string;
    competitionId: string;
    circuitId: string | null;
    roleId: string | null;
    textChannelId: string | null;
    voiceChannelId: string | null;
    participantRoleId: string | null;
    roster: Array<{ discordId: string; displayName: string }>;
  },
): Promise<{ warnings: string[] }> {
  const regRef = db.collection('competition_registrations').doc(input.registrationId);
  const warnings: string[] = [];

  const tryStep = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) {
      warnings.push(`${label} : ${err instanceof Error ? err.message.slice(0, 120) : 'erreur'}`);
    }
  };

  for (const channelId of [input.textChannelId, input.voiceChannelId]) {
    if (!channelId) continue;
    await tryStep('suppression du salon', async () => {
      const res = await discordFetch(`/channels/${channelId}`, { method: 'DELETE', headers: AUDIT_REASON });
      if (!res.ok && res.status !== 404) throw await discordError(res, 'Discord delete channel failed');
    });
  }
  if (input.roleId) {
    await tryStep("suppression du rôle d'équipe", async () => {
      const res = await discordFetch(`/guilds/${guildId}/roles/${input.roleId}`, { method: 'DELETE', headers: AUDIT_REASON });
      if (!res.ok && res.status !== 404) throw await discordError(res, 'Discord delete role failed');
    });
  }
  if (input.participantRoleId) {
    // Qui reste engagé sous ce rôle ? Une lecture ratée ne doit PAS conclure
    // « plus personne » : on préfère laisser un rôle de trop (accès en lecture
    // aux annonces) plutôt que couper l'accès à une équipe qui joue encore.
    let stillParticipating: Set<string>;
    try {
      stillParticipating = await discordIdsStillParticipating(db, {
        competitionId: input.competitionId,
        circuitId: input.circuitId,
        guildId,
        excludeRegistrationId: input.registrationId,
      });
    } catch {
      warnings.push('Rôle participant conservé : impossible de vérifier les autres inscriptions du circuit');
      stillParticipating = new Set(input.roster.map(m => m.discordId).filter(Boolean));
    }

    for (const member of input.roster) {
      if (!member.discordId) continue;
      if (stillParticipating.has(member.discordId)) continue;   // joue encore ailleurs
      await tryStep(`retrait du rôle participant (${member.displayName})`, async () => {
        const res = await discordFetch(
          `/guilds/${guildId}/members/${member.discordId}/roles/${input.participantRoleId}`,
          { method: 'DELETE', headers: AUDIT_REASON },
        );
        if (!res.ok && res.status !== 404) throw await discordError(res, 'Discord remove member role failed');
      });
    }
  }

  await regRef.update({
    'discord.provisioningStatus': 'none',
    'discord.roleId': null,
    'discord.textChannelId': null,
    'discord.voiceChannelId': null,
    'discord.warnings': warnings,
    'discord.errorMessage': null,
  }).catch(() => {});
  return { warnings };
}

// ── DM fonctionnels compétition ─────────────────────────────────────────────

/**
 * DM de décision d'inscription (validée / liste d'attente / refusée). DM
 * FONCTIONNEL : l'opt-out des annonces (`dmAnnouncementsOptOut`) ne s'applique
 * pas, comme pour les DM d'exercices. Ne throw jamais — 403 = DMs fermés,
 * cas normal.
 */
export async function sendCompetitionDM(
  discordUserId: string,
  input: { title: string; message: string; link?: string | null },
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const dmRes = await discordFetch('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!dmRes.ok) {
    const body = await dmRes.text().catch(() => '');
    return { ok: false, reason: `dm_open_${dmRes.status}: ${body.slice(0, 150)}` };
  }
  const dm = await dmRes.json();
  const channelId = dm.id as string;

  const description = input.message.slice(0, 3800)
    + (input.link ? `\n\n[Ouvrir sur Aedral →](${input.link})` : '');
  const embed = {
    color: 0xffb800,
    title: input.title.slice(0, 256),
    description,
    footer: { text: 'Aedral · compétitions' },
    timestamp: new Date().toISOString(),
  };

  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: [embed] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `post_${res.status}: ${body.slice(0, 150)}` };
  }
  const data = await res.json();
  return { ok: true, messageId: data.id as string };
}

/**
 * Message embed dans un SALON (ex. salon texte privé d'une équipe — spec §7-§8 :
 * pings de match, lancement des check-ins). Même format visuel que les DM de
 * compétition. Best-effort côté appelant — jamais bloquant pour l'action.
 */
/**
 * Pied de description d'un embed : le lien principal, puis les liens
 * secondaires sur la MÊME ligne. Une ligne par lien alourdirait un message
 * qu'on lit des dizaines de fois par tournoi.
 *
 * Fonction pure et exportée pour être testable : le reste de ce module parle à
 * Discord, celle-ci ne fait que composer du texte.
 */
export function buildEmbedDescription(
  message: string,
  link?: string | null,
  extraLinks?: Array<{ label: string; url: string }> | null,
): string {
  const body = message.slice(0, 3800);
  const parts: string[] = [];
  if (link) parts.push(`[Ouvrir sur Aedral →](${link})`);
  for (const l of extraLinks ?? []) {
    if (l?.url && l?.label) parts.push(`[${l.label}](${l.url})`);
  }
  // Sans lien principal, les liens secondaires n'ont rien à quoi se rattacher :
  // on les affiche quand même plutôt que de les perdre en silence.
  return parts.length > 0 ? `${body}\n\n${parts.join(' · ')}` : body;
}

export async function sendCompetitionChannelMessage(
  channelId: string,
  input: {
    title: string;
    message: string;
    link?: string | null;
    /** Liens secondaires, rendus à la suite du lien principal sur la même
     *  ligne (ex. l'affiche de résultat au format carré). */
    extraLinks?: Array<{ label: string; url: string }> | null;
    /** Rôle à mentionner. INDISPENSABLE pour réveiller les joueurs : une
     *  mention placée dans un embed n'envoie aucune notification — seul le
     *  `content` du message ping. Les messages de check-in passaient donc
     *  totalement inaperçus. */
    mentionRoleId?: string | null;
    /** Plusieurs rôles à la fois — le salon des résultats ne réveille que les
     *  DEUX équipes du match, pas tout le tournoi. */
    mentionRoleIds?: string[];
    /** Image jointe par URL (affiche de résultat) : Discord la charge lui-même. */
    imageUrl?: string | null;
  },
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const embed = {
    color: 0xffb800,
    title: input.title.slice(0, 256),
    description: buildEmbedDescription(input.message, input.link, input.extraLinks),
    footer: { text: 'Aedral · compétitions' },
    timestamp: new Date().toISOString(),
    ...(input.imageUrl ? { image: { url: input.imageUrl } } : {}),
  };
  // Rôles mentionnés : la liste explicite si elle est fournie, sinon le rôle
  // unique. Dédupliqués — Discord refuse un rôle répété dans allowed_mentions.
  const roles = [...new Set([
    ...(input.mentionRoleIds ?? []),
    ...(input.mentionRoleId ? [input.mentionRoleId] : []),
  ].filter(Boolean))];
  const res = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [embed],
      ...(roles.length > 0
        ? {
            content: roles.map(r => `<@&${r}>`).join(' '),
            allowed_mentions: { roles },
          }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, reason: `post_${res.status}: ${body.slice(0, 150)}` };
  }
  const data = await res.json();
  return { ok: true, messageId: data.id as string };
}
