import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { createNotifications } from '@/lib/notifications';
import { captureApiError } from '@/lib/sentry';
import { expiredDepartures } from '@/lib/structure-roles';

// GET /api/cron/expire-invitations
// Vercel Cron quotidien (3h) — deux nettoyages :
//  1. Expire les join_request / direct_invite pending > EXPIRY_DAYS (notif user).
//  2. Traite les préavis de départ de co-fondateurs expirés (préavis 7j).
//     Avant, ce traitement se faisait en "lazy" dans le GET public de la page
//     structure → un GET qui mutait Firestore (anti-pattern + race condition).
//     Désormais centralisé ici.
//
// Sécurisation : Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>`
// quand la variable d'env est définie côté projet. En dev, on autorise
// aussi sans secret pour pouvoir tester à la main.

const EXPIRY_DAYS = 30;

// Traite les préavis de départ de co-fondateurs expirés sur toutes les
// structures. Retourne le nombre de co-fondateurs rétrogradés.
async function processExpiredDepartures(db: FirebaseFirestore.Firestore): Promise<number> {
  const structuresSnap = await db.collection('structures').get();
  let processed = 0;
  for (const structDoc of structuresSnap.docs) {
    const data = structDoc.data();
    const departures = data.coFounderDepartures as Record<string, unknown> | undefined;
    if (!departures || Object.keys(departures).length === 0) continue;
    const expired = expiredDepartures(departures);
    if (expired.length === 0) continue;

    const batch = db.batch();
    const updates: Record<string, unknown> = {
      coFounderIds: FieldValue.arrayRemove(...expired),
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const u of expired) updates[`coFounderDepartures.${u}`] = FieldValue.delete();
    batch.update(structDoc.ref, updates);
    for (const u of expired) {
      const mSnap = await db.collection('structure_members')
        .where('structureId', '==', structDoc.id)
        .where('userId', '==', u)
        .get();
      for (const mDoc of mSnap.docs) batch.update(mDoc.ref, { role: 'joueur' });
    }
    await batch.commit();
    processed += expired.length;
  }
  return processed;
}

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

    // 2. Préavis de départ de co-fondateurs expirés
    const departuresProcessed = await processExpiredDepartures(db);

    return NextResponse.json({
      ok: true,
      expired: expiredCount,
      cutoffDays: EXPIRY_DAYS,
      coFounderDeparturesProcessed: departuresProcessed,
    });
  } catch (err) {
    captureApiError('API cron expire-invitations error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
