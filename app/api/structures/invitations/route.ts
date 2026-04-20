import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { addJoinHistory, closeOpenHistory } from '@/lib/member-history';
import { addAuditLog, writeAuditLog } from '@/lib/audit-log';
import { bumpStructureCounter } from '@/lib/structure-counters';

// Durée de validité d'un lien d'invitation. Au-delà, le lien est inactivable
// automatiquement à la consommation, pour éviter qu'un token leaké il y a 6 mois
// reste exploitable.
const INVITE_LINK_TTL_DAYS = 30;
const INVITE_LINK_TTL_MS = INVITE_LINK_TTL_DAYS * 24 * 60 * 60 * 1000;

// Vérifier fondateur/co-fondateur/manager
async function checkManageAccess(uid: string, structureId: string) {
  const db = getAdminDb();
  const snap = await db.collection('structures').doc(structureId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const isFounder = data.founderId === uid;
  const isCoFounder = (data.coFounderIds ?? []).includes(uid);
  const isManager = (data.managerIds ?? []).includes(uid);
  if (!isFounder && !isCoFounder && !isManager) return null;
  if (data.status !== 'active') return null;
  return data;
}

// Cap — nombre max d'invitations directes pending qu'une structure peut avoir en cours.
// Empêche le spam à l'inverse du cap côté joueur.
const MAX_PENDING_DIRECT_INVITES_PER_STRUCTURE = 10;

// GET /api/structures/invitations?structureId=xxx — lister les invitations, demandes et invites directes
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const structureId = req.nextUrl.searchParams.get('structureId');
    if (!structureId) return NextResponse.json({ error: 'structureId requis' }, { status: 400 });

    const structureData = await checkManageAccess(uid, structureId);
    if (!structureData) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // Tout d'un coup — un seul where par type
    const [linksSnap, requestsSnap, directInvitesSnap] = await Promise.all([
      db.collection('structure_invitations')
        .where('structureId', '==', structureId)
        .where('type', '==', 'invite_link').get(),
      db.collection('structure_invitations')
        .where('structureId', '==', structureId)
        .where('type', '==', 'join_request').get(),
      db.collection('structure_invitations')
        .where('structureId', '==', structureId)
        .where('type', '==', 'direct_invite').get(),
    ]);

    const nowMs = Date.now();
    const links = linksSnap.docs
      .filter(d => {
        const data = d.data();
        if (data.status !== 'active') return false;
        // Masquer les liens qui ont dépassé leur TTL (fallback createdAt+TTL
        // pour les anciens liens créés avant l'introduction du champ expiresAt).
        const effectiveExpiresMs = data.expiresAt?.toDate?.()?.getTime?.()
          ?? (data.createdAt?.toDate?.()?.getTime?.() != null
                ? data.createdAt.toDate().getTime() + INVITE_LINK_TTL_MS
                : null);
        if (typeof effectiveExpiresMs === 'number' && effectiveExpiresMs < nowMs) return false;
        return true;
      })
      .map(d => {
        const data = d.data();
        const effectiveExpiresMs = data.expiresAt?.toDate?.()?.getTime?.()
          ?? (data.createdAt?.toDate?.()?.getTime?.() != null
                ? data.createdAt.toDate().getTime() + INVITE_LINK_TTL_MS
                : null);
        return {
          id: d.id,
          token: data.token,
          game: data.game || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
          expiresAt: effectiveExpiresMs != null ? new Date(effectiveExpiresMs).toISOString() : null,
        };
      });

    // Demandes en attente (joueur → structure) — enrichies avec le profil
    const pendingRequestDocs = requestsSnap.docs.filter(d => d.data().status === 'pending');
    const applicantIds = pendingRequestDocs.map(d => d.data().applicantId).filter(Boolean);

    // Invites directes envoyées — on ne retourne que ce qui est encore pending ou cancelled récent
    const pendingInviteDocs = directInvitesSnap.docs.filter(d => d.data().status === 'pending');
    const targetIds = pendingInviteDocs.map(d => d.data().targetUserId).filter(Boolean);

    const allUserIds = Array.from(new Set([...applicantIds, ...targetIds]));
    const usersById = await fetchDocsByIds(db, 'users', allUserIds);

    const requests = pendingRequestDocs.map(doc => {
      const data = doc.data();
      const u = usersById.get(data.applicantId);
      return {
        id: doc.id,
        type: 'join_request' as const,
        applicantId: data.applicantId,
        game: data.game || '',
        role: data.role || 'joueur',
        message: data.message || '',
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        country: u?.country || '',
        rlRank: u?.rlStats?.rank || u?.rlRank || '',
        rlMmr: u?.rlStats?.mmr || u?.rlMmr || null,
        pseudoTM: u?.pseudoTM || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    const directInvites = pendingInviteDocs.map(doc => {
      const data = doc.data();
      const u = usersById.get(data.targetUserId);
      return {
        id: doc.id,
        type: 'direct_invite' as const,
        targetUserId: data.targetUserId,
        game: data.game || '',
        role: data.role || 'joueur',
        message: data.message || '',
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        country: u?.country || '',
        rlRank: u?.rlStats?.rank || u?.rlRank || '',
        rlMmr: u?.rlStats?.mmr || u?.rlMmr || null,
        pseudoTM: u?.pseudoTM || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ links, requests, directInvites });
  } catch (err) {
    captureApiError('API Invitations GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/invitations — actions sur invitations
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, structureId, invitationId, game, role, targetUserId, message } = body;

    if (!structureId || !action) {
      return NextResponse.json({ error: 'structureId et action requis' }, { status: 400 });
    }

    const structureData = await checkManageAccess(uid, structureId);
    if (!structureData) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    switch (action) {
      // ── Créer un lien d'invitation ──
      // Variante 1 : lien générique (réutilisable)
      // Variante 2 : lien ciblé single-use (si targetUserId fourni) — Phase 3 item M
      case 'create_link': {
        // Jeu optionnel mais pré-rempli côté joueur quand fourni → évite le double choix.
        const linkGame = game && typeof game === 'string' ? game : null;
        if (linkGame && structureData.games && !structureData.games.includes(linkGame)) {
          return NextResponse.json({ error: 'Jeu non supporté par la structure' }, { status: 400 });
        }

        const targetedUserId = typeof targetUserId === 'string' && targetUserId.trim() ? targetUserId.trim() : null;
        if (targetedUserId) {
          if (targetedUserId === uid) {
            return NextResponse.json({ error: 'Impossible de se cibler soi-même' }, { status: 400 });
          }
          // Le joueur doit exister
          const tSnap = await db.collection('users').doc(targetedUserId).get();
          if (!tSnap.exists) {
            return NextResponse.json({ error: 'Joueur introuvable' }, { status: 404 });
          }
          // Pas déjà membre pour ce jeu si le jeu est précisé
          if (linkGame) {
            const already = await db.collection('structure_members')
              .where('userId', '==', targetedUserId)
              .where('game', '==', linkGame)
              .get();
            if (!already.empty) {
              return NextResponse.json({ error: 'Ce joueur a déjà une structure pour ce jeu' }, { status: 400 });
            }
          }
          // Un seul lien ciblé actif à la fois pour un (structure, target, game)
          const existing = await db.collection('structure_invitations')
            .where('structureId', '==', structureId)
            .where('type', '==', 'invite_link')
            .where('targetUserId', '==', targetedUserId)
            .where('status', '==', 'active')
            .get();
          const sameGame = existing.docs.find(d => (d.data().game || null) === linkGame);
          if (sameGame) {
            return NextResponse.json({
              success: true,
              token: sameGame.data().token,
              targeted: true,
              reused: true,
            });
          }
        }

        const token = randomUUID();
        const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_LINK_TTL_MS);
        const newLinkRef = await db.collection('structure_invitations').add({
          type: 'invite_link',
          structureId,
          createdBy: uid,
          token,
          game: linkGame,
          targetUserId: targetedUserId,
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
          expiresAt,
        });
        await writeAuditLog(db, {
          structureId,
          action: 'invite_link_created',
          actorUid: uid,
          targetUid: targetedUserId ?? null,
          targetId: newLinkRef.id,
          metadata: { game: linkGame, targeted: !!targetedUserId },
        });
        return NextResponse.json({
          success: true,
          token,
          targeted: !!targetedUserId,
          expiresAt: expiresAt.toDate().toISOString(),
        });
      }

      // ── Révoquer un lien d'invitation ──
      case 'revoke_link': {
        if (!invitationId) return NextResponse.json({ error: 'invitationId requis' }, { status: 400 });
        const ref = db.collection('structure_invitations').doc(invitationId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 });
        }
        await ref.update({ status: 'expired' });
        await writeAuditLog(db, {
          structureId,
          action: 'invite_link_revoked',
          actorUid: uid,
          targetId: invitationId,
        });
        return NextResponse.json({ success: true });
      }

      // ── Accepter une demande de rejoindre ──
      case 'accept_request': {
        if (!invitationId) return NextResponse.json({ error: 'invitationId requis' }, { status: 400 });
        const invRef = db.collection('structure_invitations').doc(invitationId);

        // Transaction atomique. Invariant "1 structure par jeu" : on lit `users.structurePerGame`
        // en tx — deux acceptations concurrentes sur deux structures différentes pour le même jeu
        // seront sérialisées par Firestore (l'une retry et verra la valeur écrite par l'autre).
        let applicantId: string = '';
        let joinGame: string = '';
        let joinRole: string = '';
        try {
          await db.runTransaction(async (tx) => {
            const invDoc = await tx.get(invRef);
            if (!invDoc.exists) throw new Error('NOT_FOUND');
            const data = invDoc.data()!;
            if (data.structureId !== structureId || data.status !== 'pending') {
              throw new Error('INVALID_REQUEST');
            }

            applicantId = data.applicantId;
            joinGame = game || data.game || structureData.games?.[0] || 'rocket_league';
            joinRole = data.role || role || 'joueur';

            const memberRef = db.collection('structure_members').doc(`${structureId}_${applicantId}`);
            const memberDoc = await tx.get(memberRef);
            if (memberDoc.exists) throw new Error('ALREADY_MEMBER');

            const userRef = db.collection('users').doc(applicantId);
            const userDoc = await tx.get(userRef);
            const spg = (userDoc.exists && (userDoc.data()!.structurePerGame || {})) || {};
            if (spg[joinGame] && spg[joinGame] !== structureId) {
              throw new Error('ALREADY_HAS_GAME_STRUCTURE');
            }

            tx.set(memberRef, {
              structureId,
              userId: applicantId,
              game: joinGame,
              role: joinRole,
              joinedAt: FieldValue.serverTimestamp(),
            });
            tx.update(invRef, {
              status: 'accepted',
              acceptedBy: uid,
              acceptedAt: FieldValue.serverTimestamp(),
            });
            if (userDoc.exists) {
              tx.update(userRef, { [`structurePerGame.${joinGame}`]: structureId });
            }
            addJoinHistory(db, tx, {
              structureId,
              userId: applicantId,
              game: joinGame,
              role: joinRole,
              reason: 'join_request',
            });
            addAuditLog(db, tx, {
              structureId,
              action: 'join_request_accepted',
              actorUid: uid,
              targetUid: applicantId,
              targetId: invitationId,
              metadata: { game: joinGame, role: joinRole },
            });
            bumpStructureCounter(db, tx, structureId, 'members', +1);
          });
        } catch (err) {
          const code = (err as Error).message;
          const map: Record<string, { msg: string; status: number }> = {
            NOT_FOUND:                 { msg: 'Demande introuvable', status: 404 },
            INVALID_REQUEST:           { msg: 'Demande invalide', status: 400 },
            ALREADY_MEMBER:            { msg: 'Déjà membre de cette structure', status: 400 },
            ALREADY_HAS_GAME_STRUCTURE:{ msg: 'Ce joueur a déjà une structure pour ce jeu.', status: 400 },
          };
          const handled = map[code];
          if (handled) return NextResponse.json({ error: handled.msg }, { status: handled.status });
          throw err;
        }

        // Notifier le joueur que sa demande a été acceptée (hors tx, best-effort)
        await createNotification(db, {
          userId: applicantId,
          type: 'join_request_accepted',
          title: 'Demande acceptée',
          message: `Bienvenue dans ${structureData.name} !`,
          link: `/community/structure/${structureId}`,
          metadata: { structureId },
        });

        return NextResponse.json({ success: true });
      }

      // ── Refuser une demande ──
      case 'decline_request': {
        if (!invitationId) return NextResponse.json({ error: 'invitationId requis' }, { status: 400 });
        const ref = db.collection('structure_invitations').doc(invitationId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
        }
        const declineData = snap.data()!;
        await ref.update({
          status: 'declined',
          declinedBy: uid,
          declinedAt: FieldValue.serverTimestamp(),
        });
        await writeAuditLog(db, {
          structureId,
          action: 'join_request_declined',
          actorUid: uid,
          targetUid: declineData.applicantId ?? null,
          targetId: invitationId,
        });

        // Notifier le joueur que sa demande a été refusée
        if (declineData.applicantId) {
          await createNotification(db, {
            userId: declineData.applicantId,
            type: 'join_request_declined',
            title: 'Demande refusée',
            message: `${structureData.name} n'a pas retenu ta candidature pour le moment.`,
            link: '/community/structures',
            metadata: { structureId },
          });
        }

        return NextResponse.json({ success: true });
      }

      // ── Retirer un membre ──
      case 'remove_member': {
        const { memberId } = body;
        if (!memberId) return NextResponse.json({ error: 'memberId requis' }, { status: 400 });
        const ref = db.collection('structure_members').doc(memberId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 });
        }
        const memberData = snap.data()!;

        // Ne pas pouvoir retirer le fondateur
        if (memberData.role === 'fondateur') {
          return NextResponse.json({ error: 'Impossible de retirer le fondateur' }, { status: 400 });
        }

        // Préparer le nettoyage : profil joueur + équipes — tout en un seul batch atomique
        const userRef = db.collection('users').doc(memberData.userId);
        const [userSnap, teamsSnap] = await Promise.all([
          userRef.get(),
          db.collection('sub_teams').where('structureId', '==', structureId).get(),
        ]);

        const batch = db.batch();
        batch.delete(ref);

        if (userSnap.exists) {
          const spg = userSnap.data()!.structurePerGame || {};
          if (spg[memberData.game] === structureId) {
            delete spg[memberData.game];
            batch.update(userRef, { structurePerGame: spg });
          }
        }

        for (const teamDoc of teamsSnap.docs) {
          const td = teamDoc.data();
          const updates: Record<string, unknown> = {};
          if (td.playerIds?.includes(memberData.userId)) {
            updates.playerIds = td.playerIds.filter((id: string) => id !== memberData.userId);
          }
          if (td.subIds?.includes(memberData.userId)) {
            updates.subIds = td.subIds.filter((id: string) => id !== memberData.userId);
          }
          if (td.staffIds?.includes(memberData.userId)) {
            updates.staffIds = td.staffIds.filter((id: string) => id !== memberData.userId);
          }
          if (Object.keys(updates).length > 0) {
            batch.update(teamDoc.ref, updates);
          }
        }

        await closeOpenHistory(db, batch, {
          structureId,
          userId: memberData.userId,
          game: memberData.game,
          reason: 'removed',
        });
        addAuditLog(db, batch, {
          structureId,
          action: 'member_removed',
          actorUid: uid,
          targetUid: memberData.userId,
          metadata: { game: memberData.game, previousRole: memberData.role ?? null },
        });
        bumpStructureCounter(db, batch, structureId, 'members', -1);

        await batch.commit();
        return NextResponse.json({ success: true });
      }

      // ── Inviter un joueur précis depuis un profil / annuaire ──
      case 'direct_invite': {
        if (!targetUserId || typeof targetUserId !== 'string') {
          return NextResponse.json({ error: 'targetUserId requis' }, { status: 400 });
        }
        if (!game || typeof game !== 'string') {
          return NextResponse.json({ error: 'game requis' }, { status: 400 });
        }
        if (structureData.games && !structureData.games.includes(game)) {
          return NextResponse.json({ error: 'Jeu non supporté par la structure' }, { status: 400 });
        }
        if (targetUserId === uid) {
          return NextResponse.json({ error: 'Impossible de s\'inviter soi-même' }, { status: 400 });
        }

        // Le joueur existe et est ouvert au recrutement
        const targetRef = db.collection('users').doc(targetUserId);
        const targetSnap = await targetRef.get();
        if (!targetSnap.exists) {
          return NextResponse.json({ error: 'Joueur introuvable' }, { status: 404 });
        }
        const targetData = targetSnap.data()!;
        if (!targetData.isAvailableForRecruitment) {
          return NextResponse.json({ error: 'Ce joueur n\'est pas ouvert au recrutement' }, { status: 400 });
        }

        // Déjà membre d'une structure pour ce jeu ?
        const alreadyMemberSnap = await db.collection('structure_members')
          .where('userId', '==', targetUserId)
          .where('game', '==', game)
          .get();
        if (!alreadyMemberSnap.empty) {
          return NextResponse.json({ error: 'Ce joueur a déjà une structure pour ce jeu' }, { status: 400 });
        }

        // Cap : anti-spam côté structure
        const existingInvitesSnap = await db.collection('structure_invitations')
          .where('structureId', '==', structureId)
          .where('type', '==', 'direct_invite')
          .where('status', '==', 'pending')
          .get();
        if (existingInvitesSnap.size >= MAX_PENDING_DIRECT_INVITES_PER_STRUCTURE) {
          return NextResponse.json({
            error: `Limite atteinte : ${MAX_PENDING_DIRECT_INVITES_PER_STRUCTURE} invitations en attente maximum`,
          }, { status: 400 });
        }

        // Pas déjà une invite pending pour ce joueur+jeu
        const duplicate = existingInvitesSnap.docs.find(d => {
          const dd = d.data();
          return dd.targetUserId === targetUserId && dd.game === game;
        });
        if (duplicate) {
          return NextResponse.json({ error: 'Une invitation est déjà en attente pour ce joueur' }, { status: 400 });
        }

        const inviteRef = await db.collection('structure_invitations').add({
          type: 'direct_invite',
          structureId,
          createdBy: uid,
          targetUserId,
          game,
          role: role || 'joueur',
          message: typeof message === 'string' ? message.trim().slice(0, 500) : '',
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });

        await createNotification(db, {
          userId: targetUserId,
          type: 'direct_invite_received',
          title: 'Invitation reçue',
          message: `${structureData.name} t'invite à rejoindre la structure`,
          link: '/community/my-applications',
          metadata: { structureId, invitationId: inviteRef.id, game },
        });

        await writeAuditLog(db, {
          structureId,
          action: 'direct_invite_sent',
          actorUid: uid,
          targetUid: targetUserId,
          targetId: inviteRef.id,
          metadata: { game, role: role || 'joueur' },
        });

        return NextResponse.json({ success: true, invitationId: inviteRef.id });
      }

      // ── Annuler une invitation directe envoyée ──
      case 'cancel_direct_invite': {
        if (!invitationId) return NextResponse.json({ error: 'invitationId requis' }, { status: 400 });
        const ref = db.collection('structure_invitations').doc(invitationId);
        const snap = await ref.get();
        if (!snap.exists || snap.data()!.structureId !== structureId || snap.data()!.type !== 'direct_invite') {
          return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 });
        }
        if (snap.data()!.status !== 'pending') {
          return NextResponse.json({ error: 'Invitation déjà traitée' }, { status: 400 });
        }
        await ref.update({
          status: 'cancelled',
          cancelledBy: uid,
          cancelledAt: FieldValue.serverTimestamp(),
        });
        await writeAuditLog(db, {
          structureId,
          action: 'direct_invite_cancelled',
          actorUid: uid,
          targetUid: snap.data()!.targetUserId ?? null,
          targetId: invitationId,
        });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Invitations POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
