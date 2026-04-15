import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Shortlist = favoris de joueurs suivis par une structure (Phase 3 item L).
// Stockage : subcollection `structures/{id}/shortlist/{userId}`.
// Accès : dirigeants (founder / co-founder / manager) uniquement.

const MAX_SHORTLIST = 50;
const MAX_NOTE_LENGTH = 280;

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
  return { ok: true as const, structure: data };
}

// GET /api/structures/[id]/shortlist
// Retourne la shortlist enrichie pour une structure (dirigeant only).
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

    const shortlistSnap = await db
      .collection('structures').doc(structureId)
      .collection('shortlist')
      .get();

    if (shortlistSnap.empty) {
      return NextResponse.json({ shortlist: [] });
    }

    const userIds = shortlistSnap.docs.map(d => d.id);
    const meta = new Map<string, { addedAt: number | null; addedBy: string; note: string }>();
    for (const d of shortlistSnap.docs) {
      const data = d.data();
      meta.set(d.id, {
        addedAt: data.addedAt?.toMillis?.() ?? null,
        addedBy: data.addedBy || '',
        note: data.note || '',
      });
    }

    // Fetch user profiles en batch (Firestore limite à 30 ids par IN query)
    const items: Array<{
      uid: string;
      displayName: string;
      avatarUrl: string;
      discordAvatar: string;
      country: string;
      games: string[];
      recruitmentRole: string;
      isAvailableForRecruitment: boolean;
      rlRank: string;
      rlMmr: number | null;
      pseudoTM: string;
      addedAt: number | null;
      addedBy: string;
      note: string;
    }> = [];

    // Shortlist est capée à 50 → getAll est largement OK
    const refs = userIds.map(id => db.collection('users').doc(id));
    const userSnaps = await db.getAll(...refs);
    for (const d of userSnaps) {
      if (!d.exists) continue;
      const u = d.data() || {};
      const m = meta.get(d.id)!;
      items.push({
        uid: d.id,
        displayName: u.displayName || u.discordUsername || '',
        avatarUrl: u.avatarUrl || '',
        discordAvatar: u.discordAvatar || '',
        country: u.country || '',
        games: u.games || [],
        recruitmentRole: u.recruitmentRole || '',
        isAvailableForRecruitment: u.isAvailableForRecruitment === true,
        rlRank: u.rlStats?.rank || u.rlRank || '',
        rlMmr: u.rlStats?.mmr || u.rlMmr || null,
        pseudoTM: u.pseudoTM || '',
        addedAt: m.addedAt,
        addedBy: m.addedBy,
        note: m.note,
      });
    }

    // Tri : plus récemment ajouté en premier
    items.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

    return NextResponse.json({ shortlist: items });
  } catch (err) {
    captureApiError('API shortlist GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/shortlist
// Body: { userId: string, note?: string }
// Ajoute un joueur à la shortlist (idempotent).
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '';
    if (!targetUserId) {
      return NextResponse.json({ error: 'userId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const access = await assertDirigeant(db, structureId, uid);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    // Cap
    const existing = await db
      .collection('structures').doc(structureId)
      .collection('shortlist')
      .count()
      .get();
    const currentCount = existing.data().count;
    const alreadyIn = await db
      .collection('structures').doc(structureId)
      .collection('shortlist').doc(targetUserId)
      .get();
    if (!alreadyIn.exists && currentCount >= MAX_SHORTLIST) {
      return NextResponse.json(
        { error: `Shortlist limitée à ${MAX_SHORTLIST} joueurs` },
        { status: 400 },
      );
    }

    // Vérifier que la cible est un utilisateur valide
    const userSnap = await db.collection('users').doc(targetUserId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }

    await db
      .collection('structures').doc(structureId)
      .collection('shortlist').doc(targetUserId)
      .set({
        addedAt: FieldValue.serverTimestamp(),
        addedBy: uid,
        note,
      }, { merge: false });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API shortlist POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/shortlist?userId=X
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await context.params;
    const { searchParams } = new URL(req.url);
    const targetUserId = (searchParams.get('userId') || '').trim();
    if (!targetUserId) {
      return NextResponse.json({ error: 'userId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const access = await assertDirigeant(db, structureId, uid);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    await db
      .collection('structures').doc(structureId)
      .collection('shortlist').doc(targetUserId)
      .delete();

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API shortlist DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
