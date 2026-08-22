// Covoiturage vers un événement.
//
// Le principe, arrêté avec Matt le 17/08/2026 : personne ne déclare où il
// habite. Un joueur POSE lui-même un point de départ s'il en a envie, et
// l'itinéraire jusqu'à la salle se trace tout seul. Il peut ensuite le
// modifier — déplacer son départ, ajouter une étape pour prendre quelqu'un en
// chemin. Il ne touche jamais qu'au sien : c'est précisément ce qu'une carte
// Google partagée ne sait pas garantir.
//
// Deux populations, et c'est structurant : celui qui PROPOSE des places a un
// trajet (un point et une route) ; celui qui en CHERCHE n'a rien à tracer, il
// a juste un endroit où il se trouve. Sans cette distinction, la moitié des
// gens n'aurait rien à poser sur la carte.
//
// Ce module est PUR : aucun I/O, aucun accès Firestore, aucun appel réseau.
// Le calcul d'itinéraire vit dans `lib/carpool-routing.ts`, les décisions
// d'accès dans la route d'API.

export type TripKind = 'offer' | 'search';

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Le repère choisi par le joueur : « Lyon », « Péage de Fleury ». Sert à
   *  l'affichage — jamais à comparer deux positions. */
  label: string;
}

export interface RouteGeometry {
  /**
   * Le tracé, encodé (algorithme « encoded polyline », précision 5).
   *
   * Pourquoi une chaîne et non une liste de points : un itinéraire de 650 km
   * compte plusieurs milliers de points. En clair c'est 130 Ko par trajet, et
   * plusieurs mégaoctets envoyés au navigateur quand trente joueurs ont posé
   * le leur. Encodé, le même tracé pèse 3 Ko — on peut donc le garder ENTIER.
   *
   * L'ALLÉGER ÉTAIT LA FAUSSE BONNE IDÉE : à 500 m de tolérance, la ligne
   * coupait les virages et traversait les champs dès qu'on zoomait. Un
   * itinéraire qui ne suit pas la route ne sert à rien.
   *
   * Bonus : une chaîne passe telle quelle dans Firestore, qui refuse une
   * liste de paires.
   */
  polyline: string;
  distanceM: number;
  durationS: number;
  /** `road` = calculé sur le réseau routier. `straight` = repli à vol d'oiseau
   *  quand le service de calcul n'a pas répondu. On le DIT à l'écran plutôt
   *  que de faire passer une droite pour un itinéraire. */
  kind: 'road' | 'straight';
}

export interface CarpoolTrip {
  eventId: string;
  uid: string;
  kind: TripKind;
  origin: GeoPoint;
  /** Étapes intermédiaires, dans l'ordre. Vide = trajet direct. */
  waypoints: GeoPoint[];
  /** Null pour une demande de place : sans voiture, il n'y a pas de route. */
  route: RouteGeometry | null;
  /** Offre : places libres. Demande : places cherchées. */
  seats: number;
  /** Heure locale de rendez-vous (`YYYY-MM-DDTHH:mm`), sans fuseau : tout le
   *  monde parle de la même horloge, celle de la salle. */
  departAt: string | null;
  returnAt: string | null;
  note: string;
}

// ── L'événement de destination ───────────────────────────────────────────────
//
// Rien n'est écrit en dur ailleurs que dans cette table. La LAN Legends du
// 21-22 novembre réutilisera le même code : elle n'ajoutera qu'une entrée ici.

export interface CarpoolEvent {
  id: string;
  label: string;
  /** L'arrivée, identique pour tout le monde — c'est ce qui permet de tracer
   *  l'itinéraire sans que personne ne dessine quoi que ce soit. */
  destination: GeoPoint & { address: string };
  /** Bornes acceptées pour les horaires annoncés. Un départ trois mois avant
   *  l'événement est une faute de frappe, pas un covoiturage. */
  window: { from: string; to: string };
  /** Retour vers l'événement sur le site. */
  href: string;
}

export const CARPOOL_EVENTS: Record<string, CarpoolEvent> = {
  'mania-cup': {
    id: 'mania-cup',
    label: 'Springs Mania Cup',
    destination: {
      // Géocodé une fois sur l'adresse exacte de la salle, jamais estimé.
      lat: 46.9826369,
      lng: 3.0932185,
      label: 'Springs Mania Cup',
      address: '19 rue des Charrons, 58180 Marzy',
    },
    window: { from: '2026-09-28T00:00', to: '2026-10-11T23:59' },
    href: '/mania-cup',
  },
};

export function getCarpoolEvent(id: string): CarpoolEvent | null {
  return CARPOOL_EVENTS[id] ?? null;
}

// ── Bornes ───────────────────────────────────────────────────────────────────

export const CARPOOL_LIMITS = {
  /** Au-delà, l'itinéraire devient illisible et le calcul coûteux. */
  maxWaypoints: 4,
  maxSeats: 8,
  maxNote: 300,
  maxLabel: 80,
} as const;

/** Boîte européenne large. Sert à refuser une pastille au milieu de l'océan :
 *  c'est soit une blague, soit un doigt qui a glissé. */
const BOUNDS = { latMin: 34, latMax: 72, lngMin: -25, lngMax: 45 };

export function isWithinBounds(p: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= BOUNDS.latMin && p.lat <= BOUNDS.latMax
    && p.lng >= BOUNDS.lngMin && p.lng <= BOUNDS.lngMax
  );
}

export interface TripPayload {
  kind?: unknown;
  origin?: unknown;
  waypoints?: unknown;
  seats?: unknown;
  departAt?: unknown;
  returnAt?: unknown;
  note?: unknown;
}

export type ValidationResult =
  | { ok: true; value: Omit<CarpoolTrip, 'eventId' | 'uid' | 'route'> }
  | { ok: false; error: string };

function readPoint(raw: unknown): GeoPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!isWithinBounds({ lat, lng })) return null;
  const label = typeof o.label === 'string' ? o.label.trim().slice(0, CARPOOL_LIMITS.maxLabel) : '';
  return { lat, lng, label };
}

/** Une heure de rendez-vous, ou null. Le format est volontairement local et
 *  sans fuseau : personne ne se donne rendez-vous en UTC. */
function readWhen(raw: unknown, ev: CarpoolEvent): string | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return 'invalid';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return 'invalid';
  if (raw < ev.window.from || raw > ev.window.to) return 'invalid';
  return raw;
}

/**
 * Le serveur ne fait JAMAIS confiance au client : tout est relu, borné, et
 * l'itinéraire est recalculé côté serveur — jamais accepté depuis le payload,
 * sinon n'importe qui pourrait faire dessiner au site un tracé arbitraire.
 */
export function validateTripPayload(raw: TripPayload, ev: CarpoolEvent): ValidationResult {
  const kind = raw.kind === 'offer' || raw.kind === 'search' ? raw.kind : null;
  if (!kind) return { ok: false, error: 'Précise si tu proposes des places ou si tu en cherches.' };

  const origin = readPoint(raw.origin);
  if (!origin) return { ok: false, error: 'Pose ton point de départ sur la carte.' };

  // Une demande de place n'a pas d'itinéraire : sans voiture, il n'y a rien à
  // tracer. On ignore d'éventuelles étapes plutôt que de refuser un formulaire
  // pour un champ que l'écran n'affiche même pas dans ce mode.
  const rawWaypoints = kind === 'offer' && Array.isArray(raw.waypoints) ? raw.waypoints : [];
  if (rawWaypoints.length > CARPOOL_LIMITS.maxWaypoints) {
    return { ok: false, error: 'Quatre étapes au maximum : au-delà, l’itinéraire devient illisible.' };
  }
  const waypoints: GeoPoint[] = [];
  for (const w of rawWaypoints) {
    const p = readPoint(w);
    if (!p) return { ok: false, error: 'Une des étapes est hors de la zone couverte.' };
    waypoints.push(p);
  }

  const seats = Number(raw.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > CARPOOL_LIMITS.maxSeats) {
    return { ok: false, error: `Indique un nombre de places entre 1 et ${CARPOOL_LIMITS.maxSeats}.` };
  }

  const departAt = readWhen(raw.departAt, ev);
  if (departAt === 'invalid') {
    return { ok: false, error: 'L’heure de départ ne tombe pas dans la période de l’événement.' };
  }
  const returnAt = readWhen(raw.returnAt, ev);
  if (returnAt === 'invalid') {
    return { ok: false, error: 'L’heure de retour ne tombe pas dans la période de l’événement.' };
  }
  if (departAt && returnAt && returnAt < departAt) {
    return { ok: false, error: 'Le retour ne peut pas précéder le départ.' };
  }

  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, CARPOOL_LIMITS.maxNote) : '';

  return { ok: true, value: { kind, origin, waypoints, seats, departAt, returnAt, note } };
}

// ── Géométrie ────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Distance d'un point au tracé le plus proche.
 *
 * C'est ce calcul qui rend le service meilleur qu'une carte partagée : il
 * permet de dire à un conducteur « untel cherche une place et se trouve à six
 * minutes de ta route ». Purement local, aucun appel réseau.
 *
 * Projection équirectangulaire autour du point testé : à l'échelle d'un détour
 * de covoiturage, l'erreur est négligeable devant l'imprécision d'un point
 * posé au doigt sur une carte.
 */
export function distanceToRouteMeters(
  point: { lat: number; lng: number },
  route: [number, number][],
): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return haversineMeters(point, { lat: route[0][0], lng: route[0][1] });

  const k = Math.cos(rad(point.lat));
  const px = point.lng * k;
  const py = point.lat;
  let best = Infinity;

  for (let i = 0; i < route.length - 1; i++) {
    const ax = route[i][1] * k;
    const ay = route[i][0];
    const bx = route[i + 1][1] * k;
    const by = route[i + 1][0];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Deux points confondus : le segment se réduit à son origine.
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const proj = { lat: ay + t * dy, lng: (ax + t * dx) / k };
    const d = haversineMeters(point, proj);
    if (d < best) best = d;
  }
  return best;
}

/** Les demandes de place qui longent un itinéraire, la plus proche d'abord. */
export function seekersNearRoute<T extends { origin: { lat: number; lng: number } }>(
  seekers: T[],
  route: [number, number][],
  maxMeters = 15_000,
): { seeker: T; meters: number }[] {
  if (route.length === 0) return [];
  return seekers
    .map((seeker) => ({ seeker, meters: distanceToRouteMeters(seeker.origin, route) }))
    .filter((r) => r.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters);
}


// ── Encodage du tracé ────────────────────────────────────────────────────────
//
// L'algorithme « encoded polyline » : chaque point n'est stocké que par son
// ÉCART au précédent, en centièmes de millième de degré, puis en base 64
// imprimable. Sur une route les écarts sont minuscules, d'où un facteur de
// compression d'environ quarante contre une liste de nombres.

const PRECISION = 1e5;

function encodeValeur(v: number, sortie: string[]): void {
  let x = v < 0 ? ~(v << 1) : v << 1;
  while (x >= 0x20) {
    sortie.push(String.fromCharCode((0x20 | (x & 0x1f)) + 63));
    x >>= 5;
  }
  sortie.push(String.fromCharCode(x + 63));
}

export function encodePolyline(coords: [number, number][]): string {
  const out: string[] = [];
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of coords) {
    const nlat = Math.round(la * PRECISION);
    const nlng = Math.round(ln * PRECISION);
    encodeValeur(nlat - lat, out);
    encodeValeur(nlng - lng, out);
    lat = nlat;
    lng = nlng;
  }
  return out.join('');
}

export function decodePolyline(encoded: string): [number, number][] {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    for (const axe of [0, 1]) {
      let resultat = 0;
      let decalage = 0;
      let octet = 0;
      do {
        octet = encoded.charCodeAt(i++) - 63;
        resultat |= (octet & 0x1f) << decalage;
        decalage += 5;
      } while (octet >= 0x20 && i < encoded.length);
      const delta = resultat & 1 ? ~(resultat >> 1) : resultat >> 1;
      if (axe === 0) lat += delta;
      else lng += delta;
    }
    out.push([lat / PRECISION, lng / PRECISION]);
  }
  return out;
}


// ── Affichage ────────────────────────────────────────────────────────────────

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** Le coût d'une étape, tel qu'on l'annonce au conducteur avant qu'il valide. */
export function formatDetour(baseSeconds: number, withStopSeconds: number): string {
  const delta = Math.round((withStopSeconds - baseSeconds) / 60);
  if (delta <= 0) return 'sans détour';
  return `+${delta} min de détour`;
}
