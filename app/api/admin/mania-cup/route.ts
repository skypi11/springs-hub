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
  type ManiaCupRegistration,
} from '@/lib/mania-cup';

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

    const registrations = snap.docs.map((d) => {
      const r = d.data() as ManiaCupRegistration;
      return {
        uid: d.id,
        tmDisplayName: r.tmDisplayName,
        tmAccountId: r.tmAccountId,
        discordId: r.discordId,
        countryCode: r.countryCode,
        ageAtEvent: r.ageAtEvent,
        status: r.status,
        guardianConsent: r.guardianConsent,
        guardianDocs: Object.fromEntries(
          Object.entries(r.guardianDocs ?? {}).map(([k, d]) => [k, { name: d.name }])
        ),
        guardianRejectionReason: r.guardianRejectionReason ?? null,
        registrationCode: r.registrationCode,
        companion: r.companion ?? null,
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

    // Confirmation manuelle du règlement — filet tant que le webhook HelloAsso
    // n'est pas branché, et rattrapage permanent pour les paiements orphelins
    // (quelqu'un qui paie sans avoir reporté son code d'inscription).
    if (action === 'mark_paid' || action === 'mark_unpaid') {
      const paid = action === 'mark_paid';
      await docRef.update({
        status: paid ? 'confirmed' : 'pending_payment',
        paidAt: paid ? FieldValue.serverTimestamp() : null,
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
