import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';

// Vérifier que l'utilisateur est admin Springs
async function isAdmin(uid: string): Promise<boolean> {
  const db = getAdminDb();
  const snap = await db.collection('admins').doc(uid).get();
  return snap.exists;
}

// GET /api/admin/structures — lister toutes les structures (admin only)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const statusFilter = req.nextUrl.searchParams.get('status');

    let query = db.collection('structures').orderBy('createdAt', 'desc');
    if (statusFilter) {
      query = db.collection('structures')
        .where('status', '==', statusFilter)
        .orderBy('createdAt', 'desc');
    }

    const snap = await query.get();
    const structures = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      // Enrichir avec le nom du fondateur
      let founderName = '';
      try {
        const founderSnap = await db.collection('users').doc(data.founderId).get();
        if (founderSnap.exists) {
          founderName = founderSnap.data()?.displayName || founderSnap.data()?.discordUsername || '';
        }
      } catch { /* skip */ }

      structures.push({
        id: doc.id,
        ...data,
        founderName,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() ?? null,
        validatedAt: data.validatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    return NextResponse.json({ structures });
  } catch (err) {
    console.error('[API Admin/Structures] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/structures — approuver / refuser / suspendre / supprimer
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const body = await req.json();
    const { structureId, action, comment } = body;

    if (!structureId || !action) {
      return NextResponse.json({ error: 'structureId et action requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db.collection('structures').doc(structureId);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const data = snap.data()!;

    switch (action) {
      case 'approve':
        await ref.update({
          status: 'active',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: new Date(),
        });
        // Marquer le fondateur comme approuvé
        await db.collection('users').doc(data.founderId).update({
          isFounderApproved: true,
        });
        // Ajouter le fondateur comme membre de la structure
        await db.collection('structure_members').add({
          structureId,
          userId: data.founderId,
          game: data.games?.[0] || 'rocket_league',
          role: 'fondateur',
          joinedAt: new Date(),
        });
        break;

      case 'reject':
        await ref.update({
          status: 'rejected',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: new Date(),
        });
        break;

      case 'suspend':
        await ref.update({
          status: 'suspended',
          reviewComment: comment || '',
          suspendedBy: uid,
          suspendedAt: new Date(),
        });
        break;

      case 'unsuspend':
        await ref.update({
          status: 'active',
          reviewComment: comment || '',
          suspendedBy: null,
          suspendedAt: null,
        });
        break;

      case 'delete':
        // Supprimer les membres associés
        const members = await db.collection('structure_members')
          .where('structureId', '==', structureId).get();
        const batch = db.batch();
        members.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(ref);
        await batch.commit();
        break;

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Admin/Structures] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
