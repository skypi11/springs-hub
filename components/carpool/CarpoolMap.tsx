'use client';

import { useEffect, useRef, useState } from 'react';
import type * as LeafletNS from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPoint, RouteGeometry } from '@/lib/carpool';

// La carte.
//
// Leaflet nu, piloté à la main — pas d'enveloppe React. Même choix que pour la
// vue de tournoi : une bibliothèque impérative se conduit mieux depuis un effet
// que réenveloppée dans des composants qui se remontent à chaque rendu.
//
// LE FOND DE CARTE.
//
// Quatre tentatives. Les trois premières sont notées pour qu'on ne les refasse
// pas, la quatrième est celle qui tient :
//
// 1. CARTO sombre AVEC libellés — le seul fond sombre gratuit sans compte, mais
//    en anglais (« ISLAND OF FRANCE », « BURGUNDY-FREE COUNTY »).
// 2. CARTO sombre SANS libellés + une liste de villes à nous — règle la langue,
//    jamais le zoom : dès qu'on s'approche, les communes manquent.
// 3. OpenStreetMap France assombri par filtre — tous les noms français à tous
//    les zooms, mais un style dessiné pour un fond CLAIR : à l'échelle d'un
//    pays, ses centaines de libellés forment un mur de texte illisible.
//
// 4. Arbitrage de Matt : « utilise une belle et propre, même si elle est en
//    clair ». C'est Positron — la référence des fonds minimalistes : peu de
//    libellés, forte hiérarchie, aucun aplat criard. Le trajet et les points
//    sont alors les seuls éléments colorés de l'écran, ce qui est exactement la
//    règle de la charte.
//
// Nos couleurs sont donc calées pour un fond clair : le vert de marque
// s'assombrit pour rester lisible sur du gris pâle, et les étiquettes gardent
// leur pastille sombre — elle tranche aussi bien sur clair que sur sombre.

export interface MapTrip {
  uid: string;
  kind: 'offer' | 'search';
  origin: GeoPoint;
  waypoints: GeoPoint[];
  route: RouteGeometry | null;
  author: { displayName: string };
}

/** Le trajet en cours d'édition, affiché en direct pendant qu'on le compose. */
export interface MapDraft {
  origin: GeoPoint | null;
  waypoints: GeoPoint[];
  route: RouteGeometry | null;
  kind: 'offer' | 'search';
}

// Calées pour un fond CLAIR. L'or de la charte et son vert restent
// reconnaissables, simplement assez soutenus pour tenir sur du gris pâle : le
// #00D936 d'origine, très lumineux, s'évanouit sur du blanc.
const GOLD = '#E09400';
const GREEN = '#00A32A';
/** Une demande de place : sombre et creuse, l'inverse d'une offre. */
const NEUTRAL = '#1f1f24';

/** Pastille carrée à coins biseautés — la signature du site, pas la goutte
 *  d'eau générique des cartes en ligne. */
function pin(color: string, opts: { hollow?: boolean; big?: boolean } = {}): string {
  const size = opts.big ? 18 : 14;
  const fill = opts.hollow ? 'transparent' : color;
  return `<span style="
    display:block;width:${size}px;height:${size}px;
    background:${fill};border:2px solid ${color};
    box-shadow:0 0 0 2px rgba(255,255,255,.9), 0 1px 4px rgba(0,0,0,.35);
    clip-path:polygon(28% 0,100% 0,100% 72%,72% 100%,0 100%,0 28%);
  "></span>`;
}

export default function CarpoolMap({
  destination,
  trips,
  me,
  selectedUid,
  focus,
  draft,
  placing,
  onMapClick,
  onSelect,
}: {
  destination: GeoPoint & { address: string };
  trips: MapTrip[];
  me: string | null;
  selectedUid: string | null;
  /** Trajet sur lequel recadrer. Change uniquement sur un geste explicite
   *  depuis la liste — jamais au fil des sélections sur la carte, ce qui
   *  arracherait la vue des mains de qui la déplace. */
  focus: { uid: string; at: number } | null;
  draft: MapDraft | null;
  /** Quand vrai, un clic sur la carte pose un point au lieu de déselectionner. */
  placing: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onSelect: (uid: string | null) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const layerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);
  const fitted = useRef(false);
  /** Leaflet arrive en asynchrone. Sans ce drapeau, le premier dessin part
   *  avant que la carte existe et rien ne le relance : on obtenait un fond de
   *  carte parfait et pas un seul point dessus. */
  const [pret, setPret] = useState(false);

  // Les rappels changent d'identité à chaque rendu du parent. Les lire dans une
  // référence évite de désabonner/réabonner la carte en boucle — et évite
  // surtout d'avoir à museler la règle des dépendances, ce qui ferait sortir
  // tout le composant du compilateur React.
  const clickRef = useRef(onMapClick);
  const selectRef = useRef(onSelect);
  const placingRef = useRef(placing);
  clickRef.current = onMapClick;
  selectRef.current = onSelect;
  placingRef.current = placing;

  // ── Création de la carte, une seule fois ──────────────────────────────────
  useEffect(() => {
    let annule = false;
    const el = holder.current;
    if (!el) return;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (annule || !holder.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        // On ne dézoome pas au-delà : à ce niveau le fond entasse toute
        // l'Europe en un mur de texte illisible, et personne ne covoiture
        // depuis Zagreb pour une LAN dans la Nièvre.
        minZoom: 5,
      }).setView([destination.lat, destination.lng], 6);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      map.on('click', (e: LeafletNS.LeafletMouseEvent) => {
        if (placingRef.current) clickRef.current(e.latlng.lat, e.latlng.lng);
        else selectRef.current(null);
      });

      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setPret(true);
    })();

    return () => {
      annule = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      fitted.current = false;
      setPret(false);
    };
  }, [destination.lat, destination.lng]);

  // ── Redessin ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;

    layer.clearLayers();
    const bounds: [number, number][] = [[destination.lat, destination.lng]];

    // La salle : le seul point en or de la carte. Tout converge vers lui.
    L.marker([destination.lat, destination.lng], {
      icon: L.divIcon({ html: pin(GOLD, { big: true }), className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
      zIndexOffset: 1000,
    })
      .bindTooltip(destination.label, {
        permanent: true, direction: 'top', className: 'cp-etiquette cp-etiquette-salle',
        offset: [0, -6],
      })
      .addTo(layer);

    for (const t of trips) {
      const mine = t.uid === me;
      const actif = selectedUid === null || selectedUid === t.uid;
      const couleur = t.kind === 'offer' ? GREEN : NEUTRAL;

      if (t.route && t.route.coordinates.length > 1) {
        L.polyline(t.route.coordinates, {
          color: couleur,
          weight: mine ? 4 : 3,
          // Les trajets non retenus s'effacent sans disparaître : on garde le
          // contexte général tout en isolant celui qu'on regarde.
          opacity: actif ? (mine ? 0.95 : 0.6) : 0.12,
          dashArray: t.route.kind === 'straight' ? '6 6' : undefined,
          // Une ligne fine est difficile à viser : on élargit la zone de clic
          // sans épaissir le trait.
          bubblingMouseEvents: false,
        })
          .on('click', () => selectRef.current(t.uid))
          .on('mouseover', (e: LeafletNS.LeafletMouseEvent) => e.target.setStyle({ weight: 6 }))
          .on('mouseout', (e: LeafletNS.LeafletMouseEvent) => e.target.setStyle({ weight: mine ? 4 : 3 }))
          .addTo(layer);
        for (const c of t.route.coordinates) bounds.push(c);
      }

      L.marker([t.origin.lat, t.origin.lng], {
        // Pastille creuse pour une demande : rien à offrir, une place à prendre.
        icon: L.divIcon({
          html: pin(couleur, { hollow: t.kind === 'search', big: mine }),
          className: '',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        opacity: actif ? 1 : 0.25,
      })
        // Permanente : c'est le pseudo qui identifie quelqu'un, pas sa
        // position. Sans lui, la carte n'est qu'un semis de points.
        // Le pseudo SEUL. La ville figurait à côté : elle doublonnait le fond
        // de carte et encombrait l'affichage dès que deux points se touchaient.
        .bindTooltip(t.author.displayName, {
          permanent: true, direction: 'top', offset: [0, -6],
          className: `cp-etiquette ${t.kind === 'offer' ? 'cp-etiquette-offre' : 'cp-etiquette-demande'}${actif ? '' : ' cp-etiquette-eteinte'}`,
        })
        .on('click', (e: LeafletNS.LeafletMouseEvent) => {
          e.originalEvent.stopPropagation();
          selectRef.current(t.uid);
        })
        .addTo(layer);
      bounds.push([t.origin.lat, t.origin.lng]);

      for (const w of t.waypoints) {
        L.circleMarker([w.lat, w.lng], {
          radius: 4, color: couleur, weight: 2, fillOpacity: 0.9,
          opacity: actif ? 0.9 : 0.2, fillColor: '#0a0a0a',
        })
          .bindTooltip(w.label || 'Étape', { direction: 'top' })
          .addTo(layer);
      }
    }

    // Le brouillon, par-dessus tout le reste : c'est ce que la personne est en
    // train de composer, elle doit le voir même au milieu des autres.
    if (draft?.origin) {
      if (draft.route && draft.route.coordinates.length > 1) {
        L.polyline(draft.route.coordinates, { color: GOLD, weight: 4, opacity: 0.9 }).addTo(layer);
      }
      L.marker([draft.origin.lat, draft.origin.lng], {
        icon: L.divIcon({
          html: pin(GOLD, { hollow: draft.kind === 'search', big: true }),
          className: '', iconSize: [18, 18], iconAnchor: [9, 9],
        }),
        zIndexOffset: 900,
      })
        .bindTooltip('Toi', {
          permanent: true, direction: 'top', offset: [0, -8],
          className: 'cp-etiquette cp-etiquette-salle',
        })
        .addTo(layer);
      bounds.push([draft.origin.lat, draft.origin.lng]);
      for (const w of draft.waypoints) {
        L.circleMarker([w.lat, w.lng], { radius: 5, color: GOLD, weight: 2, fillColor: '#0a0a0a', fillOpacity: 1 })
          .bindTooltip(w.label || 'Étape', { direction: 'top' })
          .addTo(layer);
        bounds.push([w.lat, w.lng]);
      }
    }

    // Cadrage une seule fois : recadrer à chaque changement arracherait la
    // carte des mains de quelqu'un en train de la déplacer.
    if (!fitted.current && bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9 });
      fitted.current = true;
    }
  }, [pret, trips, me, selectedUid, draft, destination]);

  // ── Recadrage à la demande ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const t = trips.find((x) => x.uid === focus.uid);
    if (!t) return;
    const points: [number, number][] = t.route?.coordinates?.length
      ? t.route.coordinates
      : [[t.origin.lat, t.origin.lng], [destination.lat, destination.lng]];
    map.fitBounds(points, { padding: [50, 50] });
  }, [focus, trips, destination]);

  return (
    <>
      <div
        ref={holder}
        className="bevel h-full w-full"
        style={{
          border: '1px solid var(--s-border)',
          cursor: placing ? 'crosshair' : undefined,
          minHeight: 320,
        }}
        aria-label="Carte des trajets"
      />
      <style jsx global>{`
        /* Leaflet peint un fond gris clair sous les tuiles : il transparaît au
           chargement et pendant un déplacement rapide, en plein milieu d'un
           site noir. */
        .leaflet-container {
          background: #e8e8ec;
          font-family: inherit;
        }
        .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.78) !important;
          color: #5a5a68 !important;
          font-size: 10px;
        }
        .leaflet-control-attribution a { color: #3a3a48 !important; }
        /* Les commandes gardent l'habillage du site : sombres et biseautées,
           elles signent la carte comme une carte d'Aedral et non un widget. */
        .leaflet-bar a {
          background: var(--s-surface) !important;
          color: var(--s-text) !important;
          border-color: rgba(0, 0, 0, 0.15) !important;
        }
        .leaflet-bar a:hover { background: var(--s-elevated) !important; }
        .leaflet-tooltip {
          background: var(--s-surface);
          border: 1px solid rgba(0, 0, 0, 0.18);
          color: var(--s-text);
          box-shadow: none;
          font-size: 12px;
        }
        .leaflet-tooltip::before { display: none; }

        /* Nos étiquettes : posées sur la carte, elles doivent rester lisibles
           sur n'importe quel fond sans faire un pavé opaque. */
        .cp-etiquette {
          background: rgba(12, 12, 16, 0.88);
          border: none;
          padding: 1px 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          white-space: nowrap;
          box-shadow: none;
        }
        .cp-etiquette-salle {
          color: #FFB800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .cp-etiquette-offre { color: #3BE86A; }
        .cp-etiquette-demande { color: #eaeaf0; }
        /* Un trajet mis de côté s'efface avec son point plutôt que de
           continuer à crier son nom par-dessus celui qu'on regarde. */
        .cp-etiquette-eteinte { opacity: 0.25; }

      `}</style>
    </>
  );
}
