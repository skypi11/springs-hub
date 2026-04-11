import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';

async function isAdmin(uid: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db.collection('admins').doc(uid).get();
  return snap.exists;
}

// GET /api/admin/users — lister tous les utilisateurs inscrits (admin only)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const snap = await db.collection('users').get();

    const users = snap.docs.map(doc => {
      const data = doc.data();
      return {
        uid: doc.id,
        displayName: data.displayName || data.discordUsername || '',
        discordUsername: data.discordUsername || '',
        discordAvatar: data.discordAvatar || '',
        avatarUrl: data.avatarUrl || '',
        country: data.country || '',
        games: data.games || [],
        isAvailableForRecruitment: data.isAvailableForRecruitment || false,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    // Trier par date de création (plus récent en premier)
    users.sort((a, b) => {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return NextResponse.json({ users, total: users.length });
  } catch (err) {
    console.error('[API Admin/Users] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
