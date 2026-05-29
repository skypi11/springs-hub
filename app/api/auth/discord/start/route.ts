import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isValidNext } from '@/lib/return-to';

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const origin = req.nextUrl.origin;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(`${origin}/?auth_error=missing_client_id`);
  }

  // Nonce CSRF, stocké en cookie httpOnly et renvoyé via le param `state`
  const state = randomBytes(32).toString('hex');

  const redirectUri = `${origin}/api/auth/discord/callback`;
  // Scope 'connections' = lit les comptes liés par l'user à son Discord
  // (Epic, Steam, Twitch, YouTube, Spotify, etc.) → enrichit son profil Aedral.
  const scope = encodeURIComponent('identify connections');
  const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;

  const res = NextResponse.redirect(discordUrl);
  res.cookies.set('discord_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 minutes pour compléter le flow OAuth
  });

  // Préserve la page d'origine pendant le flow OAuth (sinon le user atterrit
  // sur "/" après login, on perd ~100% du trafic entrant via lien partagé).
  // Validation STRICTE via isValidNext : whitelist chemin relatif sûr, rejet
  // de tout schéma/host/encoding caché (open redirect = critique).
  // Si invalide ou absent : pas de cookie posé → fallback "/" côté callback.
  const next = req.nextUrl.searchParams.get('next');
  if (isValidNext(next)) {
    res.cookies.set('discord_oauth_next', next, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600, // même TTL que le state CSRF
    });
  }

  return res;
}
