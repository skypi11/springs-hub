// POST /api/profile/[uid]/rank-report
// Signaler le rang RL d'un joueur — n'importe quel user connecté peut le faire.
// Voir docs/rl-rank-verification-plan.md (Lot 5).
// Le signalement crée un doc dans `rank_reports` + ping Discord les admins.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { sendAdminAlert } from '@/lib/admin-discord-alert';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  try {
    const reporterUid = await verifyAuth(req);
    if (!reporterUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, reporterUid));
    if (blocked) return blocked;

    const { uid: targetUid } = await params;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'UID cible invalide' }, { status: 400 });
    }
    if (targetUid === reporterUid) {
      return NextResponse.json({ error: 'Tu ne peux pas te signaler toi-même.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const message = clampString(typeof body?.message === 'string' ? body.message : '', 500);

    const db = getAdminDb();
    // Cibler doit exister
    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const target = targetSnap.data()!;

    // Anti-spam : on bloque les doublons en pending du même reporter sur la
    // même cible dans les dernières 24h (évite le hammering).
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const recent = await db.collection('rank_reports')
      .where('targetUid', '==', targetUid)
      .where('reporterUid', '==', reporterUid)
      .where('status', '==', 'pending')
      .limit(1).get();
    for (const d of recent.docs) {
      const created = d.data().createdAt?.toMillis?.() ?? 0;
      if (created > cutoffMs) {
        return NextResponse.json({
          error: 'Tu as déjà signalé ce joueur dans les dernières 24 heures.',
        }, { status: 429 });
      }
    }

    const reporterSnap = await db.collection('users').doc(reporterUid).get();
    const reporterName = (reporterSnap.data()?.displayName as string) || 'Anonyme';

    const reportRef = db.collection('rank_reports').doc();
    await reportRef.set({
      targetUid,
      targetName: (target.displayName as string) || (target.discordUsername as string) || '',
      targetRlRank: (target.rlRank as string) || '',
      reporterUid,
      reporterName,
      message: message || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Ping admin Discord (fire-and-forget)
    await sendAdminAlert(db, {
      title: '🚩 Rang signalé',
      description: `**${reporterName}** signale le rang de **${(target.displayName as string) || targetUid}**\n`
        + `Rang affiché : \`${(target.rlRank as string) || '—'}\`\n`
        + (message ? `\nMessage : ${message}\n` : '')
        + `\n[Voir le profil](https://aedral.com/profile/${targetUid}) · [Admin → signalements](https://aedral.com/admin/rank-reports)`,
    });

    return NextResponse.json({ ok: true, reportId: reportRef.id });
  } catch (err) {
    captureApiError('API rank-report POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
