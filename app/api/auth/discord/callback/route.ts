import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { fetchDiscordConnections, mergeConnections, type DiscordConnection } from '@/lib/discord-connections';

export async function GET(req: NextRequest) {
  // Rate limit OAuth par IP — protège contre le bruteforce de codes Discord
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateFromUrl = searchParams.get('state');
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=no_code`);
  }

  // Vérification CSRF state — comparer au cookie posé avant la redirection vers Discord
  const stateCookie = req.cookies.get('discord_oauth_state')?.value;
  if (!stateFromUrl || !stateCookie || stateFromUrl !== stateCookie) {
    return NextResponse.redirect(`${origin}/?auth_error=invalid_state`);
  }

  try {

    // Exchange code for Discord access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${origin}/api/auth/discord/callback`,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(`${origin}/?auth_error=token_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Fetch Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return NextResponse.redirect(`${origin}/?auth_error=user_failed`);
    }

    const discordUser = await userRes.json();
    const uid = `discord_${discordUser.id}`;
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator || '0') % 5}.png`;

    // Bloquer les utilisateurs bannis AVANT de générer un nouveau token
    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists && userSnap.data()?.isBanned === true) {
      const res = NextResponse.redirect(`${origin}/?auth_error=banned`);
      res.cookies.delete('discord_oauth_state');
      return res;
    }

    // Pull les connexions Discord de l'user (Epic, Steam, Twitch, YouTube, etc.)
    // → enrichit le profil + auto-update du pseudo Epic à chaque login.
    // Erreur silencieuse : si Discord refuse ce scope (révoqué, etc.), on continue
    // l'auth normalement avec les connexions existantes.
    let mergedConnections: DiscordConnection[] | null = null;
    try {
      const fresh = await fetchDiscordConnections(accessToken);
      const existing = userSnap.exists
        ? (userSnap.data()?.discordConnections as DiscordConnection[] | undefined)
        : undefined;
      mergedConnections = mergeConnections(fresh, existing);
    } catch (err) {
      console.error('[Discord callback] fetch connections failed (non-fatal):', err);
    }

    // Create or update Firebase Auth user profile
    // Cela permet de récupérer displayName et photoURL directement depuis fbUser,
    // sans dépendre de Firestore au refresh
    const adminAuth = getAdminAuth();
    try {
      await adminAuth.updateUser(uid, {
        displayName: discordUser.username,
        photoURL: avatarUrl,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/user-not-found') {
        await adminAuth.createUser({
          uid,
          displayName: discordUser.username,
          photoURL: avatarUrl,
        });
      } else {
        console.error('[Discord callback] updateUser failed:', code, err);
      }
    }

    // Create Firebase custom token
    const firebaseToken = await adminAuth.createCustomToken(uid, {
      discordId: discordUser.id,
      discordUsername: discordUser.username,
    });

    // Write user profile to Firestore (Admin SDK — bypass security rules)
    if (!userSnap.exists) {
      await userRef.set({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
        displayName: discordUser.username,
        games: [],
        isFan: false,
        isBanned: false,
        ...(mergedConnections ? { discordConnections: mergedConnections } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.update({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
        ...(mergedConnections ? { discordConnections: mergedConnections } : {}),
      });
    }

    // Le custom token Firebase NE doit PAS transiter par l'URL (logs Vercel,
    // historique navigateur, header Referer vers ressources externes). On le
    // pose dans un cookie httpOnly court (120s) que le client consomme une
    // seule fois via GET /api/auth/discord/session.
    const authPayload = JSON.stringify({
      ft: firebaseToken,
      did: discordUser.id,
      du: discordUser.username,
      da: avatarUrl,
    });
    const res = NextResponse.redirect(`${origin}/?auth=1`);
    res.cookies.delete('discord_oauth_state');
    res.cookies.set('aedral_auth', authPayload, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 120,
    });
    return res;
  } catch (err) {
    console.error('Discord auth error:', err);
    return NextResponse.redirect(`${origin}/?auth_error=server_error`);
  }
}
