import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { captureApiError } from '@/lib/sentry';

const MAX_RECENT = 200;
const BROADCAST_CAP = 2000;         // hard cap sur les destinataires par envoi
const TITLE_MAX = 120;
const MESSAGE_MAX = 500;
const LINK_MAX = 500;

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

// GET /api/admin/notifications — stats + dernières notifs envoyées (toutes destinataires confondues).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const snap = await db.collection('notifications')
      .orderBy('createdAt', 'desc')
      .limit(MAX_RECENT)
      .get();

    const sevenDaysAgo = Date.now() - 7 * 86400000;
    let unread = 0;
    let last7d = 0;
    const byType: Record<string, number> = {};
    const userIds = new Set<string>();

    const recent = snap.docs.map(doc => {
      const d = doc.data();
      const createdAt = ts(d.createdAt);
      const createdMs = d.createdAt?.toMillis?.() ?? 0;
      if (!d.read) unread++;
      if (createdMs >= sevenDaysAgo) last7d++;
      const type = (d.type as string) ?? 'generic';
      byType[type] = (byType[type] ?? 0) + 1;
      if (typeof d.userId === 'string') userIds.add(d.userId);
      return {
        id: doc.id,
        userId: d.userId as string,
        type,
        title: (d.title as string) ?? '',
        message: (d.message as string) ?? '',
        link: (d.link as string) ?? '',
        read: !!d.read,
        createdAt,
      };
    });

    const usersMap = await fetchDocsByIds(db, 'users', Array.from(userIds));
    const enriched = recent.map(n => {
      const u = usersMap.get(n.userId);
      return {
        ...n,
        userName: (u?.displayName as string) || (u?.discordUsername as string) || '',
      };
    });

    return NextResponse.json({
      stats: {
        total: snap.size,
        unread,
        last7d,
        byType: Object.entries(byType)
          .map(([type, count]) => ({ type, count }))
          .sort((a, b) => b.count - a.count),
      },
      recent: enriched,
      truncated: snap.size >= MAX_RECENT,
    });
  } catch (err) {
    captureApiError('API Admin/Notifications GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/notifications — envoyer une notif en broadcast.
// Body : { title, message, link?, audience: 'all' | 'user' | 'structure', targetId? }
export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const body = await req.json();
    const title = clampString(typeof body.title === 'string' ? body.title : '', TITLE_MAX);
    const message = clampString(typeof body.message === 'string' ? body.message : '', MESSAGE_MAX);
    const link = clampString(typeof body.link === 'string' ? body.link : '', LINK_MAX);
    const audience = body.audience as 'all' | 'user' | 'structure';
    const targetId = typeof body.targetId === 'string' ? body.targetId : '';

    if (!title || !message) {
      return NextResponse.json({ error: 'Titre et message requis' }, { status: 400 });
    }
    if (!['all', 'user', 'structure'].includes(audience)) {
      return NextResponse.json({ error: 'Audience invalide' }, { status: 400 });
    }
    if ((audience === 'user' || audience === 'structure') && !targetId) {
      return NextResponse.json({ error: 'targetId requis pour cette audience' }, { status: 400 });
    }

    const db = getAdminDb();

    // Résoudre la liste des destinataires
    let recipientIds: string[] = [];
    let targetLabel = '';
    if (audience === 'user') {
      const userDoc = await db.collection('users').doc(targetId).get();
      if (!userDoc.exists) {
        return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
      }
      recipientIds = [targetId];
      targetLabel = (userDoc.data()?.displayName as string) || (userDoc.data()?.discordUsername as string) || targetId;
    } else if (audience === 'structure') {
      const structDoc = await db.collection('structures').doc(targetId).get();
      if (!structDoc.exists) {
        return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
      }
      targetLabel = (structDoc.data()?.name as string) || targetId;
      const membersSnap = await db.collection('structure_members')
        .where('structureId', '==', targetId)
        .limit(BROADCAST_CAP)
        .get();
      recipientIds = Array.from(new Set(
        membersSnap.docs.map(d => d.data().userId as string).filter(Boolean)
      ));
    } else {
      // all
      const usersSnap = await db.collection('users').limit(BROADCAST_CAP).get();
      recipientIds = usersSnap.docs
        .filter(d => d.data().banned !== true)
        .map(d => d.id);
      targetLabel = 'tous les utilisateurs';
    }

    if (recipientIds.length === 0) {
      return NextResponse.json({ error: 'Aucun destinataire' }, { status: 400 });
    }
    if (recipientIds.length > BROADCAST_CAP) {
      return NextResponse.json({
        error: `Trop de destinataires (${recipientIds.length} > ${BROADCAST_CAP}).`,
      }, { status: 400 });
    }

    // Batch writes : Firestore limite à 500 ops/batch.
    const BATCH_SIZE = 400;
    let sent = 0;
    for (let i = 0; i < recipientIds.length; i += BATCH_SIZE) {
      const chunk = recipientIds.slice(i, i + BATCH_SIZE);
      const batch = db.batch();
      for (const userId of chunk) {
        const ref = db.collection('notifications').doc();
        batch.set(ref, {
          userId,
          type: 'generic',
          title,
          message,
          link: link || '',
          metadata: { broadcast: true, audience, targetId: audience === 'all' ? null : targetId },
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      sent += chunk.length;
    }

    await writeAdminAuditLog(db, {
      action: 'notification_broadcast',
      adminUid,
      targetType: 'user',
      targetId: audience === 'all' ? 'all' : targetId,
      targetLabel,
      metadata: { audience, title, recipients: sent },
    });

    return NextResponse.json({ sent, audience, title });
  } catch (err) {
    captureApiError('API Admin/Notifications POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
