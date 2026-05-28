// GET /api/admin/rl-link-changes, liste les demandes (pending d'abord).
// Multi-plateforme : Epic + Steam. Lit les champs génériques avec fallback
// sur les anciens champs Epic-spécifiques.
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { buildTrackerGgUrl, type RLPlatform } from '@/lib/rl-platform';

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
      const platform = ((data.platform as string) || 'epic') as RLPlatform;
      // Champs génériques en priorité, fallback sur les anciens noms Epic
      const currentId = (data.currentLinkedId as string) || (data.currentEpicId as string) || '';
      const currentName = (data.currentLinkedName as string) || (data.currentEpicName as string) || '';
      const requestedId = (data.requestedLinkedId as string) || (data.requestedEpicId as string) || '';
      const requestedName = (data.requestedLinkedName as string) || (data.requestedEpicName as string) || '';
      // ID utilisé pour construire l'URL tracker : pseudo pour Epic, SteamID64 pour Steam
      const urlInputCurrent = platform === 'steam' ? currentId : currentName;
      const urlInputRequested = platform === 'steam' ? requestedId : requestedName;
      return {
        id: d.id,
        platform,
        userUid: data.userUid,
        userName: data.userName || '',
        currentLinkedId: currentId,
        currentLinkedName: currentName,
        currentTrackerUrl: urlInputCurrent ? buildTrackerGgUrl(platform, urlInputCurrent) : '',
        requestedLinkedId: requestedId,
        requestedLinkedName: requestedName,
        requestedTrackerUrl: urlInputRequested ? buildTrackerGgUrl(platform, urlInputRequested) : '',
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
