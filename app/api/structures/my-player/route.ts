import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/structures/my-player
// Renvoie les structures où l'utilisateur est membre simple (joueur) — c.-à-d.
// ni fondateur, ni co-fondateur, ni manager, ni coach.
// Pour chaque structure : ses sous-équipes où il apparaît (titulaire / remplaçant),
// ses coéquipiers, et la liste des contacts staff (fondateur, co-fondateurs, managers, coaches).
//
// Utilisé par la vue joueur de /community/my-structure (PlayerStructureView).
// Un user peut tout à fait être joueur dans une structure ET staff d'une autre ;
// cette API ne renvoie que les structures où il est joueur uniquement.

type PublicUser = {
  uid: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

function pickPublicUser(uid: string, data: Record<string, unknown> | undefined): PublicUser {
  const d = (data ?? {}) as Record<string, string | undefined>;
  return {
    uid,
    displayName: d.displayName || d.discordUsername || '',
    discordUsername: d.discordUsername || '',
    discordAvatar: d.discordAvatar || '',
    avatarUrl: d.avatarUrl || '',
    country: d.country || '',
  };
}

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();

    // Toutes les appartenances de l'user (quelle que soit la structure)
    const memberSnap = await db.collection('structure_members')
      .where('userId', '==', uid)
      .get();

    if (memberSnap.empty) {
      return NextResponse.json({ structures: [] });
    }

    const structureIds = Array.from(new Set(
      memberSnap.docs.map(d => d.data().structureId as string).filter(Boolean)
    ));

    // Charger toutes les structures candidates
    const structuresById = await fetchDocsByIds(db, 'structures', structureIds);

    // Filtrer : uniquement celles où l'user est joueur (pas fondateur/co-fondateur/manager/coach)
    // + status === 'active' (on ne montre pas les structures en attente / suspendues au joueur)
    const playerStructureIds: string[] = [];
    for (const sid of structureIds) {
      const s = structuresById.get(sid);
      if (!s) continue;
      if (s.status !== 'active') continue;
      if (s.founderId === uid) continue;
      if ((s.coFounderIds ?? []).includes(uid)) continue;
      if ((s.managerIds ?? []).includes(uid)) continue;
      if ((s.coachIds ?? []).includes(uid)) continue;
      playerStructureIds.push(sid);
    }

    if (playerStructureIds.length === 0) {
      return NextResponse.json({ structures: [] });
    }

    // Charger tous les membres de ces structures en une seule fois
    // (max 2 structures par user en pratique → chunks de 30 largement suffisants)
    const allMembers = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (let i = 0; i < playerStructureIds.length; i += 30) {
      const chunk = playerStructureIds.slice(i, i + 30);
      const snap = await db.collection('structure_members')
        .where('structureId', 'in', chunk)
        .get();
      for (const mDoc of snap.docs) {
        const sid = mDoc.data().structureId as string;
        if (!allMembers.has(sid)) allMembers.set(sid, []);
        allMembers.get(sid)!.push(mDoc);
      }
    }

    // Charger toutes les sous-équipes de ces structures
    const allTeams = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (let i = 0; i < playerStructureIds.length; i += 30) {
      const chunk = playerStructureIds.slice(i, i + 30);
      const snap = await db.collection('sub_teams')
        .where('structureId', 'in', chunk)
        .get();
      for (const tDoc of snap.docs) {
        const sid = tDoc.data().structureId as string;
        if (!allTeams.has(sid)) allTeams.set(sid, []);
        allTeams.get(sid)!.push(tDoc);
      }
    }

    // Collecter tous les userIds à résoudre (membres + joueurs d'équipes + founderId + coFounders + managers + coaches)
    const userIds = new Set<string>();
    for (const sid of playerStructureIds) {
      const s = structuresById.get(sid)!;
      if (s.founderId) userIds.add(s.founderId as string);
      for (const u of (s.coFounderIds ?? []) as string[]) userIds.add(u);
      for (const u of (s.managerIds ?? []) as string[]) userIds.add(u);
      for (const u of (s.coachIds ?? []) as string[]) userIds.add(u);
      for (const mDoc of allMembers.get(sid) ?? []) {
        const mu = mDoc.data().userId as string;
        if (mu) userIds.add(mu);
      }
      for (const tDoc of allTeams.get(sid) ?? []) {
        for (const u of (tDoc.data().playerIds ?? []) as string[]) userIds.add(u);
        for (const u of (tDoc.data().subIds ?? []) as string[]) userIds.add(u);
        for (const u of (tDoc.data().staffIds ?? []) as string[]) userIds.add(u);
      }
    }

    const usersById = await fetchDocsByIds(db, 'users', Array.from(userIds));

    // Assembler la réponse
    const structures = playerStructureIds.map(sid => {
      const s = structuresById.get(sid)!;
      const teams = allTeams.get(sid) ?? [];

      // Équipes où l'user figure (titulaire ou remplaçant)
      const myTeams = teams
        .filter(t => {
          const d = t.data();
          return ((d.playerIds ?? []) as string[]).includes(uid)
            || ((d.subIds ?? []) as string[]).includes(uid);
        })
        .map(t => {
          const d = t.data();
          const playerIds = (d.playerIds ?? []) as string[];
          const subIds = (d.subIds ?? []) as string[];
          const staffIds = (d.staffIds ?? []) as string[];
          return {
            id: t.id,
            name: d.name as string,
            game: d.game as string,
            isTitulaire: playerIds.includes(uid),
            isSub: subIds.includes(uid),
            titulaires: playerIds.map(u => pickPublicUser(u, usersById.get(u))),
            subs: subIds.map(u => pickPublicUser(u, usersById.get(u))),
            staff: staffIds.map(u => pickPublicUser(u, usersById.get(u))),
          };
        });

      // Contacts staff au niveau structure
      const founder = pickPublicUser(s.founderId as string, usersById.get(s.founderId as string));
      const coFounders = ((s.coFounderIds ?? []) as string[])
        .map(u => pickPublicUser(u, usersById.get(u)));
      const managers = ((s.managerIds ?? []) as string[])
        .map(u => pickPublicUser(u, usersById.get(u)));
      const coaches = ((s.coachIds ?? []) as string[])
        .map(u => pickPublicUser(u, usersById.get(u)));

      // Mon rôle membre brut (si assigné via structure_members.role — legacy)
      const myMembership = (allMembers.get(sid) ?? []).find(m => m.data().userId === uid);
      const myMemberRole = (myMembership?.data().role as string | undefined) ?? 'joueur';

      // Nombre total de membres pour affichage (hero)
      const memberCount = (allMembers.get(sid) ?? []).length;

      return {
        id: sid,
        name: s.name as string,
        tag: s.tag as string,
        logoUrl: (s.logoUrl as string) || '',
        coverUrl: (s.coverUrl as string) || '',
        description: (s.description as string) || '',
        games: (s.games as string[]) || [],
        discordUrl: (s.discordUrl as string) || '',
        socials: (s.socials as Record<string, string>) || {},
        status: s.status as string,
        recruiting: (s.recruiting as { active: boolean; positions: unknown[] }) ?? { active: false, positions: [] },
        memberCount,
        myMemberRole,
        myTeams,
        founder,
        coFounders,
        managers,
        coaches,
        createdAt: (s.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ?? null,
      };
    });

    return NextResponse.json({ structures });
  } catch (err) {
    captureApiError('API Structures/my-player GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
