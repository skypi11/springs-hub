import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';

const MAX_TEAMS = 1000;

// GET /api/admin/teams — vue cross-structures de toutes les sous-équipes.
// Filtres optionnels : game, status, structureId.
// Renvoie les champs nécessaires à l'affichage (pas le détail roster complet —
// pour ça l'admin clique dessus et on renvoie vers /community/structure/[id]).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const gameFilter = req.nextUrl.searchParams.get('game');
    const statusFilter = req.nextUrl.searchParams.get('status');
    const structureIdFilter = req.nextUrl.searchParams.get('structureId');

    let query: FirebaseFirestore.Query = db.collection('sub_teams');
    if (gameFilter) query = query.where('game', '==', gameFilter);
    if (structureIdFilter) query = query.where('structureId', '==', structureIdFilter);
    // On ne filtre PAS status côté serveur : les équipes créées avant Lot 1 n'ont
    // pas de champ `status` et seraient exclues par un `where('status','==','active')`.
    // Filtre appliqué en mémoire plus bas, avec fallback 'active' si le champ manque.
    const snap = await query.limit(MAX_TEAMS).get();

    // Charger toutes les structures référencées en un seul batch pour enrichir.
    const structureIds = Array.from(new Set(
      snap.docs.map(d => d.data().structureId).filter(Boolean) as string[]
    ));
    const structuresById = await fetchDocsByIds(db, 'structures', structureIds);

    const founderIds = Array.from(new Set(
      Array.from(structuresById.values())
        .map(s => s?.founderId as string | undefined)
        .filter((x): x is string => !!x)
    ));
    const foundersById = await fetchDocsByIds(db, 'users', founderIds);

    // Rassembler tous les UIDs roster pour un seul batch users (limite le coût
    // si 50+ équipes avec 5 membres chacune → 250 lookups → 5 batches de 50).
    const allMemberIds = new Set<string>();
    for (const doc of snap.docs) {
      const d = doc.data();
      for (const arr of [d.playerIds, d.subIds, d.staffIds]) {
        if (Array.isArray(arr)) for (const uid of arr) if (typeof uid === 'string') allMemberIds.add(uid);
      }
    }
    const membersById = await fetchDocsByIds(db, 'users', Array.from(allMemberIds));

    const teams = snap.docs.map(doc => {
      const data = doc.data();
      const structure = structuresById.get(data.structureId);
      const founderId = (structure?.founderId as string | undefined) ?? '';
      const founder = founderId ? foundersById.get(founderId) : null;
      const founderName = (founder?.displayName as string | undefined)
        || (founder?.discordUsername as string | undefined)
        || founderId;
      const players = (data.playerIds ?? []) as string[];
      const subs = (data.subIds ?? []) as string[];
      const staff = (data.staffIds ?? []) as string[];
      // Fallback : les équipes créées avant le Lot 1 (17/04/2026) n'ont pas de
      // champ `status` — on les considère `active` par défaut.
      const status: 'active' | 'archived' = data.status === 'archived' ? 'archived' : 'active';
      const toRef = (uid: string) => {
        const u = membersById.get(uid);
        return {
          uid,
          name: (u?.displayName as string | undefined)
            || (u?.discordUsername as string | undefined)
            || uid,
          avatar: (u?.avatarUrl as string | undefined)
            || (u?.discordAvatar as string | undefined)
            || '',
        };
      };
      return {
        id: doc.id,
        name: data.name ?? '',
        label: data.label ?? '',
        game: data.game ?? '',
        status,
        structureId: data.structureId ?? '',
        structureName: structure?.name ?? '',
        structureTag: structure?.tag ?? '',
        structureLogoUrl: structure?.logoUrl ?? '',
        structureStatus: structure?.status ?? null,
        founderId,
        founderName,
        players: players.map(toRef),
        subs: subs.map(toRef),
        staff: staff.map(toRef),
        playerCount: players.length,
        subCount: subs.length,
        staffCount: staff.length,
        totalRoster: players.length + subs.length + staff.length,
        logoUrl: data.logoUrl ?? '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        archivedAt: data.archivedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // Filtre status en mémoire (voir commentaire plus haut sur les docs legacy
    // sans champ `status`).
    const filtered = statusFilter
      ? teams.filter(t => t.status === statusFilter)
      : teams;

    // Tri : structures actives d'abord, puis par structure+name
    filtered.sort((a, b) => {
      if (a.structureName !== b.structureName) return a.structureName.localeCompare(b.structureName);
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      teams: filtered,
      truncated: snap.size >= MAX_TEAMS,
      max: MAX_TEAMS,
    });
  } catch (err) {
    captureApiError('API Admin/Teams GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
