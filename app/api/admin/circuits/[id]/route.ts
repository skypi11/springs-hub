import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { validateCircuitPayload } from '@/lib/competitions/validate';

// Édition/suppression d'un circuit — admins Aedral complets uniquement (la
// configuration des compétitions n'est pas dans le périmètre du rôle scopé).

// PATCH /api/admin/circuits/[id] — édition, verrouillée après draft
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();
    const validated = validateCircuitPayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('circuits').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Circuit introuvable' }, { status: 404 });

    // Verrou d'édition : une fois le circuit sorti du draft (points écrits,
    // classement public), modifier le barème fausserait les standings. La
    // gestion post-publication (retirer un Qualif, etc.) arrive aux lots suivants.
    if (snap.data()?.status !== 'draft') {
      return NextResponse.json(
        { error: 'Circuit verrouillé : seuls les circuits en brouillon sont éditables au Lot 0.' },
        { status: 409 },
      );
    }

    // Le statut et competitionIds ne passent pas par ce PATCH : le statut
    // évolue avec les lots suivants, competitionIds est maintenu par le CRUD
    // compétitions (arrayUnion/arrayRemove).
    const { name, game, pointsScale, bestResultsCount, lanTeamCount, prizePool, tieBreakers } = validated.value;
    await ref.update({
      name, game, pointsScale, bestResultsCount, lanTeamCount, prizePool, tieBreakers,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAdminAuditLog(db, {
      action: 'circuit_edited',
      adminUid: uid,
      targetType: 'circuit',
      targetId: id,
      targetLabel: validated.value.name,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Circuits PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/admin/circuits/[id] — uniquement draft ET sans compétition rattachée
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection('circuits').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Circuit introuvable' }, { status: 404 });

    const data = snap.data() ?? {};
    if (data.status !== 'draft') {
      return NextResponse.json({ error: 'Seul un circuit en brouillon peut être supprimé.' }, { status: 409 });
    }
    const attached = (data.competitionIds ?? []) as string[];
    if (attached.length > 0) {
      return NextResponse.json(
        { error: `Ce circuit a ${attached.length} compétition(s) rattachée(s) : détache-les ou supprime-les d'abord.` },
        { status: 409 },
      );
    }

    await ref.delete();

    await writeAdminAuditLog(db, {
      action: 'circuit_deleted',
      adminUid: uid,
      targetType: 'circuit',
      targetId: id,
      targetLabel: (data.name as string) ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Circuits DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
