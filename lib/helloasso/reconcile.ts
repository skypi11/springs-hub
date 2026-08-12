import { normalizeRegistrationCode, type RegistrationStatus } from '@/lib/mania-cup';
import {
  TICKETS_NEEDING_CODE,
  type HelloAssoOrder,
  type HelloAssoOrderItem,
  type TicketKind,
} from './types';

// Lecture d'une commande HelloAsso et décision de ce qu'elle vaut.
//
// Tout est PUR : ces fonctions ne lisent ni la base, ni le réseau, ni l'heure.
// C'est ce qui permet de les éprouver sur de vraies commandes capturées, y
// compris les cas qu'on ne saura pas reproduire à la demande — un
// remboursement, un double paiement, un code recopié de travers.
//
// Règle qui gouverne tout le fichier : on ne confirme JAMAIS une place sur une
// approximation. Un doute part en relecture humaine, où il coûte une minute ;
// une confirmation à tort donne un siège à quelqu'un qui n'a pas payé, ou prive
// de son siège quelqu'un qui a payé.

/** Une ligne de commande, ramenée à ce dont dépend la décision. */
export interface OrderItemView {
  orderId: number;
  itemId: number;
  /** Catégorie déduite du tarif acheté. */
  ticket: TicketKind | null;
  /** Libellé brut, conservé pour l'affichage et le diagnostic. */
  tierLabel: string;
  /** Nature déclarée par HelloAsso : billet, don, contribution… */
  type: string;
  amountCents: number;
  state: string;
  /** Réponse brute au champ « code d'inscription », telle que saisie. */
  rawCode: string | null;
  /** Le même code remis en forme, ou null s'il est illisible. */
  code: string | null;
  participantName: string;
  payerName: string;
  payerEmail: string;
}

/** Comment reconnaître nos tarifs. Les deux clés sont acceptées : l'identifiant
 *  de tarif (stable) et le libellé (lisible, mais renommable dans le
 *  back-office — d'où la préférence pour l'identifiant). */
export interface TierMap {
  byId: Record<string, TicketKind>;
  byLabel: Record<string, TicketKind>;
}

export function parseTierMap(raw: string | undefined | null): TierMap {
  const map: TierMap = { byId: {}, byLabel: {} };
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      const kind = value as TicketKind;
      if (/^\d+$/.test(key)) map.byId[key] = kind;
      else map.byLabel[normalizeLabel(key)] = kind;
    }
  } catch {
    // Une correspondance illisible ne doit pas empêcher le webhook de tourner :
    // les items deviennent simplement « tarif inconnu » et partent en relecture.
  }
  return map;
}

/**
 * Retire les accents sans regex unicode, en écartant le bloc « Combining
 * Diacritical Marks » que produit la décomposition NFD. Écrire ces caractères
 * en clair dans le source les rend invisibles à la relecture et fragiles au
 * moindre passage par un outil qui ne parle pas UTF-8.
 */
function stripDiacritics(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFD')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out;
}

/** Compare deux libellés saisis par des humains : casse, accents et espaces
 *  multiples ne doivent pas faire échouer une correspondance de tarif. */
function normalizeLabel(label: string): string {
  return stripDiacritics(label.toLowerCase()).replace(/\s+/g, ' ').trim();
}

/** À quelle catégorie appartient cette ligne ? Null si on ne reconnaît pas. */
export function classifyTier(item: HelloAssoOrderItem, tiers: TierMap): TicketKind | null {
  const id = item.tierId ?? item.priceCategory;
  if (id != null && tiers.byId[String(id)]) return tiers.byId[String(id)];
  const label = normalizeLabel(item.name ?? item.tierDescription ?? '');
  return label ? (tiers.byLabel[label] ?? null) : null;
}

/**
 * Retrouve le code d'inscription dans les champs personnalisés.
 *
 * On cherche d'abord le libellé exact configuré, puis on retombe sur tout champ
 * dont le nom parle de code d'inscription : la personne qui crée la billetterie
 * n'écrira pas forcément le libellé au caractère près, et un rattachement raté
 * pour une majuscule serait absurde.
 */
export function extractCode(item: HelloAssoOrderItem, fieldLabel: string): string | null {
  const fields = item.customFields ?? [];
  const wanted = normalizeLabel(fieldLabel);

  const exact = fields.find((f) => normalizeLabel(f.name ?? '') === wanted);
  if (exact?.answer) return exact.answer;

  const loose = fields.find((f) => /code/.test(normalizeLabel(f.name ?? '')));
  return loose?.answer ?? null;
}

export interface ParseOptions {
  tiers: TierMap;
  /** Libellé du champ personnalisé qui porte le code d'inscription. */
  codeFieldLabel: string;
}

/** Met une commande à plat, ligne par ligne. */
export function parseOrder(order: HelloAssoOrder, opts: ParseOptions): OrderItemView[] {
  const orderId = Number(order.id ?? 0);
  const payer = order.payer ?? {};
  const payerName = [payer.firstName, payer.lastName].filter(Boolean).join(' ').trim();

  return (order.items ?? []).map((item) => {
    const rawCode = extractCode(item, opts.codeFieldLabel);
    return {
      orderId,
      itemId: Number(item.id ?? 0),
      ticket: classifyTier(item, opts.tiers),
      tierLabel: item.name ?? item.tierDescription ?? '',
      type: item.type ?? '',
      amountCents: Number(item.amount ?? 0),
      state: String(item.state ?? 'Unknown'),
      rawCode,
      code: normalizeRegistrationCode(rawCode),
      participantName: [item.user?.firstName, item.user?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim(),
      payerName,
      payerEmail: payer.email ?? '',
    };
  });
}

/**
 * Une ligne vaut-elle place occupée ?
 *
 * `Registered` compte au même titre que `Processed` : c'est une inscription
 * enregistrée à la main par l'organisation, sans paiement en ligne. `Waiting`
 * ne vaut rien encore — le paiement est en cours d'autorisation, une seconde
 * notification suivra.
 */
export function isItemValid(state: string): boolean {
  return state === 'Processed' || state === 'Registered';
}

/** Une ligne annulée ou remboursée, qui doit défaire ce qu'elle avait produit. */
export function isItemVoided(state: string): boolean {
  return state === 'Canceled' || state === 'Refused';
}

/**
 * Cette ligne est-elle un don plutôt qu'un billet ?
 *
 * La billetterie propose d'ajouter un don à l'association au moment de payer,
 * et HelloAsso ajoute sa propre contribution volontaire. Ni l'un ni l'autre
 * n'ouvre de droit : sans cette distinction, chaque personne généreuse
 * produirait un « tarif non reconnu » à traiter à la main.
 *
 * On regarde le type déclaré par HelloAsso en premier — c'est la donnée fiable —
 * et le libellé en secours, pour les formulaires qui n'en portent pas.
 */
export function isDonationLike(item: Pick<OrderItemView, 'type' | 'tierLabel'>): boolean {
  const type = (item.type ?? '').toLowerCase();
  if (type === 'donation' || type === 'contribution') return true;
  const label = normalizeLabel(item.tierLabel);
  return /^(don|contribution|soutien)\b/.test(label);
}

/**
 * À quel accompagnant rattacher un billet qui vient d'être réglé.
 *
 * Deux listes se rejoignent ici : ce que le joueur a déclaré sur le site, et
 * qui a réellement payé sur HelloAsso. Elles ne concordent pas toujours — un
 * joueur annonce « mon père », le billet est au nom de « Jean Martin ».
 *
 * Règle : **le nom du billet fait foi**, parce que c'est celui qu'on
 * contrôlera à l'entrée et qui figurera sur le badge. La déclaration sert à
 * savoir combien de personnes viennent, pas à nommer qui entre.
 *
 * Renvoie la liste modifiée, ou null s'il n'y a rien à changer — ce qui rend
 * l'opération sûre au rejeu.
 */
export function assignCompanionTicket(
  companions: readonly CompanionSlot[],
  ticket: { itemId: number; participantName: string },
  max: number
): CompanionSlot[] | null {
  // Déjà rattaché : HelloAsso rejoue ses notifications, on ne double pas.
  if (companions.some((c) => c.ticketItemId === ticket.itemId)) return null;

  const wanted = normalizeLabel(ticket.participantName);

  // 1. Le nom du billet correspond à une déclaration non encore réglée.
  const byName = companions.findIndex(
    (c) => c.ticketItemId == null && wanted && normalizeLabel(c.name) === wanted
  );
  if (byName !== -1) {
    return companions.map((c, i) =>
      i === byName ? { ...c, ticketItemId: ticket.itemId } : c
    );
  }

  // 2. Une déclaration attend son billet : on la sert, en adoptant le nom du
  //    porteur — c'est lui qui se présentera à l'accueil.
  const firstFree = companions.findIndex((c) => c.ticketItemId == null);
  if (firstFree !== -1) {
    return companions.map((c, i) =>
      i === firstFree
        ? { ...c, name: ticket.participantName || c.name, ticketItemId: ticket.itemId }
        : c
    );
  }

  // 3. Personne n'attendait ce billet : quelqu'un a payé sans être déclaré.
  //    On l'ajoute, tant que le joueur n'a pas dépassé son quota.
  if (companions.length >= max) return null;
  return [
    ...companions,
    { name: ticket.participantName || 'Accompagnant', role: 'Accompagnant', ticketItemId: ticket.itemId },
  ];
}

/**
 * Détache le billet d'un accompagnant, quand HelloAsso l'a annulé ou remboursé.
 *
 * L'accompagnant reste déclaré — le joueur vient toujours avec quelqu'un, il
 * n'a simplement plus de billet réglé. Le supprimer effacerait une déclaration
 * que le joueur avait faite, et qu'il n'aurait aucun moyen de retrouver.
 *
 * Renvoie null s'il n'y avait rien à détacher : l'opération reste sûre au rejeu.
 */
export function unassignCompanionTicket(
  companions: readonly CompanionSlot[],
  itemId: number
): CompanionSlot[] | null {
  if (!companions.some((c) => c.ticketItemId === itemId)) return null;
  return companions.map((c) =>
    c.ticketItemId === itemId ? { ...c, ticketItemId: null, ticketPaidAt: null } : c
  );
}

/** Ce dont la règle d'attribution a besoin, et rien de plus. */
export interface CompanionSlot {
  name: string;
  role: string;
  ticketItemId?: number | null;
  declaredAt?: unknown;
  ticketPaidAt?: unknown;
}

/** L'inscription telle que la base la connaît, au moment de décider. */
export interface RegistrationSnapshot {
  uid: string;
  status: RegistrationStatus;
  /** Identifiant de la ligne qui a déjà réglé cette inscription, s'il y en a. */
  paidByItemId?: number | null;
  /** Ligne qui a réglé la location de poste, s'il y en a une. */
  pcRentalItemId?: number | null;
  /** Lignes qui ont réglé les billets accompagnants. */
  companionItemIds?: readonly number[];
}

export type Outcome =
  /** Rien à faire : billet spectateur, ligne en attente, tarif hors périmètre. */
  | { kind: 'ignore'; reason: string }
  /** Le règlement d'un joueur : la place est acquise. */
  | { kind: 'confirm_player'; uid: string }
  /** Le billet accompagnant du joueur identifié par le code. */
  | { kind: 'companion_paid'; uid: string }
  /** Une location de poste, qui ne vaut jamais règlement de l'inscription. */
  | { kind: 'pc_rental'; uid: string }
  /** Un billet spectateur : compté en caisse, sans effet sur un dossier. */
  | { kind: 'spectator' }
  /** Le code est absent ou inconnu : à rattacher à la main. */
  | { kind: 'unmatched'; reason: string }
  /** Quelque chose ne colle pas : décision humaine. */
  | { kind: 'needs_review'; reason: string }
  /**
   * Ligne annulée ou remboursée : défaire ce qu'elle avait produit.
   *
   * `what` dit quoi défaire. Sans lui, seule la place du joueur était rendue :
   * une location ou un billet accompagnant remboursé restait inscrit au dossier,
   * et le jour J l'organisation sortait une machine pour personne.
   */
  | { kind: 'revoke'; uid: string; reason: string; what: 'player' | 'pc_rental' | 'companion' };

export interface DecideContext {
  /** Le dossier désigné par le code, si le code a pu être résolu. */
  registration: RegistrationSnapshot | null;
  /** Montant attendu pour ce tarif, en centimes. Null = pas de contrôle. */
  expectedAmountCents: number | null;
}

/**
 * Que faire de cette ligne de commande ?
 *
 * La fonction ne décide jamais « au mieux » : chaque situation ambiguë a sa
 * sortie explicite, pour que la console puisse dire à l'organisation ce qui
 * bloque plutôt que de laisser un paiement disparaître sans trace.
 */
export function decideItem(item: OrderItemView, ctx: DecideContext): Outcome {
  // Les lignes annulées ou remboursées défont ce qu'elles avaient produit —
  // mais seulement si elles avaient bien produit quelque chose.
  if (isItemVoided(item.state)) {
    const reason =
      item.state === 'Refused' ? 'Paiement refusé' : 'Commande annulée ou remboursée';
    const reg = ctx.registration;
    if (reg) {
      // On ne défait que ce que CETTE ligne avait produit : le rapprochement se
      // fait sur son identifiant, jamais sur son type seul. Un joueur qui a
      // re-payé garde sa place, et son ancien règlement remboursé ne la reprend
      // pas au passage.
      if (item.ticket === 'player' && reg.paidByItemId === item.itemId) {
        return { kind: 'revoke', uid: reg.uid, reason, what: 'player' };
      }
      if (item.ticket === 'pc_rental' && reg.pcRentalItemId === item.itemId) {
        return { kind: 'revoke', uid: reg.uid, reason, what: 'pc_rental' };
      }
      if (item.ticket === 'companion' && (reg.companionItemIds ?? []).includes(item.itemId)) {
        return { kind: 'revoke', uid: reg.uid, reason, what: 'companion' };
      }
    }
    return { kind: 'ignore', reason: `Ligne ${item.state.toLowerCase()}` };
  }

  if (!isItemValid(item.state)) {
    return { kind: 'ignore', reason: 'Paiement en cours d’autorisation' };
  }

  // Un don à l'association, ou la contribution volontaire au fonctionnement de
  // HelloAsso : ce sont des lignes de commande comme les autres, mais elles
  // n'ouvrent aucun droit et n'ont rien à faire dans la file de rattachement.
  // La billetterie propose le don à côté des billets — sans cette porte, chaque
  // personne généreuse produirait un « tarif non reconnu » à traiter à la main.
  if (isDonationLike(item)) {
    return { kind: 'ignore', reason: 'Don ou contribution, sans effet sur une inscription' };
  }

  if (!item.ticket) {
    // Le tarif n'est pas dans la correspondance : soit la billetterie a un
    // tarif qu'on ne connaît pas, soit un libellé a été modifié. Dans les deux
    // cas c'est l'organisation qui tranche — surtout pas nous, en silence.
    return { kind: 'needs_review', reason: `Tarif non reconnu : « ${item.tierLabel} »` };
  }

  if (item.ticket === 'spectator') {
    return { kind: 'spectator' };
  }

  if (TICKETS_NEEDING_CODE.includes(item.ticket) && !item.code) {
    return {
      kind: 'unmatched',
      reason: item.rawCode
        ? `Code illisible : « ${item.rawCode} »`
        : 'Aucun code d’inscription saisi',
    };
  }

  if (!ctx.registration) {
    return {
      kind: 'unmatched',
      reason: `Code ${item.code} inconnu — aucune inscription ne le porte`,
    };
  }

  const { registration } = ctx;

  if (item.ticket === 'companion') {
    return registration.status === 'cancelled'
      ? { kind: 'needs_review', reason: 'Billet accompagnant d’une inscription retirée' }
      : { kind: 'companion_paid', uid: registration.uid };
  }

  if (item.ticket === 'pc_rental') {
    return registration.status === 'cancelled'
      ? { kind: 'needs_review', reason: 'Location de poste d’une inscription retirée' }
      : { kind: 'pc_rental', uid: registration.uid };
  }

  // À partir d'ici : le règlement d'une inscription joueur.

  if (registration.status === 'cancelled') {
    // L'argent est encaissé mais la place a été rendue. Réactiver d'office
    // rendrait une place que la liste d'attente a peut-être déjà reprise :
    // c'est un remboursement ou une réinscription, donc une décision humaine.
    return { kind: 'needs_review', reason: 'Règlement reçu pour une inscription retirée' };
  }

  if (ctx.expectedAmountCents != null && item.amountCents !== ctx.expectedAmountCents) {
    return {
      kind: 'needs_review',
      reason: `Montant inattendu : ${(item.amountCents / 100).toFixed(2)} € au lieu de ${(
        ctx.expectedAmountCents / 100
      ).toFixed(2)} €`,
    };
  }

  if (registration.status === 'confirmed' && registration.paidByItemId !== item.itemId) {
    // Deux règlements pour un même dossier : le joueur a payé deux fois, ou
    // deux personnes ont payé pour lui. Il y a un remboursement à faire.
    return { kind: 'needs_review', reason: 'Cette inscription est déjà réglée — doublon probable' };
  }

  return { kind: 'confirm_player', uid: registration.uid };
}

/**
 * Quelle catégorie de billet appliquer lors d'un rattachement MANUEL.
 *
 * Le rattachement manuel est l'outil de secours : on s'en sert précisément
 * quand la reconnaissance automatique a échoué. Le faire dépendre de
 * `payment.ticket` le rendait donc inopérant au moment où il sert — c'est ce
 * qui s'est produit à l'ouverture des inscriptions. La correspondance des
 * tarifs était vide, `ticket` valait null, aucune branche ne s'exécutait,
 * l'inscription n'était jamais confirmée, et la console répondait « ok ».
 * Un joueur a fini par payer deux fois.
 *
 * Deux règles en découlent :
 *   - l'organisation peut TRANCHER elle-même la catégorie (`requested`), sans
 *     dépendre d'un réglage ;
 *   - quand personne ne peut trancher, on refuse EXPLICITEMENT, avec la marche
 *     à suivre. Jamais de succès silencieux.
 */
export function resolveManualTicket(
  payment: { ticket: TicketKind | null; tierLabel?: string | null },
  requested?: string | null
): { ok: true; ticket: TicketKind } | { ok: false; reason: string } {
  if (requested != null && requested !== '') {
    if (!(TICKETS_NEEDING_CODE as readonly string[]).includes(requested)) {
      return {
        ok: false,
        reason: `Catégorie « ${requested} » impossible à rattacher à une inscription.`,
      };
    }
    return { ok: true, ticket: requested as TicketKind };
  }

  if (payment.ticket && (TICKETS_NEEDING_CODE as readonly string[]).includes(payment.ticket)) {
    return { ok: true, ticket: payment.ticket };
  }

  if (payment.ticket === 'spectator') {
    return { ok: false, reason: 'Un billet spectateur ne se rattache à aucune inscription.' };
  }

  const tier = payment.tierLabel ? ` « ${payment.tierLabel} »` : '';
  return {
    ok: false,
    reason:
      `Le tarif${tier} n’est associé à aucune catégorie de billet, ` +
      `le rattachement ne saurait pas quoi confirmer. Renseigne la correspondance ` +
      `des tarifs dans Configuration, puis relis les commandes — ou choisis la ` +
      `catégorie à la main.`,
  };
}

/** Vue minimale d'un dossier, pour juger si une décision y est déjà inscrite. */
export interface AppliedView {
  status?: RegistrationStatus;
  paidByItemId?: number | null;
  companionItemIds?: readonly (number | null | undefined)[];
  pcRentalItemId?: number | null;
}

/**
 * L'effet de cette décision est-il DÉJÀ inscrit sur le dossier ?
 *
 * Sert à faire porter l'idempotence sur l'EFFET plutôt que sur le journal des
 * paiements. La différence n'est pas théorique : un dossier peut dériver après
 * coup — un « Marquer payé » cliqué par mégarde dans la console suffit. Tant que
 * l'idempotence se jugeait au seul journal, « Relire les commandes » ne
 * réécrivait rien et répondait « tout était déjà à jour », laissant le joueur en
 * attente de paiement alors que ses 30 € étaient encaissés. Le bouton de
 * réparation ne doit pas être le deuxième à mentir.
 *
 * Toutes les écritures concernées sont des `merge` idempotents : réappliquer ne
 * coûte rien, ne rien appliquer coûte une place.
 */
export function isOutcomeAlreadyApplied(
  outcome: Outcome,
  itemId: number,
  reg: AppliedView | undefined
): boolean {
  if (!reg) return false;
  switch (outcome.kind) {
    case 'confirm_player':
      return reg.status === 'confirmed' && reg.paidByItemId === itemId;
    case 'revoke':
      // Chaque type se juge à sa propre trace : un dossier peut avoir perdu sa
      // location sans perdre sa place, et inversement.
      if (outcome.what === 'pc_rental') return reg.pcRentalItemId !== itemId;
      if (outcome.what === 'companion') return !(reg.companionItemIds ?? []).includes(itemId);
      return reg.status !== 'confirmed';
    case 'companion_paid':
      return (reg.companionItemIds ?? []).includes(itemId);
    case 'pc_rental':
      return reg.pcRentalItemId === itemId;
    default:
      // Les issues sans effet métier (ignore, spectator, unmatched, needs_review)
      // n'ont rien à vérifier sur le dossier.
      return true;
  }
}

/**
 * Une relecture doit-elle s'effacer devant une décision prise à la main ?
 *
 * Le rattachement manuel sert quand la reconnaissance automatique échoue — et
 * sa cause persiste souvent : un code recopié de travers chez HelloAsso le
 * restera. À chaque relecture, `decideItem` reproduit donc le même « je ne sais
 * pas », ce qui effaçait le `matchedUid` posé par l'organisation. Le dossier
 * restait confirmé, mais le journal perdait le lien — et depuis qu'un règlement
 * orphelin alerte, cela réveillait l'organisation pour un cas qu'elle avait
 * déjà tranché.
 *
 * La règle : une décision humaine explicite prime sur une incertitude
 * automatique, jamais sur un fait nouveau. Un remboursement ou une annulation
 * chez HelloAsso reste prioritaire — l'argent est reparti, aucune décision
 * d'organisation ne change cela.
 */
export function manualDecisionWins(
  prev: { source?: string; matchedUid?: string | null } | undefined,
  next: Outcome
): boolean {
  if (!prev || prev.source !== 'manual' || !prev.matchedUid) return false;
  return next.kind === 'unmatched' || next.kind === 'needs_review';
}
