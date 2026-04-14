import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/notifications — liste les notifs du user courant
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const snap = await db.collection('notifications')
      .where('userId', '==', uid)
      .limit(50)
      .get();

    const notifications = snap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          type: data.type,
          title: data.title,
          message: data.message,
          link: data.link || '',
          read: data.read ?? false,
          createdAtMs: data.createdAt?.toMillis?.() ?? null,
        };
      })
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

    const unread = notifications.filter(n => !n.read).length;

    return NextResponse.json({ notifications, unread });
  } catch (err) {
    captureApiError('API Notifications GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/notifications — mark-read / mark-all-read / delete
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, notificationId } = body;

    const db = getAdminDb();

    switch (action) {
      case 'mark_read': {
        if (!notificationId) {
          return NextResponse.json({ error: 'notificationId requis' }, { status: 400 });
        }
        const ref = db.collection('notifications').doc(notificationId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.userId !== uid) {
          return NextResponse.json({ error: 'Notification introuvable' }, { status: 404 });
        }
        await ref.update({ read: true, readAt: FieldValue.serverTimestamp() });
        return NextResponse.json({ success: true });
      }

      case 'mark_all_read': {
        const snap = await db.collection('notifications')
          .where('userId', '==', uid)
          .where('read', '==', false)
          .limit(200)
          .get();

        if (snap.empty) return NextResponse.json({ success: true, count: 0 });

        const batch = db.batch();
        for (const doc of snap.docs) {
          batch.update(doc.ref, { read: true, readAt: FieldValue.serverTimestamp() });
        }
        await batch.commit();
        return NextResponse.json({ success: true, count: snap.size });
      }

      case 'delete': {
        if (!notificationId) {
          return NextResponse.json({ error: 'notificationId requis' }, { status: 400 });
        }
        const ref = db.collection('notifications').doc(notificationId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.userId !== uid) {
          return NextResponse.json({ error: 'Notification introuvable' }, { status: 404 });
        }
        await ref.delete();
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Notifications POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
