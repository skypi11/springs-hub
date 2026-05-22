// POST /api/profile/rl-epic-link
// Snapshot l'ID Epic depuis la connexion Discord vérifiée du user dans
// `rlEpicId` (la référence officielle figée). Premier lien : libre.
// Changements ultérieurs : refusés ici — passeront par une demande admin
// (Lot 6).
//
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { findVerifiedEpicConnection, isValidEpicId } from '@/lib/rl-identity';
import type { DiscordConnection } from '@/lib/discord-connections';

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

    if (isValidEpicId(user.rlEpicId)) {
      return NextResponse.json({
        error: 'Compte Epic déjà lié. Pour le changer, passe par une demande admin.',
      }, { status: 409 });
    }

    const conn = findVerifiedEpicConnection(user.discordConnections as DiscordConnection[] | undefined);
    if (!conn) {
      return NextResponse.json({
        error: "Aucune connexion Epic vérifiée trouvée sur ton Discord. Lie ton compte Epic sur Discord (Paramètres → Connexions → Epic Games) puis reconnecte-toi.",
      }, { status: 400 });
    }

    await userRef.update({
      rlEpicId: conn.id,
      rlEpicName: conn.name,
      rlEpicLinkedAt: FieldValue.serverTimestamp(),
      rlEpicLinkSource: 'discord',
      // Miroir pour le constructeur d'URL tracker / ballchasing existant
      // (lib/rl-platform.ts construit l'URL depuis rlPlatform + rlPlatformId,
      // et tracker.gg pour Epic n'accepte que le pseudo, pas l'ID 32-hex).
      rlPlatform: 'epic',
      rlPlatformId: conn.name,
    });

    return NextResponse.json({
      ok: true,
      message: 'Compte Epic lié.',
      rlEpicId: conn.id,
      rlEpicName: conn.name,
    });
  } catch (err) {
    captureApiError('API rl-epic-link error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
