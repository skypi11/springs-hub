// POST /api/profile/rl-steam-link
// Snapshot le SteamID64 depuis `steamLinked` (Steam OpenID) dans `rlSteamId`
//, la référence officielle figée côté Steam. Symétrique à rl-epic-link.
//
// Premier lien : libre. Changements ultérieurs : refusés ici, passent par
// /api/profile/rl-steam-link/change-request (demande admin).
//
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isValidSteamId64 } from '@/lib/rl-identity';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const user = userSnap.data()!;

    if (isValidSteamId64(user.rlSteamId)) {
      return NextResponse.json({
        error: 'Compte Steam RL déjà lié. Pour le changer, passe par une demande admin.',
      }, { status: 409 });
    }

    const steamId = user.steamLinked?.steamId64 as string | undefined;
    if (!isValidSteamId64(steamId)) {
      return NextResponse.json({
        error: "Aucun compte Steam lié à ton profil Aedral. Lie Steam d'abord (Réglages → section Rocket League → « Lier mon Steam »), puis confirme.",
      }, { status: 400 });
    }
    const steamName = (user.steamLinked?.personaName as string) || steamId;

    await userRef.update({
      rlSteamId: steamId,
      rlSteamName: steamName,
      rlSteamLinkedAt: FieldValue.serverTimestamp(),
      rlSteamLinkSource: 'openid',
      // Si l'utilisateur n'a pas déjà choisi Epic, on mirror vers les champs
      // legacy pour le constructeur d'URL tracker (lib/rl-platform.ts).
      // Sinon on ne touche pas (Epic reste prioritaire pour l'URL tracker
      // post-F2P, voir /api/profile pour la sélection finale).
      ...((!user.rlEpicId) ? { rlPlatform: 'steam', rlPlatformId: steamId } : {}),
    });

    return NextResponse.json({
      ok: true,
      message: 'Compte Steam RL lié.',
      rlSteamId: steamId,
      rlSteamName: steamName,
    });
  } catch (err) {
    captureApiError('API rl-steam-link error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
