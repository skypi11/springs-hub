import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// POST /api/admin/impersonate/stop, l'admin reprend son identité d'origine.
//
// Chemin principal : lit le cookie __springs_impersonation_origin pour
// récupérer l'adminUid. Génère un custom token pour cet admin, efface le cookie.
//
// Fallback recovery (incident Matt 31/05) : si le cookie a disparu (expiration
// session navigateur, clear par OS, autre fenêtre…), on tombe en mode recovery :
//   - Lit le claim `impersonatedBy` du token Firebase courant (envoyé via header
//     Authorization).
//   - Vérifie que cet uid est bien un admin valide actuellement.
//   - Si OK → génère le custom token pour cet admin.
// Sans ce fallback, l'user reste piégé en mode impersonation sans pouvoir
// revenir admin (autre que clear manuel des cookies via DevTools).
//
// Le claim `impersonatedBy` est embarqué par /start côté server, donc il est
// signé Firebase et fiable. Le check isAdmin défense-en-profondeur reste
// appliqué dans tous les cas.
const COOKIE_NAME = '__springs_impersonation_origin';

export async function POST(req: NextRequest) {
  try {
    let adminUid = req.cookies.get(COOKIE_NAME)?.value;
    let recoveredFromClaim = false;

    // Fallback recovery : cookie absent → lire le claim du token Firebase.
    if (!adminUid) {
      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = await getAdminAuth().verifyIdToken(authHeader.split('Bearer ')[1]);
          const claimAdminUid = typeof decoded.impersonatedBy === 'string' ? decoded.impersonatedBy : null;
          if (claimAdminUid) {
            adminUid = claimAdminUid;
            recoveredFromClaim = true;
          }
        } catch {
          // Token invalide ou expiré → on retombe sur le 400 ci-dessous.
        }
      }
    }

    if (!adminUid) {
      return NextResponse.json({ error: 'Aucune impersonation active' }, { status: 400 });
    }
    if (!(await isAdmin(adminUid))) {
      // L'uid (cookie OU claim) n'est plus admin, on clear et on refuse.
      const res = NextResponse.json({ error: 'Compte admin d\'origine invalide' }, { status: 403 });
      res.cookies.delete(COOKIE_NAME);
      return res;
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, adminUid));
    if (blocked) return blocked;

    const token = await getAdminAuth().createCustomToken(adminUid);

    await writeAdminAuditLog(getAdminDb(), {
      action: 'user_impersonation_stopped',
      adminUid,
      targetType: 'user',
      targetId: adminUid,
      // Trace si l'arrêt s'est fait via le path de recovery (cookie perdu).
      // Si le compteur monte en prod, investiguer pourquoi les cookies sont
      // perdus (durée de vie, SameSite, autre).
      metadata: recoveredFromClaim ? { recoveredFromClaim: true } : undefined,
    });

    const res = NextResponse.json({ token, adminUid, recoveredFromClaim });
    res.cookies.delete(COOKIE_NAME);
    return res;
  } catch (err) {
    captureApiError('API Admin/Impersonate stop error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/admin/impersonate/stop, utilitaire : indique si une session est active
// (permet à la bannière de savoir quoi afficher après un reload).
export async function GET(req: NextRequest) {
  const adminUid = req.cookies.get(COOKIE_NAME)?.value;
  return NextResponse.json({ active: !!adminUid, adminUid: adminUid ?? null });
}
