import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { endOfDayParisMs, parisYmd, TODO_TYPE_META, type TodoType } from '@/lib/todos';
import { captureApiError } from '@/lib/sentry';

const MAX_TODOS = 5000;

function tsMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

type StructureStats = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  founderId: string;
  founderName: string;
  total: number;
  pending: number;
  done: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  doneLast7d: number;
  completionRate: number;
  byType: Record<string, number>;
};

// GET /api/admin/exercices, vue cross-structures de tous les exercices.
// Agrège structure_todos par structure + stats globales. Pas de détail par exercice
// (c'est le rôle du panel structure), ici on donne un bilan d'ensemble pour
// identifier les structures en retard / sans activité.
//
// Avec ?structureId=X : retourne la liste détaillée des exercices de cette structure
// (utilisé pour le déroulement inline dans le panel admin).
//
// Avec ?todoId=X : retourne UN exercice complet (description, steps, response, etc.)
// sérialisé en format TodoRef pour alimenter le drawer admin readonly.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const todoIdParam = req.nextUrl.searchParams.get('todoId');
    if (todoIdParam) {
      return await getTodoDetail(db, todoIdParam);
    }

    const structureIdParam = req.nextUrl.searchParams.get('structureId');
    if (structureIdParam) {
      return await getStructureDetail(db, structureIdParam);
    }

    const snap = await db.collection('structure_todos').limit(MAX_TODOS).get();

    const nowMs = Date.now();
    const todayYmd = parisYmd(nowMs);
    const endOfTodayMs = endOfDayParisMs(todayYmd);
    const endOfWeekMs = endOfTodayMs + 6 * 86400000;
    const sevenDaysAgoMs = nowMs - 7 * 86400000;

    const byStructure = new Map<string, StructureStats>();
    const structureIds = new Set<string>();

    let gTotal = 0, gPending = 0, gDone = 0, gOverdue = 0, gDueToday = 0, gDueThisWeek = 0, gDoneLast7d = 0;
    const gByType: Record<string, number> = {};

    for (const doc of snap.docs) {
      const d = doc.data();
      const structureId = d.structureId as string | undefined;
      if (!structureId) continue;
      structureIds.add(structureId);

      let s = byStructure.get(structureId);
      if (!s) {
        s = {
          structureId,
          structureName: '',
          structureTag: '',
          structureLogoUrl: '',
          founderId: '',
          founderName: '',
          total: 0, pending: 0, done: 0,
          overdue: 0, dueToday: 0, dueThisWeek: 0, doneLast7d: 0,
          completionRate: 0,
          byType: {},
        };
        byStructure.set(structureId, s);
      }

      const type = (typeof d.type === 'string' && d.type) ? d.type : 'free';
      s.byType[type] = (s.byType[type] ?? 0) + 1;
      gByType[type] = (gByType[type] ?? 0) + 1;

      s.total++;
      gTotal++;

      const isDone = !!d.done;
      if (isDone) {
        s.done++;
        gDone++;
        const doneAt = tsMs(d.doneAt);
        if (doneAt !== null && doneAt >= sevenDaysAgoMs) {
          s.doneLast7d++;
          gDoneLast7d++;
        }
        continue;
      }

      s.pending++;
      gPending++;

      const deadline = (d.deadline as string | null) ?? null;
      const deadlineAt = typeof d.deadlineAt === 'number'
        ? d.deadlineAt
        : (deadline ? endOfDayParisMs(deadline) : null);
      if (deadlineAt === null) continue;
      if (deadlineAt < nowMs) {
        s.overdue++;
        gOverdue++;
      } else if (deadlineAt <= endOfTodayMs) {
        s.dueToday++;
        gDueToday++;
      } else if (deadlineAt <= endOfWeekMs) {
        s.dueThisWeek++;
        gDueThisWeek++;
      }
    }

    const structuresById = await fetchDocsByIds(db, 'structures', Array.from(structureIds));
    const founderIds = new Set<string>();
    for (const s of byStructure.values()) {
      const struct = structuresById.get(s.structureId);
      s.structureName = (struct?.name as string | undefined) ?? '';
      s.structureTag = (struct?.tag as string | undefined) ?? '';
      s.structureLogoUrl = (struct?.logoUrl as string | undefined) ?? '';
      s.founderId = (struct?.founderId as string | undefined) ?? '';
      if (s.founderId) founderIds.add(s.founderId);
      s.completionRate = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    }

    const foundersById = await fetchDocsByIds(db, 'users', Array.from(founderIds));
    for (const s of byStructure.values()) {
      if (!s.founderId) continue;
      const u = foundersById.get(s.founderId);
      s.founderName = (u?.displayName as string | undefined)
        || (u?.discordUsername as string | undefined)
        || s.founderId;
    }

    const structures = Array.from(byStructure.values()).sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      if (b.pending !== a.pending) return b.pending - a.pending;
      return a.structureName.localeCompare(b.structureName);
    });

    const typeBreakdown = Object.entries(gByType)
      .map(([type, count]) => ({
        type,
        count,
        label: TODO_TYPE_META[type as TodoType]?.label ?? type,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      global: {
        total: gTotal,
        pending: gPending,
        done: gDone,
        overdue: gOverdue,
        dueToday: gDueToday,
        dueThisWeek: gDueThisWeek,
        doneLast7d: gDoneLast7d,
        completionRate: gTotal > 0 ? Math.round((gDone / gTotal) * 100) : 0,
      },
      typeBreakdown,
      structures,
      truncated: snap.size >= MAX_TODOS,
      max: MAX_TODOS,
    });
  } catch (err) {
    captureApiError('API Admin/Exercices GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Détail des exercices d'une structure : liste triée (pending d'abord par deadline
// croissante, puis done par doneAt décroissant). Cap 500 pour éviter un payload
// monstrueux sur une structure qui en accumulerait.
const STRUCTURE_DETAIL_CAP = 500;

async function getStructureDetail(db: FirebaseFirestore.Firestore, structureId: string) {
  const snap = await db.collection('structure_todos')
    .where('structureId', '==', structureId)
    .limit(STRUCTURE_DETAIL_CAP)
    .get();

  const assigneeIds = new Set<string>();
  const nowMs = Date.now();
  const todayYmd = parisYmd(nowMs);
  const endOfTodayMs = endOfDayParisMs(todayYmd);

  const todos = snap.docs.map(doc => {
    const d = doc.data();
    const deadline = (d.deadline as string | null) ?? null;
    const deadlineAt = typeof d.deadlineAt === 'number'
      ? d.deadlineAt
      : (deadline ? endOfDayParisMs(deadline) : null);
    const assigneeId = typeof d.assigneeId === 'string' ? d.assigneeId : '';
    if (assigneeId) assigneeIds.add(assigneeId);
    const done = !!d.done;
    let urgency: 'overdue' | 'today' | 'future' | 'none' = 'none';
    if (!done && deadlineAt !== null) {
      if (deadlineAt < nowMs) urgency = 'overdue';
      else if (deadlineAt <= endOfTodayMs) urgency = 'today';
      else urgency = 'future';
    }
    return {
      id: doc.id,
      type: (typeof d.type === 'string' && d.type) ? d.type : 'free',
      title: (d.title as string | undefined) ?? '',
      done,
      doneAt: tsMs(d.doneAt),
      deadline,
      deadlineAt,
      urgency,
      assigneeId,
      assigneeName: '',
      createdBy: (d.createdBy as string | undefined) ?? '',
      createdAt: tsMs(d.createdAt),
      hasResponse: !!d.response,
    };
  });

  const usersById = await fetchDocsByIds(db, 'users', Array.from(assigneeIds));
  for (const t of todos) {
    if (!t.assigneeId) continue;
    const u = usersById.get(t.assigneeId);
    t.assigneeName = (u?.displayName as string | undefined)
      || (u?.discordUsername as string | undefined)
      || t.assigneeId;
  }

  // Tri : pending d'abord (overdue en tête, puis today, puis par deadline croissante),
  // puis done (les plus récents d'abord).
  todos.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) {
      const rank = (u: string) => u === 'overdue' ? 0 : u === 'today' ? 1 : u === 'future' ? 2 : 3;
      const ra = rank(a.urgency), rb = rank(b.urgency);
      if (ra !== rb) return ra - rb;
      const da = a.deadlineAt ?? Number.POSITIVE_INFINITY;
      const db2 = b.deadlineAt ?? Number.POSITIVE_INFINITY;
      return da - db2;
    }
    return (b.doneAt ?? 0) - (a.doneAt ?? 0);
  });

  return NextResponse.json({
    structureId,
    todos,
    truncated: snap.size >= STRUCTURE_DETAIL_CAP,
  });
}

// Détail complet d'UN exercice, formaté en TodoRef pour alimenter le drawer admin
// readonly (description, multi-steps, réponses, screenshots, deadline complète,
// lockedAt). Inclut aussi les noms enrichis (assignee, structure, équipe, event)
// pour l'affichage contextuel du drawer.
async function getTodoDetail(db: FirebaseFirestore.Firestore, todoId: string) {
  const snap = await db.collection('structure_todos').doc(todoId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Exercice introuvable' }, { status: 404 });
  }
  const d = snap.data()!;

  const structureId = (d.structureId as string | undefined) ?? '';
  const subTeamId = (d.subTeamId as string | undefined) ?? '';
  const assigneeId = (d.assigneeId as string | undefined) ?? '';
  const eventId = (d.eventId as string | undefined) ?? null;

  // Enrichissement noms pour affichage drawer (structure, team, event, assignee).
  // Fait en parallèle pour minimiser la latence.
  const [structSnap, teamSnap, eventSnap, assigneeSnap] = await Promise.all([
    structureId ? db.collection('structures').doc(structureId).get() : Promise.resolve(null),
    subTeamId ? db.collection('sub_teams').doc(subTeamId).get() : Promise.resolve(null),
    eventId ? db.collection('structure_events').doc(eventId).get() : Promise.resolve(null),
    assigneeId ? db.collection('users').doc(assigneeId).get() : Promise.resolve(null),
  ]);

  const structName = structSnap?.exists ? (structSnap.data()?.name as string | undefined) ?? '' : '';
  const structTag = structSnap?.exists ? (structSnap.data()?.tag as string | undefined) ?? '' : '';
  const teamName = teamSnap?.exists ? (teamSnap.data()?.name as string | undefined) ?? '' : '';
  const eventTitle = eventSnap?.exists ? (eventSnap.data()?.title as string | undefined) ?? null : null;
  const assigneeName = assigneeSnap?.exists
    ? ((assigneeSnap.data()?.displayName as string | undefined)
       || (assigneeSnap.data()?.discordUsername as string | undefined)
       || assigneeId)
    : assigneeId;

  const todo = {
    id: snap.id,
    structureId,
    subTeamId,
    assigneeId,
    type: (typeof d.type === 'string' && d.type) ? d.type : 'free',
    title: (d.title as string | undefined) ?? '',
    description: (d.description as string | undefined) ?? '',
    config: (d.config && typeof d.config === 'object') ? d.config : {},
    response: (d.response && typeof d.response === 'object') ? d.response : null,
    steps: Array.isArray(d.steps) ? d.steps : undefined,
    eventId,
    deadline: (d.deadline as string | null) ?? null,
    deadlineAt: typeof d.deadlineAt === 'number'
      ? d.deadlineAt
      : (d.deadline ? endOfDayParisMs(d.deadline as string) : null),
    deadlineMode: (d.deadlineMode === 'relative' || d.deadlineMode === 'absolute')
      ? d.deadlineMode
      : (d.deadline ? 'absolute' : null),
    deadlineOffsetDays: typeof d.deadlineOffsetDays === 'number' ? d.deadlineOffsetDays : null,
    done: !!d.done,
    doneAt: tsMs(d.doneAt),
    doneBy: (d.doneBy as string | null) ?? null,
    lockedAt: tsMs(d.lockedAt),
    lockedBy: (d.lockedBy as string | null) ?? null,
    createdBy: (d.createdBy as string | undefined) ?? '',
    createdAt: tsMs(d.createdAt) ?? 0,
    // Contexte enrichi pour l'affichage drawer (props extra de DrawerTodo).
    structureName: structName,
    structureTag: structTag,
    teamName,
    eventTitle,
    assigneeName,
  };

  return NextResponse.json({ todo });
}
