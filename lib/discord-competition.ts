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

import type { Firestore } from 'firebase-admin/firestore';

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
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  READ_MESSAGE_HISTORY: 1 << 16,
  CONNECT: 1 << 20,
  SPEAK: 1 << 21,
} as const;

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
  opts: { name: string; type: 0 | 2; categoryId: string | null; teamRoleId: string },
): Promise<string> {
  const allow = opts.type === 0
    ? PERM.VIEW_CHANNEL + PERM.SEND_MESSAGES + PERM.READ_MESSAGE_HISTORY
    : PERM.VIEW_CHANNEL + PERM.CONNECT + PERM.SPEAK;
  const res = await discordFetch(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: AUDIT_REASON,
    body: JSON.stringify({
      name: opts.name.slice(0, 100),
      type: opts.type,
      parent_id: opts.categoryId ?? undefined,
      permission_overwrites: [
        { id: guildId, type: 0, deny: String(PERM.VIEW_CHANNEL), allow: '0' },
        { id: opts.teamRoleId, type: 0, allow: String(allow), deny: '0' },
      ],
    }),
  });
  if (!res.ok) throw await discordError(res, 'Discord create channel failed');
  const data = await res.json();
  return data.id as string;
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

// ── Orchestration idempotente ───────────────────────────────────────────────

export interface CompetitionDiscordShared {
  guildId: string;
  participantRoleId: string;
  categoryId: string;
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
    categoryLabel: string;          // nom de la compétition
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
      participantRoleId = await createGuildRole(input.guildId, input.participantRoleLabel, { color: 0xffb800 });
      await circuitRef.update({
        discord: { guildId: input.guildId, participantRoleId },
      });
    }
    await compRef.update({ 'discord.participantRoleId': participantRoleId });
  } else if (!participantRoleId) {
    participantRoleId = await createGuildRole(input.guildId, input.participantRoleLabel, { color: 0xffb800 });
    await compRef.update({ 'discord.participantRoleId': participantRoleId });
  }

  let categoryId = input.categoryId;
  if (!categoryId) {
    categoryId = await createCategory(input.guildId, input.categoryLabel);
    await compRef.update({ 'discord.categoryId': categoryId });
  }

  return { guildId: input.guildId, participantRoleId, categoryId };
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
  opts: { deadlineAtMs?: number } = {},
): Promise<ProvisionResult> {
  const regRef = db.collection('competition_registrations').doc(input.registrationId);
  const warnings: string[] = [];
  const pastDeadline = () => opts.deadlineAtMs !== undefined && Date.now() > opts.deadlineAtMs;

  const bailPartial = async (): Promise<ProvisionResult> => {
    warnings.push('Interrompu par la limite de temps — relance le provisioning pour continuer');
    await regRef.update({ 'discord.provisioningStatus': 'partial', 'discord.warnings': warnings });
    return { status: 'partial', warnings };
  };

  let roleId = input.discord.roleId;
  if (!roleId) {
    if (pastDeadline()) return bailPartial();
    roleId = await createGuildRole(shared.guildId, input.teamName);
    await regRef.update({ 'discord.roleId': roleId });
  }

  let textChannelId = input.discord.textChannelId;
  if (!textChannelId) {
    if (pastDeadline()) return bailPartial();
    textChannelId = await createTeamChannel(shared.guildId, {
      name: textChannelName(input.teamName),
      type: 0,
      categoryId: shared.categoryId,
      teamRoleId: roleId,
    });
    await regRef.update({ 'discord.textChannelId': textChannelId });
  }

  let voiceChannelId = input.discord.voiceChannelId;
  if (!voiceChannelId) {
    if (pastDeadline()) return bailPartial();
    voiceChannelId = await createTeamChannel(shared.guildId, {
      name: input.teamName,
      type: 2,
      categoryId: shared.categoryId,
      teamRoleId: roleId,
    });
    await regRef.update({ 'discord.voiceChannelId': voiceChannelId });
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
  return { status, warnings };
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
 * Déprovisionne UNE équipe (reject/unapprove d'une inscription déjà
 * provisionnée) : supprime les salons privés et le rôle d'équipe, best-effort
 * — une équipe refusée ne doit pas garder l'accès à son salon ni le rôle
 * participant. Les 404 (déjà supprimé à la main) sont ignorés. Retourne les
 * échecs restants pour affichage console ; ne throw jamais.
 */
export async function deprovisionRegistration(
  db: Firestore,
  guildId: string,
  input: {
    registrationId: string;
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
    for (const member of input.roster) {
      if (!member.discordId) continue;
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
