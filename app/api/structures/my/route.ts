import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

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

    if (founderSnap.empty) {
      return NextResponse.json({ structures: [] });
    }

    // Charger tous les memberships des structures de l'utilisateur en une requête,
    // puis tous les profils joueurs en un seul batch.
    const structureIds = founderSnap.docs.map(d => d.id);
    const membersByStructure = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    const allUserIds: string[] = [];

    // Firestore 'in' max 30 — paginer si beaucoup de structures (rare ici, max 2 par fondateur)
    for (let i = 0; i < structureIds.length; i += 30) {
      const chunk = structureIds.slice(i, i + 30);
      const snap = await db.collection('structure_members').where('structureId', 'in', chunk).get();
      for (const mDoc of snap.docs) {
        const m = mDoc.data();
        if (!membersByStructure.has(m.structureId)) membersByStructure.set(m.structureId, []);
        membersByStructure.get(m.structureId)!.push(mDoc);
        if (m.userId) allUserIds.push(m.userId);
      }
    }

    const usersById = await fetchDocsByIds(db, 'users', allUserIds);

    const structures = founderSnap.docs.map(doc => {
      const data = doc.data();
      const memberDocs = membersByStructure.get(doc.id) ?? [];
      const members = memberDocs.map(mDoc => {
        const mData = mDoc.data();
        const u = usersById.get(mData.userId);
        return {
          id: mDoc.id,
          ...mData,
          displayName: u?.displayName || u?.discordUsername || '',
          discordUsername: u?.discordUsername || '',
          discordAvatar: u?.discordAvatar || '',
          avatarUrl: u?.avatarUrl || '',
          country: u?.country || '',
        };
      });

      return {
        id: doc.id,
        ...data,
        members,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() ?? null,
        validatedAt: data.validatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ structures });
  } catch (err) {
    captureApiError('API Structures/my GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// PUT /api/structures/my — mettre à jour une structure (fondateur/co-fondateur)
export async function PUT(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

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

    // Champs modifiables par le fondateur — chaque champ est validé/sanitized
    const safeUpdates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (updates.description !== undefined) {
      safeUpdates.description = clampString(updates.description, LIMITS.structureDescription);
    }
    if (updates.logoUrl !== undefined) {
      safeUpdates.logoUrl = safeUrl(updates.logoUrl);
    }
    if (updates.discordUrl !== undefined) {
      safeUpdates.discordUrl = safeUrl(updates.discordUrl);
    }
    if (updates.socials !== undefined && typeof updates.socials === 'object' && updates.socials !== null) {
      const s = updates.socials as Record<string, unknown>;
      safeUpdates.socials = {
        twitter: safeUrl(s.twitter),
        youtube: safeUrl(s.youtube),
        twitch: safeUrl(s.twitch),
        instagram: safeUrl(s.instagram),
        tiktok: safeUrl(s.tiktok),
        website: safeUrl(s.website),
      };
    }
    if (updates.recruiting !== undefined) {
      safeUpdates.recruiting = updates.recruiting;
    }
    if (updates.achievements !== undefined && Array.isArray(updates.achievements)) {
      // Cap à 50 entrées pour limiter la taille du document
      safeUpdates.achievements = updates.achievements.slice(0, 50);
    }

    await ref.update(safeUpdates);
    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/my PUT error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
