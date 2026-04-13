import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import {
  canEditEvent,
  canDeleteEvent,
  type EventRef,
} from '@/lib/event-permissions';

const MAX_TITLE = 120;
const MAX_DESC = 2000;
const MAX_LOCATION = 200;
const MAX_COMPTE_RENDU = 10000;
const MAX_EVENT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// PATCH /api/structures/[id]/events/[eventId] — éditer un événement
export async function PATCH(
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
    if (!canEditEvent(resolved.context, eventPerm)) {
      return NextResponse.json({ error: 'Permissions insuffisantes' }, { status: 403 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Champs éditables tant que l'événement est scheduled
    if (event.status === 'scheduled') {
      if (body.title !== undefined) {
        const t = String(body.title).trim();
        if (!t) return NextResponse.json({ error: 'Titre obligatoire.' }, { status: 400 });
        if (t.length > MAX_TITLE) return NextResponse.json({ error: 'Titre trop long.' }, { status: 400 });
        updates.title = t;
      }
      if (body.location !== undefined) {
        const l = String(body.location).trim();
        if (l.length > MAX_LOCATION) return NextResponse.json({ error: 'Lieu trop long.' }, { status: 400 });
        updates.location = l;
      }
      if (body.description !== undefined) {
        const d = String(body.description).trim();
        if (d.length > MAX_DESC) return NextResponse.json({ error: 'Description trop longue.' }, { status: 400 });
        updates.description = d;
      }
      if (body.startsAt !== undefined || body.endsAt !== undefined) {
        const startMs = body.startsAt ? Date.parse(body.startsAt) : (event.startsAt?.toMillis?.() ?? 0);
        const endMs = body.endsAt ? Date.parse(body.endsAt) : (event.endsAt?.toMillis?.() ?? 0);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
          return NextResponse.json({ error: 'Dates invalides.' }, { status: 400 });
        }
        if (endMs <= startMs) {
          return NextResponse.json({ error: 'Fin après début.' }, { status: 400 });
        }
        if (endMs - startMs > MAX_EVENT_DURATION_MS) {
          return NextResponse.json({ error: 'Durée max 7 jours.' }, { status: 400 });
        }
        if (body.startsAt) updates.startsAt = Timestamp.fromMillis(startMs);
        if (body.endsAt) updates.endsAt = Timestamp.fromMillis(endMs);
      }
    }

    // Champs éditables même après 'done' (compte rendu, à travailler, résultat)
    if (body.compteRendu !== undefined) {
      const c = String(body.compteRendu);
      if (c.length > MAX_COMPTE_RENDU) return NextResponse.json({ error: 'Compte rendu trop long.' }, { status: 400 });
      updates.compteRendu = c;
    }
    if (body.aTravailler !== undefined) {
      const a = String(body.aTravailler);
      if (a.length > MAX_COMPTE_RENDU) return NextResponse.json({ error: 'Trop long.' }, { status: 400 });
      updates.aTravailler = a;
    }
    if ((event.type === 'match' || event.type === 'scrim')) {
      if (body.adversaire !== undefined) {
        updates.adversaire = String(body.adversaire).trim() || null;
      }
      if (body.resultat !== undefined) {
        updates.resultat = String(body.resultat).trim() || null;
      }
    }

    await eventRef.update(updates);
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/events PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/events/[eventId] — supprimer (dirigeants only)
export async function DELETE(
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
    if (!canDeleteEvent(resolved.context, eventPerm)) {
      return NextResponse.json({ error: 'Seul un dirigeant peut supprimer.' }, { status: 403 });
    }

    // Supprimer event + toutes ses présences en batch
    const batch = db.batch();
    batch.delete(eventRef);
    const pSnap = await db.collection('event_presences')
      .where('eventId', '==', eventId)
      .get();
    for (const p of pSnap.docs) batch.delete(p.ref);
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/events DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
