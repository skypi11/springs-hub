import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotifications } from '@/lib/notifications';
import { addJoinHistory, closeOpenHistory } from '@/lib/member-history';
import { addAuditLog } from '@/lib/audit-log';
import { bumpStructureCounter } from '@/lib/structure-counters';

// POST /api/structures/join — rejoindre une structure (via lien ou demande)
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, structureId, token, game, role, message } = body;

    if (!action) return NextResponse.json({ error: 'action requis' }, { status: 400 });

    const db = getAdminDb();

    switch (action) {
      // ── Rejoindre via un lien d'invitation ──
      case 'join_via_link': {
        if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 400 });

        // Lookup hors-tx : on retrouve le doc par le token (pas de query possible en tx).
        const linksSnap = await db.collection('structure_invitations')
          .where('type', '==', 'invite_link')
          .where('token', '==', token)
          .where('status', '==', 'active')
          .limit(1)
          .get();
        if (linksSnap.empty) {
          return NextResponse.json({ error: 'Lien d\'invitation invalide ou expiré.' }, { status: 400 });
        }
        const linkRef = linksSnap.docs[0].ref;

        const INVITE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

        // Transaction atomique : toutes les vérifs + les writes dans la même tx.
        // La source de vérité pour "1 structure par jeu" est `users.structurePerGame` :
        // lire ce doc en tx garantit qu'une double-acceptation concurrente retry l'une d'elles.
        try {
          const result = await db.runTransaction(async (tx) => {
            const linkDoc = await tx.get(linkRef);
            if (!linkDoc.exists) throw new Error('INVALID_LINK');
            const linkData = linkDoc.data()!;
            if (linkData.status !== 'active') throw new Error('INVALID_LINK');

            const expiresMs = linkData.expiresAt?.toDate?.()?.getTime?.()
              ?? (linkData.createdAt?.toDate?.()?.getTime?.() != null
                    ? linkData.createdAt.toDate().getTime() + INVITE_LINK_TTL_MS
                    : null);
            if (typeof expiresMs === 'number' && expiresMs < Date.now()) {
              tx.update(linkRef, { status: 'expired' });
              throw new Error('EXPIRED');
            }

            if (linkData.targetUserId && linkData.targetUserId !== uid) {
              throw new Error('NOT_FOR_YOU');
            }

            const sid: string = linkData.structureId;
            const structRef = db.collection('structures').doc(sid);
            const structDoc = await tx.get(structRef);
            if (!structDoc.exists || structDoc.data()!.status !== 'active') {
              throw new Error('STRUCTURE_INACTIVE');
            }
            const structData = structDoc.data()!;
            const joinGame: string = linkData.game || game || structData.games?.[0] || 'rocket_league';

            // Membership check via doc ID déterministe (évite une query)
            const memberRef = db.collection('structure_members').doc(`${sid}_${uid}`);
            const memberDoc = await tx.get(memberRef);
            if (memberDoc.exists) throw new Error('ALREADY_MEMBER');

            // Invariant 1-struct/jeu via users.structurePerGame (source de vérité)
            const userRef = db.collection('users').doc(uid);
            const userDoc = await tx.get(userRef);
            const spg = (userDoc.exists && (userDoc.data()!.structurePerGame || {})) || {};
            if (spg[joinGame] && spg[joinGame] !== sid) {
              throw new Error('ALREADY_HAS_GAME_STRUCTURE');
            }

            // Writes atomiques
            tx.set(memberRef, {
              structureId: sid,
              userId: uid,
              game: joinGame,
              role: 'joueur',
              joinedAt: FieldValue.serverTimestamp(),
            });
            if (userDoc.exists) {
              tx.update(userRef, { [`structurePerGame.${joinGame}`]: sid });
            }
            if (linkData.targetUserId) {
              tx.update(linkRef, {
                status: 'used',
                usedAt: FieldValue.serverTimestamp(),
                usedBy: uid,
              });
            }
            addJoinHistory(db, tx, {
              structureId: sid,
              userId: uid,
              game: joinGame,
              role: 'joueur',
              reason: linkData.targetUserId ? 'targeted_link' : 'invite_link',
            });
            addAuditLog(db, tx, {
              structureId: sid,
              action: 'member_joined',
              actorUid: uid,
              targetUid: uid,
              targetId: linkRef.id,
              metadata: {
                game: joinGame,
                via: linkData.targetUserId ? 'targeted_link' : 'invite_link',
              },
            });
            bumpStructureCounter(db, tx, sid, 'members', +1);

            return { sid, structureName: structData.name };
          });

          return NextResponse.json({ success: true, structureId: result.sid, structureName: result.structureName });
        } catch (err) {
          const code = (err as Error).message;
          const map: Record<string, { msg: string; status: number }> = {
            INVALID_LINK:              { msg: 'Lien d\'invitation invalide ou expiré.', status: 400 },
            EXPIRED:                   { msg: 'Ce lien d\'invitation a expiré.', status: 400 },
            NOT_FOR_YOU:               { msg: 'Ce lien d\'invitation n\'est pas pour toi.', status: 403 },
            STRUCTURE_INACTIVE:        { msg: 'Structure inactive.', status: 400 },
            ALREADY_MEMBER:            { msg: 'Tu es déjà membre de cette structure.', status: 400 },
            ALREADY_HAS_GAME_STRUCTURE:{ msg: 'Tu as déjà une structure pour ce jeu.', status: 400 },
          };
          const handled = map[code];
          if (handled) return NextResponse.json({ error: handled.msg }, { status: handled.status });
          throw err;
        }
      }

      // ── Faire une demande pour rejoindre ──
      case 'request_join': {
        if (!structureId) return NextResponse.json({ error: 'structureId requis' }, { status: 400 });

        // Vérifier structure active
        const structSnap = await db.collection('structures').doc(structureId).get();
        if (!structSnap.exists || structSnap.data()!.status !== 'active') {
          return NextResponse.json({ error: 'Structure inactive.' }, { status: 400 });
        }

        // Recrutement fermé = pas de demande spontanée (les invites directes restent OK,
        // elles passent par 'accept_direct_invite' / 'accept_invite_link').
        if (structSnap.data()!.recruiting?.active !== true) {
          return NextResponse.json({ error: 'Cette structure ne recrute pas actuellement.' }, { status: 403 });
        }

        // Vérifier pas déjà membre
        const existingSnap = await db.collection('structure_members')
          .where('structureId', '==', structureId)
          .where('userId', '==', uid)
          .get();
        if (!existingSnap.empty) {
          return NextResponse.json({ error: 'Tu es déjà membre de cette structure.' }, { status: 400 });
        }

        // Vérifier pas de demande en cours
        const pendingSnap = await db.collection('structure_invitations')
          .where('structureId', '==', structureId)
          .where('applicantId', '==', uid)
          .where('type', '==', 'join_request')
          .get();
        const hasPending = pendingSnap.docs.some(d => d.data().status === 'pending');
        if (hasPending) {
          return NextResponse.json({ error: 'Tu as déjà une demande en cours.' }, { status: 400 });
        }

        // Cap : un joueur ne peut pas spammer 50 structures.
        const MAX_PENDING_APPLICATIONS_PER_USER = 5;
        const allPendingSnap = await db.collection('structure_invitations')
          .where('applicantId', '==', uid)
          .where('type', '==', 'join_request')
          .where('status', '==', 'pending')
          .get();
        if (allPendingSnap.size >= MAX_PENDING_APPLICATIONS_PER_USER) {
          return NextResponse.json({
            error: `Limite atteinte : ${MAX_PENDING_APPLICATIONS_PER_USER} candidatures en attente maximum. Annule-en une d'abord.`,
          }, { status: 400 });
        }

        await db.collection('structure_invitations').add({
          type: 'join_request',
          structureId,
          applicantId: uid,
          game: game || null,
          role: role || 'joueur',
          message: message?.trim().slice(0, 500) || '',
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
        });

        // Notifier les dirigeants (fondateur + co-fondateurs + managers)
        const structData = structSnap.data()!;
        const leaderIds = Array.from(new Set([
          structData.founderId,
          ...(structData.coFounderIds ?? []),
          ...(structData.managerIds ?? []),
        ].filter(Boolean)));
        const applicantSnap = await db.collection('users').doc(uid).get();
        const applicantName = applicantSnap.exists
          ? (applicantSnap.data()!.displayName || applicantSnap.data()!.discordUsername || 'Un joueur')
          : 'Un joueur';
        await createNotifications(db, leaderIds.map(lid => ({
          userId: lid,
          type: 'join_request_received' as const,
          title: 'Nouvelle demande de recrutement',
          message: `${applicantName} souhaite rejoindre ${structData.name}`,
          link: '/community/my-structure',
          metadata: { structureId, applicantId: uid },
        })));

        return NextResponse.json({ success: true });
      }

      // ── Quitter une structure ──
      case 'leave': {
        if (!structureId) return NextResponse.json({ error: 'structureId requis' }, { status: 400 });

        // Vérifier que c'est bien un membre
        const memberSnap = await db.collection('structure_members')
          .where('structureId', '==', structureId)
          .where('userId', '==', uid)
          .get();
        if (memberSnap.empty) {
          return NextResponse.json({ error: 'Tu n\'es pas membre de cette structure.' }, { status: 400 });
        }

        const memberDoc = memberSnap.docs[0];
        const memberData = memberDoc.data();

        // Un fondateur ne peut pas quitter
        if (memberData.role === 'fondateur') {
          return NextResponse.json({ error: 'Le fondateur ne peut pas quitter sa structure. Transfère la propriété d\'abord.' }, { status: 400 });
        }

        // Préparer toutes les updates en un seul batch atomique
        const userRef = db.collection('users').doc(uid);
        const [userSnap, teamsSnap] = await Promise.all([
          userRef.get(),
          db.collection('sub_teams').where('structureId', '==', structureId).get(),
        ]);

        const batch = db.batch();
        batch.delete(memberDoc.ref);

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
          if (td.playerIds?.includes(uid)) updates.playerIds = td.playerIds.filter((id: string) => id !== uid);
          if (td.subIds?.includes(uid)) updates.subIds = td.subIds.filter((id: string) => id !== uid);
          if (td.staffIds?.includes(uid)) updates.staffIds = td.staffIds.filter((id: string) => id !== uid);
          if (Object.keys(updates).length > 0) batch.update(teamDoc.ref, updates);
        }

        await closeOpenHistory(db, batch, {
          structureId,
          userId: uid,
          game: memberData.game,
          reason: 'left',
        });
        addAuditLog(db, batch, {
          structureId,
          action: 'member_left',
          actorUid: uid,
          targetUid: uid,
          metadata: { game: memberData.game, previousRole: memberData.role ?? null },
        });
        bumpStructureCounter(db, batch, structureId, 'members', -1);

        await batch.commit();
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Join POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
