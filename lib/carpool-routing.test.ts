import { describe, it, expect } from 'vitest';
import {
  parseOrsGeoJson,
  parsePeliasResults,
  parseNominatimResults,
  straightLineRoute,
} from './carpool-routing';
import { simplifyRoute, distanceToRouteMeters, haversineMeters } from './carpool';

const MARZY = { lat: 46.9826369, lng: 3.0932185 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

describe('parseOrsGeoJson', () => {
  // GeoJSON ordonne les coordonnées en [longitude, latitude]. Leaflet et tout
  // le reste de ce module attendent l'inverse. Inverser les deux fait
  // atterrir la France au large de la Somalie, sans lever la moindre erreur —
  // c'est LE bug de toute intégration cartographique.
  const reponse = {
    features: [{
      geometry: { coordinates: [[2.3522, 48.8566], [3.0932, 46.9826]] },
      properties: { summary: { distance: 245_000, duration: 9_600 } },
    }],
  };

  it('remet les coordonnées dans le bon ordre', () => {
    const r = parseOrsGeoJson(reponse)!;
    expect(r.coordinates[0]).toEqual([48.8566, 2.3522]);
    // Le premier point doit tomber sur Paris, pas dans l'océan Indien.
    expect(haversineMeters({ lat: r.coordinates[0][0], lng: r.coordinates[0][1] }, PARIS)).toBeLessThan(1000);
    expect(haversineMeters({ lat: r.coordinates[1][0], lng: r.coordinates[1][1] }, MARZY)).toBeLessThan(2000);
  });

  it('rapporte distance, durée et provenance', () => {
    const r = parseOrsGeoJson(reponse)!;
    expect(r.distanceM).toBe(245_000);
    expect(r.durationS).toBe(9_600);
    expect(r.kind).toBe('road');
  });

  it('rend null plutôt qu’un tracé bancal', () => {
    expect(parseOrsGeoJson(null)).toBeNull();
    expect(parseOrsGeoJson({})).toBeNull();
    expect(parseOrsGeoJson({ features: [] })).toBeNull();
    // Un seul point n'est pas un itinéraire.
    expect(parseOrsGeoJson({ features: [{ geometry: { coordinates: [[2, 48]] } }] })).toBeNull();
    // Un tracé sans résumé chiffré ne permet ni d'annoncer une durée ni de
    // calculer un détour : inutilisable.
    expect(parseOrsGeoJson({ features: [{ geometry: { coordinates: [[2, 48], [3, 47]] }, properties: {} }] })).toBeNull();
  });
});

describe('straightLineRoute — le repli', () => {
  it('se déclare comme un trait droit, jamais comme une route', () => {
    // C'est ce qui permet à l'écran de le dire au joueur au lieu de faire
    // passer une droite pour un itinéraire.
    expect(straightLineRoute([PARIS, MARZY]).kind).toBe('straight');
  });

  it('additionne les segments quand il y a des étapes', () => {
    const etape = { lat: 47.9975, lng: 2.7369 };
    const direct = straightLineRoute([PARIS, MARZY]).distanceM;
    const avecEtape = straightLineRoute([PARIS, etape, MARZY]).distanceM;
    expect(avecEtape).toBeGreaterThanOrEqual(direct);
  });

  it('estime une durée plausible', () => {
    const r = straightLineRoute([PARIS, MARZY]);
    // ~210 km à vol d'oiseau : entre deux et quatre heures, jamais zéro.
    expect(r.durationS).toBeGreaterThan(2 * 3600);
    expect(r.durationS).toBeLessThan(4 * 3600);
  });
});

describe('recherche de lieux', () => {
  it('lit une réponse Pelias, coordonnées remises à l’endroit', () => {
    const r = parsePeliasResults({
      features: [{
        geometry: { coordinates: [3.3324, 46.5646] },
        properties: { label: 'Moulins, France', name: 'Moulins', region: 'Allier', country: 'France' },
      }],
    });
    expect(r).toEqual([{ label: 'Moulins, Allier, France', lat: 46.5646, lng: 3.3324 }]);
  });

  it('distingue des communes homonymes', () => {
    // Réponse RÉELLE du géocodeur pour « Moulins » : son propre `label` répète
    // quatre fois « Moulins, France ». Sans le département, impossible de
    // choisir laquelle est la bonne.
    const r = parsePeliasResults({
      features: [
        { geometry: { coordinates: [3.33, 46.56] }, properties: { label: 'Moulins, France', name: 'Moulins', region: 'Allier', country: 'France' } },
        { geometry: { coordinates: [3.79, 49.44] }, properties: { label: 'Moulins, France', name: 'Moulins', region: 'Aisne', country: 'France' } },
        { geometry: { coordinates: [-0.76, 46.88] }, properties: { label: 'Moulins, France', name: 'Moulins', region: 'Deux-Sèvres', country: 'France' } },
      ],
    });
    expect(new Set(r.map((x) => x.label)).size).toBe(3);
    expect(r[0].label).toBe('Moulins, Allier, France');
  });

  it('ne répète pas un nom identique à sa région', () => {
    const r = parsePeliasResults({
      features: [{ geometry: { coordinates: [6.14, 46.2] }, properties: { name: 'Genève', region: 'Genève', country: 'Suisse' } }],
    });
    expect(r[0].label).toBe('Genève, Suisse');
  });

  it('lit une réponse Nominatim et raccourcit l’adresse', () => {
    const r = parseNominatimResults([
      { lat: '46.5646', lon: '3.3324', display_name: 'Moulins, Allier, Auvergne-Rhône-Alpes, France métropolitaine, France' },
    ]);
    // L'adresse administrative complète noierait la liste de choix.
    expect(r[0].label).toBe('Moulins, Allier, Auvergne-Rhône-Alpes');
    expect(r[0].lat).toBeCloseTo(46.5646, 3);
  });

  it('ne rend rien sur une réponse inattendue', () => {
    expect(parsePeliasResults(null)).toEqual([]);
    expect(parseNominatimResults({ error: 'nope' })).toEqual([]);
    expect(parseNominatimResults([{ lat: 'x', lon: 'y', display_name: 'z' }])).toEqual([]);
  });
});

describe('simplifyRoute', () => {
  /** Un tracé dense et sinueux, comme en renvoie un vrai calculateur. */
  const dense: [number, number][] = Array.from({ length: 800 }, (_, i) => {
    const t = i / 799;
    return [48.8566 + (46.9826 - 48.8566) * t + Math.sin(t * 40) * 0.02, 2.3522 + (3.0932 - 2.3522) * t] as [number, number];
  });

  it('allège fortement un tracé de calculateur', () => {
    const s = simplifyRoute(dense, 500);
    expect(s.length).toBeLessThan(dense.length / 4);
    expect(s.length).toBeGreaterThan(2);
  });

  it('garde le départ et l’arrivée intacts', () => {
    const s = simplifyRoute(dense, 500);
    expect(s[0]).toEqual(dense[0]);
    expect(s[s.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it('ne déforme pas la ligne au-delà de la tolérance', () => {
    // La garantie qui compte : le tracé allégé doit rester à portée du tracé
    // d'origine, sinon « untel est à 6 min de ta route » devient faux.
    const s = simplifyRoute(dense, 500);
    const ecartMax = Math.max(...dense.map(([lat, lng]) => distanceToRouteMeters({ lat, lng }, s)));
    expect(ecartMax).toBeLessThanOrEqual(500);
  });

  it('laisse tranquille ce qui est déjà court', () => {
    const court: [number, number][] = [[48.8566, 2.3522], [46.9826, 3.0932]];
    expect(simplifyRoute(court)).toEqual(court);
    expect(simplifyRoute([])).toEqual([]);
  });
});
