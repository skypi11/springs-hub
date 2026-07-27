// La VOIX du bot pendant un tournoi — le seul chemin d'envoi.
//
// Avant, chaque route parlait à Discord dans son coin : six endroits, six
// façons de résoudre un salon, et la mention (seule chose qui NOTIFIE
// réellement) oubliée une fois sur deux. Ici : une résolution des salons, une
// règle de mention, une deadline, et un accusé de livraison — sans lequel une
// équipe qui dit « on n'a rien reçu » est indiscernable d'une équipe qui n'a
// pas regardé.
//
// Best-effort par construction : ne throw JAMAIS. Un message perdu ne doit
// jamais faire échouer l'action de tournoi qui l'a déclenché.

import type { Firestore } from 'firebase-admin/firestore';
import { sendCompetitionChannelMessage } from '@/lib/discord-competition';
import type { BroadcastText } from '@/lib/competitions/broadcast-messages';

export type BroadcastTarget =
  /** Salon privé d'une équipe — mentionne son rôle (sinon personne n'est notifié). */
  | { kind: 'team'; registrationId: string }
  /** Salon public du tournoi — JAMAIS de mention : il informe le serveur, il n'a
   *  pas à réveiller deux cents personnes. */
  | { kind: 'announce' }
  /** Salon privé du staff — mentionne le premier rôle staff déclaré. */
  | { kind: 'staff' };

export interface BroadcastItem {
  target: BroadcastTarget;
  text: BroadcastText;
  link?: string | null;
  /** Poster sans notifier (information d'ambiance, pas d'action attendue). */
  silent?: boolean;
  /** Nom lisible pour l'accusé de livraison (défaut : dérivé de la cible). */
  label?: string;
}

export interface DeliveryReport {
  sent: number;
  /** Envois refusés par Discord (salon supprimé, bot sans droit d'écriture…). */
  failures: Array<{ label: string; reason: string }>;
  /** Destinataires sans salon configuré — ils n'ont RIEN reçu, ce n'est pas une
   *  panne mais ça doit se voir. */
  unreachable: Array<{ label: string; reason: string }>;
  /** La deadline a coupé avant la fin : des envois peuvent encore aboutir. */
  timedOut: boolean;
}

const DEFAULT_DEADLINE_MS = 8_000;

const emptyReport = (): DeliveryReport => ({ sent: 0, failures: [], unreachable: [], timedOut: false });

/** Rapport en une phrase, pour un toast ou le salon staff. */
export function summarizeDelivery(report: DeliveryReport): string {
  const parts = [`${report.sent} message${report.sent > 1 ? 's' : ''} envoyé${report.sent > 1 ? 's' : ''}`];
  if (report.failures.length > 0) {
    parts.push(`${report.failures.length} échec${report.failures.length > 1 ? 's' : ''} : ${report.failures.map(f => f.label).join(', ')}`);
  }
  if (report.unreachable.length > 0) {
    parts.push(`${report.unreachable.length} sans salon Discord : ${report.unreachable.map(f => f.label).join(', ')}`);
  }
  if (report.timedOut) parts.push('envoi encore en cours');
  return parts.join(' · ');
}

interface ResolvedChannel {
  channelId: string;
  mentionRoleId: string | null;
}

/**
 * Envoie un lot de messages et rend compte de ce qui est réellement parti.
 *
 * `competition` peut être fourni si l'appelant l'a déjà lu (cas courant dans les
 * routes) — sinon il est chargé ici.
 */
export async function broadcast(
  db: Firestore,
  competitionId: string,
  items: BroadcastItem[],
  opts: {
    deadlineMs?: number;
    competition?: Record<string, unknown> | null;
  } = {},
): Promise<DeliveryReport> {
  const report = emptyReport();
  if (items.length === 0) return report;

  try {
    const comp = opts.competition
      ?? (await db.collection('competitions').doc(competitionId).get()).data()
      ?? null;
    if (!comp) return report;

    // Bac à sable : une compétition de démonstration ne doit jamais écrire sur
    // le Discord de personne (même garde que l'annonce de publication du bracket).
    if (comp.isDev === true) return report;

    const discord = (comp.discord ?? {}) as {
      guildId?: string;
      options?: { announceChannelId?: string | null; staffChannelId?: string | null; staffRoleIds?: string[] };
    };
    if (!discord.guildId) {
      for (const item of items) {
        report.unreachable.push({ label: labelOf(item), reason: 'aucun serveur Discord configuré' });
      }
      return report;
    }
    const staffRoleId = discord.options?.staffRoleIds?.[0] ?? null;

    // Salons d'équipe : une seule lecture pour tout le lot (32 équipes = 1 aller-retour).
    const registrationIds = [...new Set(
      items.filter(i => i.target.kind === 'team').map(i => (i.target as { registrationId: string }).registrationId),
    )];
    const teamChannels = new Map<string, ResolvedChannel | null>();
    const teamNames = new Map<string, string>();
    if (registrationIds.length > 0) {
      const snaps = await db.getAll(
        ...registrationIds.map(rid => db.collection('competition_registrations').doc(rid)),
      );
      for (const snap of snaps) {
        const d = snap.data();
        teamNames.set(snap.id, (d?.name as string) ?? snap.id);
        const channelId = d?.discord?.textChannelId as string | undefined;
        teamChannels.set(snap.id, channelId
          ? { channelId, mentionRoleId: (d?.discord?.roleId as string | undefined) ?? null }
          : null);
      }
    }

    const sends: Array<Promise<void>> = [];
    for (const item of items) {
      const label = labelOf(item, teamNames);
      let resolved: ResolvedChannel | null = null;

      if (item.target.kind === 'team') {
        resolved = teamChannels.get(item.target.registrationId) ?? null;
        if (!resolved) {
          report.unreachable.push({ label, reason: 'pas de salon d\'équipe' });
          continue;
        }
      } else if (item.target.kind === 'announce') {
        const channelId = discord.options?.announceChannelId;
        if (!channelId) {
          report.unreachable.push({ label, reason: 'aucun salon d\'annonces' });
          continue;
        }
        resolved = { channelId, mentionRoleId: null };   // jamais de ping public
      } else {
        const channelId = discord.options?.staffChannelId;
        if (!channelId) {
          report.unreachable.push({ label, reason: 'aucun salon staff' });
          continue;
        }
        resolved = { channelId, mentionRoleId: staffRoleId };
      }

      const mentionRoleId = item.silent ? null : resolved.mentionRoleId;
      sends.push(
        sendCompetitionChannelMessage(resolved.channelId, {
          title: item.text.title,
          message: item.text.message,
          link: item.link ?? null,
          mentionRoleId,
        }).then(res => {
          if (res.ok) report.sent += 1;
          else report.failures.push({ label, reason: res.reason });
        }).catch(err => {
          report.failures.push({ label, reason: err instanceof Error ? err.message.slice(0, 120) : 'erreur' });
        }),
      );
    }

    // Deadline : le tournoi ne s'arrête pas parce que Discord rate-limite. Les
    // envois non terminés peuvent aboutir après coup — d'où `timedOut`, plutôt
    // que de les compter en échec.
    let finished = false;
    await Promise.race([
      Promise.allSettled(sends).then(() => { finished = true; }),
      new Promise(resolve => setTimeout(resolve, opts.deadlineMs ?? DEFAULT_DEADLINE_MS)),
    ]);
    report.timedOut = !finished;
  } catch {
    // Aucune remontée d'erreur : l'action de tournoi prime toujours sur son
    // accusé de réception.
  }
  return report;
}

function labelOf(item: BroadcastItem, teamNames?: Map<string, string>): string {
  if (item.label) return item.label;
  if (item.target.kind === 'team') {
    return teamNames?.get(item.target.registrationId) ?? item.target.registrationId;
  }
  return item.target.kind === 'announce' ? 'annonces' : 'staff';
}
