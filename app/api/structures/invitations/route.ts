import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { addJoinHistory, closeOpenHistory } from '@/lib/member-history';

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

    const links = linksSnap.docs
      .filter(d => d.data().status === 'active')
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          token: data.token,
          game: data.game || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
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
        await db.collection('structure_invitations').add({
          type: 'invite_link',
          structureId,
          createdBy: uid,
          token,
          game: linkGame,
          targetUserId: targetedUserId,
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ success: true, token, targeted: !!targetedUserId });
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
        return NextResponse.json({ success: true });
      }

      // ── Accepter une demande de rejoindre ──
      case 'accept_request': {
        if (!invitationId) return NextResponse.json({ error: 'invitationId requis' }, { status: 400 });
        const ref = db.collection('structure_invitations').doc(invitationId);
        const snap = await ref.get();
        if (!snap.exists) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
        const data = snap.data()!;
        if (data.structureId !== structureId || data.status !== 'pending') {
          return NextResponse.json({ error: 'Demande invalide' }, { status: 400 });
        }

        const applicantId = data.applicantId;
        const joinGame = game || data.game || structureData.games?.[0] || 'rocket_league';
        // On persiste le rôle demandé par le joueur (si valide), sinon fallback sur le body, sinon joueur.
        const joinRole = data.role || role || 'joueur';

        // Vérifications hors-transaction (lecture seule, on tolère un petit risque de race
        // car les writes sont atomiques juste après et ce flow est manuel par un fondateur)
        const [existingSnap, playerStructSnap] = await Promise.all([
          db.collection('structure_members').where('structureId', '==', structureId).where('userId', '==', applicantId).get(),
          db.collection('structure_members').where('userId', '==', applicantId).where('game', '==', joinGame).get(),
        ]);
        if (!existingSnap.empty) {
          await ref.update({ status: 'accepted' });
          return NextResponse.json({ error: 'Déjà membre de cette structure' }, { status: 400 });
        }
        if (!playerStructSnap.empty) {
          return NextResponse.json({ error: `Ce joueur a déjà une structure pour ce jeu.` }, { status: 400 });
        }

        // Lire le profil joueur pour mettre à jour structurePerGame
        const userRef = db.collection('users').doc(applicantId);
        const userSnap = await userRef.get();
        const spg = (userSnap.exists && (userSnap.data()!.structurePerGame || {})) || {};
        spg[joinGame] = structureId;

        // 3 writes atomiques : member + invitation status + user.structurePerGame + history
        // Doc ID déterministe pour qu'un double-clic écrive sur le même doc (idempotent).
        const batch = db.batch();
        const newMemberRef = db.collection('structure_members').doc(`${structureId}_${applicantId}`);
        batch.set(newMemberRef, {
          structureId,
          userId: applicantId,
          game: joinGame,
          role: joinRole,
          joinedAt: FieldValue.serverTimestamp(),
        });
        batch.update(ref, {
          status: 'accepted',
          acceptedBy: uid,
          acceptedAt: FieldValue.serverTimestamp(),
        });
        if (userSnap.exists) {
          batch.update(userRef, { structurePerGame: spg });
        }
        addJoinHistory(db, batch, {
          structureId,
          userId: applicantId,
          game: joinGame,
          role: joinRole,
          reason: 'join_request',
        });
        await batch.commit();

        // Notifier le joueur que sa demande a été acceptée
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
