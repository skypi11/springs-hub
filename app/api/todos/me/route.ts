import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

function tsMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

// GET /api/todos/me — tous mes devoirs, à travers toutes les structures.
// Enrichi avec le nom de la structure + nom de l'équipe + titre de l'event lié (si présent).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();

    const snap = await db.collection('structure_todos')
      .where('assigneeId', '==', uid)
      .limit(500)
      .get();

    if (snap.empty) {
      return NextResponse.json({ todos: [] });
    }

    const todosRaw = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        structureId: d.structureId as string,
        subTeamId: d.subTeamId as string,
        assigneeId: d.assigneeId as string,
        title: (d.title as string) ?? '',
        description: (d.description as string) ?? '',
        eventId: (d.eventId as string | null) ?? null,
        deadline: (d.deadline as string | null) ?? null,
        done: !!d.done,
        doneAt: tsMs(d.doneAt),
        doneBy: (d.doneBy as string | null) ?? null,
        createdBy: d.createdBy as string,
        createdAt: tsMs(d.createdAt) ?? 0,
      };
    });

    const structureIds = Array.from(new Set(todosRaw.map(t => t.structureId)));
    const subTeamIds = Array.from(new Set(todosRaw.map(t => t.subTeamId)));
    const eventIds = Array.from(new Set(todosRaw.map(t => t.eventId).filter((v): v is string => !!v)));

    const [structuresById, teamsById, eventsById] = await Promise.all([
      fetchDocsByIds(db, 'structures', structureIds),
      fetchDocsByIds(db, 'sub_teams', subTeamIds),
      eventIds.length > 0 ? fetchDocsByIds(db, 'structure_events', eventIds) : Promise.resolve(new Map()),
    ]);

    const todos = todosRaw.map(t => {
      const structure = structuresById.get(t.structureId);
      const team = teamsById.get(t.subTeamId);
      const event = t.eventId ? eventsById.get(t.eventId) : null;
      return {
        ...t,
        structureName: (structure?.name as string) ?? '',
        structureTag: (structure?.tag as string) ?? '',
        teamName: (team?.name as string) ?? '',
        eventTitle: event ? ((event.title as string) ?? '') : null,
      };
    });

    return NextResponse.json({ todos });
  } catch (err) {
    captureApiError('API Todos/me GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
