import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { getGuildRoles } from '@/lib/discord-bot';

// GET /api/discord/roles?structureId=...
// Liste les rôles Discord du serveur connecté à la structure, pour le picker
// de rôle à ping sur les events scope=structure / scope=game / staff.
// Même modèle d'autorisation que /api/discord/channels.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const structureId = req.nextUrl.searchParams.get('structureId');
    if (!structureId) {
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
    const isResponsable = (data.managerIds ?? []).includes(uid);
    let allowed = isFounder || isCoFounder || isResponsable;
    if (!allowed) {
      const teamsSnap = await db.collection('sub_teams')
        .where('structureId', '==', structureId)
        .where('staffIds', 'array-contains', uid)
        .get();
      for (const t of teamsSnap.docs) {
        const roles = (t.data().staffRoles ?? {}) as Record<string, unknown>;
        if (roles[uid] === 'manager') { allowed = true; break; }
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
    }

    const integration = data.discordIntegration as { guildId?: string } | undefined;
    const guildId = integration?.guildId;
    if (!guildId) {
      return NextResponse.json({ error: 'Aucun serveur Discord connecté.' }, { status: 400 });
    }

    const roles = await getGuildRoles(guildId);
    return NextResponse.json({ roles });
  } catch (err) {
    console.error('[Discord roles] error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
