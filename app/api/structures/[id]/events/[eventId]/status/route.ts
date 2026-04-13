import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import {
  canMarkTerminated,
  canCancelEvent,
  type EventRef,
} from '@/lib/event-permissions';

// POST /api/structures/[id]/events/[eventId]/status
// Body : { action: 'terminate' | 'reopen' | 'cancel', reason?: string }
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

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const body = await req.json();
    const action = body.action as 'terminate' | 'reopen' | 'cancel';
    if (!['terminate', 'reopen', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
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

    if (action === 'cancel') {
      if (!canCancelEvent(resolved.context, eventPerm)) {
        return NextResponse.json({ error: 'Permissions insuffisantes' }, { status: 403 });
      }
      if (event.status === 'cancelled') {
        return NextResponse.json({ error: 'Déjà annulé' }, { status: 400 });
      }
      const reason = body.reason ? String(body.reason).trim().slice(0, 500) : null;
      await eventRef.update({
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: uid,
        cancelReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'terminate') {
      if (!canMarkTerminated(resolved.context, eventPerm)) {
        return NextResponse.json({ error: 'Permissions insuffisantes' }, { status: 403 });
      }
      if (event.status === 'done') {
        return NextResponse.json({ error: 'Déjà terminé' }, { status: 400 });
      }
      if (event.status === 'cancelled') {
        return NextResponse.json({ error: 'Événement annulé' }, { status: 400 });
      }
      await eventRef.update({
        status: 'done',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true });
    }

    // reopen
    if (!canMarkTerminated(resolved.context, eventPerm)) {
      return NextResponse.json({ error: 'Permissions insuffisantes' }, { status: 403 });
    }
    if (event.status === 'scheduled') {
      return NextResponse.json({ error: 'Déjà programmé' }, { status: 400 });
    }
    await eventRef.update({
      status: 'scheduled',
      completedAt: null,
      completedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/events status POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
