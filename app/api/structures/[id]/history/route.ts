import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/structures/[id]/history
// Journal d'appartenance : qui est passé par la structure, quand, pour combien de temps.
// Réservé aux dirigeants (fondateur / co-fondateur / manager).
// Phase 3 item N.

const MAX_ENTRIES = 200;

async function assertDirigeant(db: FirebaseFirestore.Firestore, structureId: string, uid: string) {
  const snap = await db.collection('structures').doc(structureId).get();
  if (!snap.exists) return { ok: false as const, status: 404, error: 'Structure introuvable' };
  const data = snap.data()!;
  const isFounder = data.founderId === uid;
  const isCoFounder = (data.coFounderIds ?? []).includes(uid);
  const isManager = (data.managerIds ?? []).includes(uid);
  if (!isFounder && !isCoFounder && !isManager) {
    return { ok: false as const, status: 403, error: 'Accès refusé' };
  }
  return { ok: true as const };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await context.params;
    const db = getAdminDb();

    const access = await assertDirigeant(db, structureId, uid);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    // Hard cap côté collection pour éviter de lire des volumes énormes sur de vieilles
    // structures. Pas d'orderBy Firestore (éviterait un index composite) — on trie
    // en mémoire côté serveur après enrichissement.
    const snap = await db.collection('structure_member_history')
      .where('structureId', '==', structureId)
      .limit(MAX_ENTRIES)
      .get();

    if (snap.empty) return NextResponse.json({ history: [] });

    // Enrichir avec les profils joueurs (batch via getAll)
    const userIds = Array.from(new Set(snap.docs.map(d => d.data().userId).filter(Boolean)));
    const refs = userIds.map(id => db.collection('users').doc(id));
    const userSnaps = refs.length > 0 ? await db.getAll(...refs) : [];
    const usersById = new Map<string, FirebaseFirestore.DocumentData>();
    for (const d of userSnaps) {
      if (d.exists) usersById.set(d.id, d.data() || {});
    }

    const history = snap.docs
      .slice()
      .sort((a, b) => {
        const am = a.data().joinedAt?.toMillis?.() ?? 0;
        const bm = b.data().joinedAt?.toMillis?.() ?? 0;
        return bm - am;
      })
      .map(d => {
      const data = d.data();
      const u = usersById.get(data.userId) || {};
      const joinedAt: number | null = data.joinedAt?.toMillis?.() ?? null;
      const leftAt: number | null = data.leftAt?.toMillis?.() ?? null;
      const durationDays = joinedAt && leftAt
        ? Math.max(1, Math.round((leftAt - joinedAt) / (1000 * 60 * 60 * 24)))
        : null;
      return {
        id: d.id,
        userId: data.userId,
        displayName: u.displayName || u.discordUsername || '',
        avatarUrl: u.avatarUrl || '',
        discordAvatar: u.discordAvatar || '',
        country: u.country || '',
        game: data.game || '',
        role: data.role || 'joueur',
        joinReason: data.joinReason || 'other',
        leftReason: data.leftReason || null,
        joinedAt,
        leftAt,
        durationDays,
        isOpen: leftAt === null,
      };
    });

    return NextResponse.json({ history });
  } catch (err) {
    captureApiError('API structure history GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
