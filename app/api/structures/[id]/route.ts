import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { expiredDepartures } from '@/lib/structure-roles';

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

    let data = snap.data()!;

    // Structure suspendue = masquée publiquement
    if (data.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue' }, { status: 403 });
    }

    // Structure en attente = pas encore visible publiquement
    if (data.status === 'pending_validation' || data.status === 'rejected') {
      return NextResponse.json({ error: 'Structure non validée' }, { status: 403 });
    }

    // Lazy-process les préavis de départ de co-fondateurs expirés (pas de cron)
    const expired = expiredDepartures(data.coFounderDepartures as Record<string, unknown> | undefined);
    if (expired.length > 0) {
      const batch = db.batch();
      const structureRef = db.collection('structures').doc(id);
      const updates: Record<string, unknown> = {
        coFounderIds: FieldValue.arrayRemove(...expired),
        updatedAt: FieldValue.serverTimestamp(),
      };
      for (const u of expired) updates[`coFounderDepartures.${u}`] = FieldValue.delete();
      batch.update(structureRef, updates);
      for (const u of expired) {
        const mSnap = await db.collection('structure_members')
          .where('structureId', '==', id)
          .where('userId', '==', u)
          .get();
        for (const mDoc of mSnap.docs) batch.update(mDoc.ref, { role: 'joueur' });
      }
      await batch.commit();
      const nextCoFounderIds = (data.coFounderIds ?? []).filter((u: string) => !expired.includes(u));
      const nextDepartures = { ...((data.coFounderDepartures ?? {}) as Record<string, unknown>) };
      for (const u of expired) delete nextDepartures[u];
      data = { ...data, coFounderIds: nextCoFounderIds, coFounderDepartures: nextDepartures };
    }

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
