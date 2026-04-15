import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';

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

// GET /api/structures/invitations?structureId=xxx — lister les invitations & demandes
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const structureId = req.nextUrl.searchParams.get('structureId');
    if (!structureId) return NextResponse.json({ error: 'structureId requis' }, { status: 400 });

    const structureData = await checkManageAccess(uid, structureId);
    if (!structureData) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // Liens d'invitation actifs
    const linksSnap = await db.collection('structure_invitations')
      .where('structureId', '==', structureId)
      .where('type', '==', 'invite_link')
      .get();

    const links = linksSnap.docs
      .filter(d => d.data().status === 'active')
      .map(d => {
        const data = d.data();
        return { id: d.id, ...data, createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null };
      });

    // Demandes de rejoindre en attente
    const requestsSnap = await db.collection('structure_invitations')
      .where('structureId', '==', structureId)
      .where('type', '==', 'join_request')
      .get();

    const pendingDocs = requestsSnap.docs.filter(d => d.data().status === 'pending');
    const applicantIds = pendingDocs.map(d => d.data().applicantId).filter(Boolean);
    const usersById = await fetchDocsByIds(db, 'users', applicantIds);

    const requests = pendingDocs.map(doc => {
      const data = doc.data();
      const u = usersById.get(data.applicantId);
      return {
        id: doc.id,
        ...data,
        displayName: u?.displayName || u?.discordUsername || '',
        discordAvatar: u?.discordAvatar || '',
        avatarUrl: u?.avatarUrl || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ links, requests });
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
    const { action, structureId, invitationId, game, role } = body;

    if (!structureId || !action) {
      return NextResponse.json({ error: 'structureId et action requis' }, { status: 400 });
    }

    const structureData = await checkManageAccess(uid, structureId);
    if (!structureData) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    switch (action) {
      // ── Créer un lien d'invitation ──
      case 'create_link': {
        const token = randomUUID();
        await db.collection('structure_invitations').add({
          type: 'invite_link',
          structureId,
          createdBy: uid,
          token,
          status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ success: true, token });
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
        const joinRole = role || 'joueur';

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

        // 3 writes atomiques : member + invitation status + user.structurePerGame
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

        await batch.commit();
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
