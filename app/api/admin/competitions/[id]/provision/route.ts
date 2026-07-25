import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import {
  countChannelsInCategory,
  createCategory,
  ensureCompetitionShared,
  MAX_CHANNELS_PER_CATEGORY,
  provisionRegistration,
} from '@/lib/discord-competition';
import { guildBlocker } from '@/lib/competitions/discord-guard';

// Provisioning Discord d'une compétition (archi §6) — bouton console
// « Provisionner ». L'approbation ne parle JAMAIS à Discord : elle pose
// `provisioningStatus: 'queued'`, cette route traite le batch.
//
// - Idempotent : chaque ID créé (rôle, salons) est stocké au fil de l'eau sur
//   le doc registration — relancer le bouton reprend exactement où le batch
//   s'est arrêté, sans rien recréer.
// - Verrou anti-concurrence sur le doc compétition : deux passages simultanés
//   dupliqueraient rôles et salons (les IDs d'un run sont invisibles de l'autre).
// - Backoff 429 générique dans lib/discord-competition (retry_after respecté).
// - Deadline dure, vérifiée entre équipes ET entre calls d'une même équipe :
//   on sort proprement avant le timeout Vercel et on renvoie un rapport
//   partiel — le passage suivant continue (pattern admin/messages).

export const maxDuration = 300;
// 80 s de marge : la deadline est vérifiée AVANT un appel Discord, et un seul
// appel peut attendre jusqu'à ~60 s sous rate-limit (4 tentatives × 15 s). Avec
// 50 s de marge, un salon pouvait être créé pendant que la fonction se faisait
// tuer — l'identifiant n'était jamais stocké, et la relance en recréait un.
const HARD_DEADLINE_MS = 220_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const deadlineAtMs = Date.now() + HARD_DEADLINE_MS;

    const compRef = db.collection('competitions').doc(id);
    const compSnap = await compRef.get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;
    const guildId = comp.discord?.guildId as string | undefined;
    if (!guildId) {
      return NextResponse.json({ error: 'Aucun serveur Discord configuré sur cette compétition.' }, { status: 400 });
    }

    // Pose du verrou (transaction, bail automatique à expiration — couvre le
    // cas d'une fonction tuée sans passer par le finally).
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(compRef);
        const lockedUntil = snap.data()?.discord?.provisioningLockedUntil as Timestamp | undefined;
        if (lockedUntil && lockedUntil.toMillis() > Date.now()) {
          throw new Error('provisioning_locked');
        }
        tx.update(compRef, {
          'discord.provisioningLockedUntil': Timestamp.fromMillis(deadlineAtMs + 30_000),
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'provisioning_locked') {
        return NextResponse.json(
          { error: 'Un provisioning est déjà en cours sur cette compétition. Attends la fin du passage en cours.' },
          { status: 409 },
        );
      }
      throw err;
    }

    try {
      // Rôle participant commun (au circuit si la compétition en a un) +
      // catégorie des salons : créés une seule fois.
      let circuitName: string | null = null;
      if (comp.circuitId) {
        const circuitSnap = await db.collection('circuits').doc(comp.circuitId as string).get();
        circuitName = (circuitSnap.data()?.name as string) ?? null;
      }
      // Le serveur est-il toujours administré par la personne qui lance le
      // provisioning ? Les droits ont pu changer depuis la création.
      const guildIssue = await guildBlocker(uid, guildId);
      if (guildIssue) return NextResponse.json({ error: guildIssue }, { status: 403 });

      // Réglages de l'organisateur (absents = comportement historique).
      const discordOptions = (comp.discord?.options ?? {}) as {
        teamChannels?: boolean;
        teamVoiceChannels?: boolean;
        categoryName?: string | null;
        staffRoleIds?: string[];
        participantRoleName?: string | null;
        announceChannelId?: string | null;
        createAnnounceChannel?: boolean;
        announceChannelName?: string | null;
        staffChannelId?: string | null;
        createStaffChannel?: boolean;
        staffChannelName?: string | null;
      };
      const teamChannels = discordOptions.teamChannels !== false;
      const staffRoleIds = Array.isArray(discordOptions.staffRoleIds) ? discordOptions.staffRoleIds : [];
      const competitionName = (comp.name as string) || 'Compétition';
      const shared = await ensureCompetitionShared(db, id, {
        guildId,
        circuitId: (comp.circuitId as string | null) ?? null,
        participantRoleId: (comp.discord?.participantRoleId as string | null) ?? null,
        categoryId: (comp.discord?.categoryId as string | null) ?? null,
        participantRoleLabel: discordOptions.participantRoleName?.trim()
          || `Participant · ${circuitName ?? competitionName}`,
        categoryLabel: discordOptions.categoryName?.trim() || competitionName,
        teamChannels,
        staffRoleIds,
        announce: {
          create: discordOptions.createAnnounceChannel === true,
          name: discordOptions.announceChannelName?.trim() || 'annonces',
          existingId: discordOptions.announceChannelId ?? null,
        },
        staffChannel: {
          create: discordOptions.createStaffChannel === true,
          name: discordOptions.staffChannelName?.trim() || 'staff-tournoi',
          existingId: discordOptions.staffChannelId ?? null,
        },
      });

      // Débordement de catégorie : Discord refuse au-delà de 50 salons dans
      // une même catégorie — 32 équipes en texte + vocal en demandent 64. On
      // compte ce qui existe déjà, et on ouvre une catégorie de plus quand la
      // suivante ne tiendrait pas (jamais un échec au 51e salon, en plein
      // tournoi).
      const channelsPerTeam = teamChannels ? (discordOptions.teamVoiceChannels === true ? 2 : 1) : 0;
      // Registre des catégories créées par le bot : sans lui, chaque relance
      // du provisioning repartait de la catégorie principale et rouvrait une
      // « (2) » de plus, jamais nettoyée.
      const knownCategories: string[] = Array.isArray(comp.discord?.categoryIds)
        ? (comp.discord.categoryIds as string[]).filter(Boolean)
        : (shared.categoryId ? [shared.categoryId] : []);
      let activeCategoryId = knownCategories[knownCategories.length - 1] ?? shared.categoryId;
      let overflowIndex = Math.max(1, knownCategories.length);

      let categoryUsed = 0;
      if (activeCategoryId && channelsPerTeam > 0) {
        const counted = await countChannelsInCategory(guildId, activeCategoryId);
        if (counted === null) {
          // Compter est la seule façon de savoir quand déborder : sans ce
          // chiffre, on créerait des salons jusqu'au refus de Discord au 51e,
          // en plein tournoi. On préfère demander de réessayer.
          return NextResponse.json(
            { error: 'Impossible de lire les salons du serveur Discord pour le moment — réessaie dans un instant.' },
            { status: 503 },
          );
        }
        categoryUsed = counted;
      }

      const categoryBaseName = discordOptions.categoryName?.trim() || competitionName;
      const categoryWithRoom = async (): Promise<string | null> => {
        if (!activeCategoryId || channelsPerTeam === 0) return activeCategoryId;
        if (categoryUsed + channelsPerTeam <= MAX_CHANNELS_PER_CATEGORY) return activeCategoryId;
        overflowIndex += 1;
        activeCategoryId = await createCategory(guildId, `${categoryBaseName} (${overflowIndex})`.slice(0, 100));
        categoryUsed = 0;
        await compRef.update({ 'discord.categoryIds': FieldValue.arrayUnion(activeCategoryId) });
        return activeCategoryId;
      };

      // Équipes validées pas encore provisionnées ('none' inclus : approuvées
      // avant la configuration du serveur Discord).
      const regsSnap = await db.collection('competition_registrations')
        .where('competitionId', '==', id)
        .where('status', '==', 'approved')
        .get();
      const toProcess = regsSnap.docs.filter(d =>
        (d.data().discord?.provisioningStatus ?? 'none') !== 'done');

      const report = {
        total: toProcess.length,
        done: 0,
        partial: 0,
        errors: 0,
        deadlineReached: false,
        teams: [] as Array<{ name: string; status: string; warnings: string[] }>,
      };

      for (const doc of toProcess) {
        if (Date.now() > deadlineAtMs) {
          report.deadlineReached = true;
          break;
        }
        // Le batch travaille sur un snapshot : une équipe unapprove/reject
        // pendant le passage ne doit pas être provisionnée — re-lecture
        // fraîche du statut (et des IDs déjà créés) juste avant de la traiter.
        const freshSnap = await doc.ref.get();
        if (!freshSnap.exists || freshSnap.data()?.status !== 'approved') continue;
        const r = freshSnap.data()!;
        const roster = ((r.roster as Array<Record<string, unknown>>) ?? []).map(m => ({
          discordId: (m.discordId as string) ?? '',
          displayName: (m.displayName as string) ?? '',
        }));
        try {
          const result = await provisionRegistration(db, shared, {
            registrationId: doc.id,
            teamName: (r.name as string) || 'Équipe',
            roster,
            discord: {
              roleId: (r.discord?.roleId as string | null) ?? null,
              textChannelId: (r.discord?.textChannelId as string | null) ?? null,
              voiceChannelId: (r.discord?.voiceChannelId as string | null) ?? null,
            },
          }, {
            deadlineAtMs,
            teamChannels,
            voiceChannels: discordOptions.teamVoiceChannels === true,
            staffRoleIds,
            categoryId: await categoryWithRoom(),
            // Un salon vide ne dit rien à personne : le bot pose le cadre dès
            // sa création.
            welcome: {
              title: competitionName,
              message: 'Votre salon d’équipe pour le tournoi. Le staff vous contactera ici : codes de room, litiges, informations de dernière minute. Check-in et horaires sur votre page de tournoi.',
              link: `https://aedral.com/competitions/${id}`,
            },
          });
          // Salons RÉELLEMENT créés : compter « ce qu'une équipe devrait
          // avoir » surestimait à chaque reprise (les équipes déjà
          // provisionnées ne créent plus rien) et faisait déborder trop tôt.
          categoryUsed += result.channelsCreated;
          if (result.status === 'done') report.done += 1;
          else report.partial += 1;
          report.teams.push({ name: (r.name as string) ?? '', status: result.status, warnings: result.warnings });
        } catch (err) {
          report.errors += 1;
          const message = err instanceof Error ? err.message.slice(0, 300) : 'Erreur inconnue';
          report.teams.push({ name: (r.name as string) ?? '', status: 'error', warnings: [message] });
          await doc.ref.update({
            'discord.provisioningStatus': 'error',
            'discord.errorMessage': message,
          }).catch(() => {});
          captureApiError('Discord provisioning registration failed', err);
        }
      }

      await writeAdminAuditLog(db, {
        action: 'competition_discord_provisioned',
        adminUid: uid,
        targetType: 'competition',
        targetId: id,
        targetLabel: (comp.name as string) ?? id,
        metadata: {
          total: report.total,
          done: report.done,
          partial: report.partial,
          errors: report.errors,
          deadlineReached: report.deadlineReached,
        },
      });

      return NextResponse.json({ success: true, report });
    } finally {
      // Libération du verrou quoi qu'il arrive (le bail à expiration couvre
      // le cas fonction tuée, ce finally couvre tous les autres).
      await compRef.update({ 'discord.provisioningLockedUntil': null }).catch(() => {});
    }
  } catch (err) {
    captureApiError('API Admin/Competitions/Provision POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
