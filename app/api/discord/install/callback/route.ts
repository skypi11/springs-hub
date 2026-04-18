import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { exchangeInstallCode, getGuildInfo } from '@/lib/discord-bot';
import { addAuditLog } from '@/lib/audit-log';

// GET /api/discord/install/callback
// Appelé par Discord après que le fondateur ait validé l'invitation du bot.
// Valide le cookie state (CSRF), échange le code OAuth, récupère les infos du
// serveur via l'API bot, puis sauvegarde discordIntegration sur la structure.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const backToStructure = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    const res = NextResponse.redirect(`${origin}/community/my-structure?${qs}`);
    res.cookies.delete('discord_install_state');
    return res;
  };

  // Rate limit par IP pour limiter l'abus du endpoint OAuth.
  const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req));
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateFromUrl = searchParams.get('state');
  const guildIdFromUrl = searchParams.get('guild_id');
  const discordError = searchParams.get('error');

  if (discordError) {
    // L'utilisateur a refusé / Discord a retourné une erreur (ex: access_denied).
    return backToStructure({ discord: 'cancelled' });
  }

  if (!code || !stateFromUrl) {
    return backToStructure({ discord: 'error', reason: 'missing_params' });
  }

  const cookieRaw = req.cookies.get('discord_install_state')?.value;
  if (!cookieRaw) {
    return backToStructure({ discord: 'error', reason: 'missing_cookie' });
  }

  let cookiePayload: { state: string; structureId: string; uid: string };
  try {
    cookiePayload = JSON.parse(cookieRaw);
  } catch {
    return backToStructure({ discord: 'error', reason: 'bad_cookie' });
  }

  if (cookiePayload.state !== stateFromUrl) {
    return backToStructure({ discord: 'error', reason: 'invalid_state' });
  }

  const { structureId, uid } = cookiePayload;

  try {
    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const snap = await structureRef.get();
    if (!snap.exists) {
      return backToStructure({ discord: 'error', reason: 'structure_not_found' });
    }
    const data = snap.data()!;
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return backToStructure({ discord: 'error', reason: 'not_allowed' });
    }

    const redirectUri = `${origin}/api/discord/install/callback`;
    const { guild } = await exchangeInstallCode(code, redirectUri);

    // Discord renvoie normalement `guild` dans la réponse quand scope=bot, mais
    // on a aussi `guild_id` en query param : on garde celui de la query comme
    // source de vérité (c'est ce que l'utilisateur a vu dans le sélecteur).
    const guildId = guildIdFromUrl ?? guild?.id ?? null;
    if (!guildId) {
      return backToStructure({ discord: 'error', reason: 'no_guild' });
    }

    // Petite parenthèse de propagation : quand le bot vient juste d'être ajouté,
    // l'API peut répondre 404 pendant 1-2s le temps que Discord propage. On
    // tombe back sur le nom renvoyé par le token exchange si disponible.
    let guildName = guild?.name ?? null;
    let guildIconHash: string | null = guild?.icon ?? null;
    try {
      const info = await getGuildInfo(guildId);
      guildName = info.name;
      guildIconHash = info.iconHash;
    } catch (err) {
      console.warn('[Discord install callback] getGuildInfo failed, falling back to token response:', err);
      if (!guildName) {
        return backToStructure({ discord: 'error', reason: 'guild_fetch_failed' });
      }
    }

    const batch = db.batch();
    batch.update(structureRef, {
      discordIntegration: {
        guildId,
        guildName,
        guildIconHash: guildIconHash ?? null,
        installedBy: uid,
        installedAt: FieldValue.serverTimestamp(),
      },
    });
    addAuditLog(db, batch, {
      structureId,
      action: 'discord_connected',
      actorUid: uid,
      metadata: { guildId, guildName },
    });
    await batch.commit();

    return backToStructure({ discord: 'connected' });
  } catch (err) {
    console.error('[Discord install callback] error:', err);
    return backToStructure({ discord: 'error', reason: 'server_error' });
  }
}
