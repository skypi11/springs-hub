// Synchronisation d'une inscription validée vers le CALENDRIER de l'équipe
// (retour Matt 07/07 : « quand une inscription est validée, la compétition
// s'ajoute au planning de l'équipe »).
//
// Un event `structure_events` par JOUR de compétition, ciblé sur l'équipe
// (target scope=teams), avec une présence `event_presences` par membre — même
// schéma que la création manuelle (app/api/structures/[id]/events) pour que le
// calendrier l'affiche à l'identique.
//
// IDEMPOTENT : doc ids déterministes (`legcomp_${compId}_${teamId}_d${i}` +
// présences `${eventId}_${userId}`) → re-approuver ne duplique rien, et le
// retrait (reject / unapprove / withdraw futur) supprime proprement.
// `createdBy: 'system'` = event officiel, non éditable par l'équipe (seuls les
// dirigeants le sont, cf canEditEvent) — voulu : c'est la compétition qui le pose.

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

const MAX_DAYS = 14; // borne du planning (validateSchedule refuse au-delà)
const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000; // si aucune heure de fin saisie

function eventId(competitionId: string, teamId: string, dayIndex: number): string {
  return `legcomp_${competitionId}_${teamId}_d${dayIndex}`;
}

// Les heures de compétition sont saisies en heure locale FR (« 15:00 » = 15h à
// Paris). Le serveur tourne en UTC → convertir le wall-time Europe/Paris en
// instant UTC en tenant compte du DST (offset +01:00 hiver / +02:00 été), sinon
// un créneau saisi 15:00 s'afficherait 16:00-17:00 aux joueurs. Renvoie ms epoch
// ou null si la date/heure est invalide.
function parisWallTimeToMs(dateStr: string, timeStr: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!dm || !tm) return null;
  const [, y, mo, d] = dm.map(Number);
  const [, h, mi] = tm.map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(naive)) return null;
  // Offset de Paris à cet instant : on relit l'instant `naive` formaté dans le
  // fuseau Paris et on mesure l'écart avec sa lecture UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(naive)).reduce<Record<string, number>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  const asParis = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
  const offset = asParis - naive;
  return naive - offset;
}

/** Crée/actualise les créneaux calendrier de l'équipe pour une compétition. */
export async function syncRegistrationToCalendar(
  db: Firestore,
  args: { competitionId: string; comp: FirebaseFirestore.DocumentData; teamId: string; structureId: string },
): Promise<void> {
  const { competitionId, comp, teamId, structureId } = args;
  const days: Array<{ date?: string; startsAt?: string; endsAt?: string }> =
    Array.isArray(comp.schedule?.days) ? comp.schedule.days : [];
  if (days.length === 0) return;

  // Invités = roster + staff de l'équipe (comme un event scope=teams).
  const teamSnap = await db.collection('sub_teams').doc(teamId).get();
  if (!teamSnap.exists) return;
  const t = teamSnap.data()!;
  const invited = Array.from(new Set<string>([
    ...((t.playerIds as string[]) ?? []),
    ...((t.subIds as string[]) ?? []),
    ...((t.staffIds as string[]) ?? []),
  ].filter(Boolean)));

  const title = (comp.name as string) || 'Compétition';
  const batch = db.batch();

  days.forEach((d, i) => {
    if (i >= MAX_DAYS || !d.date || !d.startsAt) return;
    const startMs = parisWallTimeToMs(d.date, d.startsAt);
    if (startMs === null) return;
    const endParsed = d.endsAt ? parisWallTimeToMs(d.date, d.endsAt) : null;
    const endMs = endParsed !== null && endParsed > startMs ? endParsed : startMs + DEFAULT_DURATION_MS;

    const id = eventId(competitionId, teamId, i);
    batch.set(db.collection('structure_events').doc(id), {
      structureId,
      createdBy: 'system',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      title,
      type: 'tournoi',
      description: 'Inscription validée — créneau ajouté automatiquement.',
      location: '',
      startsAt: Timestamp.fromMillis(startMs),
      endsAt: Timestamp.fromMillis(endMs),
      target: { scope: 'teams', teamIds: [teamId] },
      status: 'scheduled',
      completedAt: null, completedBy: null, cancelledAt: null, cancelledBy: null, cancelReason: null,
      compteRendu: '', aTravailler: '',
      adversaire: null, adversaireLogoUrl: null, resultat: null,
      tournoiNom: title, tournoiFormat: null, tournoiUrl: null, tournoiInscriptionUrl: null, tournoiReglementUrl: null,
      gameHostedBy: null, gameName: null, gamePassword: null, gameFormat: null,
      // Trace pour rattacher le créneau à l'inscription (retrait / audit).
      sourceCompetitionId: competitionId,
    }, { merge: true });

    for (const userId of invited) {
      batch.set(db.collection('event_presences').doc(`${id}_${userId}`), {
        eventId: id, structureId, userId, status: 'pending',
        wasStructureMember: true, respondedAt: null, updatedBy: null, history: [],
      }, { merge: true });
    }
  });

  await batch.commit();
}

/** Retire les créneaux calendrier d'une inscription (reject / unapprove / retrait). */
export async function removeRegistrationFromCalendar(
  db: Firestore,
  args: { competitionId: string; teamId: string },
): Promise<void> {
  const { competitionId, teamId } = args;
  const ids = Array.from({ length: MAX_DAYS }, (_, i) => eventId(competitionId, teamId, i));
  // Présences liées (doc id auto-préfixé eventId) : query par eventId, en parallèle.
  const presenceSnaps = await Promise.all(
    ids.map(id => db.collection('event_presences').where('eventId', '==', id).get()),
  );
  const batch = db.batch();
  let writes = 0;
  presenceSnaps.forEach((snap, i) => {
    for (const p of snap.docs) { batch.delete(p.ref); writes++; }
    // delete idempotent (no-op si l'event n'existe pas pour ce jour).
    batch.delete(db.collection('structure_events').doc(ids[i])); writes++;
  });
  if (writes > 0) await batch.commit();
}
