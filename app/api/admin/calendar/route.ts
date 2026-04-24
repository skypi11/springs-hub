import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

const MAX_EVENTS = 500;

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

// GET /api/admin/calendar — vue cross-structures de tous les events.
// Filtres : when (upcoming|past|all), type, status, structureId.
// Admin voit tout, pas de filtrage visibilité staff/target.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const when = req.nextUrl.searchParams.get('when') ?? 'upcoming';
    const typeFilter = req.nextUrl.searchParams.get('type');
    const statusFilter = req.nextUrl.searchParams.get('status');
    const structureIdFilter = req.nextUrl.searchParams.get('structureId');

    // On pousse la fenêtre temporelle + structureId côté Firestore ; on filtre
    // type/status côté serveur sur le résultat pour éviter de multiplier les
    // index composites. Volume ≤ MAX_EVENTS, c'est OK.
    let query: FirebaseFirestore.Query = db.collection('structure_events');
    if (structureIdFilter) query = query.where('structureId', '==', structureIdFilter);

    const now = new Date();
    if (when === 'upcoming') {
      query = query.where('startsAt', '>=', now).orderBy('startsAt', 'asc');
    } else if (when === 'past') {
      query = query.where('startsAt', '<', now).orderBy('startsAt', 'desc');
    } else {
      query = query.orderBy('startsAt', 'desc');
    }

    const snap = await query.limit(MAX_EVENTS).get();

    const docs = snap.docs.filter(doc => {
      const d = doc.data();
      if (typeFilter && d.type !== typeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      return true;
    });

    // Enrichir : structures + créateurs en 2 batches.
    const structureIds = new Set<string>();
    const userIds = new Set<string>();
    for (const doc of docs) {
      const data = doc.data();
      if (data.structureId) structureIds.add(data.structureId);
      if (data.createdBy) userIds.add(data.createdBy);
    }
    const [structuresById, usersById] = await Promise.all([
      fetchDocsByIds(db, 'structures', Array.from(structureIds)),
      fetchDocsByIds(db, 'users', Array.from(userIds)),
    ]);

    const nameOf = (uid?: string | null) => {
      if (!uid) return '';
      const u = usersById.get(uid);
      return u?.displayName || u?.discordUsername || '';
    };

    const events = docs.map(doc => {
      const d = doc.data();
      const structure = structuresById.get(d.structureId);
      return {
        id: doc.id,
        structureId: d.structureId ?? '',
        structureName: structure?.name ?? '',
        structureTag: structure?.tag ?? '',
        structureLogoUrl: structure?.logoUrl ?? '',
        title: d.title ?? '',
        type: d.type ?? '',
        status: d.status ?? 'scheduled',
        description: d.description ?? '',
        location: d.location ?? '',
        startsAt: ts(d.startsAt),
        endsAt: ts(d.endsAt),
        target: d.target ?? null,
        createdBy: d.createdBy ?? null,
        createdByName: nameOf(d.createdBy),
        createdAt: ts(d.createdAt),
        completedAt: ts(d.completedAt),
        cancelledAt: ts(d.cancelledAt),
      };
    });

    return NextResponse.json({
      events,
      truncated: snap.size >= MAX_EVENTS,
      max: MAX_EVENTS,
      rawCount: snap.size,
    });
  } catch (err) {
    captureApiError('API Admin/Calendar GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/calendar — actions admin sur un événement :
// Body { eventId, action: 'cancel' | 'terminate' | 'reopen', reason? }
// L'admin bypass les permissions de structure (canCancelEvent, etc.).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const eventId = String(body.eventId ?? '').trim();
    const action = body.action as 'cancel' | 'terminate' | 'reopen';
    if (!eventId) return NextResponse.json({ error: 'eventId manquant' }, { status: 400 });
    if (!['cancel', 'terminate', 'reopen'].includes(action)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }

    const db = getAdminDb();
    const eventRef = db.collection('structure_events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    }
    const event = eventSnap.data()!;

    if (action === 'cancel') {
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
      if (event.status === 'done') {
        return NextResponse.json({ error: 'Déjà terminé' }, { status: 400 });
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
    captureApiError('API Admin/Calendar POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/admin/calendar?eventId=xxx — suppression dure d'un événement + ses présences.
export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const eventId = req.nextUrl.searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ error: 'eventId manquant' }, { status: 400 });

    const db = getAdminDb();
    const eventRef = db.collection('structure_events').doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    }

    // Purge event + présences associées en batch
    const batch = db.batch();
    batch.delete(eventRef);
    const pSnap = await db.collection('event_presences').where('eventId', '==', eventId).get();
    for (const p of pSnap.docs) batch.delete(p.ref);
    await batch.commit();

    return NextResponse.json({ success: true, presencesDeleted: pSnap.size });
  } catch (err) {
    captureApiError('API Admin/Calendar DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
