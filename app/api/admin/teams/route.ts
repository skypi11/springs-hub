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
    if (statusFilter) query = query.where('status', '==', statusFilter);
    if (structureIdFilter) query = query.where('structureId', '==', structureIdFilter);
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
      return {
        id: doc.id,
        name: data.name ?? '',
        label: data.label ?? '',
        game: data.game ?? '',
        status: (data.status as 'active' | 'archived') ?? 'active',
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

    // Tri : structures actives d'abord, puis par structure+name
    teams.sort((a, b) => {
      if (a.structureName !== b.structureName) return a.structureName.localeCompare(b.structureName);
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      teams,
      truncated: snap.size >= MAX_TEAMS,
      max: MAX_TEAMS,
    });
  } catch (err) {
    captureApiError('API Admin/Teams GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
