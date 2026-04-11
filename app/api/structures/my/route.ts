import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';

// GET /api/structures/my — récupérer les structures où l'utilisateur est fondateur/co-fondateur
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const db = getAdminDb();

    // Structures en tant que fondateur
    const founderSnap = await db.collection('structures')
      .where('founderId', '==', uid)
      .get();

    const structures = [];

    for (const doc of founderSnap.docs) {
      const data = doc.data();

      // Récupérer les membres
      const membersSnap = await db.collection('structure_members')
        .where('structureId', '==', doc.id)
        .get();

      const members = [];
      for (const mDoc of membersSnap.docs) {
        const mData = mDoc.data();
        let playerInfo = { displayName: '', discordUsername: '', discordAvatar: '', avatarUrl: '', country: '' };
        try {
          const userSnap = await db.collection('users').doc(mData.userId).get();
          if (userSnap.exists) {
            const u = userSnap.data()!;
            playerInfo = {
              displayName: u.displayName || u.discordUsername || '',
              discordUsername: u.discordUsername || '',
              discordAvatar: u.discordAvatar || '',
              avatarUrl: u.avatarUrl || '',
              country: u.country || '',
            };
          }
        } catch { /* skip */ }
        members.push({ id: mDoc.id, ...mData, ...playerInfo });
      }

      structures.push({
        id: doc.id,
        ...data,
        members,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() ?? null,
        validatedAt: data.validatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    return NextResponse.json({ structures });
  } catch (err) {
    console.error('[API Structures/my] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// PUT /api/structures/my — mettre à jour une structure (fondateur/co-fondateur)
export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const { structureId, ...updates } = body;

    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('structures').doc(structureId);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const data = snap.data()!;

    // Vérifier que l'utilisateur est fondateur ou co-fondateur
    const isFounder = data.founderId === uid;
    const isCoFounder = (data.coFounderIds ?? []).includes(uid);
    if (!isFounder && !isCoFounder) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Structure suspendue = pas de modification
    if (data.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue — modifications bloquées.' }, { status: 403 });
    }

    // Champs modifiables par le fondateur
    const allowedFields = [
      'description', 'logoUrl', 'discordUrl', 'socials', 'recruiting', 'achievements',
    ];
    const safeUpdates: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        safeUpdates[key] = updates[key];
      }
    }

    await ref.update(safeUpdates);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Structures/my] PUT error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
