// PATCH /api/admin/rank-reports/[id]
// Marque un signalement comme résolu ou rejeté.
// Body : { resolution: 'resolved' | 'dismissed', note?: string }
// Voir docs/rl-rank-verification-plan.md (Lot 5).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';

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
    const resolution = body?.resolution === 'dismissed' ? 'dismissed' : 'resolved';
    const note = clampString(typeof body?.note === 'string' ? body.note : '', 300);

    const db = getAdminDb();
    const reportRef = db.collection('rank_reports').doc(id);
    const snap = await reportRef.get();
    if (!snap.exists) return NextResponse.json({ error: 'Signalement introuvable' }, { status: 404 });

    await reportRef.update({
      status: resolution,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: adminUid,
      resolution: note || null,
    });

    await writeAdminAuditLog(db, {
      action: 'rank_report_resolved',
      adminUid,
      targetType: 'user',
      targetId: snap.data()?.targetUid || id,
      targetLabel: `Signalement ${resolution} — ${snap.data()?.targetName || ''}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API admin/rank-reports PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
