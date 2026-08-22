import { describe, it, expect } from 'vitest';
import {
  getCarpoolEvent,
  validateTripPayload,
  haversineMeters,
  distanceToRouteMeters,
  seekersNearRoute,
  formatDistance,
  formatDuration,
  formatDetour,
  isWithinBounds,
  flattenCoordinates,
  inflateCoordinates,
  CARPOOL_LIMITS,
} from './carpool';

const EV = getCarpoolEvent('mania-cup')!;

// Repères réels, pour que les distances testées veuillent dire quelque chose.
const NEVERS = { lat: 46.9896, lng: 3.1628 };
const MOULINS = { lat: 46.5646, lng: 3.3324 };
const LYON = { lat: 45.764, lng: 4.8357 };

const OK = {
  kind: 'offer',
  origin: { lat: LYON.lat, lng: LYON.lng, label: 'Lyon' },
  waypoints: [],
  seats: 3,
  departAt: '2026-10-03T08:00',
  returnAt: '2026-10-04T19:00',
  note: 'Je passe par l’A89.',
};

describe('l’événement de destination', () => {
  it('connaît la salle, adresse comprise', () => {
    expect(EV.destination.address).toContain('Marzy');
    // Coordonnées géocodées sur l'adresse exacte, pas estimées à la louche :
    // une erreur ici décale tous les itinéraires du site.
    expect(haversineMeters(EV.destination, NEVERS)).toBeLessThan(10_000);
  });

  it('ne connaît rien d’autre que ce qui est déclaré', () => {
    expect(getCarpoolEvent('legends-lan')).toBeNull();
  });
});

describe('validateTripPayload', () => {
  it('accepte un trajet complet', () => {
    const r = validateTripPayload(OK, EV);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe('offer');
      expect(r.value.origin.label).toBe('Lyon');
      expect(r.value.seats).toBe(3);
    }
  });

  it('exige de savoir si on propose ou si on cherche', () => {
    const r = validateTripPayload({ ...OK, kind: 'peut-être' }, EV);
    expect(r.ok).toBe(false);
  });

  it('refuse une pastille hors de la zone couverte', () => {
    // Au milieu de l'Atlantique : un doigt qui a glissé, ou une blague.
    const r = validateTripPayload({ ...OK, origin: { lat: 12, lng: -40, label: '' } }, EV);
    expect(r.ok).toBe(false);
    expect(isWithinBounds({ lat: 12, lng: -40 })).toBe(false);
  });

  it('refuse un départ sans point', () => {
    expect(validateTripPayload({ ...OK, origin: undefined }, EV).ok).toBe(false);
    expect(validateTripPayload({ ...OK, origin: { lat: 'ici', lng: 3 } }, EV).ok).toBe(false);
  });

  it('borne le nombre d’étapes', () => {
    const trop = Array.from({ length: CARPOOL_LIMITS.maxWaypoints + 1 }, () => ({ ...MOULINS, label: 'Moulins' }));
    expect(validateTripPayload({ ...OK, waypoints: trop }, EV).ok).toBe(false);
  });

  it('ignore les étapes d’une DEMANDE de place', () => {
    // Sans voiture, il n'y a pas d'itinéraire à tracer. On n'échoue pas pour
    // un champ que l'écran n'affiche même pas dans ce mode.
    const r = validateTripPayload({ ...OK, kind: 'search', waypoints: [{ ...MOULINS, label: 'x' }] }, EV);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.waypoints).toEqual([]);
  });

  it('borne les places', () => {
    expect(validateTripPayload({ ...OK, seats: 0 }, EV).ok).toBe(false);
    expect(validateTripPayload({ ...OK, seats: 99 }, EV).ok).toBe(false);
    expect(validateTripPayload({ ...OK, seats: 2.5 }, EV).ok).toBe(false);
  });

  it('refuse une heure hors de la période de l’événement', () => {
    // Un départ en juillet pour une LAN d'octobre est une faute de frappe.
    expect(validateTripPayload({ ...OK, departAt: '2026-07-01T08:00' }, EV).ok).toBe(false);
    expect(validateTripPayload({ ...OK, departAt: 'demain matin' }, EV).ok).toBe(false);
  });

  it('accepte de ne pas savoir encore quand on part', () => {
    const r = validateTripPayload({ ...OK, departAt: '', returnAt: null }, EV);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.departAt).toBeNull();
  });

  it('refuse un retour antérieur au départ', () => {
    const r = validateTripPayload({ ...OK, departAt: '2026-10-04T19:00', returnAt: '2026-10-03T08:00' }, EV);
    expect(r.ok).toBe(false);
  });

  it('borne et détoure la note', () => {
    const r = validateTripPayload({ ...OK, note: `  ${'a'.repeat(400)}  ` }, EV);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.note).toHaveLength(CARPOOL_LIMITS.maxNote);
  });

  it('n’accepte JAMAIS un itinéraire venu du client', () => {
    // Le tracé est recalculé au serveur. L'accepter depuis le payload
    // laisserait n'importe qui faire dessiner au site la route qu'il veut.
    const r = validateTripPayload({ ...OK, route: { coordinates: [[0, 0]] } } as never, EV);
    expect(r.ok).toBe(true);
    if (r.ok) expect('route' in r.value).toBe(false);
  });
});

describe('distanceToRouteMeters', () => {
  // Un itinéraire schématique Paris → Marzy, qui passe par Montargis et Briare.
  const ROUTE: [number, number][] = [
    [48.8566, 2.3522],
    [47.9975, 2.7369],
    [47.6394, 2.7433],
    [46.9826, 3.0932],
  ];

  it('vaut zéro sur le tracé lui-même', () => {
    expect(distanceToRouteMeters({ lat: 47.9975, lng: 2.7369 }, ROUTE)).toBeLessThan(1);
  });

  it('mesure l’écart d’un point qui n’est pas dessus', () => {
    // Lyon est très loin de l'axe Paris–Nevers.
    expect(distanceToRouteMeters(LYON, ROUTE)).toBeGreaterThan(150_000);
  });

  it('trouve la projection au MILIEU d’un segment, pas seulement aux sommets', () => {
    // Un point posé juste à côté du trait, entre deux sommets éloignés : c'est
    // le cas qui distingue une vraie distance à un tracé d'une distance aux
    // seuls points de passage.
    const milieu = { lat: 47.82, lng: 2.75 };
    const auTrace = distanceToRouteMeters(milieu, ROUTE);
    const auxSommets = Math.min(...ROUTE.map(([lat, lng]) => haversineMeters(milieu, { lat, lng })));
    expect(auTrace).toBeLessThan(auxSommets);
    expect(auTrace).toBeLessThan(10_000);
  });

  it('ne plante pas sur un tracé vide ou réduit à un point', () => {
    expect(distanceToRouteMeters(LYON, [])).toBe(Infinity);
    expect(distanceToRouteMeters(NEVERS, [[46.9826, 3.0932]])).toBeLessThan(10_000);
  });

  it('supporte deux points confondus dans le tracé', () => {
    const d = distanceToRouteMeters(NEVERS, [[46.9826, 3.0932], [46.9826, 3.0932]]);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe('seekersNearRoute', () => {
  const ROUTE: [number, number][] = [[48.8566, 2.3522], [46.9826, 3.0932]];
  const surLaRoute = { uid: 'a', origin: { lat: 47.9, lng: 2.75 } };
  const loin = { uid: 'b', origin: LYON };
  const toutPres = { uid: 'c', origin: { lat: 47.92, lng: 2.73 } };

  it('ne retient que ceux qui longent l’itinéraire', () => {
    const r = seekersNearRoute([surLaRoute, loin, toutPres], ROUTE);
    expect(r.map((x) => x.seeker.uid)).not.toContain('b');
    expect(r.length).toBe(2);
  });

  it('donne le plus proche en premier — c’est celui qu’on propose', () => {
    const r = seekersNearRoute([surLaRoute, toutPres], ROUTE);
    expect(r[0].meters).toBeLessThanOrEqual(r[1].meters);
  });

  it('ne renvoie rien sans itinéraire', () => {
    expect(seekersNearRoute([surLaRoute], [])).toEqual([]);
  });
});

describe('affichage', () => {
  it('écrit des distances lisibles', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(4200)).toBe('4,2 km');
    expect(formatDistance(340_000)).toBe('340 km');
    expect(formatDistance(Infinity)).toBe('—');
  });

  it('écrit des durées lisibles', () => {
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(13_620)).toBe('3 h 47');
    expect(formatDuration(-5)).toBe('—');
  });

  it('annonce ce que coûte une étape', () => {
    expect(formatDetour(13_620, 14_700)).toBe('+18 min de détour');
    // Une étape sur le chemin ne coûte rien : le dire évite de faire hésiter
    // un conducteur pour rien.
    expect(formatDetour(13_620, 13_600)).toBe('sans détour');
  });
});

describe('passage en base', () => {
  // Régression du 17/08 : Firestore refuse une liste dans une liste. Le tracé
  // étant une liste de paires, seul le chemin « je propose des places »
  // plantait — en « Erreur serveur », sans rien dire de plus.
  const trace: [number, number][] = [[48.8566, 2.3522], [47.9975, 2.7369], [46.9826, 3.0932]];

  it('aplatit le tracé — plus aucune liste imbriquée', () => {
    const plat = flattenCoordinates(trace);
    expect(plat).toEqual([48.8566, 2.3522, 47.9975, 2.7369, 46.9826, 3.0932]);
    expect(plat.every((v) => typeof v === 'number')).toBe(true);
  });

  it('le reconstitue à l’identique', () => {
    expect(inflateCoordinates(flattenCoordinates(trace))).toEqual(trace);
  });

  it('ne fabrique pas un point avec une demi-coordonnée', () => {
    expect(inflateCoordinates([48.85, 2.35, 47.99])).toEqual([[48.85, 2.35]]);
    expect(inflateCoordinates(null)).toEqual([]);
    expect(inflateCoordinates(['a', 'b'])).toEqual([]);
  });
});
