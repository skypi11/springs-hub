import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createNotification } from '@/lib/notifications';
import { alerterPlacePrise, donnerRoleInscrit, retirerRoleInscrit } from '@/lib/mania-cup-alerts';
import { getManiaCupSettings } from '@/lib/mania-cup-settings';
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
  isItemVoided,
  isOutcomeAlreadyApplied,
  manualDecisionWins,
  unassignCompanionTicket,
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
  /** Motif en clair quand l'argent de cette ligne est reparti, sinon null. */
  moneyBack?: string | null;
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
  let uid = item.code ? await findUidByRegistrationCode(db, item.code) : null;

  // Une ligne dont l'argent est reparti doit pouvoir défaire ce qu'un
  // rattachement MANUEL avait produit. Or le code ne résout rien dans ce cas —
  // c'est justement parce qu'il était illisible que l'organisation avait tranché
  // à la main. Sans ce repli, rembourser un règlement rattaché à la main ne
  // rendait pas la place ET effaçait le seul lien qui reliait les deux.
  if (!uid && (isItemVoided(item.state) || item.moneyBack)) {
    const prev = (
      await db.collection(MANIA_CUP_PAYMENTS).doc(String(item.itemId)).get()
    ).data() as PaymentRecord | undefined;
    if (prev?.source === 'manual' && prev.matchedUid) uid = prev.matchedUid;
  }

  let snapshot: RegistrationSnapshot | null = null;
  if (uid) {
    const regSnap = await db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get();
    if (regSnap.exists) {
      const reg = regSnap.data() as ManiaCupRegistration;
      snapshot = {
        uid,
        status: reg.status,
        paidByItemId: reg.payment?.itemId ?? null,
        // Ce qui a RÉELLEMENT été encaissé pour cette place. Comparer au tarif
        // du jour déclassait toute la caisse dès que le prix bougeait.
        paidAmountCents: reg.payment?.amountCents ?? null,
        // Une ligne annulée doit pouvoir défaire la location ou le billet
        // accompagnant qu'elle avait produits : sans ces deux traces, la
        // décision ne voyait que la place du joueur.
        pcRentalItemId: reg.pcRental?.itemId ?? null,
        companionItemIds: readCompanions(reg)
          .map((c) => c.ticketItemId)
          .filter((id): id is number => id != null),
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
    // L'ORGANISATION apprend qu'une place vient de partir, et le joueur reçoit
    // son rôle sur le Discord de Springs. Ni l'un ni l'autre ne doit faire
    // échouer le traitement du paiement : l'argent est encaissé, c'est ce qui
    // compte, le reste se rattrape depuis la console.
    await alerterPlacePriseDepuisPaiement(db, outcome.uid).catch(() => {});
    await donnerRoleInscrit(db, outcome.uid).catch(() => {});
  }

  // Un règlement encaissé qu'on ne sait pas rattacher ne doit jamais rester
  // silencieux : c'est de l'argent reçu contre une place non confirmée.
  if (changed && (outcome.kind === 'unmatched' || outcome.kind === 'needs_review')) {
    await notifyStaffOfOrphanPayment(db, item, outcome).catch(() => {});
  }

  // Défaire est aussi lourd de conséquences que confirmer, et c'était pourtant
  // muet : le joueur perdait sa place sans un mot, l'organisation n'apprenait
  // pas qu'un siège repartait à la vente, et le rôle « inscrit » restait sur le
  // Discord de Springs. Or « annulé » chez HelloAsso ne prouve même pas que
  // l'argent est reparti — un remboursement peut avoir échoué.
  if (changed && outcome.kind === 'revoke') {
    await notifyRevoked(db, outcome, item).catch(() => {});
    // Le rôle suit la PLACE : une location ou un billet accompagnant défait ne
    // change rien à la présence du joueur.
    if (outcome.what === 'player') {
      await retirerRoleInscrit(db, outcome.uid).catch(() => {});
    }
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
    // Une relecture ne défait pas ce qu'un humain a tranché : la cause d'un
    // rattachement manuel (un code recopié de travers chez HelloAsso) persiste,
    // donc chaque passage reproduirait le même « je ne sais pas » et effacerait
    // la décision — en réveillant l'organisation au passage.
    if (manualDecisionWins(prev, outcome)) return false;

    const reg = regSnap?.data() as ManiaCupRegistration | undefined;
    const isReplay =
      prev != null &&
      prev.state === item.state &&
      // L'état de l'ARGENT compte autant que celui de la ligne : un
      // remboursement sans annulation de commande laisse `state` à 'Processed',
      // et sans cette comparaison il passerait pour un rejeu à l'identique —
      // rien ne s'écrirait, personne ne serait prévenu.
      (prev.moneyBack ?? null) === (item.moneyBack ?? null) &&
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
      moneyBack: item.moneyBack ?? null,
      rawCode: item.rawCode,
      code: item.code,
      participantName: item.participantName,
      payerName: item.payerName,
      payerEmail: item.payerEmail,
      // Ne jamais effacer un lien posé à la main parce que la nouvelle issue
      // n'en porte pas : c'est la seule trace qui relie ce règlement à un
      // dossier quand le code est illisible chez HelloAsso.
      matchedUid:
        'uid' in outcome
          ? outcome.uid
          : prev?.source === 'manual'
            ? (prev.matchedUid ?? null)
            : null,
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

      // Défense en profondeur : la décision a pu être prise avant que
      // l'organisation ne retire l'inscription. Remettre alors le dossier « en
      // attente de paiement » le ferait réapparaître dans la liste publique des
      // inscrits, et proposerait au joueur de repayer une place qu'on vient de
      // lui reprendre.
      if (outcome.kind === 'revoke' && outcome.what === 'player' && reg?.status !== 'cancelled') {
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

      if (outcome.kind === 'revoke' && outcome.what === 'pc_rental') {
        // Le matériel repart au stock. Les postes à louer sont peu nombreux :
        // en garder un réservé pour un règlement reparti, c'est le refuser à
        // quelqu'un d'autre.
        tx.set(
          regRef,
          { pcRental: null, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      if (outcome.kind === 'revoke' && outcome.what === 'companion') {
        // L'accompagnant reste déclaré, mais son billet n'est plus réglé : sans
        // ça, un badge s'imprimait le jour J pour un billet remboursé.
        const next = unassignCompanionTicket(readCompanions(reg), item.itemId);
        if (next) {
          tx.set(
            regRef,
            { companions: next, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
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
        } else {
          // Plus aucune place libre : le billet est payé mais ne s'attache à
          // personne. Le journaliser « companion_paid » l'affichait en vert
          // dans la console, alors qu'il appelle une décision — un billet de
          // trop, ou un accompagnant à retirer.
          tx.set(
            paymentRef,
            {
              outcome: 'needs_review',
              reason: `Billet accompagnant en trop : ce joueur en a déjà ${MAX_COMPANIONS} réglés`,
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
              // La commande, pour retrouver le règlement sans fouiller la
              // caisse : celle de la location n'est pas celle de l'inscription
              // quand le joueur revient payer plus tard.
              orderId: item.orderId,
              amountCents: item.amountCents,
              // L'intitulé de l'article, tel qu'il figure dans la boutique :
              // c'est lui qui dit quel matériel préparer.
              label: item.tierLabel,
              source: 'helloasso',
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
/**
 * Un règlement vient d'être défait : le joueur et l'organisation l'apprennent.
 *
 * Deux destinataires, deux raisons. Le joueur, parce qu'il croirait sa place
 * acquise jusqu'au 3 octobre — et parce qu'un paiement peut avoir été refusé
 * sans qu'il le sache. L'organisation, parce qu'elle est la seule à pouvoir
 * vérifier chez HelloAsso si l'argent est vraiment reparti (un remboursement
 * échoué laisse la ligne annulée alors que la somme est toujours là), et parce
 * qu'un siège vient de se libérer sur 64 : c'est elle qui appelle la liste
 * d'attente.
 */
async function notifyRevoked(
  db: Firestore,
  outcome: Extract<Outcome, { kind: 'revoke' }>,
  item: OrderItemView
): Promise<void> {
  const amount = (item.amountCents / 100).toFixed(2);
  const quoi =
    outcome.what === 'player'
      ? 'sa place'
      : outcome.what === 'pc_rental'
        ? 'sa location de poste'
        : 'un billet accompagnant';

  await createNotification(db, {
    userId: outcome.uid,
    type: 'mania_cup_payment_revoked',
    title:
      outcome.what === 'player'
        ? 'Ta place n’est plus confirmée'
        : 'Un règlement de ton dossier a été défait',
    message:
      `Ton règlement de ${amount} € (${item.tierLabel}) n’est plus valide chez HelloAsso : ` +
      `${outcome.reason.toLowerCase()}. ${
        outcome.what === 'player'
          ? 'Ta place repart à la vente.'
          : 'Ce que tu avais réservé a été retiré.'
      } Si c’est une erreur, contacte l’organisation.`,
    link: '/mania-cup/inscription',
    metadata: { orderId: item.orderId, itemId: item.itemId },
  }).catch(() => {});

  const admins = await db.collection('aedral_admins').get().catch(() => null);
  if (!admins || admins.empty) return;

  const qui = item.participantName || item.payerName || 'inscrit inconnu';
  const title = 'Mania Cup — règlement défait';
  const message = `${qui} perd ${quoi} : ${outcome.reason} (${amount} €)`;

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

  const discordIds = admins.docs
    .map((doc) => discordIdFromUid(doc.id))
    .filter((id): id is string => Boolean(id));

  await Promise.race([
    Promise.all(
      discordIds.map((discordId) =>
        sendManiaCupDM(discordId, {
          title,
          description: [
            `**${qui}** perd ${quoi}.`,
            '',
            `Motif : ${outcome.reason}`,
            `Montant : ${amount} € · commande ${item.orderId}`,
            '',
            '« Annulé » chez HelloAsso ne prouve pas que l’argent est reparti :',
            'vérifie la commande avant de rappeler quelqu’un de la liste d’attente.',
          ].join('\n'),
          link: 'https://aedral.com/admin/mania-cup',
        }).catch(() => undefined)
      )
    ),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

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


/** Qui vient de régler, et où en est la jauge — pour le message au staff. */
async function alerterPlacePriseDepuisPaiement(db: Firestore, uid: string): Promise<void> {
  const [snap, reglees, settings] = await Promise.all([
    db.collection(MANIA_CUP_REGISTRATIONS).doc(uid).get(),
    db.collection(MANIA_CUP_REGISTRATIONS).where('status', '==', 'confirmed').count().get(),
    getManiaCupSettings(db),
  ]);
  const reg = snap.data() as ManiaCupRegistration | undefined;
  await alerterPlacePrise(db, {
    qui: reg?.tmDisplayName || `${reg?.firstName ?? ''} ${reg?.lastName ?? ''}`.trim() || uid,
    placesReglees: reglees.data().count,
    placesTotales: settings.maxPlayers,
  });
}
