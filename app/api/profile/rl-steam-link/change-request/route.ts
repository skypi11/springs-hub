// POST /api/profile/rl-steam-link/change-request
// Le joueur demande à changer le compte Steam RL officiel lié à son profil.
// Pré-requis : il a déjà re-lié SA Steam OpenID Aedral vers le nouveau compte
// (Settings → Lier mon Steam), on capture cette nouvelle liaison comme
// "requested" et on l'envoie en validation admin.
// Voir docs/rl-rank-verification-plan.md.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { isValidSteamId64 } from '@/lib/rl-identity';
import { sendAdminAlert } from '@/lib/admin-discord-alert';

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

    const currentSteamId = user.rlSteamId as string | undefined;
    if (!isValidSteamId64(currentSteamId)) {
      return NextResponse.json({
        error: "Tu n'as pas de compte Steam RL officiel lié, il n'y a rien à changer.",
      }, { status: 400 });
    }

    const newSteamId = user.steamLinked?.steamId64 as string | undefined;
    if (!isValidSteamId64(newSteamId)) {
      return NextResponse.json({
        error: "Aucun compte Steam lié actuellement. Re-lie Steam (Settings → « Lier mon Steam ») vers le nouveau compte, puis refais la demande.",
      }, { status: 400 });
    }
    if (newSteamId === currentSteamId) {
      return NextResponse.json({
        error: 'Le Steam actuellement lié à Aedral est le MÊME que ton compte officiel. Pour changer : sur Settings, délie Steam et re-lie le nouveau compte, puis reviens.',
      }, { status: 400 });
    }
    const newSteamName = (user.steamLinked?.personaName as string) || newSteamId;
    const currentSteamName = (user.rlSteamName as string) || currentSteamId;

    // Bloque plusieurs demandes pending en parallèle pour le même user et plateforme
    const pending = await db.collection('rl_link_change_requests')
      .where('userUid', '==', uid)
      .where('status', '==', 'pending')
      .limit(5).get();
    if (pending.docs.some(d => (d.data().platform || 'epic') === 'steam')) {
      return NextResponse.json({
        error: 'Tu as déjà une demande de changement Steam en attente. Patiente, l\'admin va la traiter.',
      }, { status: 409 });
    }

    const reqRef = db.collection('rl_link_change_requests').doc();
    await reqRef.set({
      userUid: uid,
      userName: (user.displayName as string) || (user.discordUsername as string) || '',
      platform: 'steam',
      // Champs génériques (refacto multi-plateforme)
      currentLinkedId: currentSteamId,
      currentLinkedName: currentSteamName,
      requestedLinkedId: newSteamId,
      requestedLinkedName: newSteamName,
      reason,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    await sendAdminAlert(db, {
      title: '🔁 Demande de changement de compte Steam',
      description: `**${(user.displayName as string) || uid}** demande à changer son compte Steam RL officiel.\n\n`
        + `**Actuel** : \`${currentSteamName}\`\n`
        + `**Nouveau** : \`${newSteamName}\`\n\n`
        + `Raison : ${reason}\n\n`
        + `[Voir la demande →](https://aedral.com/admin/rl-link-changes)`,
    });

    return NextResponse.json({ ok: true, requestId: reqRef.id });
  } catch (err) {
    captureApiError('API rl-steam-link/change-request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
