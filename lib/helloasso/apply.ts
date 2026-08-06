import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createNotification } from '@/lib/notifications';
import { sendManiaCupDM } from '@/lib/discord-bot';
import {
  MANIA_CUP_REGISTRATIONS,
  MAX_COMPANIONS,
  discordIdFromUid,
  type ManiaCupCompanion,
  type ManiaCupRegistration,
} from '@/lib/mania-cup';
import { findUidByRegistrationCode } from '@/lib/mania-cup-server';
import {
  assignCompanionTicket,
  decideItem,
  isOutcomeAlreadyApplied,
  type Outcome,
  type OrderItemView,
  type RegistrationSnapshot,
} from './reconcile';
import { TICKET_LABELS, type TicketKind } from './types';

// Application en base de ce qu'une ligne de commande a décidé.
//
// Le module `reconcile` décide, celui-ci écrit. La séparation n'est pas
// cosmétique : la décision se teste sur des commandes réelles sans base, et
// l'écriture reste un chemin unique, transactionnel, que le webhook comme la
// réconciliation manuelle empruntent à l'identique. Deux chemins d'écriture
// divergents finiraient par se contredire.

/** Lecture tolérante : les tout premiers dossiers portaient un accompagnant
 *  unique, sous un autre nom de champ.
 *
 *  Exportée, car le rattachement manuel doit lire les accompagnants EXACTEMENT
 *  comme le traitement automatique. C'est d'avoir eu un second chemin de lecture
 *  qui avait fait écrire la route dans ce champ hérité que plus personne ne
 *  consomme — billet payé, aucun badge imprimé. */
export function readCompanions(reg: ManiaCupRegistration | undefined): ManiaCupCompanion[] {
  if (!reg) return [];
  if (Array.isArray(reg.companions)) return reg.companions;
  const legacy = (reg as { companion?: ManiaCupCompanion | null }).companion;
  return legacy?.name ? [legacy] : [];
}

/** Journal des encaissements. L'identifiant du document est celui de la LIGNE
 *  de commande HelloAsso : c'est ce qui rend le traitement idempotent, alors
 *  que HelloAsso rejoue ses notifications jusqu'à obtenir un 200. */
export const MANIA_CUP_PAYMENTS = 'mania_cup_payments';

export interface PaymentRecord {
  itemId: number;
  orderId: number;
  /**
   * Volontairement fermé sur les catégories connues, et pas `string | null` :
   * ce laxisme laissait passer sans un mot des comparaisons du genre
   * `payment.ticket === 'player'` alors que le champ pouvait être null.
   */
  ticket: TicketKind | null;
  tierLabel: string;
  amountCents: number;
  state: string;
  rawCode: string | null;
  code: string | null;
  participantName: string;
  payerName: string;
  payerEmail: string;
  /** Dossier auquel la ligne a été rattachée, quand elle a pu l'être. */
  matchedUid: string | null;
  outcome: Outcome['kind'];
  reason: string | null;
  source: 'webhook' | 'reconcile' | 'manual';
  receivedAt?: unknown;
  updatedAt?: unknown;
}

export interface ApplyResult {
  itemId: number;
  outcome: Outcome['kind'];
  reason: string | null;
  uid: string | null;
  /** Faux quand la ligne avait déjà été traitée à l'identique. */
  changed: boolean;
}

export interface ApplyOptions {
  source: PaymentRecord['source'];
  /** Montant attendu pour une inscription joueur, en centimes. */
  expectedPlayerAmountCents: number | null;
  /** Jauge, pour alerter si un règlement fait dépasser le nombre de places. */
  maxPlayers: number;
}

/**
 * Traite une ligne de commande de bout en bout : résout son code, décide, écrit.
 *
 * Renvoie ce qui a été fait, pour que l'appelant puisse le rapporter — un
 * webhook silencieux qui « a marché » ne se diagnostique pas.
 */
export async function applyOrderItem(
  db: Firestore,
  item: OrderItemView,
  opts: ApplyOptions
): Promise<ApplyResult> {
  const uid = item.code ? await findUidByRegistrationCode(db, item.code) : null;

  let snapshot: RegistrationSnapshot | null = null;
  if (uid) {
    const regSnap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get();
    if (regSnap.exists) {
      const reg = regSnap.data() as ManiaCupRegistration;
      snapshot = {
        uid,
        status: reg.status,
        paidByItemId: reg.payment?.itemId ?? null,
      };
    }
  }

  const outcome = decideItem(item, {
    registration: snapshot,
    expectedAmountCents: item.ticket === 'player' ? opts.expectedPlayerAmountCents : null,
  });

  const changed = await writeOutcome(db, item, outcome, opts);

  // Le joueur est prévenu APRÈS l'écriture, et seulement si quelque chose a
  // changé : un rejeu de notification ne doit pas lui renvoyer un message.
  if (changed && outcome.kind === 'confirm_player') {
    await notifyPlayerPaid(db, outcome.uid, item).catch(() => {});
  }

  // Un règlement encaissé qu'on ne sait pas rattacher ne doit jamais rester
  // silencieux : c'est de l'argent reçu contre une place non confirmée.
  if (changed && (outcome.kind === 'unmatched' || outcome.kind === 'needs_review')) {
    await notifyStaffOfOrphanPayment(db, item, outcome).catch(() => {});
  }

  return {
    itemId: item.itemId,
    outcome: outcome.kind,
    reason: 'reason' in outcome ? outcome.reason : null,
    uid: 'uid' in outcome ? outcome.uid : null,
    changed,
  };
}

/** Écrit le journal et applique l'effet métier, en une transaction. */
async function writeOutcome(
  db: Firestore,
  item: OrderItemView,
  outcome: Outcome,
  opts: ApplyOptions
): Promise<boolean> {
  const paymentRef = db.collection(MANIA_CUP_PAYMENTS).doc(String(item.itemId));

  const regRef =
    'uid' in outcome ? db.collection(MANIA_CUP_REGISTRATIONS).doc(outcome.uid) : null;

  return db.runTransaction(async (tx) => {
    // Toutes les lectures d'abord : Firestore l'exige, et l'attribution d'un
    // billet accompagnant a besoin de la liste fraîche pour ne pas écraser un
    // rattachement concurrent.
    const prevSnap = await tx.get(paymentRef);
    const regSnap = regRef ? await tx.get(regRef) : null;
    const prev = prevSnap.data() as PaymentRecord | undefined;

    // Rejeu à l'identique : même état, même décision — ET l'effet est déjà
    // inscrit sur le dossier. Cette dernière condition est ce qui fait de
    // « Relire les commandes » un vrai bouton de réparation : sans elle, un
    // dossier qui a dérivé (un « Marquer payé » cliqué de travers suffit)
    // restait en attente de paiement pendant que la console annonçait « tout
    // était déjà à jour ».
    const reg = regSnap?.data() as ManiaCupRegistration | undefined;
    const isReplay =
      prev != null &&
      prev.state === item.state &&
      prev.outcome === outcome.kind &&
      isOutcomeAlreadyApplied(outcome, item.itemId, {
        status: reg?.status,
        paidByItemId: reg?.payment?.itemId ?? null,
        companionItemIds: readCompanions(reg).map((c) => c.ticketItemId),
        pcRentalItemId: reg?.pcRental?.itemId ?? null,
      });

    const record: PaymentRecord = {
      itemId: item.itemId,
      orderId: item.orderId,
      ticket: item.ticket,
      tierLabel: item.tierLabel,
      amountCents: item.amountCents,
      state: item.state,
      rawCode: item.rawCode,
      code: item.code,
      participantName: item.participantName,
      payerName: item.payerName,
      payerEmail: item.payerEmail,
      matchedUid: 'uid' in outcome ? outcome.uid : null,
      outcome: outcome.kind,
      reason: 'reason' in outcome ? outcome.reason : null,
      source: opts.source,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!prev) record.receivedAt = FieldValue.serverTimestamp();

    if (isReplay) {
      // Même état, même décision : aucun effet métier, et surtout aucune
      // notification — c'est tout l'objet de cette porte.
      //
      // Mais la LECTURE de la ligne, elle, a pu changer : le tarif est désormais
      // reconnu, ou la raison affichée n'est plus la bonne. Sans ce
      // rafraîchissement, la console d'un règlement en doublon continuait
      // d'afficher « Rattaché à la main par l'organisation » — la trace d'une
      // tentative qui n'avait rien fait — au lieu du motif réel.
      if (prev != null && (prev.reason !== record.reason || prev.ticket !== record.ticket)) {
        tx.set(
          paymentRef,
          {
            ticket: record.ticket,
            reason: record.reason,
            source: opts.source,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      return false;
    }

    tx.set(paymentRef, record, { merge: true });

    if ('uid' in outcome && regRef) {
      if (outcome.kind === 'confirm_player') {
        tx.set(
          regRef,
          {
            status: 'confirmed',
            paidAt: FieldValue.serverTimestamp(),
            payment: {
              orderId: item.orderId,
              itemId: item.itemId,
              tierLabel: item.tierLabel,
              amountCents: item.amountCents,
              payerName: item.payerName,
              payerEmail: item.payerEmail,
              at: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (outcome.kind === 'revoke') {
        // La place repart à la vente. On efface la preuve de paiement : la
        // laisser ferait croire à un dossier réglé sur la console.
        tx.set(
          regRef,
          {
            status: 'pending_payment',
            paidAt: null,
            payment: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (outcome.kind === 'companion_paid') {
        // Le billet porte le nom de son titulaire : c'est celui qui sera
        // contrôlé à l'entrée, donc celui qui doit figurer sur le badge.
        const reg = regSnap?.data() as ManiaCupRegistration | undefined;
        const current = readCompanions(reg);
        const next = assignCompanionTicket(
          current,
          { itemId: item.itemId, participantName: item.participantName },
          MAX_COMPANIONS
        );
        if (next) {
          tx.set(
            regRef,
            {
              companions: next.map((c) =>
                c.ticketItemId === item.itemId
                  ? { ...c, ticketPaidAt: FieldValue.serverTimestamp() }
                  : c
              ),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      if (outcome.kind === 'pc_rental') {
        tx.set(
          regRef,
          {
            pcRental: {
              itemId: item.itemId,
              amountCents: item.amountCents,
              at: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    return true;
  });
}

/**
 * Prévient le joueur que son règlement est arrivé.
 *
 * La notification interne est garantie ; le message privé Discord est un bonus
 * qui ne doit jamais faire échouer le traitement d'un paiement — le joueur a
 * déjà reçu son billet par e-mail de HelloAsso.
 */
async function notifyPlayerPaid(db: Firestore, uid: string, item: OrderItemView): Promise<void> {
  const label = item.ticket ? (TICKET_LABELS[item.ticket] ?? item.tierLabel) : item.tierLabel;

  await createNotification(db, {
    userId: uid,
    type: 'mania_cup_payment_received',
    title: 'Ta place est confirmée',
    message: `Règlement reçu (${label}, ${(item.amountCents / 100).toFixed(2)} €). Rendez-vous le 3 octobre à Marzy.`,
    link: '/mania-cup/inscription',
    metadata: { orderId: item.orderId, itemId: item.itemId },
  });

  const snap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get();
  const discordId = (snap.data() as ManiaCupRegistration | undefined)?.discordId;
  if (!discordId) return;

  // Borné à dix secondes : Discord ne doit jamais retenir la réponse au
  // webhook, sous peine de faire rejouer la notification par HelloAsso.
  await Promise.race([
    sendManiaCupDM(discordId, {
      title: 'Ta place est confirmée',
      description: [
        `Ton règlement de ${(item.amountCents / 100).toFixed(2)} € est bien arrivé.`,
        '',
        'Rendez-vous le samedi 3 octobre à Marzy. Pense à ta pièce d’identité,',
        'ton PC, ton casque et un câble ethernet.',
      ].join('\n'),
      link: 'https://aedral.com/mania-cup/inscription',
    }),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

/**
 * Prévient l'organisation qu'un règlement encaissé n'a pas pu être rattaché.
 *
 * Sans ça, l'argent arrive, la place n'est pas confirmée, et PERSONNE n'est au
 * courant : le webhook répond 200, la console range la ligne dans un onglet
 * sans compteur, et on ne découvre le problème que si le joueur se plaint —
 * dans le meilleur des cas. Le 6 août, celui qui n'a rien dit a simplement
 * repayé.
 *
 * Le message part une seule fois par ligne de commande : `applyOrderItem` ne
 * l'appelle que lorsque la décision vient de CHANGER, jamais sur un rejeu.
 */
async function notifyStaffOfOrphanPayment(
  db: Firestore,
  item: OrderItemView,
  outcome: Outcome
): Promise<void> {
  const reason = 'reason' in outcome ? outcome.reason : 'Rattachement impossible';
  const amount = (item.amountCents / 100).toFixed(2);
  const who = item.payerName || item.participantName || 'payeur inconnu';

  const admins = await db.collection('aedral_admins').get().catch(() => null);
  if (!admins || admins.empty) return;

  const title = 'Mania Cup — règlement à rattacher';
  const message = `${amount} € de ${who} (${item.tierLabel}) : ${reason}`;

  await Promise.all(
    admins.docs.map((doc) =>
      createNotification(db, {
        userId: doc.id,
        type: 'mania_cup_payment_orphan',
        title,
        message,
        link: '/admin/mania-cup',
        metadata: { orderId: item.orderId, itemId: item.itemId },
      }).catch(() => {})
    )
  );

  // Message privé en prime : l'organisation vit sur Discord, pas dans la
  // console. Borné comme le reste — Discord ne retient jamais la réponse au
  // webhook, sous peine de le faire rejouer par HelloAsso.
  const discordIds = admins.docs
    .map((doc) => discordIdFromUid(doc.id))
    .filter((id): id is string => Boolean(id));

  await Promise.race([
    Promise.all(
      discordIds.map((discordId) =>
        sendManiaCupDM(discordId, {
          title,
          description: [
            `**${amount} €** encaissés, mais la place n'a pas pu être confirmée.`,
            '',
            `Payeur : ${who}`,
            `Tarif : ${item.tierLabel}`,
            `Motif : ${reason}`,
            '',
            'À traiter dans la console — onglet Paiements.',
          ].join('\n'),
          link: 'https://aedral.com/admin/mania-cup',
        }).catch(() => undefined)
      )
    ),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}
