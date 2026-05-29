import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { fetchDiscordConnections, mergeConnections, type DiscordConnection } from '@/lib/discord-connections';
import { fetchValorantAccountByPuuid } from '@/lib/valorant-henrikdev';
import { syncDiscordMember } from '@/lib/discord-role-sync';
import { generateBaseSlug, generateUniqueSlug } from '@/lib/user-slug';
import { sanitizeNext } from '@/lib/return-to';

// Cas d'erreur OAuth : on redirige TOUJOURS vers "/" (jamais vers `next`),
// pour éviter qu'une page profonde affiche un état bizarre. On nettoie
// systématiquement les cookies temporaires du flow.
function errorRedirect(origin: string, code: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/?auth_error=${code}`);
  res.cookies.delete('discord_oauth_state');
  res.cookies.delete('discord_oauth_next');
  return res;
}

export async function GET(req: NextRequest) {
  // Rate limit OAuth par IP, protège contre le bruteforce de codes Discord
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateFromUrl = searchParams.get('state');
  const origin = req.nextUrl.origin;

  if (!code) {
    return errorRedirect(origin, 'no_code');
  }

  // Vérification CSRF state, comparer au cookie posé avant la redirection vers Discord
  const stateCookie = req.cookies.get('discord_oauth_state')?.value;
  if (!stateFromUrl || !stateCookie || stateFromUrl !== stateCookie) {
    return errorRedirect(origin, 'invalid_state');
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
      return errorRedirect(origin, 'token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    // refresh_token : long-vivant, sert au cron nocturne pour rafraîchir les
    // connexions Discord sans intervention du joueur (notamment pseudo Epic
    // qui sert à construire l'URL tracker.gg). Stocké server-only en aval.
    const refreshToken: string | undefined =
      typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : undefined;
    const tokenExpiresIn: number | null =
      typeof tokenData.expires_in === 'number' ? tokenData.expires_in : null;

    // Fetch Discord user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return errorRedirect(origin, 'user_failed');
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
      return errorRedirect(origin, 'banned');
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

      // Enrichissement Riot/Valorant : Discord renvoie souvent le `name` sans
      // le tag (format "Skypi" au lieu de "Skypi#EUW"). On résout le RiotID
      // complet via HenrikDev à partir du PUUID, puis on écrit "Name#TAG"
      // dans le `name` de la connection pour que pickValorantRiotId fonctionne
      // partout (profil, embed Discord, cron sync). Erreur silencieuse, on
      // garde le name partiel si HenrikDev down.
      const riotConn = mergedConnections?.find(c => c.type === 'riotgames');
      if (riotConn && riotConn.id && !riotConn.name.includes('#')) {
        try {
          const acc = await fetchValorantAccountByPuuid(riotConn.id);
          if (acc.ok) {
            const fullRiotId = `${acc.data.name}#${acc.data.tag}`;
            mergedConnections = mergedConnections!.map(c =>
              c.type === 'riotgames' && c.id === riotConn.id
                ? { ...c, name: fullRiotId }
                : c
            );
          }
        } catch (err) {
          console.error('[Discord callback] HenrikDev resolve RiotID failed (non-fatal):', err);
        }
      }
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

    // Write user profile to Firestore (Admin SDK, bypass security rules)
    if (!userSnap.exists) {
      // Génère un slug public unique à partir du username Discord. Utilisé
      // dans /profile/[slug] au lieu de l'uid (qui contient le snowflake
      // Discord, sensible). Voir lib/user-slug.ts.
      const baseSlug = generateBaseSlug(discordUser.username);
      let slug: string | null = null;
      try {
        slug = await generateUniqueSlug(baseSlug, db);
      } catch (err) {
        // Non-fatal : si la génération échoue, l'user pourra quand même se
        // connecter (les liens utiliseront l'uid en fallback). Le backfill
        // pourra réessayer plus tard.
        console.error('[Discord callback] slug generation failed (non-fatal):', err);
      }
      await userRef.set({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
        displayName: discordUser.username,
        ...(slug ? { slug } : {}),
        games: [],
        isFan: false,
        isBanned: false,
        ...(mergedConnections ? { discordConnections: mergedConnections } : {}),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      // User existant : on ne touche PAS au slug pour ne pas casser les liens
      // déjà partagés. Le slug ne peut changer que via une action explicite
      // dans les settings (à implémenter plus tard).
      await userRef.update({
        discordId: discordUser.id,
        discordUsername: discordUser.username,
        discordAvatar: avatarUrl,
        ...(mergedConnections ? { discordConnections: mergedConnections } : {}),
      });
    }

    // Persiste le refresh_token Discord dans une collection server-only
    // (firestore.rules : `match /user_secrets/{uid} { allow read, write: if false; }`).
    // Jamais exposé client. Lu uniquement par lib/discord-refresh.ts.
    if (refreshToken) {
      try {
        await db.collection('user_secrets').doc(uid).set({
          discordRefreshToken: refreshToken,
          discordTokenIssuedAt: FieldValue.serverTimestamp(),
          discordTokenExpiresIn: tokenExpiresIn,
        }, { merge: true });
      } catch (err) {
        // Non-bloquant : sans refresh_token le cron ne pourra pas resync ce
        // joueur, mais le login fonctionne quand même.
        console.error('[Discord callback] store refresh_token failed (non-fatal):', err);
      }
    }

    // Synchronise pseudo serveur + rôles Discord sur le serveur Aedral.
    // No-op si l'utilisateur n'a pas rejoint le serveur. Ne throw jamais.
    await syncDiscordMember(db, uid);

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

    // returnTo : re-lit le cookie posé par /start, re-valide (defense in depth :
    // si jamais le cookie a été altéré côté navigateur ou pendant le transport,
    // la validation stricte rejette). On préserve la query string existante
    // du `next` en ajoutant `auth=1` avec le bon séparateur.
    const nextCookie = req.cookies.get('discord_oauth_next')?.value;
    const nextPath = sanitizeNext(nextCookie); // '/' si invalide ou absent
    const sep = nextPath.includes('?') ? '&' : '?';
    const finalUrl = `${origin}${nextPath}${sep}auth=1`;

    const res = NextResponse.redirect(finalUrl);
    res.cookies.delete('discord_oauth_state');
    res.cookies.delete('discord_oauth_next');
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
    return errorRedirect(origin, 'server_error');
  }
}
