import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';

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

    const teams = [];
    for (const doc of snap.docs) {
      const data = doc.data();

      // Enrichir les IDs avec les noms des joueurs/staff
      const enrichIds = async (ids: string[]) => {
        const result = [];
        for (const id of ids || []) {
          try {
            const userSnap = await db.collection('users').doc(id).get();
            if (userSnap.exists) {
              const u = userSnap.data()!;
              result.push({
                uid: id,
                displayName: u.displayName || u.discordUsername || '',
                discordAvatar: u.discordAvatar || '',
                avatarUrl: u.avatarUrl || '',
              });
            }
          } catch { /* skip */ }
        }
        return result;
      };

      teams.push({
        id: doc.id,
        structureId: data.structureId,
        game: data.game,
        name: data.name,
        players: await enrichIds(data.playerIds || []),
        subs: await enrichIds(data.subIds || []),
        staff: await enrichIds(data.staffIds || []),
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      });
    }

    return NextResponse.json({ teams });
  } catch (err) {
    console.error('[API Structures/teams] GET error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/teams — créer, modifier, supprimer une équipe
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const body = await req.json();
    const { action, structureId, teamId, name, game, playerIds, subIds, staffIds } = body;

    if (!structureId || !action) {
      return NextResponse.json({ error: 'structureId et action requis' }, { status: 400 });
    }

    const structureData = await checkStructureAccess(uid, structureId);
    if (!structureData) {
      return NextResponse.json({ error: 'Accès refusé ou structure introuvable' }, { status: 403 });
    }

    const db = getAdminDb();

    switch (action) {
      case 'create': {
        if (!name?.trim()) {
          return NextResponse.json({ error: "Le nom de l'équipe est obligatoire." }, { status: 400 });
        }
        if (!game) {
          return NextResponse.json({ error: 'Le jeu est obligatoire.' }, { status: 400 });
        }

        // Vérifier les limites RL : max 3 titulaires, 2 remplaçants
        if (game === 'rocket_league') {
          if ((playerIds || []).length > 3) {
            return NextResponse.json({ error: 'Max 3 titulaires pour une équipe RL.' }, { status: 400 });
          }
          if ((subIds || []).length > 2) {
            return NextResponse.json({ error: 'Max 2 remplaçants pour une équipe RL.' }, { status: 400 });
          }
        }

        const docRef = await db.collection('sub_teams').add({
          structureId,
          game,
          name: name.trim(),
          playerIds: playerIds || [],
          subIds: subIds || [],
          staffIds: staffIds || [],
          createdAt: new Date(),
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

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (name !== undefined) updates.name = name.trim();
        if (game !== undefined) updates.game = game;
        if (playerIds !== undefined) updates.playerIds = playerIds;
        if (subIds !== undefined) updates.subIds = subIds;
        if (staffIds !== undefined) updates.staffIds = staffIds;

        await ref.update(updates);
        return NextResponse.json({ success: true });
      }

      case 'delete': {
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
    console.error('[API Structures/teams] POST error:', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
