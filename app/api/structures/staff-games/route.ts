import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { canPromoteStaff, structureContext } from '@/lib/structure-permissions';
import { isKnownGame } from '@/lib/games-registry';

// POST /api/structures/staff-games
// Body: { structureId, targetUserId, role: 'manager' | 'coach', games: string[] }
//
// Configure le scope par jeu d'un Responsable (managerGames) ou Coach (coachGames).
//
// Sémantique du payload `games` :
//   - Liste non vide → managerGames[uid] / coachGames[uid] = ces jeux
//   - Liste vide []  → supprime la clé (équivaut à all-games rétrocompat)
//
// Le user doit déjà être promu (managerIds / coachIds inclut targetUserId).
// Si pas le cas → erreur (utiliser /api/structures/staff-role d'abord).
//
// Droits : fondateur + co-fondateurs (canPromoteStaff).

const ALLOWED_ROLES = new Set(['manager', 'coach']);

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId, targetUserId, role, games } = body;

    if (!structureId || !targetUserId || !role || !Array.isArray(games)) {
      return NextResponse.json(
        { error: 'structureId, targetUserId, role et games (array) requis' },
        { status: 400 }
      );
    }
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Rôle invalide, manager ou coach seulement.' }, { status: 400 });
    }

    // Validation games : que des jeux connus de la registry + uniques
    const cleanedGames = [...new Set(games.filter((g: unknown): g is string =>
      typeof g === 'string' && isKnownGame(g)
    ))];

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const data = structureSnap.data()!;

    // Droits : canPromoteStaff = fondateur + cofondateurs
    const ctx = structureContext(uid, {
      founderId: data.founderId,
      coFounderIds: data.coFounderIds,
      managerIds: data.managerIds,
      coachIds: data.coachIds,
      status: data.status,
    });
    if (!canPromoteStaff(ctx)) {
      if (data.status === 'suspended') {
        return NextResponse.json({ error: 'Structure suspendue, action bloquée.' }, { status: 403 });
      }
      return NextResponse.json(
        { error: 'Seuls les dirigeants peuvent configurer le scope des rôles staff.' },
        { status: 403 }
      );
    }

    // Verif que la cible est bien dans le rôle visé
    const roleField = role === 'manager' ? 'managerIds' : 'coachIds';
    const currentRoleIds = (data[roleField] as string[] | undefined) ?? [];
    if (!currentRoleIds.includes(targetUserId)) {
      return NextResponse.json({
        error: `L'utilisateur n'est pas ${role} de cette structure. Promouvoir d'abord via /api/structures/staff-role.`,
      }, { status: 400 });
    }

    // Validation : ne pas scoper sur des jeux que la structure ne pratique pas
    // (avertissement non-bloquant, on filtre, c'est tout)
    const structureGames = (data.games as string[] | undefined) ?? [];
    const validGames = cleanedGames.filter(g => structureGames.includes(g));

    // Update : si liste vide → on supprime la clé (= all-games rétrocompat)
    const scopeField = role === 'manager' ? 'managerGames' : 'coachGames';
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (validGames.length === 0) {
      // Supprime la clé pour ce uid (revient à all-games)
      update[`${scopeField}.${targetUserId}`] = FieldValue.delete();
    } else {
      update[`${scopeField}.${targetUserId}`] = validGames;
    }

    await structureRef.update(update);

    return NextResponse.json({ success: true, games: validGames });
  } catch (err) {
    captureApiError('API Structures/staff-games POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
