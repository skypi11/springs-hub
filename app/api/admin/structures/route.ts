import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

const MAX_STRUCTURES = 500;

// GET /api/admin/structures — lister toutes les structures (admin only)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    // Filtre status pousé côté Firestore quand fourni
    const statusFilter = req.nextUrl.searchParams.get('status');
    let query: FirebaseFirestore.Query = db.collection('structures');
    if (statusFilter) query = query.where('status', '==', statusFilter);
    const snap = await query.limit(MAX_STRUCTURES).get();

    // Charger tous les fondateurs en un seul batch
    const founderIds = snap.docs.map(d => d.data().founderId).filter(Boolean);
    const foundersById = await fetchDocsByIds(db, 'users', founderIds);

    const structures = snap.docs.map(doc => {
      const data = doc.data();
      const founder = foundersById.get(data.founderId);
      return {
        id: doc.id,
        ...data,
        founderName: founder?.displayName || founder?.discordUsername || '',
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() ?? null,
        validatedAt: data.validatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({
      structures,
      truncated: snap.size >= MAX_STRUCTURES,
      max: MAX_STRUCTURES,
    });
  } catch (err) {
    captureApiError('API Admin/Structures GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/structures — approuver / refuser / suspendre / supprimer
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

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
      case 'approve': {
        // Atomique : status structure + isFounderApproved + ajout membre fondateur
        // Doc ID déterministe pour qu'un double-clic écrive sur le même doc (idempotent).
        const memberRef = db.collection('structure_members').doc(`${structureId}_${data.founderId}`);
        const userRef = db.collection('users').doc(data.founderId);
        const batch = db.batch();
        batch.update(ref, {
          status: 'active',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: FieldValue.serverTimestamp(),
        });
        batch.update(userRef, { isFounderApproved: true });
        batch.set(memberRef, {
          structureId,
          userId: data.founderId,
          game: data.games?.[0] || 'rocket_league',
          role: 'fondateur',
          joinedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();
        break;
      }

      case 'reject':
        await ref.update({
          status: 'rejected',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case 'suspend':
        await ref.update({
          status: 'suspended',
          reviewComment: comment || '',
          suspendedBy: uid,
          suspendedAt: FieldValue.serverTimestamp(),
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

      case 'schedule_deletion': {
        // Marquer pour suppression dans 7 jours — le délai laisse la possibilité d'annuler
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        await ref.update({
          status: 'deletion_scheduled',
          reviewComment: comment || '',
          deletionScheduledAt: FieldValue.serverTimestamp(),
          deletionExecutesAt: new Date(Date.now() + sevenDaysMs),
          deletionRequestedBy: uid,
        });
        break;
      }

      case 'cancel_deletion':
        await ref.update({
          status: 'active',
          deletionScheduledAt: null,
          deletionExecutesAt: null,
          deletionRequestedBy: null,
        });
        break;

      case 'delete': {
        // Suppression immédiate — atomique avec les memberships associés.
        // Réservé aux cas où la suppression différée n'est pas adaptée
        // (rejet d'une demande, structure abandonnée).
        const members = await db.collection('structure_members')
          .where('structureId', '==', structureId).get();
        const batch = db.batch();
        members.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(ref);
        await batch.commit();
        break;
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Structures POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
