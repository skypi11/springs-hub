// PATCH /api/admin/rank-reports/[id]
// Body : { resolution: 'resolved' | 'dismissed', note?: string }
// Voir docs/rl-rank-verification-plan.md (Lot 5 v2 — système anti-mensonge).
//
// Action selon le couple (resolution, motif) :
//   resolved + rank_lie → efface user.rlRank, notif in-app, DM Discord bot.
//   resolved + smurf    → pose user.suspectedSmurfFlag (admin-only), aucune
//                         action visible côté joueur (on n'alerte pas le smurf
//                         qu'on enquête).
//   dismissed           → marque le signalement non fondé. Incrémente
//                         implicitement le compteur d'abus du reporter (3
//                         rejetés en 30j = blocage auto à l'API rank-report).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { createNotification } from '@/lib/notifications';
import { sendRankContestedDM } from '@/lib/discord-bot';

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
    const report = snap.data()!;
    const motif = (report.motif as string) || 'rank_lie';
    const targetUid = report.targetUid as string;

    // 1) Marquer le signalement comme traité (atomique pour toutes les voies)
    await reportRef.update({
      status: resolution,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: adminUid,
      resolution: note || null,
    });

    const extraInfo: Record<string, unknown> = {};

    // 2) Effets de bord côté target selon (resolution × motif)
    if (resolution === 'resolved' && targetUid) {
      if (motif === 'smurf') {
        // Pose le flag smurf dans user_admin_flags (collection server-only) —
        // pas sur le user doc qui est readable par tout user authentifié, ce
        // qui leakerait le flag via Firestore client direct.
        await db.collection('user_admin_flags').doc(targetUid).set({
          suspectedSmurf: {
            flaggedAt: FieldValue.serverTimestamp(),
            flaggedBy: adminUid,
            reportId: id,
            note: note || null,
          },
        }, { merge: true });
        extraInfo.targetUpdated = 'smurf_flag_set';
      } else {
        // motif rank_lie (ou inconnu → on traite comme rank_lie par défaut) :
        // efface le rang, notif in-app, et DM Discord (best-effort).
        await db.collection('users').doc(targetUid).update({
          rlRank: '',
          rlRankChangedAt: FieldValue.serverTimestamp(),
        });
        extraInfo.targetUpdated = 'rank_cleared';

        // Notif in-app (best-effort, on log mais on ne casse pas la résolution)
        try {
          await createNotification(db, {
            userId: targetUid,
            type: 'rank_contested',
            title: 'Ton rang Rocket League a été retiré',
            message: "Un admin a confirmé un signalement sur ton rang. Pour le réafficher, va dans Réglages → Rocket League et resaisis ton rang à jour (un coup d'œil au tracker suffit).",
            link: '/settings',
            metadata: { reportId: id, motif },
          });
        } catch (err) {
          console.error('[rank-reports PATCH] in-app notif failed:', err);
        }

        // DM Discord du bot (best-effort — l'user a peut-être coupé les DMs)
        if (targetUid.startsWith('discord_')) {
          const discordId = targetUid.slice('discord_'.length);
          try {
            const dm = await sendRankContestedDM(discordId, { reason: note || null });
            extraInfo.dm = dm.ok ? 'sent' : `failed:${dm.reason}`;
          } catch (err) {
            console.error('[rank-reports PATCH] DM failed:', err);
            extraInfo.dm = 'error';
          }
        }
      }
    }

    await writeAdminAuditLog(db, {
      action: 'rank_report_resolved',
      adminUid,
      targetType: 'user',
      targetId: targetUid || id,
      targetLabel: `Signalement ${resolution} (${motif}) — ${(report.targetName as string) || ''}${note ? ` — ${note}` : ''}`,
    });

    return NextResponse.json({ ok: true, ...extraInfo });
  } catch (err) {
    captureApiError('API admin/rank-reports PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
