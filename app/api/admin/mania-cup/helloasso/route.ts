import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
import {
  MANIA_CUP_REGISTRATIONS,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';
import {
  getHelloAssoConfig,
  fetchFormTiers,
  iterateFormOrders,
  HelloAssoError,
} from '@/lib/helloasso/client';
import { parseOrder, parseTierMap, resolveManualTicket } from '@/lib/helloasso/reconcile';
import { applyOrderItem, MANIA_CUP_PAYMENTS, type PaymentRecord } from '@/lib/helloasso/apply';

// Pilotage de la billetterie HelloAsso depuis la console.
//
// GET  ?action=tiers   — les tarifs du formulaire, pour établir la correspondance
// POST {action:'reconcile'} — relit toutes les commandes et rattrape ce qui manque
// POST {action:'match'}     — rattache à la main un règlement orphelin
//
// La réconciliation n'est pas un confort. Le webhook est le chemin normal, mais
// une notification peut ne jamais arriver : des développeurs l'ont signalé sur
// le forum de l'éditeur sans obtenir de réponse. Un joueur qui a payé et qu'on
// laisse en « en attente » appellera l'organisation le samedi matin. Ce bouton
// est ce qui évite d'en arriver là — et il emprunte EXACTEMENT le même chemin
// d'écriture que le webhook, pour qu'aucun des deux ne puisse diverger.

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const cfg = getHelloAssoConfig();
    if (!cfg) {
      return NextResponse.json(
        { configured: false, error: 'Clés HelloAsso absentes des variables d’environnement.' },
        { status: 200 }
      );
    }

    const db = getAdminDb();
    const settings = await getManiaCupSettings(db);

    if (req.nextUrl.searchParams.get('action') === 'tiers') {
      const tiers = await fetchFormTiers(db, cfg);
      return NextResponse.json({
        configured: true,
        organizationSlug: cfg.organizationSlug,
        forms: cfg.forms,
        tiers,
        tierMap: settings.helloAssoTierMap,
        codeField: settings.helloAssoCodeField,
      });
    }

    // État de la caisse : ce que HelloAsso a encaissé, vu de notre côté.
    const paymentsSnap = await db
      .collection(MANIA_CUP_PAYMENTS)
      .orderBy('receivedAt', 'desc')
      .limit(300)
      .get();
    const payments = paymentsSnap.docs.map((d) => d.data() as PaymentRecord);

    return NextResponse.json({
      configured: true,
      organizationSlug: cfg.organizationSlug,
      forms: cfg.forms,
      tierMap: settings.helloAssoTierMap,
      codeField: settings.helloAssoCodeField,
      payments,
      counts: {
        total: payments.length,
        toReview: payments.filter(
          (p) => p.outcome === 'unmatched' || p.outcome === 'needs_review'
        ).length,
      },
    });
  } catch (err) {
    if (err instanceof HelloAssoError) {
      captureApiError('admin/mania-cup/helloasso:GET', err);
      return NextResponse.json(
        { configured: true, error: `HelloAsso : ${err.message}` },
        { status: 502 }
      );
    }
    captureApiError('admin/mania-cup/helloasso:GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid || !(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Réservé aux administrateurs' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      itemId?: unknown;
      targetUid?: unknown;
      ticket?: unknown;
    } | null;
    const action = typeof body?.action === 'string' ? body.action : '';

    const db = getAdminDb();

    if (action === 'reconcile') {
      const cfg = getHelloAssoConfig();
      if (!cfg) {
        return NextResponse.json(
          { error: 'Clés HelloAsso absentes — impossible de relire les commandes.' },
          { status: 503 }
        );
      }

      const settings = await getManiaCupSettings(db);
      const opts = {
        tiers: parseTierMap(settings.helloAssoTierMap),
        codeFieldLabel: settings.helloAssoCodeField,
      };

      let scanned = 0;
      let changed = 0;
      const problems: { itemId: number; reason: string }[] = [];

      // Le générateur pagine chez HelloAsso ; on borne la boucle par le temps
      // écoulé pour rendre la main avant que la fonction ne soit coupée. Un
      // second passage reprendra ce qui reste — le traitement est idempotent.
      const deadline = Date.now() + 45_000;

      for await (const order of iterateFormOrders(db, cfg)) {
        for (const item of parseOrder(order, opts)) {
          scanned++;
          const res = await applyOrderItem(db, item, {
            source: 'reconcile',
            expectedPlayerAmountCents: settings.priceEuros * 100,
            maxPlayers: settings.maxPlayers,
          });
          if (res.changed) changed++;
          if (res.outcome === 'unmatched' || res.outcome === 'needs_review') {
            problems.push({ itemId: res.itemId, reason: res.reason ?? '' });
          }
        }
        if (Date.now() > deadline) {
          return NextResponse.json({
            ok: true,
            scanned,
            changed,
            problems,
            truncated: true,
            note: 'Relecture interrompue pour ne pas dépasser le temps imparti. Relance pour continuer.',
          });
        }
      }

      await writeAdminAuditLog(db, {
        action: 'mania_cup_payments_reconciled',
        adminUid: uid,
        targetType: 'competition',
        targetId: 'mania-cup',
        targetLabel: 'Springs Mania Cup',
        metadata: { scanned, changed },
      });

      return NextResponse.json({ ok: true, scanned, changed, problems, truncated: false });
    }

    // ── Rattachement manuel d'un règlement orphelin ──────────────────────────
    if (action === 'match') {
      const itemId = Number(body?.itemId);
      const targetUid = typeof body?.targetUid === 'string' ? body.targetUid : '';
      const requestedTicket = typeof body?.ticket === 'string' ? body.ticket : null;
      if (!Number.isFinite(itemId) || !targetUid) {
        return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
      }

      const paymentRef = db.collection(MANIA_CUP_PAYMENTS).doc(String(itemId));
      const regRef = db.collection(MANIA_CUP_REGISTRATIONS).doc(targetUid);

      const result = await db.runTransaction(async (tx) => {
        const [paySnap, regSnap] = await tx.getAll(paymentRef, regRef);
        if (!paySnap.exists) return { error: 'Règlement introuvable', status: 404 };
        if (!regSnap.exists) return { error: 'Inscription introuvable', status: 404 };

        const payment = paySnap.data() as PaymentRecord;
        const reg = regSnap.data() as ManiaCupRegistration;

        if (payment.matchedUid === targetUid && reg.status === 'confirmed') {
          return { error: 'Ce règlement est déjà rattaché à ce dossier', status: 409 };
        }
        // Rattacher un second règlement à un dossier déjà réglé masquerait un
        // doublon qui appelle un remboursement.
        if (reg.status === 'confirmed' && reg.payment?.itemId !== itemId) {
          return { error: 'Cette inscription est déjà réglée par un autre paiement', status: 409 };
        }

        // Quelle catégorie appliquer ? Surtout pas `payment.ticket` seul : quand
        // la reconnaissance automatique a échoué il vaut null, et c'est
        // exactement le cas où l'on se sert de ce bouton.
        const resolved = resolveManualTicket(payment, requestedTicket);
        if (!resolved.ok) return { error: resolved.reason, status: 409 };
        const kind = resolved.ticket;

        tx.set(
          paymentRef,
          {
            matchedUid: targetUid,
            // La catégorie tranchée est écrite : le journal doit dire ce qui a
            // été appliqué, sans quoi une relecture ultérieure repartirait du
            // même « tarif non reconnu ».
            ticket: kind,
            outcome:
              kind === 'player'
                ? 'confirm_player'
                : kind === 'companion'
                  ? 'companion_paid'
                  : 'pc_rental',
            reason: `Rattaché à la main par l’organisation`,
            source: 'manual',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (kind === 'player') {
          tx.set(
            regRef,
            {
              status: 'confirmed',
              paidAt: FieldValue.serverTimestamp(),
              payment: {
                orderId: payment.orderId,
                itemId: payment.itemId,
                tierLabel: payment.tierLabel,
                amountCents: payment.amountCents,
                payerName: payment.payerName,
                payerEmail: payment.payerEmail,
                at: FieldValue.serverTimestamp(),
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else if (kind === 'companion') {
          tx.set(
            regRef,
            {
              companion: { ticketPaid: true, ticketPaidAt: FieldValue.serverTimestamp() },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else if (kind === 'pc_rental') {
          tx.set(
            regRef,
            {
              pcRental: {
                itemId: payment.itemId,
                amountCents: payment.amountCents,
                at: FieldValue.serverTimestamp(),
              },
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        return { ok: true, label: reg.tmDisplayName ?? targetUid };
      });

      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      await writeAdminAuditLog(db, {
        action: 'mania_cup_payment_matched',
        adminUid: uid,
        targetType: 'user',
        targetId: targetUid,
        targetLabel: result.label ?? null,
        metadata: { itemId },
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
  } catch (err) {
    if (err instanceof HelloAssoError) {
      captureApiError('admin/mania-cup/helloasso:POST', err);
      return NextResponse.json({ error: `HelloAsso : ${err.message}` }, { status: 502 });
    }
    captureApiError('admin/mania-cup/helloasso:POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
