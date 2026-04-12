import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/structures — liste publique des structures actives
export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const game = req.nextUrl.searchParams.get('game');

    // Charger structures + tous les memberships en parallèle (1 read pour tous les memberships)
    const [structuresSnap, allMembersSnap] = await Promise.all([
      db.collection('structures').where('status', '==', 'active').get(),
      db.collection('structure_members').get(),
    ]);

    // Compter les membres par structure une seule fois
    const memberCountByStructure = new Map<string, number>();
    for (const doc of allMembersSnap.docs) {
      const sid = doc.data().structureId;
      if (sid) memberCountByStructure.set(sid, (memberCountByStructure.get(sid) ?? 0) + 1);
    }

    const structures = [];
    for (const doc of structuresSnap.docs) {
      const data = doc.data();
      if (game && !(data.games || []).includes(game)) continue;

      structures.push({
        id: doc.id,
        name: data.name,
        tag: data.tag,
        logoUrl: data.logoUrl || '',
        games: data.games || [],
        recruiting: data.recruiting || { active: false, positions: [] },
        memberCount: memberCountByStructure.get(doc.id) ?? 0,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    // Trier par nombre de membres décroissant
    structures.sort((a, b) => b.memberCount - a.memberCount);

    return NextResponse.json({ structures });
  } catch (err) {
    console.error('[API Structures] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
