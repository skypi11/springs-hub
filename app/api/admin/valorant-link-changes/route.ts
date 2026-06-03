// GET /api/admin/valorant-link-changes, liste les demandes de changement de
// compte Riot (Valorant), pending d'abord. Miroir de rl-link-changes.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { buildValorantTrackerUrl } from '@/lib/valorant-identity';

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
    const snap = await db.collection('valorant_link_change_requests')
      .orderBy('createdAt', 'desc')
      .limit(200).get();

    const requests = snap.docs.map(d => {
      const data = d.data();
      const currentRiotId = (data.currentRiotId as string) || '';
      const requestedRiotId = (data.requestedRiotId as string) || '';
      return {
        id: d.id,
        userUid: data.userUid,
        userName: data.userName || '',
        currentRiotId,
        currentRank: (data.currentRank as string) || '',
        currentTrackerUrl: buildValorantTrackerUrl(currentRiotId),
        requestedRiotId,
        requestedTrackerUrl: buildValorantTrackerUrl(requestedRiotId),
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
    captureApiError('API admin/valorant-link-changes GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
