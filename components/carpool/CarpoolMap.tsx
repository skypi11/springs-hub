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
// Fond sombre ET SANS LIBELLÉS. Deux raisons :
//
// · une carte OpenStreetMap classique poserait un rectangle blanc et bleu au
//   milieu d'un site noir et or ;
// · les fonds sombres gratuits n'existent qu'en anglais, et « ISLAND OF
//   FRANCE » ou « BURGUNDY-FREE COUNTY » au milieu d'un site français, ça se
//   voit. Plutôt que de subir une traduction approximative, on retire les
//   libellés du fond et on pose LES NÔTRES : le pseudo sur chaque point, « LA
//   LAN » sur la salle. Tout ce qui est écrit sur cette carte est donc écrit
//   par nous, en français.
//
// Le relief, les côtes et les frontières suffisent à se situer ; ce qu'on
// cherche ici n'est pas un nom de ville mais QUI est sur sa route.

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

const GOLD = '#FFB800';
const GREEN = '#00D936';
const NEUTRAL = '#eaeaf0';

/** Pastille carrée à coins biseautés — la signature du site, pas la goutte
 *  d'eau générique des cartes en ligne. */
function pin(color: string, opts: { hollow?: boolean; big?: boolean } = {}): string {
  const size = opts.big ? 18 : 14;
  const fill = opts.hollow ? 'transparent' : color;
  return `<span style="
    display:block;width:${size}px;height:${size}px;
    background:${fill};border:2px solid ${color};
    box-shadow:0 0 0 3px rgba(0,0,0,.55), 0 0 12px ${color}55;
    clip-path:polygon(28% 0,100% 0,100% 72%,72% 100%,0 100%,0 28%);
  "></span>`;
}

export default function CarpoolMap({
  destination,
  trips,
  me,
  selectedUid,
  draft,
  placing,
  onMapClick,
  onSelect,
}: {
  destination: GeoPoint & { address: string };
  trips: MapTrip[];
  me: string | null;
  selectedUid: string | null;
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

      const map = L.map(el, { zoomControl: true, attributionControl: true })
        .setView([destination.lat, destination.lng], 6);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
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
      .bindTooltip('LA LAN', {
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
        }).addTo(layer);
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
          background: #0a0a0a;
          font-family: inherit;
        }
        .leaflet-control-attribution {
          background: rgba(10, 10, 10, 0.75) !important;
          color: var(--s-text-muted) !important;
          font-size: 10px;
        }
        .leaflet-control-attribution a { color: var(--s-text-dim) !important; }
        .leaflet-bar a {
          background: var(--s-surface) !important;
          color: var(--s-text) !important;
          border-color: rgba(255, 255, 255, 0.12) !important;
        }
        .leaflet-bar a:hover { background: var(--s-elevated) !important; }
        .leaflet-tooltip {
          background: var(--s-surface);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: var(--s-text);
          box-shadow: none;
          font-size: 12px;
        }
        .leaflet-tooltip::before { display: none; }

        /* Nos étiquettes : posées sur la carte, elles doivent rester lisibles
           sur n'importe quel fond sans faire un pavé opaque. */
        .cp-etiquette {
          background: rgba(10, 10, 10, 0.82);
          border: none;
          padding: 1px 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          white-space: nowrap;
          box-shadow: none;
        }
        .cp-etiquette-salle { color: #FFB800; }
        .cp-etiquette-offre { color: #00D936; }
        .cp-etiquette-demande { color: #eaeaf0; }
        /* Un trajet mis de côté s'efface avec son point plutôt que de
           continuer à crier son nom par-dessus celui qu'on regarde. */
        .cp-etiquette-eteinte { opacity: 0.25; }
      `}</style>
    </>
  );
}
