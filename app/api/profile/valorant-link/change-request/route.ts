// POST /api/profile/valorant-link/change-request
// Le joueur demande à changer le compte Riot (Valorant) vérifié lié à son profil.
// Pré-requis : il a déjà mis à jour SA connexion Discord Riot pour pointer vers le
// nouveau compte (et s'est reconnecté à Aedral). On capture ce nouveau compte
// comme "requested". L'admin valide/refuse via /admin/valorant-link-changes.
//
// Miroir de rl-epic-link/change-request (anti-mensonge). Le compte Valorant est
// verrouillé sur le PUUID (valorantPuuid) ; le sync refuse de basculer seul.
//
// Body : { reason: string }

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { pickValorantRiotId, type DiscordConnection } from '@/lib/discord-connections';
import { fetchValorantAccountByPuuid } from '@/lib/valorant-henrikdev';
import { isValidPuuid, formatRiotId } from '@/lib/valorant-identity';
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

    const currentPuuid = user.valorantPuuid as string | undefined;
    if (!isValidPuuid(currentPuuid)) {
      return NextResponse.json({
        error: "Tu n'as pas de compte Riot vérifié lié, il n'y a rien à changer. Synchronise d'abord ton rang.",
      }, { status: 400 });
    }

    const riot = pickValorantRiotId(user.discordConnections as DiscordConnection[] | undefined);
    if (!riot) {
      return NextResponse.json({
        error: 'On ne voit aucune connexion Riot sur ton Discord. Lie ton nouveau compte Riot à ton Discord, reconnecte-toi à Aedral, puis refais la demande.',
      }, { status: 400 });
    }
    if (!isValidPuuid(riot.puuid)) {
      return NextResponse.json({
        error: 'Connexion Riot invalide (identifiant manquant). Relie ton compte Riot à Discord puis reconnecte-toi.',
      }, { status: 400 });
    }
    if (riot.puuid === currentPuuid) {
      return NextResponse.json({
        error: 'La connexion Riot sur ton Discord est la MÊME que ton compte vérifié actuel. Pour changer : sur Discord, retire cette connexion et lie le nouveau compte, reconnecte-toi, puis reviens.',
      }, { status: 400 });
    }

    // Résout le RiotID complet du nouveau compte (Discord renvoie parfois le name
    // sans le tag). Si HenrikDev échoue, on garde ce qu'on a (l'admin tranchera).
    let requestedName = riot.name;
    let requestedTag = riot.tag;
    if (!requestedTag) {
      const acc = await fetchValorantAccountByPuuid(riot.puuid);
      if (acc.ok) {
        requestedName = acc.data.name;
        requestedTag = acc.data.tag;
      }
    }

    // Bloque plusieurs demandes pending en parallèle pour le même user.
    // limit(1) suffit (collection mono-jeu, contrairement à RL qui mixe Epic+Steam
    // dans rl_link_change_requests et doit donc filtrer par platform).
    const pending = await db.collection('valorant_link_change_requests')
      .where('userUid', '==', uid)
      .where('status', '==', 'pending')
      .limit(1).get();
    if (!pending.empty) {
      return NextResponse.json({
        error: 'Tu as déjà une demande de changement de compte Riot en attente. Patiente, l\'admin va la traiter.',
      }, { status: 409 });
    }

    const currentRiotId = formatRiotId(user.valorantRiotName as string, user.valorantRiotTag as string);
    const requestedRiotId = formatRiotId(requestedName, requestedTag);

    const reqRef = db.collection('valorant_link_change_requests').doc();
    await reqRef.set({
      userUid: uid,
      userName: (user.displayName as string) || (user.discordUsername as string) || '',
      currentPuuid,
      currentRiotId,
      currentRank: (user.valorantRank as string) || '',
      requestedPuuid: riot.puuid,
      requestedRiotId,
      // name/tag séparés pour permettre le re-sync du rang à l'approbation admin.
      requestedName,
      requestedTag,
      reason,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    await sendAdminAlert(db, {
      title: '🔁 Demande de changement de compte Riot (Valorant)',
      description: `**${(user.displayName as string) || uid}** demande à changer son compte Riot vérifié.\n\n`
        + `**Actuel** : \`${currentRiotId || currentPuuid.slice(0, 12) + '…'}\`\n`
        + `**Nouveau** : \`${requestedRiotId || riot.puuid.slice(0, 12) + '…'}\`\n\n`
        + `Raison : ${reason}\n\n`
        + `[Voir la demande →](https://aedral.com/admin/valorant-link-changes)`,
    });

    return NextResponse.json({ ok: true, requestId: reqRef.id });
  } catch (err) {
    captureApiError('API valorant-link/change-request POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
