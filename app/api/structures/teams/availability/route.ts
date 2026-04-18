import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';

// Coerce un champ Firestore qui devrait être un Timestamp mais peut être un
// number (ms), un Date, ou un plain object legacy {_seconds, _nanoseconds}.
function coerceToMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object') {
    const o = v as { toMillis?: () => number; _seconds?: number; _nanoseconds?: number; seconds?: number; nanoseconds?: number };
    if (typeof o.toMillis === 'function') return o.toMillis();
    if (typeof o._seconds === 'number') return o._seconds * 1000 + Math.floor((o._nanoseconds ?? 0) / 1e6);
    if (typeof o.seconds === 'number') return o.seconds * 1000 + Math.floor((o.nanoseconds ?? 0) / 1e6);
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import {
  isStaffOfTeam,
  getInvitedUserIds,
  type EventTarget,
  type MemberRef,
  type TeamRef,
} from '@/lib/event-permissions';
import {
  addDays,
  getMondayYmd,
  getIsoWeekId,
  parisYmd,
  parisIsoMinute,
  generateWeekGrid,
  eventCoversSlot,
  findMatchBlocks,
} from '@/lib/availability';

const DEFAULT_MIN_PLAYERS = 2;
const DEFAULT_MIN_DURATION_MIN = 60;

// GET /api/structures/teams/availability?structureId=X&teamId=Y
// Renvoie, pour une équipe donnée, les dispos de ses joueurs sur les 2 semaines
// (courante + suivante) + les créneaux suggérés calculés côté serveur.
// Accessible au staff de l'équipe (+ dirigeants via isStaffOfTeam).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const structureId = req.nextUrl.searchParams.get('structureId');
    const teamId = req.nextUrl.searchParams.get('teamId');
    if (!structureId || !teamId) {
      return NextResponse.json({ error: 'structureId et teamId requis' }, { status: 400 });
    }

    const db = getAdminDb();

    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable ou inaccessible' }, { status: 404 });
    }
    if (!isStaffOfTeam(resolved.context, teamId)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const teamSnap = await db.collection('sub_teams').doc(teamId).get();
    if (!teamSnap.exists) {
      return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
    }
    const teamData = teamSnap.data()!;
    if (teamData.structureId !== structureId) {
      return NextResponse.json({ error: 'Équipe ne correspond pas à la structure' }, { status: 400 });
    }

    // Joueurs de l'équipe = titulaires + remplaçants (le staff n'est pas comptabilisé
    // dans le matching — on cherche à planifier des matchs entre joueurs).
    const memberIds: string[] = Array.from(new Set([
      ...((teamData.playerIds as string[]) || []),
      ...((teamData.subIds as string[]) || []),
    ])).filter(Boolean);

    const minPlayersForMatch = typeof teamData.minPlayersForMatch === 'number'
      ? teamData.minPlayersForMatch
      : DEFAULT_MIN_PLAYERS;
    const minMatchDurationMinutes = typeof teamData.minMatchDurationMinutes === 'number'
      ? teamData.minMatchDurationMinutes
      : DEFAULT_MIN_DURATION_MIN;

    // Fenêtre : semaine courante + semaine suivante
    const todayYmd = parisYmd(new Date());
    const currentMonday = getMondayYmd(todayYmd);
    const nextMonday = addDays(currentMonday, 7);
    const weekMondays = [currentMonday, nextMonday];

    // Grilles + orderedSlots pour chaque semaine
    const orderedSlotsByWeek: Record<string, string[]> = {};
    for (const m of weekMondays) {
      const grid = generateWeekGrid(m, todayYmd);
      const slots: string[] = [];
      for (const day of grid.days) slots.push(...day.slots);
      orderedSlotsByWeek[m] = slots;
    }
    const allSlots = [...orderedSlotsByWeek[currentMonday], ...orderedSlotsByWeek[nextMonday]];

    // Dispos des joueurs (batch getAll sur les 2 semaines)
    const playerSlotsByWeek: Record<string, Record<string, Set<string>>> = {
      [currentMonday]: {},
      [nextMonday]: {},
    };
    for (const mid of memberIds) {
      playerSlotsByWeek[currentMonday][mid] = new Set();
      playerSlotsByWeek[nextMonday][mid] = new Set();
    }

    if (memberIds.length > 0) {
      const availEntries = memberIds.flatMap(mid =>
        weekMondays.map(m => ({
          uid: mid,
          mondayYmd: m,
          ref: db.collection('user_availability').doc(`${mid}_${getIsoWeekId(m)}`),
        }))
      );
      const snaps = await db.getAll(...availEntries.map(e => e.ref));
      snaps.forEach((snap, i) => {
        if (!snap.exists) return;
        const entry = availEntries[i];
        const data = snap.data();
        const slots = (data?.slots ?? []) as string[];
        const set = playerSlotsByWeek[entry.mondayYmd][entry.uid];
        for (const s of slots) set.add(s);
      });
    }

    // Events de la structure — on lit tout (capé à 200 comme l'API events)
    // puis on filtre en mémoire sur la fenêtre (2 semaines). Cette approche évite
    // une requête range sur startsAt qui nécessiterait un autre index composite.
    const windowStartMs = Date.parse(`${currentMonday}T00:00:00Z`) - 3 * 24 * 3600 * 1000;
    const windowEndMs = Date.parse(`${addDays(nextMonday, 7)}T00:00:00Z`) + 24 * 3600 * 1000;

    const evSnap = await db.collection('structure_events')
      .where('structureId', '==', structureId)
      .orderBy('startsAt', 'desc')
      .limit(200)
      .get();

    // Liste des membres de la structure (pour évaluer getInvitedUserIds sur scope=structure/game)
    const allMembersSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .get();
    const allMembers: MemberRef[] = allMembersSnap.docs.map(d => ({
      userId: d.data().userId as string,
      game: d.data().game as string | undefined,
    }));
    const teamsAsRefs: TeamRef[] = resolved.teams.map(t => ({
      id: t.id,
      playerIds: t.playerIds,
      subIds: t.subIds,
      staffIds: t.staffIds,
    }));

    const conflictSlotsByPlayer: Record<string, Set<string>> = {};
    for (const mid of memberIds) conflictSlotsByPlayer[mid] = new Set();

    const memberSet = new Set(memberIds);
    for (const doc of evSnap.docs) {
      const ev = doc.data();
      if (ev.status === 'cancelled') continue;
      const target = ev.target as EventTarget | undefined;
      if (!target) continue;

      // Filtrer en mémoire sur la fenêtre (semaine courante + suivante, avec buffer).
      // Defensive : quelques events legacy ont startsAt/endsAt en number ou string au lieu
      // de Timestamp — on skip silencieusement les entrées illisibles.
      const startMs = coerceToMillis(ev.startsAt);
      const endMs = coerceToMillis(ev.endsAt);
      if (startMs == null || endMs == null) continue;
      if (endMs <= windowStartMs) continue;
      if (startMs >= windowEndMs) continue;

      const invited = getInvitedUserIds(target, allMembers, teamsAsRefs);
      const relevant = invited.filter(mid => memberSet.has(mid));
      if (relevant.length === 0) continue;

      const startDate = new Date(startMs);
      const endDate = new Date(endMs);
      const startParis = parisIsoMinute(startDate);
      const endParis = parisIsoMinute(endDate);

      for (const slot of allSlots) {
        if (eventCoversSlot(startParis, endParis, slot)) {
          for (const mid of relevant) conflictSlotsByPlayer[mid].add(slot);
        }
      }
    }

    // Matching par semaine
    const weeks = weekMondays.map(mondayYmd => {
      const orderedSlots = orderedSlotsByWeek[mondayYmd];
      const playerSlots: Record<string, Set<string>> = {};
      for (const mid of memberIds) {
        playerSlots[mid] = playerSlotsByWeek[mondayYmd][mid] ?? new Set();
      }
      const blocks = findMatchBlocks({
        playerSlots,
        conflictSlotsByPlayer,
        orderedSlots,
        minPlayers: minPlayersForMatch,
        minDurationMinutes: minMatchDurationMinutes,
      });
      return {
        mondayYmd,
        weekId: getIsoWeekId(mondayYmd),
        blocks,
      };
    });

    // Enrichissement joueurs (profil affiché côté front)
    const usersById = await fetchDocsByIds(db, 'users', memberIds);
    const members = memberIds.map(mid => {
      const u = usersById.get(mid);
      return {
        uid: mid,
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        isTitulaire: ((teamData.playerIds as string[]) || []).includes(mid),
        slotsByWeek: {
          [currentMonday]: Array.from(playerSlotsByWeek[currentMonday][mid]).sort(),
          [nextMonday]: Array.from(playerSlotsByWeek[nextMonday][mid]).sort(),
        },
        conflictSlots: Array.from(conflictSlotsByPlayer[mid]).sort(),
      };
    });

    return NextResponse.json({
      team: {
        id: teamId,
        name: teamData.name,
        game: teamData.game,
        minPlayersForMatch,
        minMatchDurationMinutes,
      },
      today: todayYmd,
      weeks,
      members,
    });
  } catch (err) {
    captureApiError('API Structures/teams/availability GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
