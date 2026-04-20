import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

// POST /api/admin/backfill-counters
// Recalcule `counters.teams` et `counters.members` pour toutes les structures
// en lisant l'état réel. À lancer une fois pour initialiser, puis plus jamais
// (les writes incrémentent/décrémentent désormais en direct).
//
// Idempotent : peut être relancé sans risque (il écrase avec la vraie valeur).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // Charger toutes les structures + agréger équipes + membres en parallèle.
    // Volume : une fois pour toutes au lancement, c'est acceptable.
    const [structuresSnap, teamsSnap, membersSnap] = await Promise.all([
      db.collection('structures').get(),
      db.collection('sub_teams').where('status', '==', 'active').get(),
      db.collection('structure_members').get(),
    ]);

    const teamsCountByStructure = new Map<string, number>();
    for (const doc of teamsSnap.docs) {
      const sid = doc.data().structureId as string | undefined;
      if (!sid) continue;
      teamsCountByStructure.set(sid, (teamsCountByStructure.get(sid) ?? 0) + 1);
    }

    const membersCountByStructure = new Map<string, number>();
    for (const doc of membersSnap.docs) {
      const sid = doc.data().structureId as string | undefined;
      if (!sid) continue;
      membersCountByStructure.set(sid, (membersCountByStructure.get(sid) ?? 0) + 1);
    }

    // Écriture en batches de 400 (limite Firestore : 500 opérations).
    const CHUNK = 400;
    const updates: { id: string; teams: number; members: number }[] = structuresSnap.docs.map(doc => ({
      id: doc.id,
      teams: teamsCountByStructure.get(doc.id) ?? 0,
      members: membersCountByStructure.get(doc.id) ?? 0,
    }));

    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = db.batch();
      for (const u of updates.slice(i, i + CHUNK)) {
        batch.update(db.collection('structures').doc(u.id), {
          counters: { teams: u.teams, members: u.members },
        });
      }
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      structuresUpdated: updates.length,
      totalTeams: Array.from(teamsCountByStructure.values()).reduce((a, b) => a + b, 0),
      totalMembers: Array.from(membersCountByStructure.values()).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    captureApiError('API Admin/BackfillCounters POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
