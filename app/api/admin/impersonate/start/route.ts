import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// POST /api/admin/impersonate/start — admin se connecte "en tant que" un autre utilisateur.
//
// Body : { targetUid: string }
// Retour : { token: string } — custom token Firebase à utiliser avec signInWithCustomToken.
// Effet de bord : pose un cookie httpOnly `__springs_impersonation_origin` contenant
// l'uid admin original, pour que /stop puisse redonner la main.
//
// Le custom token embarque un claim `impersonatedBy: adminUid` qui permet au client
// d'afficher la bannière et aux APIs de tracer les actions si besoin.
const COOKIE_NAME = '__springs_impersonation_origin';
const COOKIE_MAX_AGE = 60 * 60 * 4; // 4h

export async function POST(req: NextRequest) {
  try {
    const adminUid = await verifyAuth(req);
    if (!adminUid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(adminUid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const body = await req.json();
    const targetUid = String(body.targetUid ?? '').trim();
    if (!targetUid) {
      return NextResponse.json({ error: 'targetUid manquant' }, { status: 400 });
    }
    if (targetUid === adminUid) {
      return NextResponse.json({ error: 'Impossible de s\'impersonifier soi-même' }, { status: 400 });
    }

    const auth = getAdminAuth();
    try {
      await auth.getUser(targetUid);
    } catch {
      return NextResponse.json({ error: 'Utilisateur cible introuvable' }, { status: 404 });
    }

    // Récupérer le nom pour l'audit log
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(targetUid).get();
    const targetLabel = userDoc.exists
      ? (userDoc.data()?.displayName || userDoc.data()?.discordUsername || targetUid)
      : targetUid;

    // Custom token avec claim impersonation — utilisé par la bannière et l'audit.
    const token = await auth.createCustomToken(targetUid, { impersonatedBy: adminUid });

    // Audit : qui impersonate qui
    await writeAdminAuditLog(db, {
      action: 'user_impersonation_started',
      adminUid,
      targetType: 'user',
      targetId: targetUid,
      targetLabel,
    });

    const res = NextResponse.json({ token, targetUid, targetLabel });
    res.cookies.set(COOKIE_NAME, adminUid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    captureApiError('API Admin/Impersonate start error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
