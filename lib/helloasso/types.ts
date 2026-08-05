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
 * État d'une ligne de commande.
 *
 * `Registered` mérite une mention : c'est une inscription saisie à la main
 * depuis le back-office de l'association, sans paiement en ligne. Elle vaut
 * place occupée. L'oublier ferait vendre deux fois le même siège.
 */
export type HelloAssoItemState =
  | 'Processed'
  | 'Registered'
  | 'Unknown'
  | 'Canceled'
  | 'Refused'
  | 'Waiting';

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

export interface HelloAssoOrder {
  id?: number;
  date?: string;
  formSlug?: string;
  formType?: string;
  organizationSlug?: string;
  payer?: HelloAssoPayer;
  items?: HelloAssoOrderItem[];
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
