// POST /api/profile/rl-epic-link/change-request
// Le joueur demande à changer le compte Epic officiel lié à son profil.
// Pré-requis : il a déjà mis à jour SA connexion Discord pour pointer vers le
// nouveau compte Epic, on capture cette nouvelle connexion comme "requested".
// L'admin valide/refuse via /admin/rl-link-changes.
// Voir docs/rl-rank-verification-plan.md (Lot 6).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { findVerifiedEpicConnection, isValidEpicId } from '@/lib/rl-identity';
import { sendAdminAlert } from '@/lib/admin-discord-alert';
import type { DiscordConnection } from '@/lib/discord-connections';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json().catch(() => ({}));
    const reason = clampString(typeof body?.reason === 'string' ? body.reason : '', 500);
    if (!reason) {
      return NextResponse.json({
        error: 'Une raison est obligatoire (compte perdu, erreur de liaison, etc.)',
      }, { status: 400 });
    }

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    const user = userSnap.data()!;

    const currentEpicId = user.rlEpicId as string | undefined;
    if (!isValidEpicId(currentEpicId)) {
      return NextResponse.json({
        error: "Tu n'as pas de compte Epic officiel lié, il n'y a rien à changer.",
      }, { status: 400 });
    }

    const verified = findVerifiedEpicConnection(user.discordConnections as DiscordConnection[] | undefined);
    if (!verified) {
      return NextResponse.json({
        error: 'On ne voit aucune connexion Epic vérifiée sur ton Discord. Lie ton nouveau compte Epic à ton Discord, reconnecte-toi à Aedral, puis refais la demande.',
      }, { status: 400 });
    }
    if (verified.id === currentEpicId) {
      return NextResponse.json({
        error: 'La connexion Epic sur ton Discord est la MÊME que ton compte officiel actuel. Pour changer : sur Discord, retire cette connexion et lie le nouveau compte, reconnecte-toi, puis reviens.',
      }, { status: 400 });
    }

    // Bloquer plusieurs demandes Epic pending en parallèle pour le même user
    const pending = await db.collection('rl_link_change_requests')
      .where('userUid', '==', uid)
      .where('status', '==', 'pending')
      .limit(5).get();
    if (pending.docs.some(d => (d.data().platform || 'epic') === 'epic')) {
      return NextResponse.json({
        error: 'Tu as déjà une demande de changement Epic en attente. Patiente, l\'admin va la traiter.',
      }, { status: 409 });
    }

    const reqRef = db.collection('rl_link_change_requests').doc();
    await reqRef.set({
      userUid: uid,
      userName: (user.displayName as string) || (user.discordUsername as string) || '',
      platform: 'epic',
      // Champs génériques (refacto multi-plateforme)
      currentLinkedId: currentEpicId,
      currentLinkedName: (user.rlEpicName as string) || '',
      requestedLinkedId: verified.id,
      requestedLinkedName: verified.name,
      // Champs Epic legacy (rétrocompat pour les anciennes demandes)
      currentEpicId,
      currentEpicName: (user.rlEpicName as string) || '',
      requestedEpicId: verified.id,
      requestedEpicName: verified.name,
      reason,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    await sendAdminAlert(db, {
      title: '🔁 Demande de changement de compte Epic',
      description: `**${(user.displayName as string) || uid}** demande à changer son compte Epic officiel.\n\n`
        + `**Actuel** : \`${(user.rlEpicName as string) || ''}\`\n`
        + `**Nouveau** : \`${verified.name}\`\n\n`
        + `Raison : ${reason}\n\n`
        + `[Voir la demande →](https://aedral.com/admin/rl-link-changes)`,
    });

    return NextResponse.json({ ok: true, requestId: reqRef.id });
  } catch (err) {
    captureApiError('API rl-epic-link/change-request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
