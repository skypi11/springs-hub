import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { computeMemberRole, type MemberRoleTeam, type PrimaryRole, type TeamAffiliation } from '@/lib/member-role';

// GET /api/players — annuaire public paginé.
//
// Architecture scalable : pagination cursor + enrichissement par batch.
// Coût par PAGE (50 users), pas par TOTAL. Scale infiniment.
//
// Étapes par requête :
//   1. Query users avec filtres Firestore (where) + cursor (startAfter) + limit
//   2. Collecte uniqueStructureIds depuis structurePerGame de la page
//   3. Batch fetch structures (where __name__ IN chunks de 30)
//   4. Batch fetch sub_teams (where structureId IN chunks de 30)
//   5. Pour chaque user, enrichi via computeMemberRole → role + affiliations
//
// Query params :
//   - game = 'rocket_league' | 'trackmania' (filtre array-contains)
//   - recruiting = 'true' (filtre isAvailableForRecruitment)
//   - verifiedOnly = 'true' (RL : exclut les non-vérifiés)
//   - country = code ISO (filtre exact)
//   - cursor = uid du dernier user de la page précédente (startAfter)
//   - limit = nb par page (default 50, max 100)
//
// Réponse :
//   {
//     players: PlayerCard[],
//     nextCursor: string | null,  // null = plus rien après
//     pageSize: number,
//   }

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const FIRESTORE_IN_CHUNK = 30; // limite Firestore `in` queries

export type EnrichedStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  games: string[];               // ['rocket_league', 'trackmania'] — agrégés si l'user est dans cette struct sur plusieurs jeux
  primaryRole: PrimaryRole;      // dérivé via computeMemberRole (même rôle quel que soit le jeu)
  affiliations: TeamAffiliation[]; // équipes de cette structure où l'user est actif (tous jeux confondus)
};

export type PlayerCard = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  games: string[];
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  rlRank: string;
  rlIconUrl: string;
  rlAccountVerified: boolean;
  rlAccountName: string;
  rlAccountPlatform: 'epic' | 'steam' | '';
  rlSteamId64: string;
  pseudoTM: string;
  structures: EnrichedStructure[];
  createdAt: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
    if (blocked) return blocked;

    const db = getAdminDb();
    const { searchParams } = req.nextUrl;
    const game = searchParams.get('game');
    const recruitingOnly = searchParams.get('recruiting') === 'true';
    const verifiedOnly = searchParams.get('verifiedOnly') === 'true';
    const country = searchParams.get('country');
    const cursor = searchParams.get('cursor');
    const limitParam = parseInt(searchParams.get('limit') ?? '', 10);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_PAGE_SIZE,
    );

    // Tri par __name__ (== uid). Stable, indexé auto, supporte cursor.
    let query: FirebaseFirestore.Query = db.collection('users').orderBy('__name__');

    if (recruitingOnly) {
      query = query.where('isAvailableForRecruitment', '==', true);
    }
    if (game) {
      query = query.where('games', 'array-contains', game);
    }
    if (country) {
      query = query.where('country', '==', country);
    }

    if (cursor) {
      const cursorDoc = await db.collection('users').doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    query = query.limit(pageSize);
    const snap = await query.get();
    const isDevEnv = process.env.NODE_ENV === 'development';

    // Filtre les comptes dev en prod (post-query car pas indexé)
    const userDocs = snap.docs.filter(d => {
      const data = d.data();
      if (data.isDev === true && !isDevEnv) return false;
      // verifiedOnly côté serveur : si le user joue à RL ET pas vérifié → exclu
      if (verifiedOnly) {
        const games = (data.games as string[]) ?? [];
        const isVerified = !!data.rlEpicId || !!data.rlSteamId;
        if (games.includes('rocket_league') && !isVerified) return false;
      }
      return true;
    });

    // ── Enrichissement structures / équipes / rôles ────────────────────────
    // Deux sources combinées pour ne rater aucun lien user ↔ structure :
    //   1. `structure_members` (where userId IN chunks) — couvre les joueurs
    //      et la plupart des rôles, mais pas forcément les fondateurs anciens
    //      validés avant le fix de écriture systématique du doc.
    //   2. `structures where founderId IN chunks` — garantit qu'on trouve TOUTES
    //      les structures fondées par les users de la page, même sans
    //      structure_members existant. Les jeux sont dérivés depuis structure.games.
    const userIds = userDocs.map(d => d.id);
    const [membershipsByUser, foundedByUser] = await Promise.all([
      fetchMembershipsForUsers(db, userIds),
      fetchFoundedStructuresForUsers(db, userIds),
    ]);

    // Collecte les structureIds uniques de cette page depuis les deux sources.
    const uniqueStructureIds = new Set<string>();
    for (const list of membershipsByUser.values()) {
      for (const m of list) uniqueStructureIds.add(m.structureId);
    }
    for (const list of foundedByUser.values()) {
      for (const f of list) uniqueStructureIds.add(f.structureId);
    }

    // Batch fetch structures (chunks de 30 pour la limite Firestore `in`)
    const structuresById = await fetchDocsByIds(db, 'structures', [...uniqueStructureIds]);

    // Batch fetch sub_teams pour ces structures
    // (where structureId IN [...]) — chunks de 30
    const teamsByStructureId = await fetchTeamsForStructures(db, [...uniqueStructureIds]);

    const players: PlayerCard[] = userDocs.map(doc => {
      const data = doc.data();
      const uid = doc.id;

      // Dérive le mapping game → structureId depuis structure_members.
      // Puis complète avec les structures fondées (cas où le doc structure_members
      // manque — vieux fondateurs). Les structures fondées priorisent : un user
      // qui est fondateur d'une structure ET joueur d'une autre sur le même jeu
      // verra sa structure fondée comme principale.
      const memberships = membershipsByUser.get(uid) ?? [];
      const founded = foundedByUser.get(uid) ?? [];
      const structurePerGame: Record<string, string> = {};
      for (const f of founded) {
        for (const g of f.games) {
          if (g && f.structureId) structurePerGame[g] = f.structureId;
        }
      }
      for (const m of memberships) {
        if (m.game && m.structureId && !structurePerGame[m.game]) {
          structurePerGame[m.game] = m.structureId;
        }
      }

      // Enrichi par structure rejointe par ce user.
      // DÉDUPLIQUE par structureId — si l'user est dans la même structure pour
      // plusieurs jeux (RL + TM), on agrège les `games` et les `affiliations`
      // (équipes) en UNE seule entrée par structure. Sans ça, l'UI affichait
      // 2x la même structure (ex: "Fondateur ADL" + "Fondateur ADL").
      const structureMap = new Map<string, EnrichedStructure>();
      for (const [g, sid] of Object.entries(structurePerGame)) {
        if (!sid) continue;
        const s = structuresById.get(sid);
        if (!s) continue;
        const allTeams = teamsByStructureId.get(sid) ?? [];
        // Filtre équipes du même jeu (les sub_teams ont un champ `game`)
        const teamsForGame = allTeams.filter(t => (t.game ?? '') === g);

        const role = computeMemberRole({
          userId: uid,
          founderId: (s.founderId as string) ?? '',
          coFounderIds: (s.coFounderIds as string[]) ?? [],
          managerIds: (s.managerIds as string[]) ?? [],
          coachIds: (s.coachIds as string[]) ?? [],
          teams: teamsForGame.map(t => ({
            id: t.id,
            name: (t.name as string) ?? 'Équipe',
            playerIds: (t.playerIds as string[]) ?? [],
            subIds: (t.subIds as string[]) ?? [],
            staffIds: (t.staffIds as string[]) ?? [],
            staffRoles: (t.staffRoles as Record<string, 'coach' | 'manager'>) ?? {},
            captainId: (t.captainId as string | null) ?? null,
            status: t.status as 'active' | 'archived' | undefined,
          })),
        });

        const existing = structureMap.get(sid);
        if (existing) {
          // Merge : ajout du jeu + concat des affiliations (dédup par teamId)
          if (!existing.games.includes(g)) existing.games.push(g);
          const seenTeamIds = new Set(existing.affiliations.map(a => a.teamId));
          for (const aff of role.affiliations) {
            if (!seenTeamIds.has(aff.teamId)) {
              existing.affiliations.push(aff);
              seenTeamIds.add(aff.teamId);
            }
          }
          // primaryRole : on garde le plus haut (mais structure-level role est
          // identique pour les 2 jeux, donc rarement différent)
        } else {
          structureMap.set(sid, {
            id: sid,
            name: (s.name as string) ?? '',
            tag: (s.tag as string) ?? '',
            logoUrl: (s.logoUrl as string) ?? '',
            games: [g],
            primaryRole: role.primary,
            affiliations: [...role.affiliations],
          });
        }
      }
      const enrichedStructures = Array.from(structureMap.values());

      return {
        uid,
        displayName: (data.displayName as string) || (data.discordUsername as string) || '',
        discordAvatar: (data.discordAvatar as string) || '',
        avatarUrl: (data.avatarUrl as string) || '',
        country: (data.country as string) || '',
        games: (data.games as string[]) || [],
        isAvailableForRecruitment: (data.isAvailableForRecruitment as boolean) || false,
        recruitmentRole: (data.recruitmentRole as string) || '',
        recruitmentMessage: (data.recruitmentMessage as string) || '',
        rlRank: (data.rlRank as string) || '',
        rlIconUrl: (data.rlStats as { iconUrl?: string } | undefined)?.iconUrl || '',
        rlAccountVerified: !!data.rlEpicId || !!data.rlSteamId,
        rlAccountName: data.rlEpicId
          ? ((data.rlEpicName as string) || '')
          : data.rlSteamId
            ? ((data.rlSteamName as string) || '')
            : '',
        rlAccountPlatform: (data.rlEpicId ? 'epic' : data.rlSteamId ? 'steam' : '') as 'epic' | 'steam' | '',
        rlSteamId64: !data.rlEpicId && data.rlSteamId ? (data.rlSteamId as string) : '',
        pseudoTM: (data.pseudoTM as string) || '',
        structures: enrichedStructures,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // nextCursor = uid du dernier user retourné, ou null si page incomplète
    const nextCursor = snap.docs.length < pageSize
      ? null
      : snap.docs[snap.docs.length - 1].id;

    return NextResponse.json({
      players,
      nextCursor,
      pageSize,
    });
  } catch (err) {
    captureApiError('API Players GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Récupère les structures fondées par chaque user (founderId IN chunks de 30).
// Indispensable car certains anciens fondateurs n'ont pas de doc
// `structure_members` (le fix a été mis en place rétroactivement). On
// dérive les jeux depuis `structure.games` pour reconstruire le mapping
// game → structureId.
async function fetchFoundedStructuresForUsers(
  db: Firestore,
  userIds: string[],
): Promise<Map<string, Array<{ structureId: string; games: string[] }>>> {
  const result = new Map<string, Array<{ structureId: string; games: string[] }>>();
  if (userIds.length === 0) return result;

  for (let i = 0; i < userIds.length; i += FIRESTORE_IN_CHUNK) {
    const chunk = userIds.slice(i, i + FIRESTORE_IN_CHUNK);
    const snap = await db.collection('structures')
      .where('founderId', 'in', chunk)
      .get();
    for (const d of snap.docs) {
      const data = d.data();
      const uid = data.founderId as string;
      if (!uid) continue;
      // Exclut les structures non actives (pending_validation, rejected, suspended)
      if (data.status && data.status !== 'active') continue;
      const games = Array.isArray(data.games) ? (data.games as string[]) : [];
      const list = result.get(uid) ?? [];
      list.push({ structureId: d.id, games });
      result.set(uid, list);
    }
  }
  return result;
}

// Récupère les memberships actifs des users en paramètre, groupés par userId.
// Une seule query par chunk de 30 grâce à `where IN` Firestore sur `userId`.
async function fetchMembershipsForUsers(
  db: Firestore,
  userIds: string[],
): Promise<Map<string, Array<{ structureId: string; game: string }>>> {
  const result = new Map<string, Array<{ structureId: string; game: string }>>();
  if (userIds.length === 0) return result;

  for (let i = 0; i < userIds.length; i += FIRESTORE_IN_CHUNK) {
    const chunk = userIds.slice(i, i + FIRESTORE_IN_CHUNK);
    const snap = await db.collection('structure_members')
      .where('userId', 'in', chunk)
      .get();
    for (const d of snap.docs) {
      const data = d.data();
      const uid = data.userId as string;
      const structureId = data.structureId as string;
      const game = (data.game as string) || '';
      if (!uid || !structureId || !game) continue;
      const list = result.get(uid) ?? [];
      list.push({ structureId, game });
      result.set(uid, list);
    }
  }
  return result;
}

// Récupère toutes les sub_teams des structures en paramètre, groupées par
// structureId. Une seule query par chunk de 30 grâce à `where IN` Firestore.
async function fetchTeamsForStructures(
  db: Firestore,
  structureIds: string[],
): Promise<Map<string, Array<MemberRoleTeam & { id: string; game?: string }>>> {
  const result = new Map<string, Array<MemberRoleTeam & { id: string; game?: string }>>();
  if (structureIds.length === 0) return result;

  for (let i = 0; i < structureIds.length; i += FIRESTORE_IN_CHUNK) {
    const chunk = structureIds.slice(i, i + FIRESTORE_IN_CHUNK);
    const snap = await db.collection('sub_teams')
      .where('structureId', 'in', chunk)
      .get();
    for (const d of snap.docs) {
      const data = d.data();
      const sid = data.structureId as string;
      const team: MemberRoleTeam & { id: string; game?: string } = {
        id: d.id,
        name: (data.name as string) ?? 'Équipe',
        playerIds: (data.playerIds as string[]) ?? [],
        subIds: (data.subIds as string[]) ?? [],
        staffIds: (data.staffIds as string[]) ?? [],
        staffRoles: (data.staffRoles as Record<string, 'coach' | 'manager'>) ?? {},
        captainId: (data.captainId as string | null) ?? null,
        status: data.status as 'active' | 'archived' | undefined,
        game: data.game as string | undefined,
      };
      const list = result.get(sid) ?? [];
      list.push(team);
      result.set(sid, list);
    }
  }
  return result;
}
