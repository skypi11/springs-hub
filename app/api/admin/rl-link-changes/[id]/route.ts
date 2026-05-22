// PATCH /api/admin/rl-link-changes/[id]
// Décide d'une demande de changement de compte Epic.
// Body : { decision: 'approve' | 'reject', note?: string }
// Si approve : met à jour le user (rlEpicId/rlEpicName) atomiquement avec le
// statut de la demande. Lot 6 — voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { isValidEpicId } from '@/lib/rl-identity';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const approve = body?.decision === 'approve';
    const note = clampString(typeof body?.note === 'string' ? body.note : '', 300);

    const db = getAdminDb();
    const reqRef = db.collection('rl_link_change_requests').doc(id);

    // Atomique : on relit la demande dans la transaction, on vérifie qu'elle
    // est encore pending, on update demande + user en même temps.
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) throw new Error('not_found');
      const data = snap.data()!;
      if (data.status !== 'pending') {
        throw new Error('already_decided');
      }

      const update: Record<string, unknown> = {
        status: approve ? 'approved' : 'rejected',
        decidedAt: FieldValue.serverTimestamp(),
        decidedBy: adminUid,
        adminNote: note || null,
      };
      tx.update(reqRef, update);

      if (approve) {
        const newId = data.requestedEpicId as string;
        const newName = (data.requestedEpicName as string) || '';
        if (!isValidEpicId(newId)) throw new Error('invalid_epic_id');
        const userRef = db.collection('users').doc(data.userUid as string);
        tx.update(userRef, {
          rlEpicId: newId,
          rlEpicName: newName,
          rlEpicLinkedAt: FieldValue.serverTimestamp(),
          rlEpicLinkSource: 'admin',
          rlPlatform: 'epic',
          rlPlatformId: newName,
        });
      }
      return {
        userUid: data.userUid as string,
        userName: (data.userName as string) || '',
        currentEpicName: (data.currentEpicName as string) || '',
        requestedEpicName: (data.requestedEpicName as string) || '',
      };
    });

    await writeAdminAuditLog(db, {
      action: approve ? 'rl_epic_link_change_approved' : 'rl_epic_link_change_rejected',
      adminUid,
      targetType: 'user',
      targetId: result.userUid,
      targetLabel: `${result.userName} — ${result.currentEpicName} → ${result.requestedEpicName}${note ? ` (${note})` : ''}`,
    });

    return NextResponse.json({ ok: true, decision: approve ? 'approved' : 'rejected' });
  } catch (err) {
    const msg = (err as Error)?.message;
    if (msg === 'not_found') return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    if (msg === 'already_decided') return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 409 });
    if (msg === 'invalid_epic_id') return NextResponse.json({ error: 'Nouvel ID Epic invalide' }, { status: 400 });
    captureApiError('API admin/rl-link-changes PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
