import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/admin/structures/[id]/members
// Renvoie la liste complète des membres d'une structure avec leur(s) rôle(s)
// dérivé(s) — utilisé par l'admin pour avoir un overview rapide.
//
// Marche pour TOUTES les structures (active, suspended, pending, rejected) —
// l'endpoint public /api/structures/[id] bloque pending/suspended donc l'admin
// n'a pas d'autre moyen de voir les membres d'une structure non active.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux admins Aedral' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();

    const structSnap = await db.collection('structures').doc(structureId).get();
    if (!structSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const sData = structSnap.data()!;
    const founderId = (sData.founderId as string) ?? '';
    const coFounderIds = (sData.coFounderIds as string[] | undefined) ?? [];
    const managerIds = (sData.managerIds as string[] | undefined) ?? [];
    const coachIds = (sData.coachIds as string[] | undefined) ?? [];

    // Membres listés dans structure_members (joueur/coach/manager assignés)
    const membersSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .get();

    type Row = {
      uid: string;
      game?: string;       // pour les rôles équipe (joueur)
      roles: string[];     // multi-rôles possibles (ex: fondateur ET joueur)
    };
    const byUid = new Map<string, Row>();
    const ensure = (u: string): Row => {
      let r = byUid.get(u);
      if (!r) { r = { uid: u, roles: [] }; byUid.set(u, r); }
      return r;
    };

    if (founderId) ensure(founderId).roles.push('fondateur');
    for (const c of coFounderIds) ensure(c).roles.push('co_fondateur');
    for (const m of managerIds) ensure(m).roles.push('responsable');
    for (const c of coachIds) ensure(c).roles.push('coach_structure');

    for (const doc of membersSnap.docs) {
      const d = doc.data();
      const u = (d.userId as string | undefined) ?? '';
      if (!u) continue;
      const row = ensure(u);
      const game = (d.game as string | undefined) ?? '';
      if (game && !row.game) row.game = game;
      const role = (d.role as string | undefined) ?? 'joueur';
      // structure_members.role contient typiquement 'joueur' (membres rattachés
      // à une équipe). On évite de doubler avec les rôles dirigeants déjà ajoutés.
      if (role && !row.roles.includes(role)) row.roles.push(role);
    }

    // Enrichissement profils en un batch
    const uids = Array.from(byUid.keys());
    const usersMap = await fetchDocsByIds(db, 'users', uids);

    // Ordre canonique des rôles pour l'affichage
    const ROLE_ORDER: Record<string, number> = {
      fondateur: 0, co_fondateur: 1, responsable: 2, coach_structure: 3,
      manager_equipe: 4, coach_equipe: 5, capitaine: 6, joueur: 7,
      remplacant: 8, membre: 9,
    };

    const members = uids.map(uid => {
      const u = usersMap.get(uid);
      const row = byUid.get(uid)!;
      // Tri des rôles : le plus haut placé d'abord
      row.roles.sort((a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99));
      return {
        uid,
        displayName: (u?.displayName as string | undefined)
          ?? (u?.discordUsername as string | undefined)
          ?? uid,
        slug: (u?.slug as string | undefined) ?? '',
        avatarUrl: (u?.avatarUrl as string | undefined)
          ?? (u?.discordAvatar as string | undefined)
          ?? '',
        country: (u?.country as string | undefined) ?? '',
        roles: row.roles,
        game: row.game ?? '',
      };
    });

    // Tri global : le rôle le plus haut d'abord, puis alpha
    members.sort((a, b) => {
      const ra = ROLE_ORDER[a.roles[0]] ?? 99;
      const rb = ROLE_ORDER[b.roles[0]] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.displayName.localeCompare(b.displayName);
    });

    return NextResponse.json({ members, total: members.length });
  } catch (err) {
    captureApiError('API admin/structures/[id]/members GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
