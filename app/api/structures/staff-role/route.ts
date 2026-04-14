import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// POST /api/structures/staff-role
// Body: { structureId, targetUserId, role: 'manager' | 'coach', enabled: boolean }
//
// Ajoute ou retire un membre de structures.managerIds / structures.coachIds.
// Ces deux champs sont des arrays indépendants : un même joueur peut être à la fois
// coach ET manager (multi-rôle). Le champ structure_members.role (joueur / co_fondateur /
// fondateur) reste inchangé — les rôles staff sont orthogonaux au rôle structurel.
//
// Droits : fondateur ET co-fondateurs peuvent assigner / retirer les rôles staff.
// Contrainte : la cible doit déjà être membre de la structure.

const ALLOWED_ROLES = new Set(['manager', 'coach']);

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId, targetUserId, role, enabled } = body;

    if (!structureId || !targetUserId || !role || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'structureId, targetUserId, role et enabled requis' },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Rôle invalide — manager ou coach seulement.' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const data = structureSnap.data()!;

    // Fondateurs ET co-fondateurs peuvent assigner coach/manager
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json(
        { error: 'Seuls les dirigeants peuvent assigner les rôles coach/manager.' },
        { status: 403 }
      );
    }
    if (data.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue — action bloquée.' }, { status: 403 });
    }

    // La cible doit être membre
    const memberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', targetUserId)
      .limit(1)
      .get();
    if (memberSnap.empty) {
      return NextResponse.json({ error: "Cet utilisateur n'est pas membre de la structure." }, { status: 400 });
    }

    const field = role === 'manager' ? 'managerIds' : 'coachIds';
    await structureRef.update({
      [field]: enabled ? FieldValue.arrayUnion(targetUserId) : FieldValue.arrayRemove(targetUserId),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/staff-role POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
