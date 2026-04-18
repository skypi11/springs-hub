import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { getGuildChannels } from '@/lib/discord-bot';

// GET /api/discord/channels?structureId=...
// Liste les salons Discord postables du serveur connecté à la structure.
// Accessible aux dirigeants + responsables structure + team-managers (tous ont
// intérêt à voir la liste pour choisir le salon de leur équipe).
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

    // Autorisation : dirigeant, responsable ou team-manager (staff d'au moins une
    // équipe de la structure avec rôle 'manager'). Le but = on n'expose pas la
    // topologie Discord au premier membre venu.
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

    const channels = await getGuildChannels(guildId);
    return NextResponse.json({ channels });
  } catch (err) {
    console.error('[Discord channels] error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
