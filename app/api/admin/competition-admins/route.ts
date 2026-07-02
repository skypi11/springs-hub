import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';

// Admins de compétition (collection `competition_admins`) — rôle scopé au
// moteur de compétitions, distinct des admins Aedral complets. La NOMINATION
// et la révocation sont réservées aux admins Aedral (spec Legends §6, pas
// d'auto-promotion) ; la liste aussi (écran de gestion, pas la console).

// GET /api/admin/competition-admins — liste + enrichissement displayName/avatar
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const snap = await db.collection('competition_admins').get();

    // Enrichissement live depuis users (avatar/pseudo à jour) : peu de docs,
    // lookups directs par id.
    const admins = await Promise.all(snap.docs.map(async d => {
      const userSnap = await db.collection('users').doc(d.id).get();
      const user = userSnap.data() ?? {};
      return {
        uid: d.id,
        displayName: (user.displayName as string) || (d.data().displayName as string) || d.id,
        avatarUrl: (user.avatarUrl as string) || (user.discordAvatar as string) || '',
        slug: (user.slug as string) || '',
        addedBy: d.data().addedBy ?? '',
        addedAt: d.data().addedAt?.toDate?.()?.toISOString() ?? null,
      };
    }));
    admins.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));

    return NextResponse.json({ admins });
  } catch (err) {
    captureApiError('API Admin/CompetitionAdmins GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/competition-admins — nommer un admin de compétition
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const targetUid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (!targetUid) return NextResponse.json({ error: 'uid requis' }, { status: 400 });

    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(targetUid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable.' }, { status: 404 });
    }
    // Un admin Aedral complet a déjà tous les droits de compétition : le
    // nommer en plus n'apporterait que de la confusion dans la liste.
    const aedralSnap = await db.collection('aedral_admins').doc(targetUid).get();
    if (aedralSnap.exists) {
      return NextResponse.json({ error: 'Cet utilisateur est déjà admin Aedral (accès compétitions inclus).' }, { status: 409 });
    }
    const existingSnap = await db.collection('competition_admins').doc(targetUid).get();
    if (existingSnap.exists) {
      return NextResponse.json({ error: 'Cet utilisateur est déjà admin de compétition.' }, { status: 409 });
    }

    const displayName = (userSnap.data()?.displayName as string) || targetUid;
    await db.collection('competition_admins').doc(targetUid).set({
      displayName,
      addedBy: uid,
      addedAt: FieldValue.serverTimestamp(),
    });

    await writeAdminAuditLog(db, {
      action: 'competition_admin_added',
      adminUid: uid,
      targetType: 'user',
      targetId: targetUid,
      targetLabel: displayName,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/CompetitionAdmins POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/admin/competition-admins?uid=discord_XXX — révoquer
export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const targetUid = req.nextUrl.searchParams.get('uid')?.trim() || '';
    if (!targetUid) return NextResponse.json({ error: 'uid requis' }, { status: 400 });

    const db = getAdminDb();
    const ref = db.collection('competition_admins').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Cet utilisateur n'est pas admin de compétition." }, { status: 404 });
    }

    await ref.delete();

    await writeAdminAuditLog(db, {
      action: 'competition_admin_removed',
      adminUid: uid,
      targetType: 'user',
      targetId: targetUid,
      targetLabel: (snap.data()?.displayName as string) ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/CompetitionAdmins DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
