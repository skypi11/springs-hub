import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString } from '@/lib/validation';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
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

    return NextResponse.json({ registrations, counts });
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
    } | null;

    const target = typeof body?.uid === 'string' ? body.uid : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!target || !action) {
      return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
    }

    const db = getAdminDb();
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

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
  } catch (err) {
    captureApiError('admin/mania-cup:PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
