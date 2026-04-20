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

    const teams = snap.docs.map(doc => {
      const data = doc.data();
      const structure = structuresById.get(data.structureId);
      const players = (data.playerIds ?? []) as string[];
      const subs = (data.subIds ?? []) as string[];
      const staff = (data.staffIds ?? []) as string[];
      // Fallback : les équipes créées avant le Lot 1 (17/04/2026) n'ont pas de
      // champ `status` — on les considère `active` par défaut.
      const status: 'active' | 'archived' = data.status === 'archived' ? 'archived' : 'active';
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
