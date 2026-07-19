import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { isDirigeant, isStaffOfTeam, isCoachForTeam } from '@/lib/event-permissions';
import { endOfDayParisMs, parisYmd } from '@/lib/todos';
import { fetchDocsByIds } from '@/lib/firestore-helpers';

function tsMs(v: unknown): number | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: unknown }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

// GET /api/structures/[id]/todos/overview
// Vue agrégée des exercices cross-équipes pour le staff.
// - Dirigeant (fondateur / co-fondateur) → toutes les équipes de la structure.
// - Manager/coach d'équipe → uniquement les équipes où il est staffedTeamIds.
// Renvoie la liste des exercices enrichie (assignee + équipe), les équipes/users utiles
// pour l'UI, et des compteurs bornés Paris (overdue / dueToday / dueThisWeek / doneLast7d).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }

    const dirigeant = isDirigeant(resolved.context);
    // Multi-jeux (2026-05-30) : visibilité scopée par jeu.
    // - Dirigeant → toutes les équipes (jamais scopé)
    // - Responsable scopé → équipes du/des jeu(x) listé(s) dans managerGames (couvert par isStaffOfTeam)
    // - Coach scopé → équipes du/des jeu(x) listé(s) dans coachGames (couvert par isCoachForTeam)
    // - Staff explicite d'une sub_team → cette équipe (couvert par isStaffOfTeam via staffedTeamIds)
    const visibleTeamIds = dirigeant
      ? resolved.teams.map(t => t.id)
      : resolved.teams
          .filter(t => isStaffOfTeam(resolved.context, t.id) || isCoachForTeam(resolved.context, t.id))
          .map(t => t.id);

    if (visibleTeamIds.length === 0) {
      return NextResponse.json({
        teams: [], users: [], todos: [],
        counts: { overdue: 0, dueToday: 0, dueThisWeek: 0, doneLast7d: 0, pendingTotal: 0 },
        canSeeAll: false,
        // Un dirigeant reste dirigeant même sans aucune équipe (consommé par le
        // gestionnaire de templates pour autoriser le ménage des templates d'un
        // membre parti) — ne pas figer à false ici.
        isDirigeant: dirigeant,
      });
    }

    const visibleTeamSet = new Set(visibleTeamIds);
    const teams = resolved.teams
      .filter(t => visibleTeamSet.has(t.id))
      .map(t => ({
        id: t.id,
        name: (t.name as string | undefined) ?? '',
        label: (t.label as string | undefined) ?? null,
        game: (t.game as string | undefined) ?? '',
        logoUrl: (t.logoUrl as string | undefined) ?? null,
        order: typeof t.order === 'number' ? t.order : 0,
        groupOrder: typeof t.groupOrder === 'number' ? t.groupOrder : 0,
      }));

    // Firestore `in` query : chunks de 30 max sur subTeamId.
    const allDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (let i = 0; i < visibleTeamIds.length; i += 30) {
      const chunk = visibleTeamIds.slice(i, i + 30);
      const snap = await db.collection('structure_todos')
        .where('subTeamId', 'in', chunk)
        .limit(2000)
        .get();
      allDocs.push(...snap.docs);
    }

    const assigneeIds = new Set<string>();
    const todos = allDocs.map(doc => {
      const d = doc.data();
      const deadline = (d.deadline as string | null) ?? null;
      const deadlineAt = typeof d.deadlineAt === 'number'
        ? d.deadlineAt
        : (deadline ? endOfDayParisMs(deadline) : null);
      if (typeof d.assigneeId === 'string' && d.assigneeId) assigneeIds.add(d.assigneeId);
      return {
        id: doc.id,
        structureId: d.structureId as string,
        subTeamId: d.subTeamId as string,
        assigneeId: d.assigneeId as string,
        type: (typeof d.type === 'string' && d.type) ? d.type : 'free',
        title: (d.title as string | undefined) ?? '',
        description: (d.description as string | undefined) ?? '',
        config: (d.config && typeof d.config === 'object') ? d.config as Record<string, unknown> : {},
        response: (d.response && typeof d.response === 'object') ? d.response as Record<string, unknown> : null,
        // v3 : propage les steps[] pour que le drawer staff affiche la checklist multi-step + captures
        ...(Array.isArray(d.steps) ? { steps: d.steps } : {}),
        eventId: (d.eventId as string | null) ?? null,
        deadline,
        deadlineAt,
        deadlineMode: (d.deadlineMode === 'relative' || d.deadlineMode === 'absolute')
          ? d.deadlineMode
          : (deadline ? 'absolute' : null),
        deadlineOffsetDays: typeof d.deadlineOffsetDays === 'number' ? d.deadlineOffsetDays : null,
        done: !!d.done,
        doneAt: tsMs(d.doneAt),
        doneBy: (d.doneBy as string | null) ?? null,
        // v3, verrouillage
        lockedAt: tsMs(d.lockedAt),
        lockedBy: (d.lockedBy as string | null) ?? null,
        createdBy: d.createdBy as string,
        createdAt: tsMs(d.createdAt) ?? 0,
      };
    });

    // Enrichissement users (assignees uniquement, le UI peut requêter d'autres users à la demande).
    const usersMap = await fetchDocsByIds(db, 'users', Array.from(assigneeIds));
    const users = Array.from(assigneeIds).map(uid => {
      const u = usersMap.get(uid);
      const rawAvatar = (u?.avatarUrl as string | undefined) || (u?.discordAvatar as string | undefined) || '';
      // Fallback avatar Discord par défaut quand le doc user n'a pas d'avatar
      // (vieux comptes pré-callback Discord ou users créés autrement).
      // Format Discord post-pomelo : 6 avatars par défaut, index = (id >> 22) % 6
      let avatarUrl = rawAvatar;
      if (!avatarUrl && uid.startsWith('discord_')) {
        const discordId = uid.slice('discord_'.length);
        if (/^\d{15,32}$/.test(discordId)) {
          try {
            const idx = Number(BigInt(discordId) >> BigInt(22)) % 6;
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
          } catch { /* ignore */ }
        }
      }
      return {
        uid,
        displayName: (u?.displayName as string | undefined) ?? (u?.discordUsername as string | undefined) ?? uid,
        avatarUrl,
      };
    });

    // Compteurs bornés Paris (today = jour calendaire Paris courant).
    const nowMs = Date.now();
    const todayYmd = parisYmd(nowMs);
    const endOfTodayMs = endOfDayParisMs(todayYmd);
    const endOfWeekMs = endOfTodayMs + 6 * 86400000; // 7 jours glissants incluant aujourd'hui
    const sevenDaysAgoMs = nowMs - 7 * 86400000;

    let overdue = 0;
    let dueToday = 0;
    let dueThisWeek = 0;
    let doneLast7d = 0;
    let pendingTotal = 0;

    for (const t of todos) {
      if (t.done) {
        if (t.doneAt !== null && t.doneAt >= sevenDaysAgoMs) doneLast7d++;
        continue;
      }
      pendingTotal++;
      if (t.deadlineAt === null) continue;
      if (t.deadlineAt < nowMs) {
        overdue++;
      } else if (t.deadlineAt <= endOfTodayMs) {
        dueToday++;
      } else if (t.deadlineAt <= endOfWeekMs) {
        dueThisWeek++;
      }
    }

    return NextResponse.json({
      teams,
      users,
      todos,
      counts: { overdue, dueToday, dueThisWeek, doneLast7d, pendingTotal },
      canSeeAll: dirigeant,
      isDirigeant: dirigeant,
    });
  } catch (err) {
    captureApiError('API Structures/todos/overview GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
