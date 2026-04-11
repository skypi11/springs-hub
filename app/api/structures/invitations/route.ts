import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';

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
      .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() ?? null }))
      .filter((l: any) => l.status === 'active');

    // Demandes de rejoindre en attente
    const requestsSnap = await db.collection('structure_invitations')
      .where('structureId', '==', structureId)
      .where('type', '==', 'join_request')
      .get();

    const requests = [];
    for (const doc of requestsSnap.docs) {
      const data = doc.data();
      if (data.status !== 'pending') continue;
      // Enrichir avec infos joueur
      let playerInfo = { displayName: '', discordAvatar: '', avatarUrl: '' };
      try {
        const userSnap = await db.collection('users').doc(data.applicantId).get();
        if (userSnap.exists) {
          const u = userSnap.data()!;
          playerInfo = {
            displayName: u.displayName || u.discordUsername || '',
            discordAvatar: u.discordAvatar || '',
            avatarUrl: u.avatarUrl || '',
          };
        }
      } catch { /* skip */ }
      requests.push({
        id: doc.id,
        ...data,
        ...playerInfo,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    return NextResponse.json({ links, requests });
  } catch (err) {
    console.error('[API Invitations] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/invitations — actions sur invitations
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

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
          createdAt: new Date(),
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

        // Vérifier que le joueur n'est pas déjà membre
        const existingSnap = await db.collection('structure_members')
          .where('structureId', '==', structureId)
          .where('userId', '==', applicantId)
          .get();
        if (!existingSnap.empty) {
          await ref.update({ status: 'accepted' });
          return NextResponse.json({ error: 'Déjà membre de cette structure' }, { status: 400 });
        }

        // Vérifier contrainte : 1 structure par jeu
        const playerStructSnap = await db.collection('structure_members')
          .where('userId', '==', applicantId)
          .where('game', '==', joinGame)
          .get();
        if (!playerStructSnap.empty) {
          return NextResponse.json({ error: `Ce joueur a déjà une structure pour ce jeu.` }, { status: 400 });
        }

        // Ajouter comme membre
        await db.collection('structure_members').add({
          structureId,
          userId: applicantId,
          game: joinGame,
          role: joinRole,
          joinedAt: new Date(),
        });

        // Mettre à jour structurePerGame du joueur
        const userRef = db.collection('users').doc(applicantId);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const userData = userSnap.data()!;
          const spg = userData.structurePerGame || {};
          spg[joinGame] = structureId;
          await userRef.update({ structurePerGame: spg });
        }

        await ref.update({ status: 'accepted', acceptedBy: uid, acceptedAt: new Date() });
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
        await ref.update({ status: 'declined', declinedBy: uid, declinedAt: new Date() });
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

        // Nettoyer structurePerGame du joueur
        const userRef = db.collection('users').doc(memberData.userId);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const userData = userSnap.data()!;
          const spg = userData.structurePerGame || {};
          if (spg[memberData.game] === structureId) {
            delete spg[memberData.game];
            await userRef.update({ structurePerGame: spg });
          }
        }

        // Retirer des équipes
        const teamsSnap = await db.collection('sub_teams')
          .where('structureId', '==', structureId)
          .get();
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
            await teamDoc.ref.update(updates);
          }
        }

        await ref.delete();
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    console.error('[API Invitations] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
