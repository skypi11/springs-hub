import { describe, it, expect } from 'vitest';
import {
  parseOrsRoute,
  parsePeliasResults,
  parseNominatimResults,
  straightLineRoute,
} from './carpool-routing';
import { decodePolyline, encodePolyline, haversineMeters } from './carpool';

const MARZY = { lat: 46.9826369, lng: 3.0932185 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

describe('parseOrsRoute', () => {
  /** Un tracé réaliste : des points serrés, comme en renvoie un calculateur. */
  const trace: [number, number][] = Array.from({ length: 500 }, (_, i) => [
    48.8566 + (46.9826 - 48.8566) * (i / 499) + Math.sin(i / 9) * 0.01,
    2.3522 + (3.0932 - 2.3522) * (i / 499),
  ]);
  const reponse = {
    routes: [{
      geometry: encodePolyline(trace),
      summary: { distance: 245_000, duration: 9_600 },
    }],
  };

  it('garde le tracé ENTIER, point par point', () => {
    // Régression du 22/08 : le tracé était simplifié à 500 m, ce qui faisait
    // couper les virages et « passer à travers champs ». Aucun point ne doit
    // plus se perdre entre le calculateur et l'écran.
    const r = parseOrsRoute(reponse)!;
    expect(decodePolyline(r.polyline)).toHaveLength(trace.length);
  });

  it('ne déplace aucun point de plus d’un mètre', () => {
    const rendu = decodePolyline(parseOrsRoute(reponse)!.polyline);
    const ecartMax = Math.max(...rendu.map(([lat, lng], i) =>
      haversineMeters({ lat, lng }, { lat: trace[i][0], lng: trace[i][1] })));
    expect(ecartMax).toBeLessThan(1);
  });

  it('reprend la géométrie TELLE QUELLE, sans conversion', () => {
    // Le point d'entrée standard d'ORS rend déjà le format qu'on stocke : plus
    // aucune occasion d'inverser latitude et longitude, le piège classique de
    // toute intégration cartographique.
    expect(parseOrsRoute(reponse)!.polyline).toBe(reponse.routes[0].geometry);
  });

  it('rapporte distance, durée et provenance', () => {
    const r = parseOrsRoute(reponse)!;
    expect(r.distanceM).toBe(245_000);
    expect(r.durationS).toBe(9_600);
    expect(r.kind).toBe('road');
  });

  it('rend null plutôt qu’un tracé bancal', () => {
    expect(parseOrsRoute(null)).toBeNull();
    expect(parseOrsRoute({})).toBeNull();
    expect(parseOrsRoute({ routes: [] })).toBeNull();
    expect(parseOrsRoute({ routes: [{ geometry: '' }] })).toBeNull();
    // Sans résumé chiffré, impossible d'annoncer une durée ou un détour.
    expect(parseOrsRoute({ routes: [{ geometry: 'abcdef', summary: {} }] })).toBeNull();
  });
});

describe('straightLineRoute — le repli', () => {
  it('se déclare comme un trait droit, jamais comme une route', () => {
    // C'est ce qui permet à l'écran de le dire au joueur au lieu de faire
    // passer une droite pour un itinéraire.
    expect(straightLineRoute([PARIS, MARZY]).kind).toBe('straight');
  });

  it('encode ses points comme un vrai tracé', () => {
    const r = straightLineRoute([PARIS, MARZY]);
    const pts = decodePolyline(r.polyline);
    expect(pts).toHaveLength(2);
    expect(haversineMeters({ lat: pts[0][0], lng: pts[0][1] }, PARIS)).toBeLessThan(2);
  });

  it('additionne les segments quand il y a des étapes', () => {
    const etape = { lat: 47.9975, lng: 2.7369 };
    expect(straightLineRoute([PARIS, etape, MARZY]).distanceM)
      .toBeGreaterThanOrEqual(straightLineRoute([PARIS, MARZY]).distanceM);
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
        { geometry: { coordinates: [3.33, 46.56] }, properties: { name: 'Moulins', region: 'Allier', country: 'France' } },
        { geometry: { coordinates: [3.79, 49.44] }, properties: { name: 'Moulins', region: 'Aisne', country: 'France' } },
        { geometry: { coordinates: [-0.76, 46.88] }, properties: { name: 'Moulins', region: 'Deux-Sèvres', country: 'France' } },
      ],
    });
    expect(new Set(r.map((x) => x.label)).size).toBe(3);
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
    expect(r[0].label).toBe('Moulins, Allier, Auvergne-Rhône-Alpes');
    expect(r[0].lat).toBeCloseTo(46.5646, 3);
  });

  it('ne rend rien sur une réponse inattendue', () => {
    expect(parsePeliasResults(null)).toEqual([]);
    expect(parseNominatimResults({ error: 'nope' })).toEqual([]);
    expect(parseNominatimResults([{ lat: 'x', lon: 'y', display_name: 'z' }])).toEqual([]);
  });
});
