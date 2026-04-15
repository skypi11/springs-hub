import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { createNotifications } from '@/lib/notifications';
import { captureApiError } from '@/lib/sentry';

// GET /api/cron/expire-invitations
// Vercel Cron — expire silencieusement les join_request / direct_invite
// pending > EXPIRY_DAYS. Chaque invitation passée à `expired` génère une
// notif `invitation_expired` pour l'utilisateur concerné (applicant pour
// une demande, target pour une invitation directe).
//
// Sécurisation : Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>`
// quand la variable d'env est définie côté projet. En dev, on autorise
// aussi sans secret pour pouvoir tester à la main.

const EXPIRY_DAYS = 30;

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
      }
    } else if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 500 });
    }

    const db = getAdminDb();
    const cutoffMs = Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000;

    const snap = await db
      .collection('structure_invitations')
      .where('status', '==', 'pending')
      .get();

    const batch = db.batch();
    const notifications: Parameters<typeof createNotifications>[1] = [];
    let expiredCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const createdMs = data.createdAt?.toMillis?.() ?? 0;
      if (!createdMs || createdMs > cutoffMs) continue;

      // join_request → expire + notif à l'applicant
      // direct_invite → expire + notif à la target
      // invite_link → skip (pas d'user ciblé, on les laisse tels quels
      //               ou à un autre job de garbage collection)
      const type = data.type;
      if (type === 'join_request') {
        const applicantId = data.applicantId;
        if (!applicantId) continue;
        batch.update(doc.ref, { status: 'expired', expiredAt: new Date() });
        notifications.push({
          userId: applicantId,
          type: 'invitation_expired',
          title: 'Demande expirée',
          message: `Ta demande auprès d'une structure est restée sans réponse plus de ${EXPIRY_DAYS} jours et a été automatiquement archivée.`,
          link: '/community/my-applications',
          metadata: { invitationId: doc.id, structureId: data.structureId || '' },
        });
        expiredCount++;
      } else if (type === 'direct_invite') {
        const targetUserId = data.targetUserId;
        if (!targetUserId) continue;
        batch.update(doc.ref, { status: 'expired', expiredAt: new Date() });
        notifications.push({
          userId: targetUserId,
          type: 'invitation_expired',
          title: 'Invitation expirée',
          message: `Une invitation à rejoindre une structure est restée sans réponse plus de ${EXPIRY_DAYS} jours et a été automatiquement archivée.`,
          link: '/community/my-applications',
          metadata: { invitationId: doc.id, structureId: data.structureId || '' },
        });
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      await batch.commit();
      await createNotifications(db, notifications);
    }

    return NextResponse.json({ ok: true, expired: expiredCount, cutoffDays: EXPIRY_DAYS });
  } catch (err) {
    captureApiError('API cron expire-invitations error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
