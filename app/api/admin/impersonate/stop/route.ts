import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';

// POST /api/admin/impersonate/stop — l'admin reprend son identité d'origine.
//
// Lit le cookie __springs_impersonation_origin pour récupérer l'adminUid,
// vérifie que c'est toujours un admin (défense en profondeur), génère un
// custom token pour lui, efface le cookie.
//
// On n'exige PAS de verifyAuth ici parce que le client est actuellement
// connecté en tant que target (l'admin n'a pas son idToken admin en main).
// La sécurité repose entièrement sur le cookie httpOnly + le check isAdmin.
const COOKIE_NAME = '__springs_impersonation_origin';

export async function POST(req: NextRequest) {
  try {
    const adminUid = req.cookies.get(COOKIE_NAME)?.value;
    if (!adminUid) {
      return NextResponse.json({ error: 'Aucune impersonation active' }, { status: 400 });
    }
    if (!(await isAdmin(adminUid))) {
      // Le cookie contient un uid qui n'est plus admin — on clear et on refuse.
      const res = NextResponse.json({ error: 'Compte admin d\'origine invalide' }, { status: 403 });
      res.cookies.delete(COOKIE_NAME);
      return res;
    }

    const token = await getAdminAuth().createCustomToken(adminUid);

    await writeAdminAuditLog(getAdminDb(), {
      action: 'user_impersonation_stopped',
      adminUid,
      targetType: 'user',
      targetId: adminUid,
    });

    const res = NextResponse.json({ token, adminUid });
    res.cookies.delete(COOKIE_NAME);
    return res;
  } catch (err) {
    captureApiError('API Admin/Impersonate stop error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/admin/impersonate/stop — utilitaire : indique si une session est active
// (permet à la bannière de savoir quoi afficher après un reload).
export async function GET(req: NextRequest) {
  const adminUid = req.cookies.get(COOKIE_NAME)?.value;
  return NextResponse.json({ active: !!adminUid, adminUid: adminUid ?? null });
}
