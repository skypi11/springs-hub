import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    initializeApp({ credential: cert(serviceAccount) });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=no_code`);
  }

  try {
    initAdmin();

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

    // Create or update Firebase Auth user profile
    // Cela permet de récupérer displayName et photoURL directement depuis fbUser,
    // sans dépendre de Firestore au refresh
    try {
      await getAuth().updateUser(uid, {
        displayName: discordUser.username,
        photoURL: avatarUrl,
      });
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        await getAuth().createUser({
          uid,
          displayName: discordUser.username,
          photoURL: avatarUrl,
        });
      }
    }

    // Create Firebase custom token
    const firebaseToken = await getAuth().createCustomToken(uid, {
      discordId: discordUser.id,
      discordUsername: discordUser.username,
    });

    // Write user profile to Firestore (Admin SDK — bypass security rules)
    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      await userRef.set({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
        displayName: discordUser.username,
        games: [],
        isFan: false,
        createdAt: new Date(),
      });
    } else {
      await userRef.update({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
      });
    }

    // Redirect back to app with token
    const params = new URLSearchParams({
      ft: firebaseToken,
      did: discordUser.id,
      du: discordUser.username,
      da: avatarUrl,
    });

    return NextResponse.redirect(`${origin}/?${params.toString()}`);
  } catch (err) {
    console.error('Discord auth error:', err);
    return NextResponse.redirect(`${origin}/?auth_error=server_error`);
  }
}
