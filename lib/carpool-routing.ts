import {
  haversineMeters,
  simplifyRoute,
  type CarpoolEvent,
  type GeoPoint,
  type RouteGeometry,
} from '@/lib/carpool';

// Le calcul d'itinéraire et la recherche de lieux.
//
// Deux règles de conception :
//
// 1. ON CALCULE UNE FOIS, à l'enregistrement du trajet, et on stocke le tracé.
//    Afficher la carte ne coûte alors AUCUN appel — seulement les tuiles de
//    fond. Sur toute la durée d'un événement, ça fait quelques centaines de
//    calculs, très loin des paliers gratuits.
//
// 2. UN SERVICE TIERS QUI TOMBE NE DOIT JAMAIS EMPÊCHER QUELQU'UN DE POSER SON
//    TRAJET. Sans clé, ou si l'appel échoue, on retombe sur un trait droit —
//    et on le DIT à l'écran (`kind: 'straight'`), au lieu de faire passer une
//    droite pour une route.
//
// La clé vit dans `OPENROUTESERVICE_API_KEY`. Elle ne sort jamais du serveur :
// la recherche de lieux est relayée par une route d'API, pas appelée depuis le
// navigateur.

const ORS = 'https://api.openrouteservice.org';
/** Au-delà, on rend la main : une page qui attend un tiers est une page cassée. */
const TIMEOUT_MS = 8_000;
/** Vitesse moyenne portière à portière, pour l'estimation du repli. Volontairement
 *  prudente : mieux vaut annoncer un peu long qu'un peu court. */
const FALLBACK_KMH = 75;

function apiKey(): string | null {
  const k = process.env.OPENROUTESERVICE_API_KEY?.trim();
  return k ? k : null;
}

export function isRoutingConfigured(): boolean {
  return apiKey() !== null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ── Itinéraire ───────────────────────────────────────────────────────────────

/**
 * Lecture de la réponse d'OpenRouteService.
 *
 * Isolée et exportée pour être testable sans réseau, parce qu'elle porte le
 * piège classique de toute API cartographique : **GeoJSON ordonne les
 * coordonnées en [longitude, latitude]**, l'inverse de ce qu'attendent Leaflet
 * et le reste de ce module. Inverser les deux fait atterrir la France au large
 * de la Somalie, sans aucune erreur.
 */
export function parseOrsGeoJson(json: unknown): RouteGeometry | null {
  const f = (json as { features?: unknown[] })?.features?.[0] as
    | { geometry?: { coordinates?: [number, number][] }; properties?: { summary?: { distance?: number; duration?: number } } }
    | undefined;
  const coords = f?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const distanceM = Number(f?.properties?.summary?.distance);
  const durationS = Number(f?.properties?.summary?.duration);
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationS)) return null;

  return {
    // [lng, lat] → [lat, lng].
    coordinates: simplifyRoute(coords.map(([lng, lat]) => [lat, lng] as [number, number])),
    distanceM,
    durationS,
    kind: 'road',
  };
}

/** Le repli : une ligne brisée par les étapes, et une durée estimée. */
export function straightLineRoute(points: { lat: number; lng: number }[]): RouteGeometry {
  const coordinates = points.map((p) => [p.lat, p.lng] as [number, number]);
  let distanceM = 0;
  for (let i = 0; i < points.length - 1; i++) {
    distanceM += haversineMeters(points[i], points[i + 1]);
  }
  return {
    coordinates,
    distanceM,
    durationS: (distanceM / 1000 / FALLBACK_KMH) * 3600,
    kind: 'straight',
  };
}

/**
 * L'itinéraire d'un joueur jusqu'à la salle, étapes comprises.
 *
 * Ne lève jamais. En cas d'échec on renvoie le trait droit : le joueur a le
 * droit de poser son trajet même quand un service tiers a hoqueté.
 */
export async function computeRoute(
  ev: CarpoolEvent,
  origin: GeoPoint,
  waypoints: GeoPoint[],
): Promise<RouteGeometry> {
  const points = [origin, ...waypoints, ev.destination];
  const key = apiKey();
  if (!key) return straightLineRoute(points);

  try {
    const res = await fetchWithTimeout(`${ORS}/v2/directions/driving-car/geojson`, {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        Accept: 'application/geo+json',
      },
      // ORS attend [longitude, latitude] — voir parseOrsGeoJson.
      body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) }),
    });
    if (!res.ok) return straightLineRoute(points);
    const parsed = parseOrsGeoJson(await res.json());
    return parsed ?? straightLineRoute(points);
  } catch {
    return straightLineRoute(points);
  }
}

// ── Recherche de lieux ───────────────────────────────────────────────────────

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Lecture d'une réponse Pelias (le géocodeur d'OpenRouteService). Exportée pour
 * la même raison que ci-dessus : c'est encore du [lng, lat].
 */
export function parsePeliasResults(json: unknown): PlaceResult[] {
  const feats = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(feats)) return [];
  const out: PlaceResult[] = [];
  for (const f of feats) {
    const feat = f as {
      geometry?: { coordinates?: number[] };
      properties?: { label?: string; name?: string; region?: string; country?: string };
    };
    const c = feat?.geometry?.coordinates;
    const p = feat?.properties;
    if (!Array.isArray(c) || c.length < 2 || !p) continue;

    // Le `label` du géocodeur ne distingue RIEN : une recherche « Moulins »
    // renvoie quatre fois « Moulins, France » — impossible de choisir. Le
    // département (`region`) les sépare : Allier, Aisne, Deux-Sèvres,
    // Ille-et-Vilaine. On recompose donc l'étiquette, en écartant les
    // répétitions (« Genève, Genève, Suisse »).
    const morceaux = [p.name, p.region, p.country].filter(
      (m): m is string => typeof m === 'string' && m.trim().length > 0,
    );
    const label = [...new Set(morceaux)].join(', ') || p.label;
    if (!label) continue;
    out.push({ label, lat: Number(c[1]), lng: Number(c[0]) });
  }
  return out;
}

/** Lecture d'une réponse Nominatim — le repli quand aucune clé n'est posée. */
export function parseNominatimResults(json: unknown): PlaceResult[] {
  if (!Array.isArray(json)) return [];
  const out: PlaceResult[] = [];
  for (const r of json) {
    const row = r as { lat?: string; lon?: string; display_name?: string };
    const lat = Number(row?.lat);
    const lng = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof row?.display_name !== 'string') continue;
    // Nominatim renvoie l'adresse administrative complète, jusqu'au pays. Les
    // trois premiers éléments suffisent à reconnaître une ville sans noyer la
    // liste : « Moulins, Allier, Auvergne-Rhône-Alpes ».
    out.push({ label: row.display_name.split(',').slice(0, 3).join(',').trim(), lat, lng });
  }
  return out;
}

/**
 * Cherche un lieu par son nom.
 *
 * Relayé par le serveur pour que la clé n'atteigne jamais le navigateur, et
 * centré sur la destination : à requête égale, on préfère la ville la plus
 * proche de l'événement — « Saint-Pierre » ne renvoie pas le même endroit
 * selon qu'on organise sa LAN dans la Nièvre ou à La Réunion.
 */
export async function searchPlaces(ev: CarpoolEvent, query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const key = apiKey();

  try {
    if (key) {
      const url = new URL(`${ORS}/geocode/search`);
      url.searchParams.set('api_key', key);
      url.searchParams.set('text', q);
      url.searchParams.set('size', '6');
      url.searchParams.set('focus.point.lat', String(ev.destination.lat));
      url.searchParams.set('focus.point.lon', String(ev.destination.lng));
      const res = await fetchWithTimeout(url.toString());
      if (res.ok) return parsePeliasResults(await res.json());
      return [];
    }

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '6');
    const res = await fetchWithTimeout(url.toString(), {
      // Exigé par la politique d'usage de Nominatim : un service qui ne
      // s'identifie pas se fait bloquer, et il aurait raison.
      headers: { 'User-Agent': 'Aedral/1.0 (https://aedral.com)' },
    });
    if (!res.ok) return [];
    return parseNominatimResults(await res.json());
  } catch {
    return [];
  }
}
