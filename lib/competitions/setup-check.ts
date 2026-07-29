// Contrôle du dispositif Discord d'une compétition — « est-ce que tout est prêt ? »
//
// Répond AVANT le jour J aux questions qu'on se pose à 14h35 quand une équipe
// ne trouve pas où check-in : le bot est-il là, a-t-il les droits, les salons
// existent-ils, toutes les équipes validées sont-elles provisionnées, et qui,
// parmi les joueurs inscrits, n'est pas sur le serveur (ceux-là ne recevront
// RIEN de ce que le bot raconte).
//
// Aucune écriture : ce module ne fait que constater.

import type { Firestore } from 'firebase-admin/firestore';
import {
  describeGuildAccess, discordFetch, guildIdOfChannel, isGuildMember, roleIdsOfGuild,
} from '@/lib/discord-competition';

export interface SetupIssue {
  /** Ce qui ne va pas, en langage d'organisateur. */
  label: string;
  /** `blocker` : le jour J ne peut pas se dérouler normalement. */
  level: 'blocker' | 'warning';
}

export interface SetupCheckReport {
  guildName: string | null;
  issues: SetupIssue[];
  teams: { total: number; provisioned: number; missing: string[] };
  players: {
    /** Joueurs dont l'absence du serveur est CONFIRMÉE. */
    absent: Array<{ team: string; name: string }>;
    checked: number;
    /** Tous les joueurs n'ont pas pu être vérifiés (temps ou quota). */
    partial: boolean;
  };
  pendingRegistrations: number;
}

/** Cap de vérifications joueur par joueur : sans l'intent « Server Members »,
 *  chaque joueur coûte un appel. 200 couvre 32 équipes de 5 + marge. */
const MAX_PLAYER_CHECKS = 200;
const PLAYER_CHECK_DEADLINE_MS = 20_000;

/**
 * Membres du serveur en UN appel — disponible seulement si l'intent privilégié
 * « Server Members » est activé sur l'application. Sans lui, Discord répond 403
 * et on retombe sur une vérification joueur par joueur.
 */
async function guildMemberIds(guildId: string): Promise<Set<string> | null> {
  const res = await discordFetch(`/guilds/${guildId}/members?limit=1000`);
  if (!res.ok) return null;
  const members = await res.json() as Array<{ user?: { id?: string } }>;
  return new Set(members.map(m => m.user?.id).filter((id): id is string => !!id));
}

export async function checkCompetitionSetup(
  db: Firestore,
  competitionId: string,
  adminDiscordUserId: string,
): Promise<SetupCheckReport> {
  const report: SetupCheckReport = {
    guildName: null,
    issues: [],
    teams: { total: 0, provisioned: 0, missing: [] },
    players: { absent: [], checked: 0, partial: false },
    pendingRegistrations: 0,
  };
  const fail = (label: string) => report.issues.push({ label, level: 'blocker' });
  const warn = (label: string) => report.issues.push({ label, level: 'warning' });

  const compSnap = await db.collection('competitions').doc(competitionId).get();
  const comp = compSnap.data();
  if (!comp) {
    fail('Compétition introuvable.');
    return report;
  }
  const discord = (comp.discord ?? {}) as {
    guildId?: string;
    participantRoleId?: string | null;
    options?: { announceChannelId?: string | null; staffChannelId?: string | null; staffRoleIds?: string[] };
  };
  if (!discord.guildId) {
    fail('Aucun serveur Discord configuré : le bot ne peut rien annoncer.');
    return report;
  }
  const guildId = discord.guildId;

  // 1. Le serveur, le bot, les droits.
  const access = await describeGuildAccess(guildId, adminDiscordUserId);
  report.guildName = access.guildName;
  if (!access.botPresent) {
    fail("Le bot Aedral n'est pas sur le serveur — invite-le, rien ne partira sans lui.");
    return report;
  }
  for (const p of access.problems) fail(p);

  // 2. Les salons désignés existent-ils encore, et sur le BON serveur ?
  const opts = discord.options ?? {};
  for (const [label, channelId] of [
    ["Le salon d'annonces", opts.announceChannelId],
    ['Le salon du staff', opts.staffChannelId],
  ] as const) {
    if (!channelId) {
      warn(`${label} n'est pas configuré.`);
      continue;
    }
    const owner = await guildIdOfChannel(channelId);
    if (owner === null) fail(`${label} n'existe plus (supprimé sur Discord ?).`);
    else if (owner !== guildId) fail(`${label} appartient à un autre serveur.`);
  }

  // 3. Le rôle participant est-il toujours là ? (supprimé à la main = les
  //    joueurs perdent l'accès aux salons communs)
  const roleIds = await roleIdsOfGuild(guildId);
  if (roleIds === null) {
    warn('Les rôles du serveur sont illisibles pour le moment.');
  } else {
    if (discord.participantRoleId && !roleIds.has(discord.participantRoleId)) {
      fail('Le rôle participant a été supprimé sur Discord — relance le provisioning.');
    }
    const unknownStaff = (opts.staffRoleIds ?? []).filter(id => !roleIds.has(id));
    if (unknownStaff.length > 0) warn("Un rôle staff configuré n'existe plus sur le serveur.");
  }

  // 4. Les équipes validées sont-elles toutes provisionnées ?
  const regsSnap = await db.collection('competition_registrations')
    .where('competitionId', '==', competitionId)
    .get();
  const approved = regsSnap.docs.filter(d => d.data().status === 'approved');
  report.pendingRegistrations = regsSnap.docs.filter(d => d.data().status === 'pending').length;
  report.teams.total = approved.length;
  for (const d of approved) {
    const status = d.data().discord?.provisioningStatus ?? 'none';
    // `partial` = salons CRÉÉS, mais un joueur manquait à l'appel (il est
    // signalé plus bas). L'équipe a bien son salon : la compter comme « sans
    // salon » ferait crier au blocage pour un simple joueur absent.
    if (status === 'done' || status === 'partial') report.teams.provisioned += 1;
    else report.teams.missing.push((d.data().name as string) ?? d.id);
  }
  if (report.teams.missing.length > 0) {
    fail(`${report.teams.missing.length} équipe(s) validée(s) sans salon Discord : ${report.teams.missing.slice(0, 5).join(', ')}${report.teams.missing.length > 5 ? '…' : ''}`);
  }
  if (report.pendingRegistrations > 0) {
    warn(`${report.pendingRegistrations} inscription(s) encore sans décision.`);
  }

  // 5. Qui, parmi les joueurs inscrits, n'est PAS sur le serveur ? Ceux-là ne
  //    recevront rien : ni check-in, ni room, ni décision d'arbitrage.
  const roster: Array<{ team: string; name: string; discordId: string }> = [];
  for (const d of approved) {
    const team = (d.data().name as string) ?? d.id;
    for (const m of (d.data().roster ?? []) as Array<{ discordId?: string; displayName?: string }>) {
      if (m.discordId) roster.push({ team, name: m.displayName || m.discordId, discordId: m.discordId });
    }
  }
  const known = await guildMemberIds(guildId);
  if (known) {
    // Intent « Server Members » actif : tout est vérifié en un appel.
    for (const p of roster) if (!known.has(p.discordId)) report.players.absent.push({ team: p.team, name: p.name });
    report.players.checked = roster.length;
  } else {
    const deadline = Date.now() + PLAYER_CHECK_DEADLINE_MS;
    for (const p of roster.slice(0, MAX_PLAYER_CHECKS)) {
      if (Date.now() > deadline) { report.players.partial = true; break; }
      const member = await isGuildMember(guildId, p.discordId);
      if (member === null) continue;          // indéterminé : ne jamais conclure
      report.players.checked += 1;
      if (!member) report.players.absent.push({ team: p.team, name: p.name });
    }
    if (roster.length > MAX_PLAYER_CHECKS) report.players.partial = true;
  }
  if (report.players.absent.length > 0) {
    warn(`${report.players.absent.length} joueur(s) inscrit(s) ne sont pas sur le serveur Discord — ils ne recevront aucun message.`);
  }

  return report;
}
