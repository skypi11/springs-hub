// PATCH /api/admin/valorant-link-changes/[id]
// Décide d'une demande de changement de compte Riot (Valorant).
// Body : { decision: 'approve' | 'reject', note?: string }
// Si approve : verrouille le user sur le nouveau PUUID + RiotID et re-sync son
// rang (best-effort via HenrikDev) atomiquement avec le statut de la demande.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { isValidPuuid } from '@/lib/valorant-identity';
import { fetchValorantMmr, fetchValorantAccountByPuuid } from '@/lib/valorant-henrikdev';

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
    const reqRef = db.collection('valorant_link_change_requests').doc(id);

    // Pré-lecture hors transaction pour récupérer le compte demandé et fetcher
    // son rang (appel réseau HenrikDev impossible proprement dans une tx). On
    // re-vérifie le statut `pending` DANS la transaction pour l'atomicité.
    const preSnap = await reqRef.get();
    if (!preSnap.exists) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    const preData = preSnap.data()!;
    if (preData.status !== 'pending') return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 409 });

    const requestedPuuid = (preData.requestedPuuid as string) || '';
    let requestedName = (preData.requestedName as string) || '';
    let requestedTag = (preData.requestedTag as string) || '';

    // Best-effort : récupère le rang du nouveau compte pour l'afficher tout de
    // suite. Si le RiotID stocké n'avait pas le tag (Discord l'avait omis), on
    // tente d'abord de le résoudre via le PUUID.
    let syncedRank: { rank: string; rr: number } | null = null;
    if (approve) {
      if (requestedPuuid && (!requestedName || !requestedTag)) {
        try {
          const acc = await fetchValorantAccountByPuuid(requestedPuuid);
          if (acc.ok) { requestedName = acc.data.name; requestedTag = acc.data.tag; }
        } catch { /* best-effort */ }
      }
      if (requestedName && requestedTag) {
        try {
          const res = await fetchValorantMmr({ name: requestedName, tag: requestedTag });
          if (res.ok) syncedRank = { rank: res.data.rank, rr: res.data.rr };
          else if (res.status === 404) syncedRank = { rank: 'Unranked', rr: 0 };
        } catch { /* best-effort, ignore */ }
      }
    }

    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(reqRef);
      if (!snap.exists) throw new Error('not_found');
      const data = snap.data()!;
      if (data.status !== 'pending') throw new Error('already_decided');

      tx.update(reqRef, {
        status: approve ? 'approved' : 'rejected',
        decidedAt: FieldValue.serverTimestamp(),
        decidedBy: adminUid,
        adminNote: note || null,
      });

      if (approve) {
        if (!isValidPuuid(requestedPuuid)) throw new Error('invalid_puuid');
        const userRef = db.collection('users').doc(data.userUid as string);
        const userUpdate: Record<string, unknown> = {
          valorantPuuid: requestedPuuid,
          valorantPuuidLinkedAt: FieldValue.serverTimestamp(),
          valorantRiotName: requestedName,
          valorantRiotTag: requestedTag,
        };
        if (syncedRank) {
          userUpdate.valorantRank = syncedRank.rank;
          userUpdate.valorantRR = syncedRank.rr;
          userUpdate.valorantRankSource = 'henrikdev';
          userUpdate.valorantRankSyncedAt = FieldValue.serverTimestamp();
        } else {
          // Re-sync échoué : on NEUTRALISE le rang hérité de l'ancien compte pour
          // ne pas l'attribuer (à tort, badgé « vérifié ») au nouveau compte. Le
          // profil affichera « non synchronisé » jusqu'au prochain passage du cron.
          userUpdate.valorantRank = '';
          userUpdate.valorantRR = FieldValue.delete();
          userUpdate.valorantRankSource = FieldValue.delete();
        }
        tx.update(userRef, userUpdate);
      }

      return {
        userUid: data.userUid as string,
        userName: (data.userName as string) || '',
        currentRiotId: (data.currentRiotId as string) || '',
        requestedRiotId: (data.requestedRiotId as string) || '',
      };
    });

    await writeAdminAuditLog(db, {
      action: approve ? 'valorant_link_change_approved' : 'valorant_link_change_rejected',
      adminUid,
      targetType: 'user',
      targetId: result.userUid,
      targetLabel: `${result.userName} [valorant], ${result.currentRiotId || '—'} → ${result.requestedRiotId || '—'}${note ? ` (${note})` : ''}`,
    });

    return NextResponse.json({ ok: true, decision: approve ? 'approved' : 'rejected' });
  } catch (err) {
    const msg = (err as Error)?.message;
    if (msg === 'not_found') return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
    if (msg === 'already_decided') return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 409 });
    if (msg === 'invalid_puuid') return NextResponse.json({ error: 'PUUID demandé invalide' }, { status: 400 });
    captureApiError('API admin/valorant-link-changes PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
