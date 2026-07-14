// Rappel de disponibilités — couche PURE (aucun I/O Firestore/Discord).
// Le cron hebdo et le bouton manuel du staff consomment ces helpers ; la
// couche serveur (lecture user_availability + post bot) vit ailleurs.
//
// Règle métier (discussion produit 2026-07-13) : un joueur est « manquant »
// pour une semaine s'il n'a AUCUN créneau déclaré sur cette semaine (doc
// absent ou vide). Sur un outil de consensus, un vide honnête vaut mieux
// qu'une dispo fausse — donc on relance les vides, on ne présume rien.

import { getMondayYmd, getIsoWeekId, addDays } from '@/lib/availability';

export interface WeekTarget {
  mondayYmd: string;
  weekId: string;
  weekLabel: string;
}

/** Libellé « semaine du lundi 20 janvier » à partir du lundi (YYYY-MM-DD). */
export function formatWeekLabel(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long',
  });
  return `semaine du ${fmt.format(d)}`;
}

/** Cible = le prochain lundi (semaine QUI SUIT la relance — cron du dimanche). */
export function nextWeekTarget(todayYmd: string): WeekTarget {
  const mondayYmd = addDays(getMondayYmd(todayYmd), 7);
  return { mondayYmd, weekId: getIsoWeekId(mondayYmd), weekLabel: formatWeekLabel(mondayYmd) };
}

/** Cible = la semaine EN COURS (relance manuelle du staff, lundi/mardi). */
export function currentWeekTarget(todayYmd: string): WeekTarget {
  const mondayYmd = getMondayYmd(todayYmd);
  return { mondayYmd, weekId: getIsoWeekId(mondayYmd), weekLabel: formatWeekLabel(mondayYmd) };
}

/** Snowflake Discord depuis un uid Aedral (`discord_ID`) — null si non liable. */
export function toDiscordId(uid: string): string | null {
  if (!uid.startsWith('discord_')) return null;
  const id = uid.slice('discord_'.length);
  return /^\d{5,32}$/.test(id) ? id : null;
}

export interface RosterMember {
  uid: string;
  displayName: string;
}

/**
 * Joueurs du roster (titulaires + remplaçants) qui n'ont pas rempli leurs
 * dispos pour la semaine ciblée. `filledUids` = uids ayant au moins un créneau.
 * Dédupliqué, ordre du roster préservé.
 */
export function computeMissingPlayers(
  roster: RosterMember[],
  filledUids: Set<string>,
): RosterMember[] {
  const seen = new Set<string>();
  const missing: RosterMember[] = [];
  for (const m of roster) {
    if (!m.uid || seen.has(m.uid)) continue;
    seen.add(m.uid);
    if (!filledUids.has(m.uid)) missing.push(m);
  }
  return missing;
}

// Discord : cap les mentions pour rester sous la limite de content (2000 car.)
// et éviter un ping-storm — bien assez pour un roster (5+2 max aujourd'hui).
const MAX_MENTIONS = 40;

export interface ReminderMessage {
  /** Ligne de mentions qui déclenche le ping (à mettre dans `content`). */
  content: string;
  /** IDs Discord réellement pingés (pour `allowed_mentions.users`). */
  pingUserIds: string[];
  embedTitle: string;
  embedDescription: string;
}

/**
 * Construit le message de relance. Les joueurs sans compte Discord liable sont
 * quand même nommés dans l'embed (transparence pour le staff) mais pas pingés.
 */
export function buildReminderMessage(input: {
  teamName: string;
  weekLabel: string;          // ex. « semaine du lundi 20 janvier »
  missing: RosterMember[];
  link: string;
}): ReminderMessage {
  const { teamName, weekLabel, missing, link } = input;
  const pingUserIds: string[] = [];
  for (const m of missing) {
    const did = toDiscordId(m.uid);
    if (did && pingUserIds.length < MAX_MENTIONS) pingUserIds.push(did);
  }

  const mentions = pingUserIds.map(id => `<@${id}>`).join(' ');
  const n = missing.length;
  const noun = n > 1 ? 'joueurs' : 'joueur';
  const verb = n > 1 ? 'ont' : 'a';

  const content = mentions
    ? `📅 Dispos ${weekLabel} — pensez à les remplir ! ${mentions}`
    : `📅 Dispos ${weekLabel} — ${n} ${noun} ${verb} oublié de les remplir.`;

  const names = missing.map(m => `• ${m.displayName}`).join('\n');
  const embedTitle = `${teamName} — dispos à compléter`;
  const embedDescription =
    `${n} ${noun} n'${n > 1 ? 'ont' : 'a'} pas encore indiqué ${n > 1 ? 'leurs' : 'ses'} disponibilités pour la ${weekLabel} :\n`
    + `${names}\n\n`
    + `Ça prend 30 secondes → [Remplir mes dispos](${link})`;

  return { content: content.slice(0, 2000), pingUserIds, embedTitle, embedDescription };
}
