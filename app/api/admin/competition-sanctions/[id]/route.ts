import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';

// PATCH /api/admin/competition-sanctions/[id] — révoquer une sanction (jamais
// de delete : l'historique fait foi, il fonde l'escalade manuelle, spec §5).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    if (body.action !== 'revoke') {
      return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
    }

    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection('competition_sanctions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Sanction introuvable.' }, { status: 404 });
    if (snap.data()?.revokedAt) {
      return NextResponse.json({ error: 'Cette sanction est déjà révoquée.' }, { status: 409 });
    }

    await ref.update({ revokedAt: FieldValue.serverTimestamp(), revokedBy: uid });

    const tt = snap.data()?.targetType;
    await writeAdminAuditLog(db, {
      action: 'competition_sanction_revoked',
      adminUid: uid,
      targetType: tt === 'structure' ? 'structure' : tt === 'team' ? 'team' : 'user',
      targetId: (snap.data()?.targetId as string) ?? id,
      targetLabel: (snap.data()?.targetLabel as string) ?? null,
      metadata: { sanctionId: id, type: snap.data()?.type ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/CompetitionSanctions PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
