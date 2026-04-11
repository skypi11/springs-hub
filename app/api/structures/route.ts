import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET /api/structures — liste publique des structures actives
export async function GET(req: NextRequest) {
  try {
    const db = getAdminDb();
    const game = req.nextUrl.searchParams.get('game');

    const snap = await db.collection('structures')
      .where('status', '==', 'active')
      .get();

    const structures = [];
    for (const doc of snap.docs) {
      const data = doc.data();

      // Filtre par jeu si demandé
      if (game && !(data.games || []).includes(game)) continue;

      // Compter les membres
      const membersSnap = await db.collection('structure_members')
        .where('structureId', '==', doc.id)
        .get();

      structures.push({
        id: doc.id,
        name: data.name,
        tag: data.tag,
        logoUrl: data.logoUrl || '',
        games: data.games || [],
        recruiting: data.recruiting || { active: false, positions: [] },
        memberCount: membersSnap.size,
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
