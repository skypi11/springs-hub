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
  /** Ligne annulée ou remboursée : défaire la confirmation. */
  | { kind: 'revoke'; uid: string; reason: string };

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
    if (item.ticket === 'player' && ctx.registration?.paidByItemId === item.itemId) {
      return {
        kind: 'revoke',
        uid: ctx.registration.uid,
        reason: item.state === 'Refused' ? 'Paiement refusé' : 'Commande annulée ou remboursée',
      };
    }
    return { kind: 'ignore', reason: `Ligne ${item.state.toLowerCase()}` };
  }

  if (!isItemValid(item.state)) {
    return { kind: 'ignore', reason: 'Paiement en cours d’autorisation' };
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
