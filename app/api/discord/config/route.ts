import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { addAuditLog } from '@/lib/audit-log';

// POST /api/discord/config
// Met à jour la config Discord au niveau structure (salon + rôle à ping) pour
// un scope donné : 'structure', 'game' (avec game=rocket_league|trackmania),
// ou 'staff'.
//
// Dirigeants only (fondateur + co-fondateurs). Les salons par équipe restent
// gérés via /api/structures/teams.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => null) as {
      structureId?: string;
      scope?: 'structure' | 'game' | 'staff';
      game?: string;
      channelId?: string | null;
      channelName?: string | null;
      roleId?: string | null;
      roleName?: string | null;
    } | null;

    if (!body || !body.structureId || !body.scope) {
      return NextResponse.json({ error: 'structureId et scope requis.' }, { status: 400 });
    }
    if (!['structure', 'game', 'staff'].includes(body.scope)) {
      return NextResponse.json({ error: 'scope invalide.' }, { status: 400 });
    }
    if (body.scope === 'game' && (!body.game || (body.game !== 'rocket_league' && body.game !== 'trackmania'))) {
      return NextResponse.json({ error: 'game invalide (rocket_league | trackmania).' }, { status: 400 });
    }

    // Validation des snowflakes Discord. null/'' = unset, sinon ^\d{1,32}$.
    const validSnowflake = (v: unknown): v is string =>
      typeof v === 'string' && /^\d{1,32}$/.test(v);
    if (body.channelId != null && body.channelId !== '' && !validSnowflake(body.channelId)) {
      return NextResponse.json({ error: 'channelId invalide.' }, { status: 400 });
    }
    if (body.roleId != null && body.roleId !== '' && !validSnowflake(body.roleId)) {
      return NextResponse.json({ error: 'roleId invalide.' }, { status: 400 });
    }
    const channelId = body.channelId && validSnowflake(body.channelId) ? body.channelId : null;
    const channelName = typeof body.channelName === 'string' ? body.channelName.slice(0, 100) : null;
    const roleId = body.roleId && validSnowflake(body.roleId) ? body.roleId : null;
    const roleName = typeof body.roleName === 'string' ? body.roleName.slice(0, 100) : null;

    const db = getAdminDb();
    const structSnap = await db.collection('structures').doc(body.structureId).get();
    if (!structSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable.' }, { status: 404 });
    }
    const struct = structSnap.data()!;

    // Autorisation : dirigeants uniquement.
    const isFounder = struct.founderId === uid;
    const isCoFounder = Array.isArray(struct.coFounderIds) && struct.coFounderIds.includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
    }

    const integration = struct.discordIntegration as { guildId?: string } | undefined;
    if (!integration?.guildId) {
      return NextResponse.json({ error: 'Aucun serveur Discord connecté.' }, { status: 400 });
    }

    // Construction du patch dot-notation ciblé sur discordIntegration.{champ}.
    const updates: Record<string, unknown> = {};
    if (body.scope === 'structure') {
      updates['discordIntegration.structureChannelId'] = channelId;
      updates['discordIntegration.structureChannelName'] = channelId ? channelName : null;
      updates['discordIntegration.structureRoleId'] = roleId;
      updates['discordIntegration.structureRoleName'] = roleId ? roleName : null;
    } else if (body.scope === 'game') {
      const g = body.game!;
      updates[`discordIntegration.gameChannels.${g}.channelId`] = channelId;
      updates[`discordIntegration.gameChannels.${g}.channelName`] = channelId ? channelName : null;
      updates[`discordIntegration.gameChannels.${g}.roleId`] = roleId;
      updates[`discordIntegration.gameChannels.${g}.roleName`] = roleId ? roleName : null;
    } else {
      updates['discordIntegration.staffChannelId'] = channelId;
      updates['discordIntegration.staffChannelName'] = channelId ? channelName : null;
      updates['discordIntegration.staffRoleId'] = roleId;
      updates['discordIntegration.staffRoleName'] = roleId ? roleName : null;
    }

    const batch = db.batch();
    batch.update(structSnap.ref, updates);
    addAuditLog(db, batch, {
      structureId: body.structureId,
      action: 'discord_config_updated',
      actorUid: uid,
      metadata: {
        scope: body.scope,
        ...(body.scope === 'game' ? { game: body.game } : {}),
        channelId,
        roleId,
      },
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API discord/config POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
