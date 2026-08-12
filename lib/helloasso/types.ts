// Ce qu'on lit d'une commande HelloAsso — et rien de plus.
//
// Les types ne décrivent pas l'API entière : ils décrivent la portion dont
// dépend le rattachement d'un règlement à une inscription. Tout y est optionnel
// et retypé à la lecture, parce que ces objets viennent du réseau : un champ
// renommé ou absent doit produire un item ignoré et une alerte, jamais une
// exception qui ferait échouer la notification et déclencherait des rejeux.

/** Types de notification émis par HelloAsso. */
export type HelloAssoEventType = 'Order' | 'Payment' | 'Form' | 'Organization';

/**
 * État d'une ligne de commande, d'après l'énumération publiée par HelloAsso.
 *
 * `Registered` mérite une mention : c'est une inscription saisie à la main
 * depuis le back-office de l'association, sans paiement en ligne. Elle vaut
 * place occupée. L'oublier ferait vendre deux fois le même siège.
 *
 * Cette liste ne PROTÈGE de rien : `HelloAssoOrderItem.state` reste une chaîne
 * venue du réseau, et HelloAsso peut en ajouter sans nous prévenir. C'est
 * pourquoi le classement se fait par listes explicites dans `reconcile.ts`, et
 * qu'un état hors de toutes ces listes part en décision humaine plutôt que de
 * disparaître en silence.
 */
export type HelloAssoItemState =
  | 'Processed'
  | 'Registered'
  | 'Unknown'
  | 'Canceled'
  | 'Refused'
  | 'Waiting'
  | 'Deleted'
  | 'Abandoned';

/**
 * État d'un PAIEMENT — à ne pas confondre avec l'état d'une ligne.
 *
 * La distinction n'est pas théorique : elle décide d'une place. L'API de
 * remboursement de HelloAsso porte un paramètre `cancelOrder` qui vaut FALSE
 * par défaut (« Whether the future payments and linked items of this order must
 * be canceled »). Un remboursement fait sans cocher cette option laisse donc la
 * ligne à `Processed` — seul le PAIEMENT passe à `Refunded`. Ne lire que l'état
 * des lignes, c'est laisser une place occupée par de l'argent reparti.
 */
export type HelloAssoPaymentState =
  | 'Pending'
  | 'Authorized'
  | 'Refused'
  | 'Registered'
  | 'Refunded'
  | 'Refunding'
  | 'Contested'
  | 'Canceled'
  | 'Waiting'
  | 'WaitingBankValidation'
  | 'Unknown';

export interface HelloAssoCustomField {
  id?: number;
  name?: string;
  type?: string;
  answer?: string;
}

export interface HelloAssoUser {
  firstName?: string;
  lastName?: string;
}

export interface HelloAssoPayer extends HelloAssoUser {
  email?: string;
}

export interface HelloAssoOrderItem {
  id?: number;
  /** En CENTIMES. 30 € vaut 3000. */
  amount?: number;
  /** Libellé du tarif tel qu'il apparaît sur la billetterie. */
  name?: string;
  type?: string;
  state?: string;
  /** Identifiant stable du tarif — préférable au libellé, qui est renommable. */
  priceCategory?: string;
  tierId?: number;
  tierDescription?: string;
  user?: HelloAssoUser;
  customFields?: HelloAssoCustomField[];
}

/**
 * La ventilation d'un paiement sur une ligne de commande.
 *
 * `id` est l'identifiant de la LIGNE (« Id of the order item »). C'est lui qui
 * permet de ne pas condamner tout un panier : un joueur qui règle sa place et
 * loue un poste dans la même commande, puis se fait rembourser la location
 * seule, ne doit pas perdre sa place au passage.
 */
export interface HelloAssoShareItem {
  id?: number;
  /** En CENTIMES, part de ce paiement affectée à cette ligne. */
  shareAmount?: number;
}

/** Un règlement de la commande — plusieurs si le payeur a échelonné. */
export interface HelloAssoOrderPayment {
  id?: number;
  /** En CENTIMES. */
  amount?: number;
  /** Voir `HelloAssoPaymentState` : c'est ici que se lit un remboursement. */
  state?: string;
  /** Ce que ce paiement couvre, ligne par ligne. Absent sur les formes anciennes. */
  items?: HelloAssoShareItem[];
  refundOperations?: { status?: string; amount?: number }[];
}

export interface HelloAssoOrder {
  id?: number;
  date?: string;
  formSlug?: string;
  formType?: string;
  organizationSlug?: string;
  payer?: HelloAssoPayer;
  items?: HelloAssoOrderItem[];
  /** Tous les règlements de la commande — renvoyés par GET /v5/orders/{id}. */
  payments?: HelloAssoOrderPayment[];
}

/** Corps d'une notification. La forme de `data` dépend de `eventType`. */
export interface HelloAssoNotification {
  eventType?: string;
  data?: Record<string, unknown>;
}

/** Les catégories de billets de la Springs Mania Cup. */
export const TICKET_KINDS = [
  'player',
  'companion',
  'spectator',
  'pc_rental',
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_LABELS: Record<TicketKind, string> = {
  player: 'Joueur',
  companion: 'Accompagnant',
  spectator: 'Spectateur',
  pc_rental: 'Location PC',
};

/** Les billets qui exigent un code d'inscription pour être exploitables. */
export const TICKETS_NEEDING_CODE: readonly TicketKind[] = ['player', 'companion', 'pc_rental'];
