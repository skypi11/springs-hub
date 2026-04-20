import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';

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
