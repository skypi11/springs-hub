import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isValidNext } from '@/lib/return-to';
import {
  buildTrackmaniaAuthorizeUrl,
  trackmaniaRedirectUri,
  isTrackmaniaOAuthConfigured,
} from '@/lib/trackmania-oauth';

// POST /api/auth/trackmania/start
//
// Démarre la liaison d'un compte Trackmania à un compte Aedral déjà connecté.
// Cette liaison n'est PAS propre à la Mania Cup : Trackmania est le seul jeu
// d'Aedral sans vérification possible (Epic/Steam/Riot passent par les
// connexions Discord, Ubisoft n'y figure pas). L'OAuth Nadeo est donc le
// mécanisme de compte vérifié de tout le site pour ce jeu.
//
// POST et non GET : un simple <a href> n'envoie pas l'ID token Firebase, or on
// doit savoir QUI lie son compte avant même de partir chez Nadeo. Le client
// appelle donc cette route avec son token, on vérifie l'identité, puis on
// dépose l'uid dans un cookie httpOnly que seul le callback relira. L'uid
// n'est donc jamais fourni par le navigateur : il vient d'un token vérifié.
//
// `next` (optionnel) : page vers laquelle revenir après la liaison. Validée par
// `isValidNext` — un open redirect sur un flux OAuth est critique.
export async function POST(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const uid = await verifyAuth(req);
  if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  if (!isTrackmaniaOAuthConfigured()) {
    return NextResponse.json(
      { error: 'La connexion Trackmania n’est pas encore configurée sur le site.' },
      { status: 503 }
    );
  }

  const origin = req.nextUrl.origin;
  const state = randomBytes(32).toString('hex');
  const url = buildTrackmaniaAuthorizeUrl({
    redirectUri: trackmaniaRedirectUri(origin),
    state,
  });

  const res = NextResponse.json({ url });
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 min pour compléter le flux
  };
  res.cookies.set('tm_oauth_state', state, cookieOpts);
  res.cookies.set('tm_oauth_uid', uid, cookieOpts);

  // Page de retour. Absente ou invalide → le callback retombe sur l'inscription
  // de la Mania Cup, qui reste le point d'entrée principal pour l'instant.
  const next = (await req.json().catch(() => null) as { next?: unknown } | null)?.next;
  if (typeof next === 'string' && isValidNext(next)) {
    res.cookies.set('tm_oauth_next', next, cookieOpts);
  }

  return res;
}
