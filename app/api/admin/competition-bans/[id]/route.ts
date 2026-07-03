import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';

// PATCH /api/admin/competition-bans/[id] — révoquer un ban (jamais de delete :
// l'historique du registre fait foi, spec Legends §5).
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
    const ref = db.collection('competition_bans').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Ban introuvable.' }, { status: 404 });
    if (snap.data()?.revokedAt) {
      return NextResponse.json({ error: 'Ce ban est déjà révoqué.' }, { status: 409 });
    }

    await ref.update({
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: uid,
    });

    await writeAdminAuditLog(db, {
      action: 'competition_ban_revoked',
      adminUid: uid,
      targetType: snap.data()?.targetType === 'structure' ? 'structure' : 'user',
      targetId: (snap.data()?.targetId as string) ?? id,
      targetLabel: (snap.data()?.targetLabel as string) ?? null,
      metadata: { banId: id },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/CompetitionBans PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
