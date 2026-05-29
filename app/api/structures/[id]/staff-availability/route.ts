import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { isDirigeant } from '@/lib/event-permissions';
import {
  addDays,
  getMondayYmd,
  getIsoWeekId,
  parisYmd,
} from '@/lib/availability';

// GET /api/structures/[id]/staff-availability
// Dispos du pool STAFF d'une structure (vue dédiée onglet "STAFF" du calendrier).
// Validé Matt 2026-05-25 :
//   - Visible UNIQUEMENT pour responsable + dirigeants (sinon 403).
//   - Pool LARGE : fondateur + co-fondateurs + responsables (managerIds) +
//     coach structure (coachIds) + staff d'équipes (sub_teams.staffIds) +
//     capitaines (sub_teams.captainId). Évite de restreindre arbitrairement.
//   - Renvoie membres + dispos sur 2 semaines (courante + suivante), comme
//     l'API team-availability. Le client agrège en heatmap consensus.

export type StaffMemberRole = 'fondateur' | 'co_fondateur' | 'responsable' | 'coach_structure' | 'staff_team' | 'capitaine';

export interface StaffMemberEntry {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  roles: StaffMemberRole[]; // un user peut cumuler plusieurs rôles
  slotsByWeek: Record<string, string[]>;
}

export interface StaffAvailabilityResponse {
  today: string;
  weekMondays: string[];
  members: StaffMemberEntry[];
  minPlayersForStaffMatch: number;
}

const DEFAULT_MIN_STAFF = 2;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
    // Gate : dirigeant OU responsable
    if (!isDirigeant(resolved.context) && !resolved.context.isManager) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const struct = resolved.structure as {
      founderId?: string;
      coFounderIds?: string[];
      managerIds?: string[];
      coachIds?: string[];
    };

    // Construction du pool staff (multi-rôles possibles)
    const roleByUid = new Map<string, Set<StaffMemberRole>>();
    const addRole = (id: string, role: StaffMemberRole) => {
      if (!id) return;
      const s = roleByUid.get(id) ?? new Set<StaffMemberRole>();
      s.add(role);
      roleByUid.set(id, s);
    };
    if (struct.founderId) addRole(struct.founderId, 'fondateur');
    for (const u of struct.coFounderIds ?? []) addRole(u, 'co_fondateur');
    for (const u of struct.managerIds ?? []) addRole(u, 'responsable');
    for (const u of struct.coachIds ?? []) addRole(u, 'coach_structure');
    for (const t of resolved.teams) {
      for (const sId of (t.staffIds as string[] | undefined) ?? []) addRole(sId, 'staff_team');
      const captainId = t.captainId as string | undefined;
      if (captainId) addRole(captainId, 'capitaine');
    }

    const memberIds = Array.from(roleByUid.keys());
    if (memberIds.length === 0) {
      return NextResponse.json({
        today: parisYmd(new Date()),
        weekMondays: [],
        members: [],
        minPlayersForStaffMatch: typeof struct === 'object'
          ? ((resolved.structure as { minPlayersForStaffMatch?: number }).minPlayersForStaffMatch ?? DEFAULT_MIN_STAFF)
          : DEFAULT_MIN_STAFF,
      });
    }

    // Fenêtre : semaine courante + suivante (comme team-availability)
    const todayYmd = parisYmd(new Date());
    const currentMonday = getMondayYmd(todayYmd);
    const nextMonday = addDays(currentMonday, 7);
    const weekMondays = [currentMonday, nextMonday];

    // Batch read des dispos
    const availEntries = memberIds.flatMap(mid =>
      weekMondays.map(m => ({
        uid: mid,
        mondayYmd: m,
        ref: db.collection('user_availability').doc(`${mid}_${getIsoWeekId(m)}`),
      })),
    );
    const snaps = await db.getAll(...availEntries.map(e => e.ref));
    const slotsByUidAndWeek: Record<string, Record<string, string[]>> = {};
    for (const id of memberIds) {
      slotsByUidAndWeek[id] = { [currentMonday]: [], [nextMonday]: [] };
    }
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const entry = availEntries[i];
      const slots = (snap.data()?.slots ?? []) as string[];
      slotsByUidAndWeek[entry.uid][entry.mondayYmd] = slots;
    });

    // Enrichi via users docs (displayName, avatar)
    const usersById = await fetchDocsByIds(db, 'users', memberIds);

    const members: StaffMemberEntry[] = memberIds.map(id => {
      const u = usersById.get(id);
      return {
        uid: id,
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        roles: Array.from(roleByUid.get(id) ?? []),
        slotsByWeek: slotsByUidAndWeek[id],
      };
    });

    const minPlayersForStaffMatch = (resolved.structure as { minPlayersForStaffMatch?: number }).minPlayersForStaffMatch ?? DEFAULT_MIN_STAFF;

    return NextResponse.json({
      today: todayYmd,
      weekMondays,
      members,
      minPlayersForStaffMatch,
    });
  } catch (err) {
    captureApiError('API structures/staff-availability GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/staff-availability, update minPlayersForStaffMatch
// Réservé aux dirigeants.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
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
    if (!isDirigeant(resolved.context)) {
      return NextResponse.json({ error: 'Réservé aux dirigeants' }, { status: 403 });
    }

    const body = await req.json();
    const mp = typeof body.minPlayersForStaffMatch === 'number' ? body.minPlayersForStaffMatch : null;
    if (mp === null || !Number.isInteger(mp) || mp < 1 || mp > 20) {
      return NextResponse.json({ error: 'minPlayersForStaffMatch doit être un entier entre 1 et 20.' }, { status: 400 });
    }

    await db.collection('structures').doc(structureId).update({
      minPlayersForStaffMatch: mp,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API structures/staff-availability POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
