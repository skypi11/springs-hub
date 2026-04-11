import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';

// POST /api/structures/join — rejoindre une structure (via lien ou demande)
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const { action, structureId, token, game, message } = body;

    if (!action) return NextResponse.json({ error: 'action requis' }, { status: 400 });

    const db = getAdminDb();

    switch (action) {
      // ── Rejoindre via un lien d'invitation ──
      case 'join_via_link': {
        if (!token) return NextResponse.json({ error: 'Token requis' }, { status: 400 });

        // Trouver le lien
        const linksSnap = await db.collection('structure_invitations')
          .where('type', '==', 'invite_link')
          .where('token', '==', token)
          .where('status', '==', 'active')
          .get();

        if (linksSnap.empty) {
          return NextResponse.json({ error: 'Lien d\'invitation invalide ou expiré.' }, { status: 400 });
        }

        const linkDoc = linksSnap.docs[0];
        const linkData = linkDoc.data();
        const sid = linkData.structureId;

        // Vérifier que la structure est active
        const structSnap = await db.collection('structures').doc(sid).get();
        if (!structSnap.exists || structSnap.data()!.status !== 'active') {
          return NextResponse.json({ error: 'Structure inactive.' }, { status: 400 });
        }

        const structData = structSnap.data()!;
        const joinGame = game || structData.games?.[0] || 'rocket_league';

        // Vérifier pas déjà membre
        const existingSnap = await db.collection('structure_members')
          .where('structureId', '==', sid)
          .where('userId', '==', uid)
          .get();
        if (!existingSnap.empty) {
          return NextResponse.json({ error: 'Tu es déjà membre de cette structure.' }, { status: 400 });
        }

        // Vérifier contrainte 1 structure par jeu
        const playerStructSnap = await db.collection('structure_members')
          .where('userId', '==', uid)
          .where('game', '==', joinGame)
          .get();
        if (!playerStructSnap.empty) {
          return NextResponse.json({ error: 'Tu as déjà une structure pour ce jeu.' }, { status: 400 });
        }

        // Ajouter comme membre
        await db.collection('structure_members').add({
          structureId: sid,
          userId: uid,
          game: joinGame,
          role: 'joueur',
          joinedAt: new Date(),
        });

        // Mettre à jour structurePerGame
        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const userData = userSnap.data()!;
          const spg = userData.structurePerGame || {};
          spg[joinGame] = sid;
          await userRef.update({ structurePerGame: spg });
        }

        return NextResponse.json({ success: true, structureId: sid, structureName: structData.name });
      }

      // ── Faire une demande pour rejoindre ──
      case 'request_join': {
        if (!structureId) return NextResponse.json({ error: 'structureId requis' }, { status: 400 });

        // Vérifier structure active
        const structSnap = await db.collection('structures').doc(structureId).get();
        if (!structSnap.exists || structSnap.data()!.status !== 'active') {
          return NextResponse.json({ error: 'Structure inactive.' }, { status: 400 });
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

        await db.collection('structure_invitations').add({
          type: 'join_request',
          structureId,
          applicantId: uid,
          game: game || null,
          message: message?.trim() || '',
          status: 'pending',
          createdAt: new Date(),
        });

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

        // Nettoyer structurePerGame
        const userRef = db.collection('users').doc(uid);
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
          if (td.playerIds?.includes(uid)) updates.playerIds = td.playerIds.filter((id: string) => id !== uid);
          if (td.subIds?.includes(uid)) updates.subIds = td.subIds.filter((id: string) => id !== uid);
          if (td.staffIds?.includes(uid)) updates.staffIds = td.staffIds.filter((id: string) => id !== uid);
          if (Object.keys(updates).length > 0) await teamDoc.ref.update(updates);
        }

        await memberDoc.ref.delete();
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    console.error('[API Join] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
