import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { FieldValue, DocumentData } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { createNotification, createNotifications, type NotificationPayload } from '@/lib/notifications';

// Vérifier que l'utilisateur a les droits sur la structure (fondateur ou co-fondateur)
async function checkStructureAccess(uid: string, structureId: string) {
  const db = getAdminDb();
  const snap = await db.collection('structures').doc(structureId).get();
  if (!snap.exists) return null;
  const data = snap.data()!;
  const isFounder = data.founderId === uid;
  const isCoFounder = (data.coFounderIds ?? []).includes(uid);
  const isManager = (data.managerIds ?? []).includes(uid);
  if (!isFounder && !isCoFounder && !isManager) return null;
  if (data.status === 'suspended') return null;
  return data;
}

// GET /api/structures/teams?structureId=xxx — lister les équipes d'une structure
export async function GET(req: NextRequest) {
  try {
    const structureId = req.nextUrl.searchParams.get('structureId');
    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const snap = await db.collection('sub_teams')
      .where('structureId', '==', structureId)
      .get();

    // Collecter tous les IDs de joueurs/staff de toutes les équipes en un seul batch
    const allUserIds: string[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      for (const id of data.playerIds || []) allUserIds.push(id);
      for (const id of data.subIds || []) allUserIds.push(id);
      for (const id of data.staffIds || []) allUserIds.push(id);
    }
    const usersById = await fetchDocsByIds(db, 'users', allUserIds);

    const enrich = (ids: string[] | undefined) => (ids ?? []).flatMap(id => {
      const u = usersById.get(id);
      if (!u) return [];
      return [{
        uid: id,
        displayName: u.displayName || u.discordUsername || '',
        discordAvatar: u.discordAvatar || '',
        avatarUrl: u.avatarUrl || '',
      }];
    });

    const teams = snap.docs.map(doc => {
      const data: DocumentData = doc.data();
      return {
        id: doc.id,
        structureId: data.structureId,
        game: data.game,
        name: data.name,
        players: enrich(data.playerIds),
        subs: enrich(data.subIds),
        staff: enrich(data.staffIds),
        captainId: data.captainId ?? null,
        label: data.label ?? '',
        order: typeof data.order === 'number' ? data.order : 0,
        groupOrder: typeof data.groupOrder === 'number' ? data.groupOrder : 0,
        status: (data.status as 'active' | 'archived') ?? 'active',
        archivedAt: data.archivedAt?.toDate?.()?.toISOString() ?? null,
        minPlayersForMatch: typeof data.minPlayersForMatch === 'number' ? data.minPlayersForMatch : null,
        minMatchDurationMinutes: typeof data.minMatchDurationMinutes === 'number' ? data.minMatchDurationMinutes : null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ teams });
  } catch (err) {
    captureApiError('API Structures/teams GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/teams — créer, modifier, supprimer une équipe
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, structureId, teamId, name, game, playerIds, subIds, staffIds, captainId, label, order, groupOrder } = body;

    if (!structureId || !action) {
      return NextResponse.json({ error: 'structureId et action requis' }, { status: 400 });
    }

    const structureData = await checkStructureAccess(uid, structureId);
    if (!structureData) {
      return NextResponse.json({ error: 'Accès refusé ou structure introuvable' }, { status: 403 });
    }

    const isFounder = structureData.founderId === uid;
    const isCoFounder = (structureData.coFounderIds ?? []).includes(uid);
    const isDirigeant = isFounder || isCoFounder;

    const db = getAdminDb();

    switch (action) {
      case 'create': {
        // Création : dirigeants uniquement (les managers ne créent pas d'équipes).
        if (!isDirigeant) {
          return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
        }
        if (!name?.trim()) {
          return NextResponse.json({ error: "Le nom de l'équipe est obligatoire." }, { status: 400 });
        }
        if (!game) {
          return NextResponse.json({ error: 'Le jeu est obligatoire.' }, { status: 400 });
        }
        // label optionnel au niveau API pour compat ascendante ; l'UX l'impose.
        const labelStr = typeof label === 'string' ? label.trim() : '';

        // Vérifier les limites RL : max 3 titulaires, 2 remplaçants
        if (game === 'rocket_league') {
          if ((playerIds || []).length > 3) {
            return NextResponse.json({ error: 'Max 3 titulaires pour une équipe RL.' }, { status: 400 });
          }
          if ((subIds || []).length > 2) {
            return NextResponse.json({ error: 'Max 2 remplaçants pour une équipe RL.' }, { status: 400 });
          }
        }

        // Calculer l'ordre par défaut : dernier dans son label
        const existingSnap = await db.collection('sub_teams')
          .where('structureId', '==', structureId)
          .get();
        const sameLabel = existingSnap.docs.filter(d => (d.data().label ?? '') === labelStr);
        const maxOrder = sameLabel.reduce((acc, d) => Math.max(acc, typeof d.data().order === 'number' ? d.data().order : 0), -1);

        const captainToStore = captainId && (playerIds || []).includes(captainId) ? captainId : null;

        const docRef = await db.collection('sub_teams').add({
          structureId,
          game,
          name: name.trim(),
          label: labelStr,
          order: typeof order === 'number' ? order : maxOrder + 1,
          groupOrder: typeof groupOrder === 'number' ? groupOrder : 0,
          status: 'active' as const,
          playerIds: playerIds || [],
          subIds: subIds || [],
          staffIds: staffIds || [],
          captainId: captainToStore,
          createdAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ success: true, id: docRef.id });
      }

      case 'update': {
        if (!teamId) {
          return NextResponse.json({ error: 'teamId requis' }, { status: 400 });
        }

        const ref = db.collection('sub_teams').doc(teamId);
        const teamSnap = await ref.get();
        if (!teamSnap.exists) {
          return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
        }

        const teamData = teamSnap.data()!;
        if (teamData.structureId !== structureId) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }

        const teamGame = game || teamData.game;

        // Vérifier les limites RL
        if (teamGame === 'rocket_league') {
          if (playerIds && playerIds.length > 3) {
            return NextResponse.json({ error: 'Max 3 titulaires pour une équipe RL.' }, { status: 400 });
          }
          if (subIds && subIds.length > 2) {
            return NextResponse.json({ error: 'Max 2 remplaçants pour une équipe RL.' }, { status: 400 });
          }
        }

        const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
        if (name !== undefined) updates.name = name.trim();
        if (game !== undefined) updates.game = game;
        if (playerIds !== undefined) updates.playerIds = playerIds;
        if (subIds !== undefined) updates.subIds = subIds;
        if (staffIds !== undefined) updates.staffIds = staffIds;

        // label : dirigeants uniquement (le manager ne change pas le niveau d'une équipe)
        if (label !== undefined) {
          if (!isDirigeant) {
            return NextResponse.json({ error: 'Le label est réservé aux dirigeants.' }, { status: 403 });
          }
          if (typeof label !== 'string' || !label.trim()) {
            return NextResponse.json({ error: 'Le label ne peut pas être vide.' }, { status: 400 });
          }
          updates.label = label.trim();
        }

        // captainId : dirigeants uniquement, et doit être un joueur de l'équipe
        if (captainId !== undefined) {
          if (!isDirigeant) {
            return NextResponse.json({ error: 'Le capitaine est désigné par les dirigeants.' }, { status: 403 });
          }
          if (captainId === null || captainId === '') {
            updates.captainId = null;
          } else {
            const finalPlayers = playerIds !== undefined ? playerIds : (teamData.playerIds ?? []);
            if (!finalPlayers.includes(captainId)) {
              return NextResponse.json({ error: 'Le capitaine doit être un titulaire de l\'équipe.' }, { status: 400 });
            }
            updates.captainId = captainId;
          }
        } else if (playerIds !== undefined && teamData.captainId) {
          // Si on retire le capitaine actuel des titulaires, on nettoie captainId
          if (!playerIds.includes(teamData.captainId)) {
            updates.captainId = null;
          }
        }

        await ref.update(updates);

        // Notifier le nouveau capitaine si captainId a changé et n'est pas null
        const prevCaptainId = teamData.captainId ?? null;
        const nextCaptainId = (updates.captainId as string | null | undefined);
        if (nextCaptainId !== undefined && nextCaptainId !== null && nextCaptainId !== prevCaptainId) {
          try {
            await createNotification(db, {
              userId: nextCaptainId as string,
              type: 'team_captain_assigned',
              title: 'Tu es capitaine',
              message: `Tu as été désigné(e) capitaine de ${teamData.name}.`,
              link: '/community/my-structure',
              metadata: { structureId, teamId },
            });
          } catch (e) {
            captureApiError('teams/update captain notification', e);
          }
        }

        return NextResponse.json({ success: true });
      }

      case 'reorder': {
        // Batch : [{ teamId, order?, groupOrder?, label? }]. Dirigeants uniquement.
        if (!isDirigeant) {
          return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
        }
        const items = Array.isArray(body.items) ? body.items : null;
        if (!items || items.length === 0) {
          return NextResponse.json({ error: 'items requis' }, { status: 400 });
        }
        if (items.length > 100) {
          return NextResponse.json({ error: 'Trop d\'items (max 100).' }, { status: 400 });
        }

        // Charger tout le snapshot pour valider que chaque teamId appartient bien à cette structure
        const allSnap = await db.collection('sub_teams')
          .where('structureId', '==', structureId)
          .get();
        const validIds = new Set(allSnap.docs.map(d => d.id));

        const batch = db.batch();
        for (const item of items) {
          if (!item?.teamId || !validIds.has(item.teamId)) continue;
          const upd: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
          if (typeof item.order === 'number') upd.order = item.order;
          if (typeof item.groupOrder === 'number') upd.groupOrder = item.groupOrder;
          if (typeof item.label === 'string' && item.label.trim()) upd.label = item.label.trim();
          if (Object.keys(upd).length > 1) {
            batch.update(db.collection('sub_teams').doc(item.teamId), upd);
          }
        }
        await batch.commit();
        return NextResponse.json({ success: true });
      }

      case 'archive':
      case 'unarchive': {
        // Archivage : dirigeants uniquement.
        if (!isDirigeant) {
          return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
        }
        if (!teamId) {
          return NextResponse.json({ error: 'teamId requis' }, { status: 400 });
        }
        const ref = db.collection('sub_teams').doc(teamId);
        const teamSnap = await ref.get();
        if (!teamSnap.exists) {
          return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
        }
        if (teamSnap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }
        const teamDataArch = teamSnap.data()!;
        if (action === 'archive') {
          await ref.update({
            status: 'archived',
            archivedAt: FieldValue.serverTimestamp(),
            archivedBy: uid,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Notifier tous les membres de l'équipe (titulaires + remplaçants + staff + capitaine)
          try {
            const recipients = new Set<string>();
            for (const id of (teamDataArch.playerIds ?? []) as string[]) recipients.add(id);
            for (const id of (teamDataArch.subIds ?? []) as string[]) recipients.add(id);
            for (const id of (teamDataArch.staffIds ?? []) as string[]) recipients.add(id);
            if (teamDataArch.captainId) recipients.add(teamDataArch.captainId as string);
            recipients.delete(uid);
            const payloads: NotificationPayload[] = Array.from(recipients).map(userId => ({
              userId,
              type: 'team_archived' as const,
              title: 'Équipe archivée',
              message: `L'équipe ${teamDataArch.name} a été archivée.`,
              link: '/community/my-structure',
              metadata: { structureId, teamId },
            }));
            await createNotifications(db, payloads);
          } catch (e) {
            captureApiError('teams/archive notification', e);
          }
        } else {
          await ref.update({
            status: 'active',
            archivedAt: FieldValue.delete(),
            archivedBy: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        return NextResponse.json({ success: true });
      }

      case 'updateMatchConfig': {
        // Réservé aux dirigeants (fondateur / co-fondateur) — pas aux managers.
        if (!isDirigeant) {
          return NextResponse.json({ error: 'Réservé aux dirigeants.' }, { status: 403 });
        }
        if (!teamId) {
          return NextResponse.json({ error: 'teamId requis' }, { status: 400 });
        }

        const mp = typeof body.minPlayersForMatch === 'number' ? body.minPlayersForMatch : null;
        const md = typeof body.minMatchDurationMinutes === 'number' ? body.minMatchDurationMinutes : null;
        if (mp === null || md === null) {
          return NextResponse.json({ error: 'minPlayersForMatch et minMatchDurationMinutes requis' }, { status: 400 });
        }
        if (!Number.isInteger(mp) || mp < 1 || mp > 10) {
          return NextResponse.json({ error: 'minPlayersForMatch doit être entre 1 et 10.' }, { status: 400 });
        }
        if (!Number.isInteger(md) || md < 30 || md > 480 || md % 30 !== 0) {
          return NextResponse.json({ error: 'minMatchDurationMinutes doit être un multiple de 30 entre 30 et 480.' }, { status: 400 });
        }

        const ref = db.collection('sub_teams').doc(teamId);
        const teamSnap = await ref.get();
        if (!teamSnap.exists) {
          return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
        }
        if (teamSnap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }

        await ref.update({
          minPlayersForMatch: mp,
          minMatchDurationMinutes: md,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ success: true });
      }

      case 'delete': {
        // Suppression définitive : fondateur uniquement (destructif, pas d'historique).
        // Les dirigeants peuvent préférer l'action 'archive'.
        if (!isFounder) {
          return NextResponse.json({ error: 'La suppression est réservée au fondateur. Utilisez "archiver".' }, { status: 403 });
        }
        if (!teamId) {
          return NextResponse.json({ error: 'teamId requis' }, { status: 400 });
        }

        const ref = db.collection('sub_teams').doc(teamId);
        const teamSnap = await ref.get();
        if (!teamSnap.exists) {
          return NextResponse.json({ error: 'Équipe introuvable' }, { status: 404 });
        }
        if (teamSnap.data()!.structureId !== structureId) {
          return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
        }

        await ref.delete();
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Structures/teams POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
