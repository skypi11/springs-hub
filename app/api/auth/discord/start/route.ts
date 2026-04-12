import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const origin = req.nextUrl.origin;
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(`${origin}/?auth_error=missing_client_id`);
  }

  // Nonce CSRF — stocké en cookie httpOnly et renvoyé via le param `state`
  const state = randomBytes(32).toString('hex');

  const redirectUri = `${origin}/api/auth/discord/callback`;
  const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${state}`;

  const res = NextResponse.redirect(discordUrl);
  res.cookies.set('discord_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600, // 10 minutes pour compléter le flow OAuth
  });
  return res;
}
