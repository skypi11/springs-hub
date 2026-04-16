import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { addJoinHistory } from '@/lib/member-history';

// GET /api/me/applications
// Retourne les demandes envoyées (join_request pending) + invitations reçues (direct_invite pending)
// du joueur courant, enrichies avec les infos de la structure.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const db = getAdminDb();

    const [sentSnap, receivedSnap] = await Promise.all([
      db.collection('structure_invitations')
        .where('applicantId', '==', uid)
        .where('type', '==', 'join_request')
        .where('status', '==', 'pending')
        .get(),
      db.collection('structure_invitations')
        .where('targetUserId', '==', uid)
        .where('type', '==', 'direct_invite')
        .where('status', '==', 'pending')
        .get(),
    ]);

    const structureIds = Array.from(new Set([
      ...sentSnap.docs.map(d => d.data().structureId),
      ...receivedSnap.docs.map(d => d.data().structureId),
    ].filter(Boolean)));
    const structuresById = await fetchDocsByIds(db, 'structures', structureIds);

    const enrichStructure = (sid: string) => {
      const s = structuresById.get(sid);
      return {
        id: sid,
        name: s?.name || '',
        tag: s?.tag || '',
        logoUrl: s?.logoUrl || '',
        games: s?.games || [],
      };
    };

    const sentRequests = sentSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        type: 'join_request' as const,
        game: data.game || '',
        role: data.role || 'joueur',
        message: data.message || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        structure: enrichStructure(data.structureId),
      };
    });

    const receivedInvites = receivedSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        type: 'direct_invite' as const,
        game: data.game || '',
        role: data.role || 'joueur',
        message: data.message || '',
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        structure: enrichStructure(data.structureId),
      };
    });

    return NextResponse.json({ sentRequests, receivedInvites });
  } catch (err) {
    captureApiError('API Me/Applications GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/me/applications — actions du joueur sur ses propres candidatures/invitations
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, invitationId } = body;

    if (!action || !invitationId) {
      return NextResponse.json({ error: 'action et invitationId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('structure_invitations').doc(invitationId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Invitation introuvable' }, { status: 404 });
    }
    const data = snap.data()!;

    switch (action) {
      // ── Annuler sa propre demande de recrutement ──
      case 'cancel_request': {
        if (data.type !== 'join_request' || data.applicantId !== uid) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }
        if (data.status !== 'pending') {
          return NextResponse.json({ error: 'Demande déjà traitée' }, { status: 400 });
        }
        await ref.update({
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ success: true });
      }

      // ── Accepter une invitation directe reçue ──
      case 'accept_invite': {
        if (data.type !== 'direct_invite' || data.targetUserId !== uid) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }
        if (data.status !== 'pending') {
          return NextResponse.json({ error: 'Invitation déjà traitée' }, { status: 400 });
        }

        const structureId = data.structureId;
        const joinGame = data.game;
        const joinRole = data.role || 'joueur';

        // Structure encore active ?
        const structRef = db.collection('structures').doc(structureId);
        const structSnap = await structRef.get();
        if (!structSnap.exists || structSnap.data()!.status !== 'active') {
          return NextResponse.json({ error: 'Structure inactive' }, { status: 400 });
        }
        const structData = structSnap.data()!;

        // Vérifs : pas déjà membre + pas déjà une autre structure pour ce jeu
        const [existingSnap, playerStructSnap] = await Promise.all([
          db.collection('structure_members').where('structureId', '==', structureId).where('userId', '==', uid).get(),
          db.collection('structure_members').where('userId', '==', uid).where('game', '==', joinGame).get(),
        ]);
        if (!existingSnap.empty) {
          await ref.update({ status: 'accepted' });
          return NextResponse.json({ error: 'Déjà membre de cette structure' }, { status: 400 });
        }
        if (!playerStructSnap.empty) {
          return NextResponse.json({ error: 'Tu as déjà une structure pour ce jeu' }, { status: 400 });
        }

        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        const spg = (userSnap.exists && (userSnap.data()!.structurePerGame || {})) || {};
        spg[joinGame] = structureId;

        // Atomique : member + invite accepted + user.structurePerGame + history
        const batch = db.batch();
        const newMemberRef = db.collection('structure_members').doc(`${structureId}_${uid}`);
        batch.set(newMemberRef, {
          structureId,
          userId: uid,
          game: joinGame,
          role: joinRole,
          joinedAt: FieldValue.serverTimestamp(),
        });
        batch.update(ref, {
          status: 'accepted',
          acceptedAt: FieldValue.serverTimestamp(),
        });
        if (userSnap.exists) {
          batch.update(userRef, { structurePerGame: spg });
        }
        addJoinHistory(db, batch, {
          structureId,
          userId: uid,
          game: joinGame,
          role: joinRole,
          reason: 'direct_invite',
        });
        await batch.commit();

        // Notifier le fondateur qui a envoyé l'invite
        if (data.createdBy) {
          await createNotification(db, {
            userId: data.createdBy,
            type: 'direct_invite_accepted',
            title: 'Invitation acceptée',
            message: `Un joueur a rejoint ${structData.name} via ton invitation`,
            link: '/community/my-structure',
            metadata: { structureId, playerId: uid },
          });
        }

        return NextResponse.json({ success: true, structureId, structureName: structData.name });
      }

      // ── Refuser une invitation directe reçue ──
      case 'decline_invite': {
        if (data.type !== 'direct_invite' || data.targetUserId !== uid) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }
        if (data.status !== 'pending') {
          return NextResponse.json({ error: 'Invitation déjà traitée' }, { status: 400 });
        }
        await ref.update({
          status: 'declined',
          declinedAt: FieldValue.serverTimestamp(),
        });

        // Notifier le fondateur
        if (data.createdBy) {
          const structSnap = await db.collection('structures').doc(data.structureId).get();
          const structName = structSnap.exists ? structSnap.data()!.name : 'une structure';
          await createNotification(db, {
            userId: data.createdBy,
            type: 'direct_invite_declined',
            title: 'Invitation refusée',
            message: `Un joueur a refusé l'invitation de ${structName}`,
            link: '/community/my-structure',
            metadata: { structureId: data.structureId },
          });
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Me/Applications POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
