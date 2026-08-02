// Rappels de la veille d'un tournoi — greffés sur le cron quotidien existant
// (todos-reminders). Trois envois, une seule détection « ça se joue demain » :
//
//   1. aux équipes engagées : le tournoi est demain, avec l'heure et la règle
//      du check-in (personne ne relit une fiche trois jours après s'être inscrit) ;
//   2. à la liste d'attente, en message privé : « tiens-toi prête » — elles
//      n'ont pas de salon Discord, et une réserve qu'on n'a pas prévenue n'est
//      pas une réserve ;
//   3. au salon staff : le bilan du contrôle du dispositif, pour que les salons
//      manquants se découvrent la veille et non à 14h35.
//
// IDEMPOTENT PAR CONSTRUCTION : le cron est déclenché par Vercel ET par le
// filet GitHub Actions, donc DEUX fois par jour. Un verrou par date, posé en
// transaction, garantit un seul envoi.

import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { broadcast, type BroadcastItem } from '@/lib/competitions/tournament-broadcast';
import { sendCompetitionDM } from '@/lib/discord-competition';
import { checkCompetitionSetup } from '@/lib/competitions/setup-check';
import { discordIdOfUid } from '@/lib/competitions/discord-guard';
import {
  tournamentTomorrowText, waitlistStandbyText, setupCheckStaffText,
} from '@/lib/competitions/broadcast-messages';

export interface DailyReminderReport {
  competitionId: string;
  teamsNotified: number;
  waitlistNotified: number;
  staffBriefed: boolean;
}

/** Date du jour au format `YYYY-MM-DD`, fuseau de Paris (celui des tournois). */
function parisDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * Envoie les rappels pour toutes les compétitions dont le premier jour de jeu
 * est DEMAIN. Ne throw jamais : un tournoi en panne ne doit pas empêcher les
 * autres d'être prévenus.
 */
export async function sendCompetitionDayReminders(db: Firestore): Promise<DailyReminderReport[]> {
  const tomorrow = parisDate(1);
  const reports: DailyReminderReport[] = [];

  // Les compétitions qui vont se jouer : ni brouillon, ni terminées. Le premier
  // jour est dans `schedule.days[0].date` — filtré en mémoire (peu de docs, et
  // pas d'index à déclarer pour un champ imbriqué de tableau).
  const snap = await db.collection('competitions')
    .where('status', 'in', ['registration', 'validation', 'seeding', 'live'])
    .get();

  for (const doc of snap.docs) {
    const comp = doc.data();
    if (comp.isDev === true) continue;                     // bac à sable : jamais
    const days = (comp.schedule?.days as Array<{ date?: string; startsAt?: string }> | undefined) ?? [];
    const first = days[0];
    if (!first?.date || first.date !== tomorrow) continue;

    try {
      // Verrou par date : le cron passe deux fois (Vercel + filet GitHub).
      const claimed = await db.runTransaction(async tx => {
        const fresh = await tx.get(doc.ref);
        if (fresh.data()?.dayReminderSentFor === tomorrow) return false;
        tx.update(doc.ref, { dayReminderSentFor: tomorrow });
        return true;
      });
      if (!claimed) continue;

      reports.push(await remindOne(db, doc.id, comp, first.startsAt ?? null));
    } catch (err) {
      captureApiError(`Rappel de la veille impossible pour ${doc.id}`, err);
    }
  }
  return reports;
}

async function remindOne(
  db: Firestore,
  competitionId: string,
  comp: FirebaseFirestore.DocumentData,
  startsAt: string | null,
): Promise<DailyReminderReport> {
  const competitionName = (comp.name as string) ?? competitionId;
  const report: DailyReminderReport = {
    competitionId, teamsNotified: 0, waitlistNotified: 0, staffBriefed: false,
  };

  const regs = await db.collection('competition_registrations')
    .where('competitionId', '==', competitionId).get();
  const approved = regs.docs.filter(d => d.data().status === 'approved');
  const waitlisted = regs.docs.filter(d => d.data().status === 'waitlisted');

  // 1. Les équipes engagées, dans leur salon.
  if (approved.length > 0) {
    const text = tournamentTomorrowText({
      competitionName, startsAt,
      checkinMinutes: (comp.schedule?.generalCheckinMinutes as number) ?? 20,
    });
    const items: BroadcastItem[] = approved.map(d => ({
      target: { kind: 'team' as const, registrationId: d.id },
      text, link: `https://aedral.com/competitions/${competitionId}`,
    }));
    const delivery = await broadcast(db, competitionId, items, { competition: comp, deadlineMs: 20_000 });
    report.teamsNotified = delivery.sent;
  }

  // 2. La liste d'attente, en message privé : elle n'a pas de salon.
  if (waitlisted.length > 0) {
    const text = waitlistStandbyText({ competitionName, startsAt });
    for (const d of waitlisted) {
      const captainUid = d.data().captainUid as string | undefined;
      const discordId = captainUid ? discordIdOfUid(captainUid) : null;
      if (!discordId) continue;
      const res = await sendCompetitionDM(discordId, {
        title: text.title, message: text.message,
        link: `https://aedral.com/competitions/${competitionId}`,
      });
      if (res.ok) report.waitlistNotified += 1;
    }
  }

  // 3. Le bilan du dispositif, au salon staff. L'organisateur découvre la
  //    veille qu'il manque trois salons, pas le jour même.
  try {
    const ownerUid = (comp.createdByDiscordId as string | undefined)
      ?? discordIdOfUid((comp.discord?.checkedByUid as string) ?? '')
      ?? null;
    // Le contrôle a besoin d'une identité Discord pour juger des droits : à
    // défaut, on prend celle du bot lui-même via un identifiant vide, ce qui
    // limite le rapport aux constats objectifs (salons, équipes, joueurs).
    const setup = await checkCompetitionSetup(db, competitionId, ownerUid ?? '0');
    const blockers = setup.issues.filter(i => i.level === 'blocker').map(i => i.label);
    const warnings = setup.issues.filter(i => i.level === 'warning').map(i => i.label);
    const delivery = await broadcast(db, competitionId, [{
      target: { kind: 'staff' },
      text: setupCheckStaffText({
        competitionName, blockers, warnings,
        teamsProvisioned: setup.teams.provisioned, teamsTotal: setup.teams.total,
      }),
      link: `https://aedral.com/admin/competitions/${competitionId}/console`,
    }], { competition: comp, deadlineMs: 10_000 });
    report.staffBriefed = delivery.sent > 0;
  } catch (err) {
    captureApiError(`Contrôle de la veille impossible pour ${competitionId}`, err);
  }

  return report;
}

/** Exposé pour les tests : la date de demain, fuseau de Paris. */
export const _tomorrowParis = () => parisDate(1);
export const _todayParis = () => parisDate(0);
export const _timestampNow = () => Timestamp.now();
