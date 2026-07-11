// POST /api/profile/valorant-link/change-request
// EN PAUSE (juillet 2026). Le changement de compte Valorant exigeait de capturer
// le nouveau compte via la connexion Riot de Discord — que Discord a supprimée de
// son API OAuth (« no replacement »). Sans elle, plus aucune bascule possible.
// La route renvoie un message « en pause » ; le flux sera rétabli avec la
// connexion Riot directe (RSO). L'UI masque déjà le bouton côté Settings.
//
// Body : { reason: string }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { isValidPuuid } from '@/lib/valorant-identity';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const reason = clampString(typeof body?.reason === 'string' ? body.reason : '', 500);
    if (!reason) {
      return NextResponse.json({
        error: 'Une raison est obligatoire (compte perdu, erreur de liaison, etc.)',
      }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    const user = userSnap.data()!;

    const currentPuuid = user.valorantPuuid as string | undefined;
    if (!isValidPuuid(currentPuuid)) {
      return NextResponse.json({
        error: "Tu n'as pas de compte Riot vérifié lié, il n'y a rien à changer. Synchronise d'abord ton rang.",
      }, { status: 400 });
    }

    // Changement EN PAUSE : capturer le nouveau compte exigeait la connexion Riot
    // de Discord, supprimée en juillet 2026. Aucune bascule possible jusqu'à la
    // connexion Riot directe (RSO). L'UI masque le bouton ; ce garde-fou couvre un
    // appel direct — et n'instruit jamais de « relier son Riot à Discord ».
    return NextResponse.json({
      error: 'Le changement de compte Valorant est en pause jusqu\'à la connexion Riot directe (« Se connecter avec Riot »).',
    }, { status: 409 });
  } catch (err) {
    captureApiError('API valorant-link/change-request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
