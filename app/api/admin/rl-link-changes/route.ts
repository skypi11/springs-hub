// GET /api/admin/rl-link-changes — liste les demandes (pending d'abord).
// Lot 6 — voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { buildTrackerGgUrl } from '@/lib/rl-platform';

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
    const snap = await db.collection('rl_link_change_requests')
      .orderBy('createdAt', 'desc')
      .limit(200).get();

    const requests = snap.docs.map(d => {
      const data = d.data();
      const currentName = (data.currentEpicName as string) || '';
      const requestedName = (data.requestedEpicName as string) || '';
      return {
        id: d.id,
        userUid: data.userUid,
        userName: data.userName || '',
        currentEpicId: data.currentEpicId || '',
        currentEpicName: currentName,
        currentTrackerUrl: currentName ? buildTrackerGgUrl('epic', currentName) : '',
        requestedEpicId: data.requestedEpicId || '',
        requestedEpicName: requestedName,
        requestedTrackerUrl: requestedName ? buildTrackerGgUrl('epic', requestedName) : '',
        reason: data.reason || '',
        status: data.status || 'pending',
        createdAt: ts(data.createdAt),
        decidedAt: ts(data.decidedAt),
        decidedBy: data.decidedBy || null,
        adminNote: data.adminNote ?? null,
      };
    });

    return NextResponse.json({ requests });
  } catch (err) {
    captureApiError('API admin/rl-link-changes GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
