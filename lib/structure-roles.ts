// Helpers purs autour des rôles dirigeants d'une structure.
// Pas d'accès Firestore ici — toute la logique métier qui peut être testée en isolation.

export const MAX_SEATS_PER_PERSON = 2;
export const MAX_CO_FOUNDERS_PER_STRUCTURE = 2;
export const DEPARTURE_NOTICE_DAYS = 7;
export const DEPARTURE_NOTICE_MS = DEPARTURE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

// Statuts dans lesquels un siège dirigeant "compte" pour la limite personnelle.
// Une structure supprimée ou rejetée ne compte plus, mais une suspendue ou orphelinée oui :
// tant qu'elle existe et peut redevenir active, elle consomme un siège.
export const SEAT_COUNTING_STATUSES = new Set([
  'pending_validation',
  'active',
  'deletion_scheduled',
  'orphaned',
  'suspended',
]);

export interface DirigeantRef {
  id?: string;
  founderId: string;
  coFounderIds?: string[];
  status: string;
}

export function isFounder(structure: Pick<DirigeantRef, 'founderId'>, uid: string): boolean {
  return !!uid && structure.founderId === uid;
}

export function isCoFounder(structure: Pick<DirigeantRef, 'coFounderIds'>, uid: string): boolean {
  if (!uid) return false;
  return (structure.coFounderIds ?? []).includes(uid);
}

export function isDirigeant(structure: DirigeantRef, uid: string): boolean {
  return isFounder(structure, uid) || isCoFounder(structure, uid);
}

// Compte combien de structures où `uid` occupe un siège dirigeant (fondateur OU co-fondateur),
// en ne gardant que les statuts qui bloquent un siège. Déduplique via l'id pour ne pas compter
// deux fois une structure qui serait listée dans les deux requêtes (impossible en pratique).
export function countDirigeantSeats(
  structures: DirigeantRef[],
  uid: string,
  ignoreStructureId?: string
): number {
  const seen = new Set<string>();
  for (const s of structures) {
    if (!SEAT_COUNTING_STATUSES.has(s.status)) continue;
    if (!isDirigeant(s, uid)) continue;
    const key = s.id ?? `${s.founderId}:${(s.coFounderIds ?? []).join(',')}`;
    if (ignoreStructureId && s.id === ignoreStructureId) continue;
    seen.add(key);
  }
  return seen.size;
}

export function hasReachedSeatLimit(
  structures: DirigeantRef[],
  uid: string,
  ignoreStructureId?: string
): boolean {
  return countDirigeantSeats(structures, uid, ignoreStructureId) >= MAX_SEATS_PER_PERSON;
}

// Convertit une valeur Firestore (Timestamp, Date, number, string ISO) en millisecondes epoch.
// Renvoie null si la valeur est absente ou illisible — l'appelant doit gérer l'absence de préavis.
export function noticeTimestampToMs(value: unknown): number | null {
  if (value == null) return null;
  // Firestore Timestamp a une méthode toMillis()
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// Temps restant (ms) avant l'expiration du préavis. 0 = expiré, null = pas de préavis.
export function departureNoticeRemainingMs(noticeAt: unknown, now: number = Date.now()): number | null {
  const t = noticeTimestampToMs(noticeAt);
  if (t === null) return null;
  return Math.max(0, t + DEPARTURE_NOTICE_MS - now);
}

// True si un préavis a été déposé et que les 7 jours sont passés.
export function isDepartureNoticeExpired(noticeAt: unknown, now: number = Date.now()): boolean {
  const remaining = departureNoticeRemainingMs(noticeAt, now);
  return remaining !== null && remaining === 0;
}

// Trouve tous les uid dont le préavis a expiré dans la map `coFounderDepartures`.
// Utilisé par le lazy-processing au moment des lectures (structures/my, structures/[id]).
export function expiredDepartures(
  departures: Record<string, unknown> | undefined | null,
  now: number = Date.now()
): string[] {
  if (!departures) return [];
  return Object.keys(departures).filter(uid => isDepartureNoticeExpired(departures[uid], now));
}
