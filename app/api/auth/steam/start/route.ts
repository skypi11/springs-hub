import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildSteamLoginUrl } from '@/lib/steam-openid';
import { verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// Initie le flow Steam OpenID. L'user doit être authentifié sur Aedral
// pour qu'on puisse rattacher le SteamID au bon compte au callback.
//
// POST (pas GET) parce qu'on a besoin du header Authorization Bearer pour
// récupérer l'UID. Le client fait `fetch('/api/auth/steam/start', { method: POST,
// headers: { Authorization: 'Bearer <idToken>' } })` puis redirige vers la URL
// retournée dans le JSON.

export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const origin = req.nextUrl.origin;
  const returnTo = `${origin}/api/auth/steam/callback`;
  const steamUrl = buildSteamLoginUrl(returnTo, origin);

  // Cookies CSRF/state — le callback les lira pour retrouver à quel user
  // attacher le SteamID retourné par Steam.
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.json({ redirectUrl: steamUrl });
  res.cookies.set('steam_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  res.cookies.set('steam_oauth_uid', uid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}

// Endpoint pour délier Steam — supprime le linkage dans Firestore
export async function DELETE(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req));
  if (blocked) return blocked;

  const uid = await verifyAuth(req);
  if (!uid) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  const { getAdminDb } = await import('@/lib/firebase-admin');
  const { FieldValue } = await import('firebase-admin/firestore');
  const db = getAdminDb();
  await db.collection('users').doc(uid).update({
    steamLinked: FieldValue.delete(),
  });
  return NextResponse.json({ ok: true });
}
