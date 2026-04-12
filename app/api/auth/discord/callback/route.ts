import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
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
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.update({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
      });
    }

    // Redirect back to app with token (et nettoyer le cookie state)
    const params = new URLSearchParams({
      ft: firebaseToken,
      did: discordUser.id,
      du: discordUser.username,
      da: avatarUrl,
    });
    const res = NextResponse.redirect(`${origin}/?${params.toString()}`);
    res.cookies.delete('discord_oauth_state');
    return res;
  } catch (err) {
    console.error('Discord auth error:', err);
    return NextResponse.redirect(`${origin}/?auth_error=server_error`);
  }
}
