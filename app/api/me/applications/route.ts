import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { addJoinHistory } from '@/lib/member-history';
import { addAuditLog } from '@/lib/audit-log';
import { bumpStructureCounter } from '@/lib/structure-counters';

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

        // Transaction atomique pour l'invariant "1 structure par jeu"
        // (voir commentaire équivalent dans /api/structures/join).
        let structureName = '';
        try {
          await db.runTransaction(async (tx) => {
            const invDoc = await tx.get(ref);
            if (!invDoc.exists || invDoc.data()!.status !== 'pending') {
              throw new Error('INVALID_INVITE');
            }

            const structRef = db.collection('structures').doc(structureId);
            const structDoc = await tx.get(structRef);
            if (!structDoc.exists || structDoc.data()!.status !== 'active') {
              throw new Error('STRUCTURE_INACTIVE');
            }
            structureName = structDoc.data()!.name;

            const memberRef = db.collection('structure_members').doc(`${structureId}_${uid}`);
            const memberDoc = await tx.get(memberRef);
            if (memberDoc.exists) throw new Error('ALREADY_MEMBER');

            const userRef = db.collection('users').doc(uid);
            const userDoc = await tx.get(userRef);
            const spg = (userDoc.exists && (userDoc.data()!.structurePerGame || {})) || {};
            if (spg[joinGame] && spg[joinGame] !== structureId) {
              throw new Error('ALREADY_HAS_GAME_STRUCTURE');
            }

            tx.set(memberRef, {
              structureId,
              userId: uid,
              game: joinGame,
              role: joinRole,
              joinedAt: FieldValue.serverTimestamp(),
            });
            tx.update(ref, {
              status: 'accepted',
              acceptedAt: FieldValue.serverTimestamp(),
            });
            if (userDoc.exists) {
              tx.update(userRef, { [`structurePerGame.${joinGame}`]: structureId });
            }
            addJoinHistory(db, tx, {
              structureId,
              userId: uid,
              game: joinGame,
              role: joinRole,
              reason: 'direct_invite',
            });
            addAuditLog(db, tx, {
              structureId,
              action: 'member_joined',
              actorUid: uid,
              targetUid: uid,
              targetId: invitationId,
              metadata: { game: joinGame, role: joinRole, via: 'direct_invite' },
            });
            bumpStructureCounter(db, tx, structureId, 'members', +1);
          });
        } catch (err) {
          const code = (err as Error).message;
          const map: Record<string, { msg: string; status: number }> = {
            INVALID_INVITE:            { msg: 'Invitation déjà traitée', status: 400 },
            STRUCTURE_INACTIVE:        { msg: 'Structure inactive', status: 400 },
            ALREADY_MEMBER:            { msg: 'Déjà membre de cette structure', status: 400 },
            ALREADY_HAS_GAME_STRUCTURE:{ msg: 'Tu as déjà une structure pour ce jeu', status: 400 },
          };
          const handled = map[code];
          if (handled) return NextResponse.json({ error: handled.msg }, { status: handled.status });
          throw err;
        }

        // Notifier le fondateur qui a envoyé l'invite (hors tx, best-effort)
        if (data.createdBy) {
          await createNotification(db, {
            userId: data.createdBy,
            type: 'direct_invite_accepted',
            title: 'Invitation acceptée',
            message: `Un joueur a rejoint ${structureName} via ton invitation`,
            link: '/community/my-structure',
            metadata: { structureId, playerId: uid },
          });
        }

        return NextResponse.json({ success: true, structureId, structureName });
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
