import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { buildInstallUrl } from '@/lib/discord-bot';
import { addAuditLog } from '@/lib/audit-log';

// POST /api/discord/install
// Body: { structureId }
// Retourne: { url } vers laquelle le client doit naviguer pour inviter le bot.
// Vérifie que l'utilisateur est fondateur ou co-fondateur de la structure avant
// de signer la redirection et de poser le cookie state (anti-CSRF).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.oauth, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { structureId } = await req.json().catch(() => ({}));
    if (!structureId || typeof structureId !== 'string') {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection('structures').doc(structureId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const data = snap.data()!;
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
    }

    const state = randomBytes(32).toString('hex');
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/discord/install/callback`;
    const url = buildInstallUrl(redirectUri, state);

    // On stocke dans le cookie : state + structureId + uid. Au callback, on
    // compare le state de l'URL au state du cookie et on récupère en confiance
    // structureId + uid (cookie httpOnly, sameSite=lax → pas forgeable cross-site).
    const payload = JSON.stringify({ state, structureId, uid });

    const res = NextResponse.json({ url });
    res.cookies.set('discord_install_state', payload, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600, // 10 minutes pour compléter l'invite côté Discord
    });
    return res;
  } catch (err) {
    console.error('[Discord install start] error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/discord/install?structureId=...
// Déconnecte le bot côté Springs Hub (on retire discordIntegration de la structure).
// NB : le bot reste techniquement dans le serveur Discord — le fondateur doit le
// retirer manuellement côté Discord s'il le souhaite. On ne peut pas le kicker
// via l'API sans token serveur avec MANAGE_GUILD côté bot.
export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const structureId = req.nextUrl.searchParams.get('structureId');
    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('structures').doc(structureId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const data = snap.data()!;
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
    }

    const prevGuildId = (data.discordIntegration as { guildId?: string } | undefined)?.guildId ?? null;

    const batch = db.batch();
    batch.update(ref, { discordIntegration: FieldValue.delete() });
    addAuditLog(db, batch, {
      structureId,
      action: 'discord_disconnected',
      actorUid: uid,
      metadata: prevGuildId ? { guildId: prevGuildId } : {},
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Discord install delete] error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
