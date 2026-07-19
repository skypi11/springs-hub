// Écriture de présence à un événement — CHEMIN UNIQUE partagé par la route du
// site (POST .../events/[eventId]/presence) et le handler d'interactions Discord.
//
// Motivation : la logique d'autorisation (invitation prouvée par la ligne de
// présence, event terminé/annulé, structure indisponible) DOIT être identique
// sur les deux surfaces, sinon un bouton Discord pourrait écrire une présence
// que le site refuserait (dérive de sécurité). On centralise donc ici.
//
// Écriture via Admin SDK (les rules bloquent event_presences en écriture).

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveUserContext } from '@/lib/event-context';
import {
  canRespondToPresence,
  canModifyOthersPresence,
  type EventRef,
  type PresenceStatus,
  type UserContext,
} from '@/lib/event-permissions';

export const VALID_PRESENCE_STATUSES: PresenceStatus[] = ['present', 'absent', 'maybe', 'pending'];

export type WritePresenceCode =
  | 'invalid_status'         // statut hors enum
  | 'event_not_found'        // event inexistant OU n'appartient pas à expectedStructureId
  | 'structure_unavailable'  // structure suspended/pending/rejected (ou inexistante)
  | 'not_invited'            // pas de ligne de présence pour (eventId, targetUserId)
  | 'event_closed'           // event passé (rejectPast) ou terminé/annulé
  | 'forbidden';             // permission insuffisante (modifier autrui)

export type WritePresenceResult =
  | { ok: true; from: PresenceStatus; to: PresenceStatus }
  | { ok: false; code: WritePresenceCode };

export interface WritePresenceArgs {
  actorUid: string;                   // qui effectue l'action (le cliqueur / le connecté)
  targetUserId: string;              // présence de qui (=== actorUid pour une réponse à soi)
  eventId: string;
  status: PresenceStatus;
  // Fourni par la route (id résolu depuis l'URL) → défense : l'event doit y
  // appartenir. Omis par Discord (structureId dérivé de l'event lui-même).
  expectedStructureId?: string | null;
  // Discord : refuse un event déjà commencé (le site masque déjà ses boutons pour
  // les events passés — on aligne le comportement effectif). Le site laisse false.
  rejectPast?: boolean;
}

// Contexte minimal pour une réponse à SOI : canRespondToPresence ne lit que
// ctx.uid (+ event.status). Inutile de charger membres + toutes les équipes de la
// structure (jusqu'à 500) via resolveUserContext — coûteux et, côté Discord,
// menace la limite des 3 s. Le gate « structure active » se fait via un seul get.
function selfContext(uid: string): UserContext {
  return {
    uid,
    isFounder: false, isCoFounder: false, isManager: false, isCoach: false,
    staffedTeamIds: [], managedTeamIds: [], coachedTeamIds: [], captainOfTeamIds: [],
    managerGames: null, coachGames: null, teamGames: {},
  };
}

async function structureIsAvailable(db: Firestore, structureId: string): Promise<boolean> {
  const snap = await db.collection('structures').doc(structureId).get();
  if (!snap.exists) return false;
  const status = snap.data()!.status;
  return status !== 'suspended' && status !== 'pending_validation' && status !== 'rejected';
}

/**
 * Écrit/mets à jour la présence. Ne lève jamais pour un cas métier — renvoie un
 * code. Les exceptions techniques (Firestore) remontent à l'appelant.
 */
export async function writePresence(
  db: Firestore,
  args: WritePresenceArgs,
): Promise<WritePresenceResult> {
  const { actorUid, targetUserId, eventId, status, expectedStructureId, rejectPast } = args;
  const isSelf = targetUserId === actorUid;

  if (!VALID_PRESENCE_STATUSES.includes(status)) return { ok: false, code: 'invalid_status' };

  const eventSnap = await db.collection('structure_events').doc(eventId).get();
  if (!eventSnap.exists) return { ok: false, code: 'event_not_found' };
  const event = eventSnap.data()!;
  const structureId = event.structureId as string;
  if (expectedStructureId && expectedStructureId !== structureId) {
    return { ok: false, code: 'event_not_found' };
  }

  // Résolution du contexte + gate structure. Réponse à soi = chemin léger (1 get
  // structure) ; modification d'autrui = contexte complet (rôles requis).
  let ctx: UserContext;
  if (isSelf) {
    if (!(await structureIsAvailable(db, structureId))) return { ok: false, code: 'structure_unavailable' };
    ctx = selfContext(actorUid);
  } else {
    const resolved = await resolveUserContext(db, actorUid, structureId);
    if (!resolved) return { ok: false, code: 'structure_unavailable' };
    ctx = resolved.context;
  }

  // La ligne de présence prouve l'invitation (créée à la création de l'event).
  const pSnap = await db.collection('event_presences')
    .where('eventId', '==', eventId)
    .where('userId', '==', targetUserId)
    .limit(1)
    .get();
  if (pSnap.empty) return { ok: false, code: 'not_invited' };
  const pDoc = pSnap.docs[0];
  const pData = pDoc.data();

  // Garde « event passé » (Discord uniquement) : les boutons d'un vieux message
  // restent cliquables ; on refuse une réponse sur un event déjà commencé pour
  // matcher ce que voit un joueur sur le site (boutons masqués).
  if (rejectPast) {
    const startMs = typeof event.startsAt?.toMillis === 'function' ? event.startsAt.toMillis() : null;
    if (startMs !== null && startMs < Date.now()) return { ok: false, code: 'event_closed' };
  }

  const eventPerm: EventRef = {
    createdBy: event.createdBy,
    target: event.target,
    status: event.status,
  };

  if (isSelf) {
    // canRespondToPresence refuse si event done/cancelled.
    if (!canRespondToPresence(ctx, eventPerm, true)) return { ok: false, code: 'event_closed' };
  } else {
    if (!canModifyOthersPresence(ctx, eventPerm)) return { ok: false, code: 'forbidden' };
    if (event.status === 'cancelled') return { ok: false, code: 'event_closed' };
  }

  const from = (pData.status ?? 'pending') as PresenceStatus;
  await pDoc.ref.update({
    status,
    respondedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
    history: FieldValue.arrayUnion({ at: new Date(), by: actorUid, from, to: status }),
  });

  return { ok: true, from, to: status };
}
