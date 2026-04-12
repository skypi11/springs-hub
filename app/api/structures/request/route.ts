import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';

const LEGAL_STATUSES = ['none', 'asso_1901', 'auto_entreprise', 'sas_sarl', 'other'];

// POST /api/structures/request — soumettre une demande de création de structure
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await req.json();

    // Validation
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Le nom de la structure est obligatoire.' }, { status: 400 });
    }
    if (!body.tag?.trim()) {
      return NextResponse.json({ error: 'Le tag est obligatoire.' }, { status: 400 });
    }
    if (body.tag.trim().length > 5) {
      return NextResponse.json({ error: 'Le tag ne peut pas dépasser 5 caractères.' }, { status: 400 });
    }
    if (!body.games || body.games.length === 0) {
      return NextResponse.json({ error: 'Sélectionne au moins un jeu.' }, { status: 400 });
    }
    if (!body.description?.trim()) {
      return NextResponse.json({ error: 'La description est obligatoire.' }, { status: 400 });
    }
    if (body.legalStatus && !LEGAL_STATUSES.includes(body.legalStatus)) {
      return NextResponse.json({ error: 'Statut juridique invalide.' }, { status: 400 });
    }

    const db = getAdminDb();

    // Vérifier que l'utilisateur n'a pas déjà 2 structures en tant que fondateur
    const existingStructures = await db.collection('structures')
      .where('founderId', '==', uid)
      .where('status', 'in', ['pending_validation', 'active'])
      .get();

    if (existingStructures.size >= 2) {
      return NextResponse.json({ error: 'Tu ne peux pas créer plus de 2 structures.' }, { status: 400 });
    }

    // Vérifier que le nom ou tag n'est pas déjà pris (case-insensitive sur le nom)
    const nameLower = body.name.trim().toLowerCase();
    const tagUpper = body.tag.trim().toUpperCase();
    const [nameCheck, tagCheck] = await Promise.all([
      db.collection('structures').where('nameLower', '==', nameLower).get(),
      db.collection('structures').where('tag', '==', tagUpper).get(),
    ]);

    if (!nameCheck.empty) {
      return NextResponse.json({ error: 'Ce nom de structure est déjà pris.' }, { status: 400 });
    }
    if (!tagCheck.empty) {
      return NextResponse.json({ error: 'Ce tag est déjà pris.' }, { status: 400 });
    }

    // Créer la demande
    const structureData = {
      name: clampString(body.name, LIMITS.structureName),
      nameLower,
      tag: tagUpper,
      logoUrl: safeUrl(body.logoUrl),
      description: clampString(body.description, LIMITS.structureDescription),
      games: body.games,
      legalStatus: body.legalStatus || 'none',
      teamCount: Math.max(0, parseInt(body.teamCount) || 0),
      staffCount: Math.max(0, parseInt(body.staffCount) || 0),
      discordUrl: safeUrl(body.discordUrl),
      message: clampString(body.message, 1000),
      founderId: uid,
      coFounderIds: [],
      managerIds: [],
      coachIds: [],
      status: 'pending_validation',
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('structures').add(structureData);

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err) {
    captureApiError('API Structures/request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/structures/request — récupérer les demandes de l'utilisateur connecté
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const db = getAdminDb();
    const snap = await db.collection('structures')
      .where('founderId', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();

    const structures = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ structures });
  } catch (err) {
    captureApiError('API Structures/request GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
