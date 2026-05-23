// GET /api/admin/rank-reports — liste les signalements (pending d'abord) +
// stats par reporter pour repérer les abusifs.
// Voir docs/rl-rank-verification-plan.md (Lot 5 v2).

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
    // On tire un large échantillon pour pouvoir aussi calculer les stats par
    // reporter en mémoire (économise N+1 queries). 500 suffit largement à notre
    // échelle ; au-delà on changera de stratégie.
    const snap = await db.collection('rank_reports')
      .orderBy('createdAt', 'desc')
      .limit(500).get();

    // Agrégation par reporter : total + count par statut
    const statsByReporter = new Map<string, { total: number; resolved: number; dismissed: number; pending: number }>();
    for (const d of snap.docs) {
      const r = d.data();
      const rid = r.reporterUid as string | undefined;
      if (!rid) continue;
      const s = statsByReporter.get(rid) ?? { total: 0, resolved: 0, dismissed: 0, pending: 0 };
      s.total++;
      const status = r.status as string;
      if (status === 'resolved') s.resolved++;
      else if (status === 'dismissed') s.dismissed++;
      else s.pending++;
      statsByReporter.set(rid, s);
    }

    // On ne renvoie que les 200 reports les plus récents — mais les stats
    // utilisent les 500 (plus de précision sur l'historique du reporter).
    const reports = snap.docs.slice(0, 200).map(d => {
      const data = d.data();
      const rid = data.reporterUid as string;
      const reporterStats = statsByReporter.get(rid) ?? { total: 1, resolved: 0, dismissed: 0, pending: 0 };
      return {
        id: d.id,
        targetUid: data.targetUid,
        targetName: data.targetName || '',
        targetRlRank: data.targetRlRank || '',
        reporterUid: rid,
        reporterName: data.reporterName || '',
        motif: (data.motif as string) || 'rank_lie', // fallback legacy avant Lot 5 v2
        message: data.message ?? null,
        status: data.status || 'pending',
        createdAt: ts(data.createdAt),
        resolvedAt: ts(data.resolvedAt),
        resolvedBy: data.resolvedBy || null,
        resolution: data.resolution ?? null,
        reporterStats,
      };
    });

    return NextResponse.json({ reports });
  } catch (err) {
    captureApiError('API admin/rank-reports GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
