/**
 * Liste d'attente de la Springs Mania Cup.
 *
 * CE QUE ÇA RÈGLE. Jusqu'ici, un joueur arrivé après les 64 places réglées
 * était renvoyé vers le Discord avec un « contacte l'organisation ». Rien ne
 * retenait qui avait demandé, ni dans quel ordre, et une place libérée ne
 * prévenait personne : la liste d'attente, c'était la mémoire de
 * l'organisateur.
 *
 * LE PIÈGE À NE PAS REPRODUIRE. Une place se prend en PAYANT. Si l'organisation
 * dit « vas-y, inscris-toi » à deux personnes pour une seule place libérée,
 * toutes deux paient et l'une doit être remboursée — exactement le scénario qui
 * a déjà coûté un double paiement sur cet événement.
 *
 * D'où l'invitation qui RÉSERVE. Inviter quelqu'un immobilise la place le temps
 * qu'il règle : elle est comptée comme prise. Si le délai passe sans règlement,
 * elle retourne au pot et le suivant peut être invité. Le nombre de places
 * offertes au public ne dépasse donc jamais le nombre réellement disponible.
 */

export const MANIA_CUP_WAITLIST = 'mania_cup_waitlist';

/** Délai laissé pour régler après une invitation, en heures. */
export const DELAI_INVITATION_HEURES = 48;

export type StatutAttente =
  /** A demandé une place, attend son tour. */
  | 'waiting'
  /** Invité à régler — sa place est réservée jusqu'à l'échéance. */
  | 'invited'
  /** A réglé : son inscription existe, il quitte la file. */
  | 'converted'
  /** Est parti, ou a laissé passer son tour. */
  | 'left';

export type EntreeAttente = {
  uid: string;
  /** Millisecondes. L'ordre d'arrivée décide de tout. */
  createdAt: number;
  statut: StatutAttente;
  /** Échéance de l'invitation, en millisecondes. */
  expireA?: number | null;
};

/** L'invitation tient-elle encore la place ? */
export function invitationActive(e: EntreeAttente, maintenant: number): boolean {
  if (e.statut !== 'invited') return false;
  // Sans échéance, l'invitation ne périme jamais : c'est un choix explicite de
  // l'organisation, pas un oubli à rattraper ici.
  if (e.expireA == null) return true;
  return e.expireA > maintenant;
}

/** Les places immobilisées par des invitations en cours. */
export function placesReservees(entrees: EntreeAttente[], maintenant: number): number {
  return entrees.filter((e) => invitationActive(e, maintenant)).length;
}

/**
 * La file, dans l'ordre d'arrivée.
 *
 * Ceux dont l'invitation a expiré RESTENT dans la file, à leur rang d'origine :
 * une invitation manquée n'est pas une faute, et les renvoyer en fin de file
 * les punirait d'un délai que l'organisation a choisi.
 */
export function fileEnAttente(entrees: EntreeAttente[]): EntreeAttente[] {
  return entrees
    .filter((e) => e.statut === 'waiting' || e.statut === 'invited')
    .sort((a, b) => a.createdAt - b.createdAt || a.uid.localeCompare(b.uid));
}

/** Le rang d'un joueur dans la file, à partir de 1. `null` s'il n'y est pas. */
export function rangDe(entrees: EntreeAttente[], uid: string): number | null {
  const i = fileEnAttente(entrees).findIndex((e) => e.uid === uid);
  return i < 0 ? null : i + 1;
}

/**
 * Qui inviter maintenant, s'il y a une place à offrir.
 *
 * On ne propose personne tant qu'aucune place n'est libre — places réglées et
 * places réservées comprises. C'est ce calcul qui empêche deux invitations pour
 * une seule place.
 */
export function prochainAInviter({
  entrees,
  placesReglees,
  placesTotales,
  maintenant,
}: {
  entrees: EntreeAttente[];
  placesReglees: number;
  placesTotales: number;
  maintenant: number;
}): EntreeAttente | null {
  const occupees = placesReglees + placesReservees(entrees, maintenant);
  if (occupees >= placesTotales) return null;
  return (
    fileEnAttente(entrees).find(
      (e) => e.statut === 'waiting' || (e.statut === 'invited' && !invitationActive(e, maintenant))
    ) ?? null
  );
}

/** Échéance d'une invitation émise maintenant. */
export function echeanceInvitation(maintenant: number, heures = DELAI_INVITATION_HEURES): number {
  return maintenant + heures * 3600_000;
}
