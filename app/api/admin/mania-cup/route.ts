import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString } from '@/lib/validation';
import { countries } from '@/lib/countries';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import { createNotification } from '@/lib/notifications';
import { donnerRoleInscrit, retirerRoleInscrit } from '@/lib/mania-cup-alerts';
import {
  MANIA_CUP_WAITLIST, prochainAInviter, fileEnAttente,
} from '@/lib/mania-cup-waitlist';
import { lireFileAttente, compterPlacesReglees } from '@/lib/mania-cup-waitlist-server';
import {
  MANIA_CUP_REGISTRATIONS,
  type ManiaCupCompanion,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

/** Lecture tolérante : les tout premiers dossiers portaient un accompagnant
 *  unique, sous un autre nom de champ. */
function readCompanions(reg: ManiaCupRegistration): ManiaCupCompanion[] {
  if (Array.isArray(reg.companions)) return reg.companions;
  const legacy = (reg as { companion?: ManiaCupCompanion | null }).companion;
  return legacy?.name ? [legacy] : [];
}

// Console d'organisation de la Springs Mania Cup.
//
// GET   — toutes les inscriptions, avec les données nécessaires au suivi
// PATCH — statuer sur une autorisation parentale (valider / refuser), ou
//         confirmer un paiement à la main tant que HelloAsso n'est pas branché

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const db = getAdminDb();
    const [snap, settings] = await Promise.all([
      db.collection(MANIA_CUP_REGISTRATIONS).orderBy('createdAt', 'asc').get(),
      getManiaCupSettings(db),
    ]);

    // Même règle que la liste publique : le drapeau vient du profil, que le
    // joueur et l'organisation peuvent corriger, et non de la copie figée au
    // dépôt du dossier. La console doit montrer ce que montre le site.
    const profils = snap.docs.length
      ? await db.getAll(...snap.docs.map((d) => db.collection('users').doc(d.id)))
      : [];
    const paysParUid = new Map(
      profils.map((p) => [p.id, (p.data()?.country as string) || ''])
    );

    const registrations = snap.docs.map((d) => {
      const r = d.data() as ManiaCupRegistration;
      return {
        uid: d.id,
        tmDisplayName: r.tmDisplayName,
        tmAccountId: r.tmAccountId,
        discordId: r.discordId,
        // Identité civile : c'est elle que le bénévole compare à la pièce
        // d'identité présentée à l'accueil.
        firstName: r.firstName ?? '',
        lastName: r.lastName ?? '',
        email: r.email ?? '',
        phone: r.phone ?? null,
        emergencyContact: r.emergencyContact ?? null,
        imageConsent: r.imageConsent?.accepted ?? null,
        countryCode: paysParUid.get(d.id) || r.countryCode,
        ageAtEvent: r.ageAtEvent,
        // Les places se prennent par ordre de règlement : savoir QUAND un
        // dossier est arrivé, et quand il a été réglé, est ce qui permet
        // d'arbitrer une liste d'attente ou de relancer un retardataire.
        createdAt: r.createdAt ?? null,
        paidAt: r.paidAt ?? null,
        status: r.status,
        guardianConsent: r.guardianConsent,
        guardianDocs: Object.fromEntries(
          Object.entries(r.guardianDocs ?? {}).map(([k, d]) => [k, { name: d.name }])
        ),
        guardianRejectionReason: r.guardianRejectionReason ?? null,
        registrationCode: r.registrationCode,
        companions: readCompanions(r),
        payment: r.payment ?? null,
        pcRental: r.pcRental ?? null,
        seat: r.seat ?? null,
        checkedIn: Boolean(r.checkedInAt),
        staffMessage: r.staffMessage ?? null,
      };
    });

    // Une inscription retirée ne compte dans aucun total : la laisser dans le
    // « total » gonflait un chiffre que personne ne pouvait rapprocher, et la
    // faisait apparaître dans les dossiers parentaux à relire.
    const active = registrations.filter((r) => r.status !== 'cancelled');

    const counts = {
      total: active.length,
      cancelled: registrations.length - active.length,
      confirmed: active.filter((r) => r.status === 'confirmed').length,
      pendingPayment: active.filter((r) => r.status === 'pending_payment').length,
      guardianToReview: active.filter((r) => r.guardianConsent === 'pending_review').length,
      guardianMissing: active.filter((r) => r.guardianConsent === 'missing').length,
      minors: active.filter((r) => r.ageAtEvent < 18).length,
      checkedIn: active.filter((r) => r.checkedIn).length,
      // Dossiers déposés avant que l'identité civile ne soit demandée : ils
      // n'ont ni nom ni e-mail, donc rien à contrôler à l'accueil.
      incomplete: active.filter((r) => !r.firstName || !r.email).length,
      // Même règle que le site : seules les inscriptions réglées consomment
      // une place.
      seatsLeft: Math.max(
        0,
        settings.maxPlayers - active.filter((r) => r.status === 'confirmed').length
      ),
      maxPlayers: settings.maxPlayers,
    };

    // La file d'attente voyage avec le reste : la console doit pouvoir dire
    // qui attend, dans quel ordre, et si une place peut être offerte — sans
    // deuxième aller-retour.
    const { entrees } = await lireFileAttente(db);
    const maintenant = Date.now();
    const nomsParUid = new Map(
      registrations.map((r) => [r.uid, r.tmDisplayName || `${r.firstName} ${r.lastName}`.trim()])
    );
    const fileDocs = fileEnAttente(entrees);
    const attenteProfils = fileDocs.length
      ? await db.getAll(...fileDocs.map((e) => db.collection('users').doc(e.uid)))
      : [];
    const profilsAttente = new Map(attenteProfils.map((d) => [d.id, d.data() ?? {}]));

    const waitlist = fileDocs.map((e, i) => {
      const u = profilsAttente.get(e.uid) ?? {};
      return {
        uid: e.uid,
        rang: i + 1,
        statut: e.statut,
        expireA: e.expireA ?? null,
        expiree: e.statut === 'invited' && e.expireA != null && e.expireA <= maintenant,
        nom: nomsParUid.get(e.uid) || (u.pseudoTM as string) || (u.displayName as string) || e.uid,
        discordId: (u.discordId as string) ?? null,
        demandeLe: e.createdAt,
      };
    });

    const prochain = prochainAInviter({
      entrees,
      placesReglees: counts.confirmed,
      placesTotales: settings.maxPlayers,
      maintenant,
    });

    return NextResponse.json({
      registrations,
      counts,
      waitlist,
      /** Qui recevra l'invitation si on clique. `null` = aucune place à offrir. */
      prochainAInviter: prochain?.uid ?? null,
    });
  } catch (err) {
    captureApiError('admin/mania-cup:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as {
      uid?: unknown;
      action?: unknown;
      reason?: unknown;
      seat?: unknown;
      message?: unknown;
      countryCode?: unknown;
      pcRental?: unknown;
    } | null;

    const target = typeof body?.uid === 'string' ? body.uid : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    const db = getAdminDb();

    // ── Actions qui NE VISENT PAS une inscription ────────────────────────────
    //
    // Elles se traitent AVANT la garde ci-dessous, qui exige un `uid` et
    // charge le dossier correspondant. Greffées après, elles étaient MORTES :
    // « Rôles Discord » ne vise personne en particulier et repartait en
    // « Requête invalide », et les actions de liste d'attente visent une
    // entrée de FILE, pas une inscription — elles auraient toutes répondu
    // « Inscription introuvable », l'invitation comprise.

    /** Donner le rôle à tous ceux qui ont réglé et ne l'ont pas encore.
     *
     *  Indispensable et pas seulement pour rattraper : un joueur peut très bien
     *  régler son inscription AVANT de rejoindre le serveur Discord. Discord
     *  n'a aucun moyen de nous prévenir quand il arrive ; c'est donc ce bouton
     *  qui referme l'écart, autant de fois qu'il le faut. */
    if (action === 'sync_discord_roles') {
      const snap = await db
        .collection(MANIA_CUP_REGISTRATIONS)
        .where('status', '==', 'confirmed')
        .get();

      const absents: string[] = [];
      let donnes = 0;
      let raisonBloquante: string | null = null;

      for (const doc of snap.docs) {
        const r = doc.data() as { tmDisplayName?: string };
        const res = await donnerRoleInscrit(db, doc.id);
        if (res.ok) { donnes++; continue; }
        if (res.raison === 'pas_membre') {
          absents.push(r.tmDisplayName || doc.id);
          continue;
        }
        // Rôle non configuré ou introuvable : inutile de marteler l'API
        // Discord soixante-quatre fois pour la même cause.
        raisonBloquante = res.raison;
        break;
      }

      if (raisonBloquante === 'role_non_configure') {
        return NextResponse.json(
          { error: 'Aucun rôle n’est configuré — renseigne-le dans l’onglet Configuration.' },
          { status: 400 }
        );
      }
      if (raisonBloquante === 'role_introuvable') {
        return NextResponse.json(
          { error: 'Le rôle configuré n’existe plus sur le serveur Discord.' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        donnes,
        // Nommés, pas comptés : l'organisation doit pouvoir leur dire de
        // rejoindre le serveur.
        absentsDuServeur: absents,
      });
    }

    // ── Liste d'attente ──────────────────────────────────────────────────────

    /** Inviter quelqu'un à prendre la place qui vient de se libérer.
     *
     *  L'action REFUSE tant qu'aucune place n'est disponible — places réglées
     *  et places déjà réservées par une autre invitation comprises. C'est ce
     *  refus qui empêche d'inviter deux personnes sur une seule place, et donc
     *  de devoir en rembourser une. */
    if (action === 'waitlist_invite') {
      const [{ entrees }, reglees, settings] = await Promise.all([
        lireFileAttente(db),
        compterPlacesReglees(db),
        getManiaCupSettings(db),
      ]);
      const maintenant = Date.now();
      const suivant = prochainAInviter({
        entrees,
        placesReglees: reglees,
        placesTotales: settings.maxPlayers,
        maintenant,
      });
      if (!suivant) {
        return NextResponse.json(
          {
            error:
              'Aucune place à offrir pour l’instant — soit tout est réglé, soit une invitation en cours tient déjà la dernière place.',
          },
          { status: 409 }
        );
      }
      // La cible est imposée par la file, jamais choisie dans la requête :
      // l'ordre d'arrivée est la seule règle annoncée aux joueurs.
      if (typeof body?.uid === 'string' && body.uid !== suivant.uid) {
        return NextResponse.json(
          { error: 'C’est au tour de quelqu’un d’autre dans la file.' },
          { status: 409 }
        );
      }

      // Aucune échéance : la place reste réservée jusqu'à ce que
      // l'organisation passe au suivant. Une horloge obligerait à annoncer un
      // délai dans le règlement, donc à s'y tenir même quand la personne
      // répond une heure trop tard avec une bonne raison.
      await db.collection(MANIA_CUP_WAITLIST).doc(suivant.uid).set(
        {
          status: 'invited',
          invitedAt: FieldValue.serverTimestamp(),
          invitedBy: uid,
          invitationExpiresAt: null,
        },
        { merge: true }
      );
      await createNotification(db, {
        userId: suivant.uid,
        type: 'mania_cup_waitlist_invited',
        title: 'Une place s’est libérée à la Springs Mania Cup',
        message:
          'Elle t’est réservée. Règle ton inscription sans tarder : sans nouvelle de ta part, l’organisation la proposera à la personne suivante.',
        link: '/mania-cup/inscription',
      });
      await writeAdminAuditLog(db, {
        action: 'mania_cup_waitlist_invited',
        adminUid: uid,
        targetType: 'user',
        targetId: suivant.uid,
        targetLabel: suivant.uid,
      });
      return NextResponse.json({ ok: true, invite: suivant.uid });
    }

    /** Passer au suivant : la personne invitée n'a pas donné suite.
     *
     *  C'est la seule façon de libérer une place réservée. Ce n'est pas une
     *  sanction — elle peut se remettre dans la file — mais elle repart alors
     *  de la fin, comme tout le monde : reprendre son rang la ferait passer
     *  devant des gens qui, eux, ont attendu sans se faire proposer de place. */
    if (action === 'waitlist_pass') {
      const cible = typeof body?.uid === 'string' ? body.uid : '';
      if (!cible) return NextResponse.json({ error: 'Joueur manquant.' }, { status: 400 });

      const ref = db.collection(MANIA_CUP_WAITLIST).doc(cible);
      const doc = await ref.get();
      if ((doc.data()?.status as string) !== 'invited') {
        return NextResponse.json(
          { error: 'Cette personne n’a pas d’invitation en cours.' },
          { status: 409 }
        );
      }
      await ref.set(
        { status: 'left', passedAt: FieldValue.serverTimestamp(), passedBy: uid },
        { merge: true }
      );
      await writeAdminAuditLog(db, {
        action: 'mania_cup_waitlist_passed',
        adminUid: uid,
        targetType: 'user',
        targetId: cible,
        targetLabel: cible,
      });
      return NextResponse.json({ ok: true });
    }

    /** Retirer quelqu'un de la file — désistement annoncé de vive voix, doublon. */
    if (action === 'waitlist_remove') {
      const cible = typeof body?.uid === 'string' ? body.uid : '';
      if (!cible) return NextResponse.json({ error: 'Joueur manquant.' }, { status: 400 });
      await db.collection(MANIA_CUP_WAITLIST).doc(cible).set(
        { status: 'left', leftAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await writeAdminAuditLog(db, {
        action: 'mania_cup_waitlist_removed',
        adminUid: uid,
        targetType: 'user',
        targetId: cible,
        targetLabel: cible,
      });
      return NextResponse.json({ ok: true });
    }


    if (!target || !action) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const docRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(target);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: 'Inscription introuvable' }, { status: 404 });
    const reg = snap.data() as ManiaCupRegistration;

    if (action === 'approve_guardian') {
      await docRef.update({
        guardianConsent: 'approved',
        guardianRejectionReason: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAdminAuditLog(db, {
        action: 'mania_cup_guardian_consent_approved',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? null,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reject_guardian') {
      // Le motif part au joueur : sans lui, il redépose le même document.
      const reason = clampString(typeof body?.reason === 'string' ? body.reason : '', 400);
      if (!reason) {
        return NextResponse.json(
          { error: 'Indique un motif — le joueur doit savoir quoi corriger.' },
          { status: 400 }
        );
      }
      await docRef.update({
        guardianConsent: 'rejected',
        guardianRejectionReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAdminAuditLog(db, {
        action: 'mania_cup_guardian_consent_rejected',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? null,
        metadata: { reason },
      });
      return NextResponse.json({ ok: true });
    }

    // Confirmation manuelle du règlement — rattrapage pour un paiement reçu
    // autrement que par la billetterie (espèces, virement), ou pour un dossier
    // que la relecture automatique n'a pas su rattacher.
    //
    // Ce chemin est TRACÉ : c'est un encaissement de 30 €, il doit être
    // possible de dire qui l'a validé et quand.
    if (action === 'mark_paid' || action === 'mark_unpaid') {
      const paid = action === 'mark_paid';
      if (paid && reg.status === 'cancelled') {
        return NextResponse.json(
          { error: 'Cette inscription a été retirée. Réactive-la d’abord avec le joueur.' },
          { status: 409 }
        );
      }
      await docRef.update({
        status: paid ? 'confirmed' : 'pending_payment',
        paidAt: paid ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Le rôle Discord suit le règlement, quel que soit le chemin : marqué à
      // la main ici, ou rattaché par le webhook. Sans ça, un joueur confirmé
      // depuis la console n'aurait jamais son rôle.
      if (paid) {
        void donnerRoleInscrit(db, target).catch(() => {});
      } else {
        void retirerRoleInscrit(db, target).catch(() => {});
      }
      await writeAdminAuditLog(db, {
        action: paid ? 'mania_cup_marked_paid' : 'mania_cup_marked_unpaid',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? null,
        metadata: { registrationCode: reg.registrationCode ?? null },
      });
      return NextResponse.json({ ok: true });
    }

    // Annulation par l'organisation. Distincte de « marquer non payé », qui
    // remet seulement le dossier en attente : ici la place est rendue.
    if (action === 'cancel') {
      // Une inscription retirée rend la place ET l'accès : garder le rôle
      // laisserait quelqu'un dans les salons des inscrits sans y avoir droit.
      void retirerRoleInscrit(db, target).catch(() => {});
      const reason = clampString(typeof body?.reason === 'string' ? body.reason : '', 400);
      await docRef.update({
        status: 'cancelled',
        staffMessage: reason || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAdminAuditLog(db, {
        action: 'mania_cup_registration_cancelled',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? null,
        metadata: { reason, hadPaid: Boolean(reg.paidAt) },
      });
      return NextResponse.json({ ok: true });
    }

    // ── Le jour J ────────────────────────────────────────────────────────────

    if (action === 'check_in' || action === 'undo_check_in') {
      const arriving = action === 'check_in';
      await docRef.update({
        checkedInAt: arriving ? FieldValue.serverTimestamp() : null,
        checkedInBy: arriving ? uid : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (arriving) {
        await writeAdminAuditLog(db, {
          action: 'mania_cup_checked_in',
          adminUid: uid,
          targetType: 'user',
          targetId: target,
          targetLabel: reg.tmDisplayName ?? null,
        });
      }
      return NextResponse.json({ ok: true });
    }

    /** Emplacement attribué dans la salle : imprimé sur le badge, dit au joueur
     *  où brancher son PC sans faire le tour des tables. */
    if (action === 'set_seat') {
      const seat = clampString(typeof body?.seat === 'string' ? body.seat : '', 20).trim();
      await docRef.update({ seat: seat || null, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, seat });
    }

    /** Mot visible par le joueur sur son espace — évite les messages privés qui
     *  se perdent quand il manque une pièce. */
    if (action === 'set_message') {
      const message = clampString(typeof body?.message === 'string' ? body.message : '', 300).trim();
      await docRef.update({
        staffMessage: message || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    }

    /** Corriger le pays d'un inscrit.
     *
     *  Le drapeau affiché vient du PROFIL : c'est donc lui qu'on corrige, pas
     *  la copie de l'inscription. Le 7 août, un joueur suisse est apparu sous
     *  drapeau français et l'organisation n'avait aucun moyen d'y remédier —
     *  modifier le profil depuis la console des utilisateurs ne changeait rien
     *  à la page de l'événement, faute de source unique.
     *
     *  La copie de l'inscription est alignée dans la foulée : elle sert de
     *  repli, et l'accueil du jour J travaille dessus. */
    if (action === 'set_country') {
      const code = typeof body?.countryCode === 'string' ? body.countryCode : '';
      if (!countries.some((c) => c.code === code)) {
        return NextResponse.json({ error: 'Pays inconnu.' }, { status: 400 });
      }
      await Promise.all([
        db.collection('users').doc(target).set(
          { country: code, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        ),
        docRef.update({ countryCode: code, updatedAt: FieldValue.serverTimestamp() }),
      ]);
      await writeAdminAuditLog(db, {
        action: 'mania_cup_country_set',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? target,
        metadata: { countryCode: code },
      });
      return NextResponse.json({ ok: true, countryCode: code });
    }

    /** Marquer une location de poste à la main.
     *
     *  `pcRental` ne pouvait venir que de la boutique HelloAsso, qui n'existe
     *  pas encore — l'organisation n'avait donc aucun moyen d'enregistrer une
     *  location convenue de vive voix ou sur le Discord, alors que le nombre de
     *  postes disponibles est très limité et qu'il faut savoir qui en occupe un.
     *
     *  Quand la boutique existera, elle écrira le même champ avec son montant
     *  réel : ce chemin restera le rattrapage. */

    if (action === 'set_pc_rental') {
      const rented = body?.pcRental === true;
      await docRef.update({
        pcRental: rented
          ? {
              // Aucun montant : rien n'a été encaissé par ce chemin. Inscrire un
              // prix ici ferait croire à un règlement reçu.
              amountCents: 0,
              source: 'manual',
              at: FieldValue.serverTimestamp(),
            }
          : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAdminAuditLog(db, {
        action: 'mania_cup_pc_rental_set',
        adminUid: uid,
        targetType: 'user',
        targetId: target,
        targetLabel: reg.tmDisplayName ?? target,
        metadata: { rented },
      });
      return NextResponse.json({ ok: true, rented });
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
  } catch (err) {
    captureApiError('admin/mania-cup:PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
