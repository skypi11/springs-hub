import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { countDirigeantSeats, MAX_SEATS_PER_PERSON, type DirigeantRef } from '@/lib/structure-roles';
import { sendAdminAlert } from '@/lib/admin-discord-alert';
import { canJoinStructure, addStructureToGame, STRUCTURE_MEMBERSHIP_CAP } from '@/lib/structure-membership';

const LEGAL_STATUSES = ['none', 'asso_1901', 'auto_entreprise', 'sas_sarl', 'other'];

// POST /api/structures/request, soumettre une demande de création de structure
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

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

    // Vérifier que l'utilisateur n'a pas déjà 2 sièges dirigeant (fondateur + co-fondateur cumulés)
    // Deux requêtes séparées car Firestore n'aime pas combiner array-contains et plusieurs filtres
    const [asFounderSnap, asCoFounderSnap] = await Promise.all([
      db.collection('structures').where('founderId', '==', uid).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', uid).get(),
    ]);
    const refs: DirigeantRef[] = [
      ...asFounderSnap.docs.map(d => ({
        id: d.id,
        founderId: d.data().founderId,
        coFounderIds: d.data().coFounderIds ?? [],
        status: d.data().status,
      })),
      ...asCoFounderSnap.docs.map(d => ({
        id: d.id,
        founderId: d.data().founderId,
        coFounderIds: d.data().coFounderIds ?? [],
        status: d.data().status,
      })),
    ];
    if (countDirigeantSeats(refs, uid) >= MAX_SEATS_PER_PERSON) {
      return NextResponse.json({
        error: `Tu occupes déjà le maximum de ${MAX_SEATS_PER_PERSON} sièges dirigeant (fondateur + co-fondateur).`,
      }, { status: 400 });
    }

    // Check cap "max N structures par jeu" pour TOUS les jeux que la nouvelle
    // structure couvre. Mode strict : on inclut les pending dans le compte.
    const userSnap = await db.collection('users').doc(uid).get();
    const userSpg = (userSnap.exists && (userSnap.data()!.structurePerGame || {})) || {};
    for (const g of body.games) {
      // structureId pas encore connu, on passe une sentinelle qui ne matchera
      // aucune struct existante, donc seul le cap importe.
      const check = canJoinStructure(userSpg, g, '__new__');
      if (!check.ok && check.reason === 'cap_reached') {
        return NextResponse.json({
          error: `Tu es déjà dans ${STRUCTURE_MEMBERSHIP_CAP} structures sur ${g} (max). Quitte-en une avant de pouvoir en fonder une nouvelle.`,
        }, { status: 400 });
      }
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
      // Plan freemium par défaut : 'free'. Sera switché en 'pro' manuellement
      // par un admin ou via webhook subscription (cf. lib/plan-limits.ts).
      plan: 'free',
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection('structures').add(structureData);

    // Compte la struct dans le cap dès la création (mode strict : pending compte).
    // Sans ça, un user peut soumettre 10 demandes pending et toutes les voir validées
    // au-delà du cap. addStructureToGame est idempotent (dédup si déjà présent).
    if (userSnap.exists) {
      const updates: Record<string, unknown> = {};
      for (const g of body.games) {
        updates[`structurePerGame.${g}`] = addStructureToGame(userSpg, g, docRef.id);
      }
      await db.collection('users').doc(uid).update(updates);
    }

    // Alerte admin sur le Discord Aedral, fire-and-forget (ne throw jamais).
    const founderSnap = await db.collection('users').doc(uid).get();
    const founderName = (founderSnap.data()?.displayName as string)
      || (founderSnap.data()?.discordUsername as string)
      || 'Un joueur';
    await sendAdminAlert(db, {
      title: '🏛️ Nouvelle demande de structure',
      description: `**${structureData.name}** \`[${structureData.tag}]\`\nDemandée par **${founderName}**.\nÀ valider dans le panel admin.`,
      url: `${req.nextUrl.origin}/admin/structures`,
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err) {
    captureApiError('API Structures/request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// GET /api/structures/request, récupérer les demandes de l'utilisateur connecté
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
