import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { deleteChannel, deleteGuildRole, guildIdOfChannel } from '@/lib/discord-competition';
import { guildBlocker } from '@/lib/competitions/discord-guard';

// Nettoyage Discord de fin de tournoi — JAMAIS automatique : une compétition
// terminée laisse une catégorie, N salons et N rôles sur le serveur, mais c'est
// à l'organisateur de décider quand les retirer (des équipes peuvent vouloir
// récupérer leurs échanges).
//
// Ne supprime QUE ce que le bot a créé : un salon d'annonces désigné par
// l'organisateur parmi les siens n'est jamais touché.

const HARD_DEADLINE_MS = 45_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const deadlineAtMs = Date.now() + HARD_DEADLINE_MS;

    const compRef = db.collection('competitions').doc(id);
    const compSnap = await compRef.get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const status = (comp.status as string) ?? 'draft';
    if (status !== 'finished' && status !== 'archived') {
      return NextResponse.json(
        { error: 'Le nettoyage n’est possible qu’une fois la compétition terminée.' },
        { status: 409 },
      );
    }

    const guildId = comp.discord?.guildId as string | undefined;
    if (!guildId) {
      return NextResponse.json({ error: 'Aucun serveur Discord configuré.' }, { status: 400 });
    }
    const guildIssue = await guildBlocker(uid, guildId);
    if (guildIssue) return NextResponse.json({ error: guildIssue }, { status: 403 });

    // Registre de ce que le bot a CRÉÉ. C'est la seule preuve d'auteur : un
    // salon désigné par l'organisateur parmi les siens n'y figure pas, et ne
    // sera donc jamais supprimé — contrairement à l'ancien critère
    // (`createAnnounceChannel`), qui pouvait coexister avec un identifiant
    // fourni et faisait détruire le salon de quelqu'un d'autre.
    const options = (comp.discord?.options ?? {}) as {
      announceChannelId?: string | null;
      staffChannelId?: string | null;
    };
    const createdChannelIds: string[] = Array.isArray(comp.discord?.createdChannelIds)
      ? (comp.discord.createdChannelIds as string[]).filter(Boolean)
      : [];
    const categoryIds: string[] = Array.isArray(comp.discord?.categoryIds)
      ? (comp.discord.categoryIds as string[]).filter(Boolean)
      : ((comp.discord?.categoryId as string | undefined) ? [comp.discord.categoryId as string] : []);

    /** Supprime un salon SEULEMENT s'il appartient au serveur de la compétition
     *  (un identifiant peut avoir été saisi à la main avant les gardes). */
    const deleteOwnedChannel = async (channelId: string): Promise<boolean> => {
      const owner = await guildIdOfChannel(channelId);
      if (owner === null) return true;          // déjà supprimé : rien à faire
      if (owner !== guildId) return false;      // appartient à un autre serveur
      return deleteChannel(channelId);
    };

    const report = { channels: 0, roles: 0, categories: 0, skipped: 0, deadlineReached: false };

    // Salons et rôles d'équipe.
    const regsSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .get();
    for (const doc of regsSnap.docs) {
      if (Date.now() > deadlineAtMs) { report.deadlineReached = true; break; }
      const d = doc.data();
      const textChannelId = d.discord?.textChannelId as string | undefined;
      const voiceChannelId = d.discord?.voiceChannelId as string | undefined;
      const roleId = d.discord?.roleId as string | undefined;
      if (!textChannelId && !voiceChannelId && !roleId) continue;

      const cleared: Record<string, unknown> = {};
      if (textChannelId && await deleteOwnedChannel(textChannelId)) {
        report.channels += 1;
        cleared['discord.textChannelId'] = null;
      }
      if (voiceChannelId && await deleteOwnedChannel(voiceChannelId)) {
        report.channels += 1;
        cleared['discord.voiceChannelId'] = null;
      }
      if (roleId && await deleteGuildRole(guildId, roleId)) {
        report.roles += 1;
        cleared['discord.roleId'] = null;
      }
      // Les identifiants effacés au fil de l'eau : un nettoyage interrompu se
      // relance sans retenter ce qui est déjà parti.
      if (Object.keys(cleared).length > 0) {
        cleared['discord.provisioningStatus'] = 'none';
        await doc.ref.update(cleared).catch(() => {});
      }
    }

    // Salons du registre « créés par le bot » UNIQUEMENT.
    const compUpdate: Record<string, unknown> = {};
    const removedChannelIds: string[] = [];
    for (const channelId of createdChannelIds) {
      if (Date.now() > deadlineAtMs) { report.deadlineReached = true; break; }
      if (await deleteOwnedChannel(channelId)) {
        report.channels += 1;
        removedChannelIds.push(channelId);
        if (options.announceChannelId === channelId) compUpdate['discord.options.announceChannelId'] = null;
        if (options.staffChannelId === channelId) compUpdate['discord.options.staffChannelId'] = null;
      }
    }
    if (removedChannelIds.length > 0) {
      compUpdate['discord.createdChannelIds'] = FieldValue.arrayRemove(...removedChannelIds);
    }
    // Salons désignés par l'organisateur parmi les siens : jamais touchés.
    for (const designated of [options.announceChannelId, options.staffChannelId]) {
      if (designated && !createdChannelIds.includes(designated)) report.skipped += 1;
    }

    // Catégories du tournoi (principale + débordements), vides à ce stade.
    const removedCategoryIds: string[] = [];
    for (const categoryId of categoryIds) {
      if (Date.now() > deadlineAtMs) { report.deadlineReached = true; break; }
      if (await deleteOwnedChannel(categoryId)) {
        report.categories += 1;
        removedCategoryIds.push(categoryId);
      }
    }
    if (removedCategoryIds.length > 0) {
      compUpdate['discord.categoryIds'] = FieldValue.arrayRemove(...removedCategoryIds);
      if (removedCategoryIds.includes(comp.discord?.categoryId as string)) {
        compUpdate['discord.categoryId'] = null;
      }
    }

    // Rôle participant : COMMUN au circuit (spec §7). On ne le supprime que
    // pour une compétition isolée — sinon les autres étapes le perdraient.
    const participantRoleId = comp.discord?.participantRoleId as string | undefined;
    if (participantRoleId && !comp.circuitId) {
      if (await deleteGuildRole(guildId, participantRoleId)) {
        report.roles += 1;
        compUpdate['discord.participantRoleId'] = null;
      }
    } else if (participantRoleId) {
      report.skipped += 1;
    }

    if (Object.keys(compUpdate).length > 0) {
      compUpdate.updatedAt = FieldValue.serverTimestamp();
      await compRef.update(compUpdate);
    }

    await writeAdminAuditLog(db, {
      action: 'competition_discord_cleanup',
      adminUid: uid,
      targetType: 'competition',
      targetId: id,
      targetLabel: (comp.name as string) ?? null,
      metadata: { ...report },
    });

    return NextResponse.json({ success: true, report });
  } catch (err) {
    captureApiError('API Admin/Competitions/DiscordCleanup POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
