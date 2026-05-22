// Rafraîchit l'access_token Discord d'un user à partir de son refresh_token
// stocké server-side dans `user_secrets/{uid}`. Sert au cron nocturne pour
// re-fetcher ses connexions sans qu'il ait à se reconnecter.
//
// Ne throw jamais — renvoie `null` en cas d'échec (token révoqué, app
// désautorisée, réseau, etc.). L'appelant doit traiter null comme « pas
// rafraîchissable cette fois », sans planter le reste de sa boucle.
//
// Discord OAuth — refresh token grant :
// https://discord.com/developers/docs/topics/oauth2#authorization-code-grant-refresh-token-exchange-example

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export interface RefreshResult {
  accessToken: string;
  // Discord PEUT (mais pas toujours) faire tourner le refresh_token — quand
  // il le fait, on persiste le nouveau pour les passes suivantes.
  rotatedRefreshToken?: string;
}

export async function refreshDiscordAccessToken(
  db: Firestore,
  uid: string,
): Promise<RefreshResult | null> {
  let refreshToken: string;
  try {
    const snap = await db.collection('user_secrets').doc(uid).get();
    const stored = snap.data()?.discordRefreshToken;
    if (typeof stored !== 'string' || !stored) return null;
    refreshToken = stored;
  } catch {
    return null;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  let res: Response;
  try {
    res = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    // 400/401 = token révoqué ou app désautorisée par l'user. On invalide
    // notre copie pour ne plus la tenter inutilement à chaque passe.
    if (res.status === 400 || res.status === 401) {
      try {
        await db.collection('user_secrets').doc(uid).update({
          discordRefreshToken: FieldValue.delete(),
          discordRefreshInvalidatedAt: FieldValue.serverTimestamp(),
        });
      } catch { /* best effort */ }
    }
    return null;
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : null;
  if (!accessToken) return null;
  const newRefresh = typeof data.refresh_token === 'string' ? data.refresh_token : null;

  if (newRefresh && newRefresh !== refreshToken) {
    try {
      await db.collection('user_secrets').doc(uid).set({
        discordRefreshToken: newRefresh,
        discordTokenIssuedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch { /* best effort */ }
  }

  return {
    accessToken,
    rotatedRefreshToken: newRefresh && newRefresh !== refreshToken ? newRefresh : undefined,
  };
}
