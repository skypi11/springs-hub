'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Loader2, MapPin, Trash2, UserSearch } from 'lucide-react';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import CopyHandle from '@/components/ui/CopyHandle';
import { getProfileHref } from '@/lib/user-slug';
import TripEditor, { EMPTY_DRAFT, type Draft } from '@/components/carpool/TripEditor';
import {
  formatDistance, formatDuration, seekersNearRoute,
  type CarpoolEvent, type GeoPoint, type RouteGeometry, type TripKind,
} from '@/lib/carpool';

// Le covoiturage de la Mania Cup.
//
// Chacun pose son point s'il en a envie, l'itinéraire jusqu'à la salle se
// trace tout seul, et personne ne peut toucher au trajet d'un autre — c'est
// exactement ce qu'une carte partagée ne sait pas garantir.
//
// Un visiteur qui n'est pas inscrit voit le NOMBRE de trajets posés, et rien
// d'autre : ni position, ni pseudo. C'est ce qui permet d'en faire un argument
// d'inscription sans rien divulguer de personne.

const EVENT_ID = 'mania-cup';

const CarpoolMap = dynamic(() => import('@/components/carpool/CarpoolMap'), {
  ssr: false,
  loading: () => (
    <div className="bevel flex h-full w-full items-center justify-center" style={{ border: '1px solid var(--s-border)', minHeight: 320 }}>
      <Loader2 className="animate-spin" size={20} style={{ color: 'var(--s-text-dim)' }} />
    </div>
  ),
});

interface Trip {
  uid: string;
  kind: TripKind;
  origin: GeoPoint;
  waypoints: GeoPoint[];
  route: RouteGeometry | null;
  seats: number;
  departAt: string | null;
  returnAt: string | null;
  note: string;
  author: { uid: string; displayName: string; slug: string | null; discordUsername: string | null };
}

interface Payload {
  allowed: boolean;
  authenticated: boolean;
  event: CarpoolEvent;
  count: number;
  me?: string;
  trips?: Trip[];
  routing?: 'road' | 'straight';
}

/** « samedi 3 oct. à 08:00 » — la date brute est illisible dans une liste. */
function quand(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function CovoituragePage() {
  const { isAdmin, firebaseUser, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [placing, setPlacing] = useState<null | 'origin' | 'waypoint'>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // La requête attend que Firebase ait tranché.
  //
  // Sans ça, quelqu'un qui arrive directement sur cette adresse part avant que
  // sa session soit établie : le serveur le voit anonyme, lui renvoie le mur
  // « réservé aux inscrits », et react-query garde cette réponse en cache — un
  // inscrit se retrouve devant une porte fermée. L'uid entre dans la clé pour
  // que la réponse d'un compte ne soit jamais resservie à un autre.
  const { data, isLoading } = useQuery({
    queryKey: ['carpool', EVENT_ID, firebaseUser?.uid ?? 'anonyme'] as const,
    queryFn: () => apiPublic<Payload>(`/api/carpool/${EVENT_ID}`),
    enabled: !authLoading,
  });

  const trips = useMemo(() => data?.trips ?? [], [data]);
  const mine = useMemo(() => trips.find((t) => t.uid === data?.me) ?? null, [trips, data?.me]);

  /** Ouvrir l'éditeur reprend le trajet existant : on corrige un point, on ne
   *  recommence pas de zéro. Semé ICI, dans le geste qui ouvre — un effet qui
   *  appelle setState en cascade est précisément ce que le compilateur React
   *  refuse, et le museler éteindrait toutes les règles du fichier. */
  function ouvrirEditeur() {
    setDraft(mine
      ? {
          kind: mine.kind, origin: mine.origin, waypoints: mine.waypoints, seats: mine.seats,
          departAt: mine.departAt ?? '', returnAt: mine.returnAt ?? '', note: mine.note,
        }
      : EMPTY_DRAFT);
    setEditing(true);
  }

  // L'itinéraire du brouillon, recalculé au serveur à chaque changement de
  // point ou d'étape. C'est lui qui affiche le coût d'un détour AVANT que le
  // conducteur valide.
  //
  // Confié à react-query plutôt qu'à un effet : l'état de chargement et
  // l'annulation viennent gratuitement, et une géométrie déjà calculée n'est
  // pas redemandée — quelqu'un qui ajoute puis retire une étape ne consomme
  // pas deux fois le quota du calculateur.
  const cle = draft.origin
    ? JSON.stringify([draft.origin.lat, draft.origin.lng, draft.waypoints.map((w) => [w.lat, w.lng])])
    : '';
  const previewQuery = useQuery({
    queryKey: ['carpool', EVENT_ID, 'preview', cle] as const,
    queryFn: () => api<{ route: RouteGeometry; direct: RouteGeometry | null }>(
      `/api/carpool/${EVENT_ID}/preview`,
      { method: 'POST', body: { origin: draft.origin, waypoints: draft.waypoints, seats: 1 } },
    ),
    enabled: editing && draft.kind === 'offer' && Boolean(draft.origin),
    // Une même géométrie donne toujours le même itinéraire.
    staleTime: Infinity,
    retry: false,
  });
  const preview = previewQuery.data ?? null;
  const previewing = previewQuery.isFetching;

  function onMapClick(lat: number, lng: number) {
    if (placing === 'origin') setDraft({ ...draft, origin: { lat, lng, label: '' } });
    else if (placing === 'waypoint') setDraft({ ...draft, waypoints: [...draft.waypoints, { lat, lng, label: '' }] });
    setPlacing(null);
  }

  async function supprimer(uid: string) {
    await api(`/api/carpool/${EVENT_ID}?uid=${encodeURIComponent(uid)}`, { method: 'DELETE' });
    void qc.invalidateQueries({ queryKey: ['carpool', EVENT_ID] });
  }

  function recharger() {
    setEditing(false);
    setDraft(EMPTY_DRAFT);
    void qc.invalidateQueries({ queryKey: ['carpool', EVENT_ID] });
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center gap-3 py-16" style={{ color: 'var(--s-text-dim)' }}>
        <Loader2 className="animate-spin" size={20} /> Chargement de la carte…
      </div>
    );
  }

  const ev = data?.event;
  if (!ev) return null;

  // ── Porte fermée ──────────────────────────────────────────────────────────
  if (!data.allowed) {
    return (
      <div className="py-10">
        <h1 className="font-display text-4xl">Covoiturage</h1>
        <p className="mt-3 max-w-2xl" style={{ color: 'var(--s-text-dim)' }}>
          Les joueurs inscrits posent leur point de départ sur une carte, et l’itinéraire
          jusqu’à la salle se trace tout seul. On voit d’un coup d’œil qui passe par où.
        </p>
        <div className="mt-8 border-y border-white/10 py-6">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-4xl">{data.count}</span>
            <span style={{ color: 'var(--s-text-dim)' }}>
              trajet{data.count > 1 ? 's' : ''} déjà posé{data.count > 1 ? 's' : ''}
            </span>
          </div>
          <p className="mt-3 text-sm" style={{ color: 'var(--s-text-muted)' }}>
            La carte est réservée aux inscrits — personne d’autre ne voit les positions.
          </p>
        </div>
        <Link href="/mania-cup/inscription" className="btn-springs btn-primary bevel-sm mt-8 inline-flex">
          {data.authenticated ? 'M’inscrire à la LAN' : 'Me connecter et m’inscrire'}
        </Link>
      </div>
    );
  }

  const offres = trips.filter((t) => t.kind === 'offer');
  const demandes = trips.filter((t) => t.kind === 'search');
  const selectedTrip = trips.find((t) => t.uid === selected) ?? null;

  // Les demandes qui longent l'itinéraire sélectionné. C'est le calcul qui rend
  // la carte utile plutôt que jolie — et il est purement local.
  const surLaRoute = selectedTrip?.kind === 'offer' && selectedTrip.route
    ? seekersNearRoute(demandes, selectedTrip.route.coordinates)
    : [];

  return (
    <div className="space-y-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Covoiturage</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {offres.length} trajet{offres.length > 1 ? 's' : ''} proposé{offres.length > 1 ? 's' : ''} ·{' '}
            {demandes.length} joueur{demandes.length > 1 ? 's' : ''} en recherche
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={ouvrirEditeur}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
          >
            <MapPin size={15} aria-hidden />
            {mine ? 'Modifier mon trajet' : 'Poser mon trajet'}
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="h-[420px] lg:h-[620px]">
          <CarpoolMap
            destination={ev.destination}
            trips={trips}
            me={data.me ?? null}
            selectedUid={selected}
            draft={editing ? { origin: draft.origin, waypoints: draft.waypoints, route: preview?.route ?? null, kind: draft.kind } : null}
            placing={placing !== null}
            onMapClick={onMapClick}
            onSelect={setSelected}
          />
        </div>

        <div className="space-y-4">
          {editing ? (
            <section className="panel bevel p-4">
              <div className="flex items-center justify-between">
                <h2 className="t-sub">Mon trajet</h2>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setDraft(EMPTY_DRAFT); setPlacing(null); }}
                  className="text-xs underline"
                  style={{ color: 'var(--s-text-dim)' }}
                >
                  Annuler
                </button>
              </div>
              <div className="mt-4">
                <TripEditor
                  event={ev}
                  draft={draft}
                  setDraft={setDraft}
                  placing={placing}
                  setPlacing={setPlacing}
                  preview={preview}
                  previewing={previewing}
                  hasTrip={Boolean(mine)}
                  onSaved={recharger}
                  onDeleted={recharger}
                />
              </div>
            </section>
          ) : (
            <>
              {trips.length === 0 && (
                <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                  Personne n’a encore posé de trajet. Le premier point donne le ton.
                </p>
              )}

              {selectedTrip && surLaRoute.length > 0 && (
                <section
                  className="bevel border p-3"
                  style={{ borderColor: 'rgba(255,184,0,0.35)', background: 'rgba(255,184,0,0.06)' }}
                >
                  <h2 className="t-label" style={{ color: 'var(--s-gold)' }}>Sur cet itinéraire</h2>
                  <ul className="mt-2 space-y-1 text-sm">
                    {surLaRoute.map(({ seeker, meters }) => (
                      <li key={seeker.uid}>
                        {seeker.author.displayName}
                        <span style={{ color: 'var(--s-text-dim)' }}> — à {formatDistance(meters)} de la route</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {[['Propose des places', offres, Car] as const, ['Cherche une place', demandes, UserSearch] as const]
                .filter(([, liste]) => liste.length > 0)
                .map(([titre, liste, Icone]) => (
                  <section key={titre}>
                    <h2 className="t-label flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
                      <Icone size={13} aria-hidden /> {titre}
                    </h2>
                    <ul className="mt-2 divide-y" style={{ borderColor: 'var(--s-border)' }}>
                      {liste.map((t) => (
                        <li
                          key={t.uid}
                          className="cursor-pointer py-3 transition-colors"
                          onClick={() => setSelected(selected === t.uid ? null : t.uid)}
                          style={{ background: selected === t.uid ? 'rgba(255,255,255,0.03)' : undefined }}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <Link
                              href={getProfileHref({ slug: t.author.slug, uid: t.author.uid })}
                              target="_blank"
                              onClick={(e) => e.stopPropagation()}
                              className="font-semibold hover:underline"
                            >
                              {t.author.displayName}
                            </Link>
                            {t.uid === data.me && <span className="tag tag-neutral">toi</span>}
                            <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              {t.seats} place{t.seats > 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                            {t.origin.label || 'Point sur la carte'}
                            {t.route && ` · ${formatDistance(t.route.distanceM)} · ${formatDuration(t.route.durationS)}`}
                          </div>
                          {(t.departAt || t.returnAt) && (
                            <div className="mt-0.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              {quand(t.departAt) && `Départ ${quand(t.departAt)}`}
                              {t.departAt && t.returnAt && ' · '}
                              {quand(t.returnAt) && `retour ${quand(t.returnAt)}`}
                            </div>
                          )}
                          {t.waypoints.length > 0 && (
                            <div className="mt-0.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                              via {t.waypoints.map((w) => w.label || 'un point').join(', ')}
                            </div>
                          )}
                          {t.note && <p className="mt-1 text-sm">{t.note}</p>}
                          <div className="mt-1.5 flex items-center gap-3">
                            {t.author.discordUsername
                              ? <CopyHandle handle={t.author.discordUsername} />
                              : <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Discord inconnu</span>}
                            {isAdmin && t.uid !== data.me && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void supprimer(t.uid); }}
                                className="inline-flex items-center gap-1 text-xs underline"
                                style={{ color: 'var(--s-text-muted)' }}
                              >
                                <Trash2 size={11} aria-hidden /> Retirer
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </>
          )}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Springs E-Sport met en relation et n’organise pas le transport. Les trajets
        sont visibles des seuls joueurs inscrits, et effacés après l’événement.
      </p>
    </div>
  );
}
