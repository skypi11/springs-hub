// Notification d'une sanction de compétition (warn / exclusion / ban) au staff
// et aux dirigeants concernés — calqué sur notifyDecision (route registrations).
// Canal GARANTI = notif in-app ; canal best-effort = DM Discord FONCTIONNEL
// (sendCompetitionDM bypasse l'opt-out d'annonces : une sanction n'est pas une
// annonce). Les deux sont best-effort et n'échouent JAMAIS l'écriture de la
// sanction (try/catch isolés côté appelant).

import type { Firestore } from 'firebase-admin/firestore';
import { createNotifications } from '@/lib/notifications';
import { sendCompetitionDM } from '@/lib/discord-competition';
import type { SanctionType, SanctionTargetType } from '@/types/competitions';

const KIND_LABEL: Record<SanctionType, string> = {
  warn: 'Avertissement',
  exclusion: 'Exclusion',
  ban: 'Ban compétition',
};

export async function notifyCompetitionSanction(
  db: Firestore,
  args: {
    sanctionId: string;
    type: SanctionType;
    targetType: SanctionTargetType;
    targetId: string;
    targetLabel: string;
    reason: string;
    competitionId: string | null;
    competitionName: string;
    /** Contexte d'émission (inscription) pour joindre staff + dirigeants. */
    structureId?: string | null;
    teamId?: string | null;
  },
): Promise<void> {
  const { sanctionId, type, targetType, targetId, targetLabel, reason, competitionId, competitionName } = args;

  // ── Résolution des destinataires ──
  const recipients = new Set<string>();

  // Structure concernée : cible directe, ou déduite de l'équipe/contexte.
  let structureId = args.structureId ?? null;
  if (targetType === 'structure') structureId = targetId;
  let teamId = args.teamId ?? null;
  if (targetType === 'team') teamId = targetId;

  if (teamId) {
    const teamSnap = await db.collection('sub_teams').doc(teamId).get();
    if (teamSnap.exists) {
      const t = teamSnap.data()!;
      if (!structureId) structureId = (t.structureId as string) ?? null;
      for (const u of (t.staffIds as string[]) ?? []) if (u) recipients.add(u);
    }
  }
  if (structureId) {
    const sSnap = await db.collection('structures').doc(structureId).get();
    if (sSnap.exists) {
      const s = sSnap.data()!;
      if (s.founderId) recipients.add(s.founderId as string);
      for (const u of (s.coFounderIds as string[]) ?? []) if (u) recipients.add(u);
      for (const u of (s.managerIds as string[]) ?? []) if (u) recipients.add(u);
      for (const u of (s.coachIds as string[]) ?? []) if (u) recipients.add(u);
    }
  }
  // Le joueur directement ciblé est informé lui aussi.
  if (targetType === 'user') recipients.add(targetId);

  const uids = [...recipients].filter(Boolean);
  if (uids.length === 0) return;

  const title = `${KIND_LABEL[type] ?? 'Sanction'} — ${competitionName || 'Compétition'}`;
  const message = `${targetLabel} : ${reason}`;
  const link = competitionId ? `/competitions/${competitionId}` : '/community/my-structure?tab=inscriptions';

  // Canal garanti : notif in-app.
  try {
    await createNotifications(db, uids.map(userId => ({
      userId,
      type: 'competition_sanction' as const,
      title,
      message,
      link,
      metadata: { sanctionId, kind: type, competitionId },
    })));
  } catch (err) {
    console.error('[sanctions] in-app notify failed:', err);
  }

  // Canal best-effort : DM Discord (borné 10 s, jamais bloquant).
  try {
    const userSnaps = await db.getAll(...uids.map(u => db.collection('users').doc(u)));
    const dms: Promise<unknown>[] = [];
    for (const snap of userSnaps) {
      const discordId = (snap.data()?.discordId as string) || snap.id.replace(/^discord_/, '');
      if (!/^\d{5,32}$/.test(discordId)) continue;
      dms.push(sendCompetitionDM(discordId, { title, message, link: `https://aedral.com${link}` }));
    }
    if (dms.length > 0) {
      await Promise.race([Promise.all(dms), new Promise(resolve => setTimeout(resolve, 10_000))]);
    }
  } catch (err) {
    console.error('[sanctions] Discord DM failed:', err);
  }
}
