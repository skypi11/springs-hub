// GET /api/admin/rank-reports — liste les signalements (pending d'abord).
// Voir docs/rl-rank-verification-plan.md (Lot 5).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const snap = await db.collection('rank_reports')
      .orderBy('createdAt', 'desc')
      .limit(200).get();

    const reports = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        targetUid: data.targetUid,
        targetName: data.targetName || '',
        targetRlRank: data.targetRlRank || '',
        reporterUid: data.reporterUid,
        reporterName: data.reporterName || '',
        message: data.message ?? null,
        status: data.status || 'pending',
        createdAt: ts(data.createdAt),
        resolvedAt: ts(data.resolvedAt),
        resolvedBy: data.resolvedBy || null,
        resolution: data.resolution ?? null,
      };
    });

    return NextResponse.json({ reports });
  } catch (err) {
    captureApiError('API admin/rank-reports GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
