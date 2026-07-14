// Rappel de disponibilités — couche SERVEUR (lecture user_availability + post
// bot). Partagée par le cron hebdo (toutes les équipes) et le bouton manuel du
// staff (une équipe). La logique pure (manquants + message) vit dans
// lib/availability-reminder ; ici on fait les I/O.

import type { Firestore } from 'firebase-admin/firestore';
import {
  computeMissingPlayers,
  buildReminderMessage,
  nextWeekTarget,
  type RosterMember,
} from '@/lib/availability-reminder';
import { postAvailabilityReminder } from '@/lib/discord-bot';
import { parisYmd } from '@/lib/availability';
import { getStructurePlan, getLimit } from '@/lib/plan-limits';
import { captureApiError } from '@/lib/sentry';

export interface ReminderTeam {
  id: string;
  structureId: string;
  name: string;
  game: string;
  logoUrl: string | null;
  discordChannelId: string | null;
  playerIds: string[];
  subIds: string[];
}

export type TeamReminderResult =
  | { posted: true; missingCount: number }
  | { posted: false; reason: 'no_channel' | 'empty_roster' | 'all_filled' | 'post_failed' };

/**
 * Relance UNE équipe pour une semaine donnée. Ne vérifie ni permission ni gate
 * (au caller) : lit les dispos du roster, calcule les manquants, poste dans le
 * salon si ≥ 1 manquant. Silencieux si tout est rempli (zéro bruit inutile).
 */
export async function remindTeamAvailability(
  db: Firestore,
  team: ReminderTeam,
  target: { weekId: string; weekLabel: string; origin: string },
): Promise<TeamReminderResult> {
  if (!team.discordChannelId) return { posted: false, reason: 'no_channel' };

  const rosterUids = Array.from(new Set([...(team.playerIds ?? []), ...(team.subIds ?? [])].filter(Boolean)));
  if (rosterUids.length === 0) return { posted: false, reason: 'empty_roster' };

  // Dispos + profils du roster, en deux getAll bornés (roster ≤ 7 aujourd'hui).
  const availRefs = rosterUids.map(uid => db.collection('user_availability').doc(`${uid}_${target.weekId}`));
  const userRefs = rosterUids.map(uid => db.collection('users').doc(uid));
  const [availSnaps, userSnaps] = await Promise.all([db.getAll(...availRefs), db.getAll(...userRefs)]);

  const filledUids = new Set<string>();
  availSnaps.forEach((snap, i) => {
    const slots = snap.data()?.slots;
    if (Array.isArray(slots) && slots.length > 0) filledUids.add(rosterUids[i]);
  });

  const nameByUid = new Map<string, string>();
  userSnaps.forEach((snap, i) => {
    const d = snap.data();
    nameByUid.set(rosterUids[i], (d?.displayName as string) || (d?.discordUsername as string) || 'Joueur');
  });

  const roster: RosterMember[] = rosterUids.map(uid => ({ uid, displayName: nameByUid.get(uid) ?? 'Joueur' }));
  const missing = computeMissingPlayers(roster, filledUids);
  if (missing.length === 0) return { posted: false, reason: 'all_filled' };

  const link = `${target.origin}/calendar`;
  const msg = buildReminderMessage({ teamName: team.name, weekLabel: target.weekLabel, missing, link });

  try {
    await postAvailabilityReminder(team.discordChannelId, {
      content: msg.content,
      pingUserIds: msg.pingUserIds,
      embedTitle: msg.embedTitle,
      embedDescription: msg.embedDescription,
      siteUrl: link,
      thumbnailUrl: team.logoUrl,
    });
    return { posted: true, missingCount: missing.length };
  } catch (err) {
    captureApiError(`availability reminder post failed (team=${team.id})`, err);
    return { posted: false, reason: 'post_failed' };
  }
}

/**
 * Passe HEBDO (greffée sur le cron quotidien, déclenchée le dimanche) : relance
 * toutes les équipes actives avec un salon Discord, pour la SEMAINE QUI SUIT.
 * Respecte l'opt-out par structure et le drapeau de plan (gate-ready, gratuit
 * au lancement). Best-effort : une équipe qui échoue n'arrête pas les autres.
 */
export async function runWeeklyAvailabilityReminders(
  db: Firestore,
  opts: { origin: string; todayYmd?: string },
): Promise<{ teamsScanned: number; posted: number; skipped: number }> {
  const todayYmd = opts.todayYmd ?? parisYmd(new Date());
  const target = nextWeekTarget(todayYmd);

  // Scan borné des équipes (comme le cron todos). Filtre en mémoire : actives
  // (status legacy absent = active) AVEC un salon configuré.
  const snap = await db.collection('sub_teams').limit(2000).get();
  const candidates: ReminderTeam[] = [];
  // Verrou d'idempotence par semaine cible : si le cron re-tourne le même
  // dimanche (retry Vercel), on ne re-pingue pas une équipe déjà relancée pour
  // cette semaine (sinon double ping-storm dans le salon).
  const alreadySent = new Set<string>();
  for (const doc of snap.docs) {
    const d = doc.data();
    if ((d.status as string) === 'archived') continue;
    if (typeof d.discordChannelId !== 'string' || !d.discordChannelId) continue;
    if ((d.lastAutoReminderWeekId as string | undefined) === target.weekId) { alreadySent.add(doc.id); continue; }
    candidates.push({
      id: doc.id,
      structureId: (d.structureId as string) ?? '',
      name: (d.name as string) ?? 'Équipe',
      game: (d.game as string) ?? '',
      logoUrl: (d.logoUrl as string) ?? null,
      discordChannelId: d.discordChannelId as string,
      playerIds: Array.isArray(d.playerIds) ? (d.playerIds as string[]) : [],
      subIds: Array.isArray(d.subIds) ? (d.subIds as string[]) : [],
    });
  }

  // Gate + opt-out résolus une fois par structure (cache).
  const structCache = new Map<string, { allowed: boolean }>();
  const resolveStructure = async (structureId: string): Promise<boolean> => {
    if (!structureId) return false;
    const cached = structCache.get(structureId);
    if (cached) return cached.allowed;
    let allowed = false;
    try {
      const s = await db.collection('structures').doc(structureId).get();
      const data = s.data();
      const optedOut = data?.availabilityRemindersDisabled === true;
      const gated = getLimit(getStructurePlan(data), 'autoAvailabilityReminder') === true;
      // Cohérence avec le reste du calendrier (review) : une structure suspendue
      // ou en suppression ne reçoit plus de rappels.
      const badStatus = ['suspended', 'deletion_scheduled', 'pending_validation']
        .includes((data?.status as string) ?? '');
      allowed = !!data && !optedOut && gated && !badStatus;
    } catch { allowed = false; }
    structCache.set(structureId, { allowed });
    return allowed;
  };

  let posted = 0;
  let skipped = 0;
  for (const team of candidates) {
    if (!(await resolveStructure(team.structureId))) { skipped++; continue; }
    const res = await remindTeamAvailability(db, team, {
      weekId: target.weekId, weekLabel: target.weekLabel, origin: opts.origin,
    });
    if (res.posted) {
      posted++;
      // Marque la semaine comme relancée (verrou anti-double-ping). Best-effort,
      // mais on LOGUE l'échec : sans le verrou, un retry du cron re-pinguerait —
      // la brèche doit être visible (review), pas muette.
      try {
        await db.collection('sub_teams').doc(team.id).update({ lastAutoReminderWeekId: target.weekId });
      } catch (err) {
        captureApiError(`availability reminder lock update failed (team=${team.id})`, err);
      }
    } else {
      skipped++;
    }
  }
  return { teamsScanned: candidates.length, posted, skipped: skipped + alreadySent.size };
}
