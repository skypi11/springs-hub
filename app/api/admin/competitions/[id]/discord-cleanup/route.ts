import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { deleteChannel, deleteGuildRole } from '@/lib/discord-competition';
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

    const options = (comp.discord?.options ?? {}) as {
      createAnnounceChannel?: boolean;
      announceChannelId?: string | null;
      createStaffChannel?: boolean;
      staffChannelId?: string | null;
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
      if (textChannelId && await deleteChannel(textChannelId)) {
        report.channels += 1;
        cleared['discord.textChannelId'] = null;
      }
      if (voiceChannelId && await deleteChannel(voiceChannelId)) {
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

    // Salons créés PAR LE BOT uniquement.
    const compUpdate: Record<string, unknown> = {};
    if (options.createAnnounceChannel && options.announceChannelId) {
      if (await deleteChannel(options.announceChannelId)) {
        report.channels += 1;
        compUpdate['discord.options.announceChannelId'] = null;
      }
    } else if (options.announceChannelId) {
      report.skipped += 1;   // salon existant de l'organisateur : on n'y touche pas
    }
    if (options.createStaffChannel && options.staffChannelId) {
      if (await deleteChannel(options.staffChannelId)) {
        report.channels += 1;
        compUpdate['discord.options.staffChannelId'] = null;
      }
    } else if (options.staffChannelId) {
      report.skipped += 1;
    }

    // Catégorie du tournoi (vide à ce stade) — Discord la supprime même
    // pleine, mais les salons sont déjà partis.
    const categoryId = comp.discord?.categoryId as string | undefined;
    if (categoryId && await deleteChannel(categoryId)) {
      report.categories += 1;
      compUpdate['discord.categoryId'] = null;
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
