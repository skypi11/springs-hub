import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { safeUrl, clampString, LIMITS } from '@/lib/validation';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { expiredDepartures } from '@/lib/structure-roles';

// Lazy-process les préavis de départ de co-fondateurs expirés sur une structure.
// Appelée au moment des lectures (pas de cron). Retire du coFounderIds, nettoie la map
// coFounderDepartures et rétrograde le membre en 'joueur' — le tout en batch.
// Retourne la data mise à jour (mergée localement) pour éviter un re-fetch.
async function processExpiredDepartures(
  db: FirebaseFirestore.Firestore,
  structureId: string,
  data: FirebaseFirestore.DocumentData
): Promise<FirebaseFirestore.DocumentData> {
  const departures = data.coFounderDepartures as Record<string, unknown> | undefined;
  const expired = expiredDepartures(departures);
  if (expired.length === 0) return data;

  const batch = db.batch();
  const structureRef = db.collection('structures').doc(structureId);
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const expiredUid of expired) {
    updates[`coFounderDepartures.${expiredUid}`] = FieldValue.delete();
  }
  updates.coFounderIds = FieldValue.arrayRemove(...expired);
  batch.update(structureRef, updates);

  // Rétrograder les membres correspondants
  for (const expiredUid of expired) {
    const memberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', expiredUid)
      .get();
    for (const mDoc of memberSnap.docs) {
      batch.update(mDoc.ref, { role: 'joueur' });
    }
  }
  await batch.commit();

  // Merge local : on retire les expirés du coFounderIds et de la map
  const nextCoFounderIds = (data.coFounderIds ?? []).filter((id: string) => !expired.includes(id));
  const nextDepartures = { ...(departures ?? {}) };
  for (const u of expired) delete nextDepartures[u];
  return { ...data, coFounderIds: nextCoFounderIds, coFounderDepartures: nextDepartures };
}

// GET /api/structures/my — récupère les structures où l'utilisateur a un accès dirigeant ou staff.
// - dirigeant : fondateur ou co-fondateur → accessLevel: 'dirigeant' (tout le dashboard)
// - staff     : manager ou coach (via structure_members.role OU sub_teams.staffIds)
//               → accessLevel: 'staff' (header + liste membres read-only + calendrier)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const db = getAdminDb();

    // 4 requêtes parallèles :
    //   - fondateur
    //   - co-fondateur
    //   - membre staff (role in [manager, coach])
    //   - staff d'une équipe (sub_teams.staffIds array-contains)
    const [founderSnap, coFounderSnap, memberSnap, teamStaffSnap] = await Promise.all([
      db.collection('structures').where('founderId', '==', uid).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', uid).get(),
      db.collection('structure_members').where('userId', '==', uid).get(),
      db.collection('sub_teams').where('staffIds', 'array-contains', uid).get(),
    ]);

    // Structures où l'user est dirigeant (accessLevel = 'dirigeant')
    const dirigeantIds = new Set<string>();
    const structureDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const d of founderSnap.docs) {
      dirigeantIds.add(d.id);
      structureDocs.set(d.id, d);
    }
    for (const d of coFounderSnap.docs) {
      dirigeantIds.add(d.id);
      structureDocs.set(d.id, d);
    }

    // Structures où l'user est staff non-dirigeant
    const staffStructureIds = new Set<string>();
    for (const m of memberSnap.docs) {
      const role = m.data().role as string | undefined;
      const structureId = m.data().structureId as string | undefined;
      if (structureId && (role === 'manager' || role === 'coach')) {
        staffStructureIds.add(structureId);
      }
    }
    for (const t of teamStaffSnap.docs) {
      const structureId = t.data().structureId as string | undefined;
      if (structureId) staffStructureIds.add(structureId);
    }
    // Ne pas dédoubler : si on est déjà dirigeant, on ne considère pas comme staff seul
    for (const id of dirigeantIds) staffStructureIds.delete(id);

    // Fetch les structures staff-only (celles qu'on n'a pas encore)
    if (staffStructureIds.size > 0) {
      const ids = Array.from(staffStructureIds);
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const snap = await db.collection('structures')
          .where('__name__', 'in', chunk)
          .get();
        for (const d of snap.docs) structureDocs.set(d.id, d);
      }
    }

    if (structureDocs.size === 0) {
      return NextResponse.json({ structures: [] });
    }

    // Lazy-process les préavis expirés uniquement sur les structures où l'user est dirigeant
    const structureDataById = new Map<string, FirebaseFirestore.DocumentData>();
    for (const [id, doc] of structureDocs) {
      if (dirigeantIds.has(id)) {
        const processed = await processExpiredDepartures(db, id, doc.data());
        structureDataById.set(id, processed);
      } else {
        structureDataById.set(id, doc.data());
      }
    }

    // Si l'utilisateur vient de perdre son siège de co-fondateur (préavis expiré),
    // on retire la structure de sa liste "dirigeant" — mais si c'est aussi une structure
    // staff, on la garde avec accessLevel 'staff'.
    for (const [id, data] of structureDataById) {
      if (!dirigeantIds.has(id)) continue;
      const isFounder = data.founderId === uid;
      const isCoFounder = (data.coFounderIds ?? []).includes(uid);
      if (!isFounder && !isCoFounder) {
        dirigeantIds.delete(id);
        if (!staffStructureIds.has(id)) {
          structureDataById.delete(id);
        }
      }
    }

    // Filtrer les structures staff-only qui ne sont pas active (pas de calendrier sur suspended/pending)
    for (const [id, data] of structureDataById) {
      if (dirigeantIds.has(id)) continue;
      if (data.status !== 'active') structureDataById.delete(id);
    }

    if (structureDataById.size === 0) {
      return NextResponse.json({ structures: [] });
    }

    // Charger tous les memberships des structures de l'utilisateur en une requête,
    // puis tous les profils joueurs en un seul batch.
    const structureIds = Array.from(structureDataById.keys());
    const membersByStructure = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    const allUserIds: string[] = [];

    // Firestore 'in' max 30 — paginer si beaucoup de structures (rare ici, max 2 par personne)
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

    const structures = structureIds.map(id => {
      const data = structureDataById.get(id)!;
      const memberDocs = membersByStructure.get(id) ?? [];
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

      // Sérialiser la map des préavis (Timestamps → ISO) pour le client
      const departuresRaw = (data.coFounderDepartures ?? {}) as Record<string, unknown>;
      const coFounderDepartures: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(departuresRaw)) {
        const t = v as { toDate?: () => Date } | null;
        coFounderDepartures[k] = t?.toDate?.()?.toISOString?.() ?? null;
      }

      return {
        id,
        ...data,
        coFounderDepartures,
        members,
        accessLevel: dirigeantIds.has(id) ? 'dirigeant' : 'staff',
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() ?? null,
        validatedAt: data.validatedAt?.toDate?.()?.toISOString() ?? null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
        transferredAt: data.transferredAt?.toDate?.()?.toISOString() ?? null,
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
