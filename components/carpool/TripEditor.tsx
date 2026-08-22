'use client';

import { useRef, useState } from 'react';
import { Loader2, MapPin, Plus, Search, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import {
  CARPOOL_LIMITS, formatDetour, formatDistance, formatDuration,
  type CarpoolEvent, type GeoPoint, type RouteGeometry, type TripKind,
} from '@/lib/carpool';

// Le formulaire d'un trajet.
//
// Deux populations, deux formulaires : celui qui PROPOSE des places compose un
// itinéraire (départ, étapes) ; celui qui en CHERCHE pose un point et c'est
// tout. Afficher des étapes à quelqu'un qui n'a pas de voiture n'aurait aucun
// sens — c'est pour ça que les champs se replient selon le choix.
//
// La saisie par NOM est l'entrée principale, pas le clic sur la carte : sur un
// téléphone, taper « Moulins » est infiniment plus simple que viser une ville
// au doigt. Le clic reste offert pour ceux qui veulent un point précis.

export interface Draft {
  kind: TripKind;
  origin: GeoPoint | null;
  waypoints: GeoPoint[];
  seats: number;
  departAt: string;
  returnAt: string;
  note: string;
}

export const EMPTY_DRAFT: Draft = {
  kind: 'offer', origin: null, waypoints: [], seats: 3, departAt: '', returnAt: '', note: '',
};

/**
 * Champ de recherche d'une commune.
 *
 * Débouncé DANS le gestionnaire de saisie, pas dans un effet : appeler
 * setState au corps d'un effet fait sortir tout le composant du compilateur
 * React, et le museler éteindrait les règles du fichier entier.
 *
 * La requête elle-même passe par react-query — annulation, état de chargement
 * et mise en cache des mêmes recherches viennent avec, et on ne martèle pas un
 * géocodeur public.
 */
function PlaceSearch({
  eventId, placeholder, onPick,
}: {
  eventId: string;
  placeholder: string;
  onPick: (p: GeoPoint) => void;
}) {
  const [q, setQ] = useState('');
  const [terme, setTerme] = useState('');
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  function saisir(valeur: string) {
    setQ(valeur);
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setTerme(valeur.trim()), 400);
  }

  function vider() {
    if (minuteur.current) clearTimeout(minuteur.current);
    setQ('');
    setTerme('');
  }

  const { data, isFetching } = useQuery({
    queryKey: ['carpool', eventId, 'places', terme] as const,
    queryFn: () => api<{ places: { label: string; lat: number; lng: number }[] }>(
      `/api/carpool/${eventId}/places?q=${encodeURIComponent(terme)}`,
    ),
    enabled: terme.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const results = terme.length >= 2 ? (data?.places ?? []) : [];

  return (
    <div className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        style={{ color: 'var(--s-text-muted)' }}
        aria-hidden
      />
      <input
        value={q}
        onChange={(e) => saisir(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="settings-input has-icon w-full"
      />
      {isFetching && (
        <Loader2
          size={14}
          className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin"
          style={{ color: 'var(--s-text-muted)' }}
          aria-hidden
        />
      )}
      {results.length > 0 && (
        <ul
          className="absolute z-[500] mt-1 max-h-56 w-full overflow-auto border"
          style={{ background: 'var(--s-surface)', borderColor: 'rgba(255,255,255,0.14)' }}
        >
          {results.map((r) => (
            <li key={`${r.lat},${r.lng},${r.label}`}>
              <button
                type="button"
                onClick={() => { onPick({ lat: r.lat, lng: r.lng, label: r.label }); vider(); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-white/10"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TripEditor({
  event,
  draft,
  setDraft,
  placing,
  setPlacing,
  preview,
  previewing,
  hasTrip,
  onSaved,
  onDeleted,
}: {
  event: CarpoolEvent;
  draft: Draft;
  setDraft: (d: Draft) => void;
  placing: null | 'origin' | 'waypoint';
  setPlacing: (p: null | 'origin' | 'waypoint') => void;
  preview: { route: RouteGeometry | null; direct: RouteGeometry | null } | null;
  previewing: boolean;
  hasTrip: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offre = draft.kind === 'offer';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/carpool/${event.id}`, {
        method: 'PUT',
        body: {
          kind: draft.kind,
          origin: draft.origin,
          waypoints: draft.waypoints,
          seats: draft.seats,
          departAt: draft.departAt || null,
          returnAt: draft.returnAt || null,
          note: draft.note,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement refusé');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/carpool/${event.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Retrait refusé');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Ce qu'on vient faire ici. Le choix commande tout le reste du
          formulaire, il vient donc en premier. */}
      <div className="grid grid-cols-2 gap-2">
        {([['offer', 'Je propose des places'], ['search', 'Je cherche une place']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setDraft({ ...draft, kind: k })}
            className="bevel-sm border px-3 py-2 text-sm transition-colors"
            style={draft.kind === k
              ? { borderColor: '#00D936', color: 'var(--s-text)', background: 'rgba(0,217,54,0.08)' }
              : { borderColor: 'var(--s-border)', color: 'var(--s-text-dim)' }}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <div className="t-label" style={{ color: 'var(--s-text-muted)' }}>
          {offre ? 'D’où tu pars' : 'Où tu te trouves'}
        </div>
        <div className="mt-1.5 space-y-2">
          <PlaceSearch
            eventId={event.id}
            placeholder="Ta ville, ou un point de rendez-vous…"
            onPick={(p) => { setDraft({ ...draft, origin: p }); setPlacing(null); }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPlacing(placing === 'origin' ? null : 'origin')}
              className="bevel-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs"
              style={placing === 'origin'
                ? { borderColor: '#FFB800', color: '#FFB800' }
                : { borderColor: 'var(--s-border)', color: 'var(--s-text-dim)' }}
            >
              <MapPin size={12} aria-hidden />
              {placing === 'origin' ? 'Clique sur la carte…' : 'Placer sur la carte'}
            </button>
            {draft.origin && (
              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                {draft.origin.label || 'Point posé sur la carte'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Les étapes n'existent que pour un conducteur : sans voiture, il n'y a
          pas d'itinéraire à infléchir. */}
      {offre && (
        <div>
          <div className="t-label" style={{ color: 'var(--s-text-muted)' }}>
            Étapes <span style={{ textTransform: 'none' }}>— pour prendre quelqu’un en chemin</span>
          </div>
          <div className="mt-1.5 space-y-2">
            {draft.waypoints.map((w, i) => (
              <div key={`${w.lat},${w.lng},${i}`} className="flex items-center gap-2 text-sm">
                <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{w.label || 'Point sur la carte'}</span>
                <button
                  type="button"
                  aria-label={`Retirer l’étape ${i + 1}`}
                  onClick={() => setDraft({ ...draft, waypoints: draft.waypoints.filter((_, j) => j !== i) })}
                  className="shrink-0 p-1 hover:text-white"
                  style={{ color: 'var(--s-text-muted)' }}
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
            {draft.waypoints.length < CARPOOL_LIMITS.maxWaypoints ? (
              <>
                <PlaceSearch
                  eventId={event.id}
                  placeholder="Ajouter une étape…"
                  onPick={(p) => { setDraft({ ...draft, waypoints: [...draft.waypoints, p] }); setPlacing(null); }}
                />
                <button
                  type="button"
                  onClick={() => setPlacing(placing === 'waypoint' ? null : 'waypoint')}
                  className="bevel-sm inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs"
                  style={placing === 'waypoint'
                    ? { borderColor: '#FFB800', color: '#FFB800' }
                    : { borderColor: 'var(--s-border)', color: 'var(--s-text-dim)' }}
                >
                  <Plus size={12} aria-hidden />
                  {placing === 'waypoint' ? 'Clique sur la carte…' : 'Placer une étape sur la carte'}
                </button>
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Quatre étapes au maximum.
              </p>
            )}
          </div>
        </div>
      )}

      {/* L'itinéraire calculé, et ce que coûtent les étapes. C'est cette ligne
          qui décide si on prend quelqu'un ou pas. */}
      {offre && draft.origin && (
        <div
          className="bevel-sm border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--s-border)', background: 'rgba(255,255,255,0.02)' }}
        >
          {previewing ? (
            <span className="inline-flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
              <Loader2 size={13} className="animate-spin" aria-hidden /> Calcul de l’itinéraire…
            </span>
          ) : preview?.route ? (
            <>
              <span>
                {formatDistance(preview.route.distanceM)} · {formatDuration(preview.route.durationS)}
              </span>
              {preview.direct && (
                <span className="ml-2" style={{ color: 'var(--s-gold)' }}>
                  {formatDetour(preview.direct.durationS, preview.route.durationS)}
                </span>
              )}
              {preview.route.kind === 'straight' && (
                <div className="mt-1 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Tracé à vol d’oiseau : le calcul routier n’a pas répondu.
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--s-text-muted)' }}>Pose ton départ pour voir l’itinéraire.</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>
            {offre ? 'Places libres' : 'Places cherchées'}
          </span>
          <input
            type="number"
            min={1}
            max={CARPOOL_LIMITS.maxSeats}
            value={draft.seats}
            onChange={(e) => setDraft({ ...draft, seats: Number(e.target.value) })}
            className="settings-input mt-1 w-full"
          />
        </label>
        <div />
        <label className="block">
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Départ</span>
          <input
            type="datetime-local"
            value={draft.departAt}
            min={event.window.from}
            max={event.window.to}
            onChange={(e) => setDraft({ ...draft, departAt: e.target.value })}
            className="settings-input mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Retour</span>
          <input
            type="datetime-local"
            value={draft.returnAt}
            min={event.window.from}
            max={event.window.to}
            onChange={(e) => setDraft({ ...draft, returnAt: e.target.value })}
            className="settings-input mt-1 w-full"
          />
        </label>
      </div>

      <label className="block">
        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Précision</span>
        <textarea
          rows={3}
          maxLength={CARPOOL_LIMITS.maxNote}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          placeholder="Participation à l’essence, place pour un setup, horaire souple…"
          className="settings-input mt-1 w-full"
        />
      </label>

      {error && (
        <p className="border px-3 py-2 text-sm" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#ff9b9b' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !draft.origin}
          className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2 disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {hasTrip ? 'Enregistrer les modifications' : 'Poser mon trajet'}
        </button>
        {hasTrip && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs underline disabled:opacity-40"
            style={{ color: 'var(--s-text-dim)' }}
          >
            <Trash2 size={13} aria-hidden /> Retirer mon trajet de la carte
          </button>
        )}
      </div>
    </div>
  );
}
