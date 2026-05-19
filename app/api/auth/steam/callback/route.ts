import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifySteamOpenIdResponse, fetchSteamProfile } from '@/lib/steam-openid';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';

// Callback du flow Steam OpenID :
// 1. Récupère le cookie steam_oauth_uid (UID Firebase de l'user qui a lancé le flow)
// 2. Vérifie la signature OpenID via Steam (POST check_authentication)
// 3. Si valide : extrait le SteamID64, enrichit avec pseudo/avatar via Steam Web API,
//    écrit dans Firestore le linkage Steam de l'user

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const origin = req.nextUrl.origin;
  const settingsUrl = `${origin}/settings?section=games`;

  // Vérif des cookies CSRF + UID
  const stateCookie = req.cookies.get('steam_oauth_state')?.value;
  const uidCookie = req.cookies.get('steam_oauth_uid')?.value;
  if (!stateCookie || !uidCookie) {
    return clearedRedirect(`${settingsUrl}&steam_error=invalid_state`);
  }

  try {
    const steamId64 = await verifySteamOpenIdResponse(req.nextUrl.searchParams);
    if (!steamId64) {
      return clearedRedirect(`${settingsUrl}&steam_error=verify_failed`);
    }

    // Enrichissement : pseudo + avatar via Steam Web API (best-effort, optionnel)
    const profile = await fetchSteamProfile(steamId64);

    // Vérifier que cet SteamID64 n'est pas déjà lié à un AUTRE compte Aedral
    // (sinon deux users pourraient prétendre au même Steam — exploit identitaire)
    const db = getAdminDb();
    const dupeQuery = await db.collection('users')
      .where('steamLinked.steamId64', '==', steamId64)
      .limit(1)
      .get();
    if (!dupeQuery.empty && dupeQuery.docs[0].id !== uidCookie) {
      return clearedRedirect(`${settingsUrl}&steam_error=already_linked`);
    }

    // Écriture du linkage Steam sur le user
    await db.collection('users').doc(uidCookie).set(
      {
        steamLinked: {
          steamId64,
          personaName: profile.personaName ?? null,
          avatarUrl: profile.avatarUrl ?? null,
          profileUrl: profile.profileUrl ?? null,
          linkedAt: FieldValue.serverTimestamp(),
        },
        // Auto-fill rlPlatform=steam si rien d'autre déjà set
        // (l'user peut override dans Settings)
        ...(await shouldAutoFillRL(db, uidCookie)
          ? { rlPlatform: 'steam', rlPlatformId: steamId64 }
          : {}),
      },
      { merge: true },
    );

    return clearedRedirect(`${settingsUrl}&steam_linked=1`);
  } catch (err) {
    captureApiError('Steam OpenID callback error', err);
    return clearedRedirect(`${settingsUrl}&steam_error=server_error`);
  }
}

// Helper : retourne true si l'user n'a pas encore de rlPlatform configuré
async function shouldAutoFillRL(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<boolean> {
  try {
    const snap = await db.collection('users').doc(uid).get();
    const data = snap.data() ?? {};
    return !data.rlPlatform || !data.rlPlatformId;
  } catch {
    return false;
  }
}

function clearedRedirect(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.delete('steam_oauth_state');
  res.cookies.delete('steam_oauth_uid');
  return res;
}
