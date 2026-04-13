import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

// GET /api/calendar/me — tous les événements où l'user est invité, groupés par structure.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();

    // Présences où l'user figure (toutes structures confondues)
    const pSnap = await db.collection('event_presences')
      .where('userId', '==', uid)
      .limit(500)
      .get();

    if (pSnap.empty) {
      return NextResponse.json({ events: [], structures: {} });
    }

    const eventIds = Array.from(new Set(pSnap.docs.map(d => d.data().eventId as string)));
    const presencesByEventId = new Map<string, Record<string, unknown>>();
    for (const pDoc of pSnap.docs) {
      const p = pDoc.data();
      presencesByEventId.set(p.eventId as string, {
        id: pDoc.id,
        status: p.status,
        respondedAt: ts(p.respondedAt),
      });
    }

    // Fetch les events (chunks de 30 sur __name__)
    const eventsById = await fetchDocsByIds(db, 'structure_events', eventIds);

    // Fetch les structures pour afficher name/tag/logo
    const structureIds = Array.from(new Set(
      Array.from(eventsById.values()).map(e => e.structureId as string)
    ));
    const structuresById = await fetchDocsByIds(db, 'structures', structureIds);

    const structures: Record<string, { name: string; tag: string; logoUrl: string }> = {};
    for (const [id, s] of structuresById) {
      structures[id] = {
        name: s.name ?? '',
        tag: s.tag ?? '',
        logoUrl: s.logoUrl ?? '',
      };
    }

    const events = Array.from(eventsById.entries()).map(([id, d]) => ({
      id,
      structureId: d.structureId,
      title: d.title,
      type: d.type,
      description: d.description ?? '',
      location: d.location ?? '',
      startsAt: ts(d.startsAt),
      endsAt: ts(d.endsAt),
      target: d.target,
      status: d.status,
      adversaire: d.adversaire ?? null,
      resultat: d.resultat ?? null,
      compteRendu: d.compteRendu ?? '',
      aTravailler: d.aTravailler ?? '',
      myPresence: presencesByEventId.get(id) ?? null,
    }));

    // Tri : à venir d'abord (les plus proches en premier), puis passés (récents en premier)
    const now = Date.now();
    events.sort((a, b) => {
      const aStart = a.startsAt ? Date.parse(a.startsAt) : 0;
      const bStart = b.startsAt ? Date.parse(b.startsAt) : 0;
      const aFuture = aStart >= now;
      const bFuture = bStart >= now;
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      if (aFuture) return aStart - bStart;
      return bStart - aStart;
    });

    return NextResponse.json({ events, structures });
  } catch (err) {
    captureApiError('API calendar/me GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
