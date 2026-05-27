import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { clampString, LIMITS } from '@/lib/validation';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { addJoinHistory } from '@/lib/member-history';
import { writeAdminAuditLog, type AdminAuditAction } from '@/lib/admin-audit-log';
import { computeStaffSize } from '@/lib/structure-counters';
import { addStructureToGame, removeStructureFromGame } from '@/lib/structure-membership';
import { isKnownGame } from '@/lib/games-registry';

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

    // Charger fondateurs + admins référencés (reviewedBy, suspendedBy, deletionRequestedBy)
    // en un seul batch pour éviter N lectures par structure.
    const userIds = new Set<string>();
    for (const d of snap.docs) {
      const data = d.data();
      if (data.founderId) userIds.add(data.founderId);
      if (data.reviewedBy) userIds.add(data.reviewedBy);
      if (data.suspendedBy) userIds.add(data.suspendedBy);
      if (data.deletionRequestedBy) userIds.add(data.deletionRequestedBy);
    }
    const usersById = await fetchDocsByIds(db, 'users', Array.from(userIds));
    const nameOf = (uid?: string | null) => {
      if (!uid) return '';
      const u = usersById.get(uid);
      return u?.displayName || u?.discordUsername || '';
    };

    const structures = snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        founderName: nameOf(data.founderId),
        reviewedByName: nameOf(data.reviewedBy),
        suspendedByName: nameOf(data.suspendedBy),
        deletionRequestedByName: nameOf(data.deletionRequestedBy),
        // Valeurs "annoncées" au formulaire de demande : data.teamCount / data.staffCount
        // Valeurs réelles : counters (teams, members) + staff dérivé des champs founder/co/manager/coach
        actualTeamCount: data.counters?.teams ?? 0,
        actualMemberCount: data.counters?.members ?? 0,
        actualStaffCount: computeStaffSize(data),
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
        // + write structurePerGame pour CHAQUE jeu déclaré.
        // Doc ID déterministe pour qu'un double-clic écrive sur le même doc (idempotent).
        const memberRef = db.collection('structure_members').doc(`${structureId}_${data.founderId}`);
        const userRef = db.collection('users').doc(data.founderId);
        const founderGames: string[] = Array.isArray(data.games) && data.games.length > 0
          ? data.games
          : ['rocket_league'];

        // Lecture défensive du structurePerGame actuel pour merger en array
        // (compat avec le format legacy string ET le nouveau format array).
        const founderSnapForSpg = await userRef.get();
        const currentSpg = (founderSnapForSpg.exists && (founderSnapForSpg.data()!.structurePerGame || {})) || {};

        const batch = db.batch();
        batch.update(ref, {
          status: 'active',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: FieldValue.serverTimestamp(),
          // Init compteurs dénormalisés : fondateur = 1 membre, 0 équipe
          counters: { teams: 0, members: 1 },
        });
        // Set structurePerGame.{game} = array contenant la structure, mergé
        // avec les structures déjà présentes pour ce jeu (max 2). En théorie le
        // fondateur n'aura pas déjà 2 autres struct sur ce jeu — sinon la
        // création aurait été bloquée en amont. AddStructureToGame throw si cap.
        const userUpdates: Record<string, unknown> = { isFounderApproved: true };
        for (const g of founderGames) {
          userUpdates[`structurePerGame.${g}`] = addStructureToGame(currentSpg, g, structureId);
        }
        batch.update(userRef, userUpdates);
        batch.set(memberRef, {
          structureId,
          userId: data.founderId,
          game: founderGames[0],
          role: 'fondateur',
          joinedAt: FieldValue.serverTimestamp(),
        });
        addJoinHistory(db, batch, {
          structureId,
          userId: data.founderId,
          game: founderGames[0],
          role: 'fondateur',
          reason: 'founder',
        });
        await batch.commit();
        break;
      }

      case 'reject': {
        // Retire la struct (pending) du structurePerGame du fondateur — sinon
        // elle reste comptée dans son cap "max N par jeu" alors qu'elle est
        // rejetée. À la création (request), on l'avait ajoutée pour le strict mode.
        const founderId = data.founderId as string | undefined;
        const founderGames: string[] = Array.isArray(data.games) ? data.games : [];
        if (founderId && founderGames.length > 0) {
          const founderUserRef = db.collection('users').doc(founderId);
          const founderSnap = await founderUserRef.get();
          if (founderSnap.exists) {
            const spg = (founderSnap.data()!.structurePerGame || {}) as Record<string, string | string[]>;
            const updates: Record<string, unknown> = {};
            for (const g of founderGames) {
              const newArr = removeStructureFromGame(spg, g, structureId);
              if (newArr.length === 0) {
                updates[`structurePerGame.${g}`] = FieldValue.delete();
              } else {
                updates[`structurePerGame.${g}`] = newArr;
              }
            }
            if (Object.keys(updates).length > 0) await founderUserRef.update(updates);
          }
        }
        await ref.update({
          status: 'rejected',
          reviewComment: comment || '',
          reviewedBy: uid,
          validatedAt: FieldValue.serverTimestamp(),
        });
        break;
      }

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

      case 'edit': {
        // Édition directe des infos publiques de la structure (admin) — sans
        // toucher au statut ni au cycle de validation.
        const name = clampString(body.name, LIMITS.structureName);
        const tag = clampString(body.tag, LIMITS.structureTag).toUpperCase();
        const description = clampString(body.description, LIMITS.structureDescription);
        const games = Array.isArray(body.games)
          ? [...new Set(body.games)].filter((g): g is string => typeof g === 'string' && isKnownGame(g))
          : [];
        if (!name) return NextResponse.json({ error: 'Le nom est obligatoire.' }, { status: 400 });
        if (!tag) return NextResponse.json({ error: 'Le tag est obligatoire.' }, { status: 400 });
        if (games.length === 0) {
          return NextResponse.json({ error: 'Sélectionne au moins un jeu.' }, { status: 400 });
        }
        await ref.update({
          name,
          tag,
          description,
          games,
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;
      }

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

    // Audit log — après succès de l'action, avant retour. Mapping action → AdminAuditAction.
    const auditActionByAction: Record<string, AdminAuditAction | undefined> = {
      approve: 'structure_approved',
      reject: 'structure_rejected',
      suspend: 'structure_suspended',
      unsuspend: 'structure_unsuspended',
      schedule_deletion: 'structure_deletion_scheduled',
      cancel_deletion: 'structure_deletion_cancelled',
      delete: 'structure_deleted',
      edit: 'structure_edited',
    };
    const auditAction = auditActionByAction[action];
    if (auditAction) {
      await writeAdminAuditLog(db, {
        action: auditAction,
        adminUid: uid,
        targetType: 'structure',
        targetId: structureId,
        targetLabel: data.name ?? null,
        metadata: {
          comment: comment || null,
          founderId: data.founderId ?? null,
          games: data.games ?? [],
          previousStatus: data.status ?? null,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Structures POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
