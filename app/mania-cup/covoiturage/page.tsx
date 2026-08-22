'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Crosshair, Loader2, MapPin, Trash2, UserSearch } from 'lucide-react';
import { api, apiPublic } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import CopyHandle from '@/components/ui/CopyHandle';
import { getProfileHref } from '@/lib/user-slug';
import TripEditor, { EMPTY_DRAFT, type Draft } from '@/components/carpool/TripEditor';
import {
  decodePolyline, formatDistance, formatDuration, seekersNearRoute,
  type CarpoolEvent, type GeoPoint, type RouteGeometry, type TripKind,
} from '@/lib/carpool';

// Le covoiturage de la Mania Cup.
//
// Chacun pose son point s'il en a envie, l'itinéraire jusqu'à la salle se trace
// tout seul, et personne ne peut toucher au trajet d'un autre.
//
// La page a deux visages, et c'est délibéré : en CONSULTATION la carte prend
// toute la largeur et les trajets se lisent dessous — c'est la carte qu'on
// vient voir. En ÉDITION le formulaire se range à côté d'elle, parce qu'on pose
// un point sur la carte tout en remplissant ses champs, et qu'un formulaire qui
// oblige à faire défiler entre chaque geste est inutilisable.
//
// Un visiteur qui n'est pas inscrit voit le NOMBRE de trajets posés, et rien
// d'autre : ni position, ni pseudo.

const EVENT_ID = 'mania-cup';

const CarpoolMap = dynamic(() => import('@/components/carpool/CarpoolMap'), {
  ssr: false,
  loading: () => (
    <div className="bevel flex h-full w-full items-center justify-center" style={{ border: '1px solid var(--s-border)' }}>
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

/** Une pastille de légende, dessinée comme celles de la carte. */
function Pastille({ couleur, creuse }: { couleur: string; creuse?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: 11, height: 11,
        background: creuse ? 'transparent' : couleur,
        border: `2px solid ${couleur}`,
        clipPath: 'polygon(28% 0,100% 0,100% 72%,72% 100%,0 100%,0 28%)',
      }}
    />
  );
}

/**
 * La légende.
 *
 * Elle porte sa part du travail depuis que le fond de carte est muet : c'est
 * elle qui dit ce que veut dire une pastille pleine, une pastille creuse, et un
 * trait en pointillés.
 */
function Legende({ evenement, routier }: { evenement: string; routier: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ color: 'var(--s-text-dim)' }}>
      <li className="flex items-center gap-1.5"><Pastille couleur="#FFB800" /> {evenement}</li>
      <li className="flex items-center gap-1.5"><Pastille couleur="#00D936" /> Propose des places</li>
      <li className="flex items-center gap-1.5"><Pastille couleur="#eaeaf0" creuse /> Cherche une place</li>
      {/* Une durée calculée sur le réseau routier ignore le trafic, les pauses
          et les péages. Google et Waze calculent aussi — mais eux mesurent la
          vitesse réelle de millions de téléphones. Le dire évite qu'on cale un
          rendez-vous à la minute sur une estimation théorique. */}
      <li style={{ color: 'var(--s-text-muted)' }}>Durées estimées sans trafic</li>
      {!routier && (
        <li className="flex items-center gap-1.5">
          <span aria-hidden style={{ display: 'inline-block', width: 18, borderTop: '2px dashed var(--s-text-muted)' }} />
          Tracé à vol d’oiseau
        </li>
      )}
    </ul>
  );
}

/**
 * Le conteneur des pages de la LAN.
 *
 * Toutes les autres — présentation, inscrits, FAQ, règlement, spectateurs —
 * centrent leur contenu. `max-w-6xl` est la largeur que la présentation emploie
 * déjà pour ses blocs les plus larges.
 */
function Conteneur({ children }: { children: React.ReactNode }) {
  return (
    <main className="text-[#eaeaf0]">
      <div className="mx-auto max-w-6xl px-6 py-14">{children}</div>
    </main>
  );
}

/** « samedi 3 oct., 08:00 » — la date brute est illisible dans une liste. */
function quand(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** « Toulon, Var, France » → « Toulon ». */
function ville(label: string): string {
  return label.split(',')[0].trim() || 'Point sur la carte';
}

export default function CovoituragePage() {
  const { isAdmin, isCompetitionAdmin, firebaseUser, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [placing, setPlacing] = useState<null | 'origin' | 'waypoint'>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Un compteur plutôt qu'un horodatage : recadrer deux fois de suite sur le
  // même trajet doit refonctionner, et rien ici n'a besoin de connaître l'heure.
  const [focus, setFocus] = useState<{ uid: string; at: number } | null>(null);

  // La requête attend que Firebase ait tranché : sans ça, quelqu'un qui arrive
  // directement sur cette adresse part avant que sa session soit établie et
  // reçoit le mur « réservé aux inscrits », que react-query met en cache.
  const { data, isLoading } = useQuery({
    queryKey: ['carpool', EVENT_ID, firebaseUser?.uid ?? 'anonyme'] as const,
    queryFn: () => apiPublic<Payload>(`/api/carpool/${EVENT_ID}`),
    enabled: !authLoading,
  });

  const trips = useMemo(() => data?.trips ?? [], [data]);
  const mine = useMemo(() => trips.find((t) => t.uid === data?.me) ?? null, [trips, data?.me]);

  /** Ouvrir l'éditeur reprend le trajet existant : on corrige un point, on ne
   *  recommence pas de zéro. Semé dans le geste qui ouvre — un effet qui appelle
   *  setState en cascade est ce que le compilateur React refuse. */
  function ouvrirEditeur() {
    setDraft(mine
      ? {
          kind: mine.kind, origin: mine.origin, waypoints: mine.waypoints, seats: mine.seats,
          departAt: mine.departAt ?? '', returnAt: mine.returnAt ?? '', note: mine.note,
        }
      : EMPTY_DRAFT);
    setEditing(true);
  }

  // L'itinéraire du brouillon, recalculé au serveur à chaque changement de point
  // ou d'étape. Confié à react-query : l'annulation et l'état de chargement
  // viennent avec, et une géométrie déjà calculée n'est pas redemandée.
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
    staleTime: Infinity,
    retry: false,
  });
  const preview = previewQuery.data ?? null;

  function onMapClick(lat: number, lng: number) {
    if (placing === 'origin') setDraft({ ...draft, origin: { lat, lng, label: '' } });
    else if (placing === 'waypoint') setDraft({ ...draft, waypoints: [...draft.waypoints, { lat, lng, label: '' }] });
    setPlacing(null);
  }

  /** Choisir un trajet depuis la liste : on le met en avant ET on recadre la
   *  carte dessus. Depuis la carte, on se contente de le mettre en avant — la
   *  vue ne doit pas sauter sous les doigts de qui la déplace. */
  function montrer(uid: string) {
    setSelected(uid);
    setFocus((f) => ({ uid, at: (f?.at ?? 0) + 1 }));
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
      <Conteneur>
        <div className="flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
          <Loader2 className="animate-spin" size={20} /> Chargement de la carte…
        </div>
      </Conteneur>
    );
  }

  const ev = data?.event;
  if (!ev) return null;

  // ── Porte fermée ──────────────────────────────────────────────────────────
  if (!data.allowed) {
    return (
      <Conteneur>
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
      </Conteneur>
    );
  }

  const offres = trips.filter((t) => t.kind === 'offer');
  const demandes = trips.filter((t) => t.kind === 'search');

  const carte = (
    <CarpoolMap
      destination={ev.destination}
      trips={trips}
      me={data.me ?? null}
      selectedUid={selected}
      focus={focus}
      draft={editing
        ? { origin: draft.origin, waypoints: draft.waypoints, route: preview?.route ?? null, kind: draft.kind }
        : null}
      placing={placing !== null}
      onMapClick={onMapClick}
      onSelect={setSelected}
    />
  );
  const legende = <Legende evenement={ev.label} routier={data.routing !== 'straight'} />;

  return (
    <Conteneur>
      <div className="space-y-6">
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

        {editing ? (
          /* En édition, le formulaire se range à côté de la carte : on pose un
             point dessus tout en remplissant ses champs. */
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div>
              <div className="h-[420px] lg:h-[560px]">{carte}</div>
              <div className="mt-4">{legende}</div>
            </div>
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
                  previewing={previewQuery.isFetching}
                  hasTrip={Boolean(mine)}
                  onSaved={recharger}
                  onDeleted={recharger}
                />
              </div>
            </section>
          </div>
        ) : (
          <>
            {/* En consultation, la carte prend toute la largeur : c'est elle
                qu'on vient voir, et les trajets se lisent dessous. */}
            <div>
              <div className="h-[440px] lg:h-[640px]">{carte}</div>
              <div className="mt-4">{legende}</div>
            </div>

            {trips.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Personne n’a encore posé de trajet. Le premier point donne le ton.
              </p>
            ) : (
              <div className="space-y-8">
                {([
                  ['Propose des places', offres, Car] as const,
                  ['Cherche une place', demandes, UserSearch] as const,
                ])
                  .filter(([, liste]) => liste.length > 0)
                  .map(([titre, liste, Icone]) => (
                    <section key={titre}>
                      <h2 className="t-label flex items-center gap-1.5" style={{ color: 'var(--s-text-muted)' }}>
                        <Icone size={13} aria-hidden /> {titre} · {liste.length}
                      </h2>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {liste.map((t) => (
                          <CarteTrajet
                            key={t.uid}
                            trip={t}
                            demandes={demandes}
                            moi={data.me ?? null}
                            choisi={selected === t.uid}
                            estAdmin={isAdmin || isCompetitionAdmin}
                            onMontrer={() => montrer(t.uid)}
                            onSupprimer={() => void supprimer(t.uid)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
              </div>
            )}
          </>
        )}

        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Springs E-Sport met en relation et n’organise pas le transport. Les trajets
          sont visibles des seuls joueurs inscrits, et effacés après l’événement.
        </p>
      </div>
    </Conteneur>
  );
}

/**
 * Un trajet, en carte.
 *
 * Cliquer dessus le met en avant sur la carte ET recadre dessus : sans ce
 * geste, repérer parmi trente tracés celui qu'on est en train de lire relevait
 * du jeu des sept erreurs.
 */
function CarteTrajet({
  trip: t, demandes, moi, choisi, estAdmin, onMontrer, onSupprimer,
}: {
  trip: Trip;
  demandes: Trip[];
  moi: string | null;
  choisi: boolean;
  estAdmin: boolean;
  onMontrer: () => void;
  onSupprimer: () => void;
}) {
  const offre = t.kind === 'offer';
  const couleur = offre ? '#00D936' : '#eaeaf0';

  // Les demandes qui longent CET itinéraire. C'est le calcul qui rend la carte
  // utile plutôt que jolie — et il est purement local.
  const surLaRoute = offre && t.route ? seekersNearRoute(demandes, decodePolyline(t.route.polyline)) : [];

  return (
    <article
      onClick={onMontrer}
      className="panel bevel cursor-pointer p-3.5 transition-colors"
      style={{
        borderColor: choisi ? couleur : undefined,
        background: choisi ? 'rgba(255,255,255,0.035)' : undefined,
      }}
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
        {t.uid === moi && <span className="tag tag-neutral">toi</span>}
        <span className="ml-auto text-xs" style={{ color: couleur }}>
          {t.seats} place{t.seats > 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-1.5 text-sm">
        {ville(t.origin.label)}
        {t.route && (
          <span style={{ color: 'var(--s-text-dim)' }}>
            {' '}· {formatDistance(t.route.distanceM)} · {formatDuration(t.route.durationS)}
          </span>
        )}
      </div>

      {t.waypoints.length > 0 && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
          via {t.waypoints.map((w) => ville(w.label)).join(', ')}
        </div>
      )}

      {(t.departAt || t.returnAt) && (
        <div className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--s-text-dim)' }}>
          {quand(t.departAt) && <>Départ {quand(t.departAt)}</>}
          {t.departAt && t.returnAt && <br />}
          {quand(t.returnAt) && <>Retour {quand(t.returnAt)}</>}
        </div>
      )}

      {t.note && <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>{t.note}</p>}

      {/* Ne s'affiche que sur le trajet mis en avant : sur trente cartes, ce
          serait trente listes que personne ne lirait. */}
      {choisi && surLaRoute.length > 0 && (
        <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: 'var(--s-border)' }}>
          <div className="t-label" style={{ color: 'var(--s-gold)' }}>Sur cet itinéraire</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {surLaRoute.map(({ seeker, meters }) => (
              <li key={seeker.uid}>
                {seeker.author.displayName}
                <span style={{ color: 'var(--s-text-dim)' }}> — à {formatDistance(meters)} de la route</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-3">
        {t.author.discordUsername
          ? <CopyHandle handle={t.author.discordUsername} />
          : <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Discord inconnu</span>}
        <span
          className="ml-auto inline-flex items-center gap-1 text-xs"
          style={{ color: choisi ? couleur : 'var(--s-text-muted)' }}
        >
          <Crosshair size={11} aria-hidden /> {choisi ? 'sur la carte' : 'voir'}
        </span>
        {estAdmin && t.uid !== moi && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSupprimer(); }}
            aria-label="Retirer ce trajet"
            className="p-0.5"
            style={{ color: 'var(--s-text-muted)' }}
          >
            <Trash2 size={12} aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}
