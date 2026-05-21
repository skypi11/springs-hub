import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/structures/[id] — page publique d'une structure
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const snap = await db.collection('structures').doc(id).get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const data = snap.data()!;

    // Structure suspendue = masquée publiquement
    if (data.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue' }, { status: 403 });
    }

    // Structure en attente = pas encore visible publiquement
    if (data.status === 'pending_validation' || data.status === 'rejected') {
      return NextResponse.json({ error: 'Structure non validée' }, { status: 403 });
    }

    // Note : le traitement des préavis de départ de co-fondateurs expirés est
    // fait par le cron quotidien /api/cron/expire-invitations — plus de write
    // dans ce GET public (anti-pattern + race condition supprimés).

    // Récupérer les membres puis tous les profils en un seul batch
    const membersSnap = await db.collection('structure_members')
      .where('structureId', '==', id)
      .get();

    const userIds = membersSnap.docs.map(d => d.data().userId).filter(Boolean);
    const usersById = await fetchDocsByIds(db, 'users', userIds);

    const members = membersSnap.docs.map(doc => {
      const memberData = doc.data();
      const u = usersById.get(memberData.userId);
      return {
        id: doc.id,
        userId: memberData.userId,
        game: memberData.game,
        role: memberData.role,
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        country: u?.country || '',
      };
    });

    // Stats vivantes : nombre d'events créés (tous types confondus) depuis toujours
    let eventsCount = 0;
    try {
      const eventsAgg = await db.collection('structure_events')
        .where('structureId', '==', id)
        .count()
        .get();
      eventsCount = eventsAgg.data().count || 0;
    } catch {
      // pas bloquant
    }

    const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : null;

    // Données publiques
    const structure = {
      id: snap.id,
      name: data.name,
      tag: data.tag,
      logoUrl: data.logoUrl || '',
      coverUrl: data.coverUrl || '',
      coverPositionY: typeof data.coverPositionY === 'number' ? data.coverPositionY : 50,
      description: data.description || '',
      games: data.games || [],
      discordUrl: data.discordUrl || '',
      socials: data.socials || {},
      recruiting: data.recruiting || { active: false, positions: [] },
      achievements: data.achievements || [],
      status: data.status,
      founderId: data.founderId,
      coFounderIds: data.coFounderIds ?? [],
      managerIds: data.managerIds ?? [],
      coachIds: data.coachIds ?? [],
      members,
      createdAtMs,
      eventsCount,
    };

    return NextResponse.json(structure);
  } catch (err) {
    captureApiError('API Structures/id GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
