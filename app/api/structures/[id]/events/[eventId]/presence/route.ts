import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import {
  canRespondToPresence,
  canModifyOthersPresence,
  type EventRef,
  type PresenceStatus,
} from '@/lib/event-permissions';

const VALID_STATUSES: PresenceStatus[] = ['present', 'absent', 'maybe', 'pending'];

// POST /api/structures/[id]/events/[eventId]/presence
// Body : { userId?: string, status: 'present' | 'absent' | 'maybe' | 'pending' }
// Si userId omis ou === uid → l'user répond pour lui-même.
// Sinon → le staff modifie pour qqn d'autre (canModifyOthersPresence).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, eventId } = await params;
    const db = getAdminDb();

    const body = await req.json();
    const targetUserId = (body.userId as string | undefined) ?? uid;
    const newStatus = body.status as PresenceStatus;
    if (!VALID_STATUSES.includes(newStatus)) {
      return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const eventRef = db.collection('structure_events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    }
    const event = eventSnap.data()!;
    if (event.structureId !== structureId) {
      return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    }

    const eventPerm: EventRef = {
      createdBy: event.createdBy,
      target: event.target,
      status: event.status,
    };

    // Vérifier qu'une ligne de présence existe pour (eventId, targetUserId).
    const pSnap = await db.collection('event_presences')
      .where('eventId', '==', eventId)
      .where('userId', '==', targetUserId)
      .limit(1)
      .get();
    if (pSnap.empty) {
      return NextResponse.json({ error: 'Cet utilisateur n\'est pas invité' }, { status: 404 });
    }
    const pDoc = pSnap.docs[0];
    const pData = pDoc.data();

    // Permissions
    if (targetUserId === uid) {
      if (!canRespondToPresence(resolved.context, eventPerm, true)) {
        return NextResponse.json({ error: 'Impossible de répondre (événement terminé/annulé ?)' }, { status: 403 });
      }
    } else {
      if (!canModifyOthersPresence(resolved.context, eventPerm)) {
        return NextResponse.json({ error: 'Permissions insuffisantes' }, { status: 403 });
      }
      if (event.status === 'cancelled') {
        return NextResponse.json({ error: 'Événement annulé' }, { status: 400 });
      }
    }

    const now = FieldValue.serverTimestamp();
    const historyEntry = {
      at: new Date(),
      by: uid,
      from: pData.status ?? 'pending',
      to: newStatus,
    };

    await pDoc.ref.update({
      status: newStatus,
      respondedAt: now,
      updatedBy: uid,
      history: FieldValue.arrayUnion(historyEntry),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/events presence POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
