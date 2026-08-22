'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, AlertTriangle, ScrollText, Save,
  Search, Download, IdCard, ExternalLink, ShieldCheck,
} from 'lucide-react';
import { api, apiDownload, ApiError } from '@/lib/api-client';
import { downloadCsv } from '@/lib/csv';
import RegistrationRow, {
  needsAction, matchesSearch, type ActionBody, type Row,
} from '@/components/mania-cup/RegistrationRow';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import FaqEditor from '@/components/mania-cup/FaqEditor';
import TicketingSettings from '@/components/mania-cup/TicketingSettings';
import TierMapping from '@/components/mania-cup/TierMapping';
import PaymentsPanel, { type MatchTarget } from '@/components/mania-cup/PaymentsPanel';
import WaitlistPanel, { type LigneAttente } from '@/components/mania-cup/WaitlistPanel';
import { MANIA_CUP, MANIA_CUP_DOCS } from '@/lib/mania-cup';

/** Libellés des états du dossier parental, pour la liste d'émargement. */
const GUARDIAN_STATUS_LABELS: Record<Row['guardianConsent'], string> = {
  not_required: '',
  missing: 'pièces manquantes',
  pending_review: 'à relire',
  approved: 'validé',
  rejected: 'refusé',
};

// Console d'organisation de la Springs Mania Cup.
//
// Deux tâches concrètes : relire les autorisations parentales des 16-17 ans, et
// confirmer les règlements à la main tant que le webhook HelloAsso n'est pas
// branché (il restera de toute façon utile pour les paiements orphelins).

type Payload = {
  registrations: Row[];
  waitlist?: LigneAttente[];
  prochainAInviter?: string | null;
  counts: {
    total: number;
    cancelled: number;
    confirmed: number;
    pendingPayment: number;
    guardianToReview: number;
    guardianMissing: number;
    minors: number;
    checkedIn: number;
    incomplete: number;
    seatsLeft: number;
    maxPlayers: number;
  };
};

/** Ce que la liste des inscriptions montre. Sur 64 dossiers, tout afficher
 *  d'un bloc oblige à chercher à l'œil ; ces filtres répondent chacun à une
 *  question qu'on se pose vraiment. */
type Filter = 'all' | 'unpaid' | 'guardian' | 'minors' | 'incomplete';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Tous',
  unpaid: 'Pas encore réglés',
  guardian: 'Dossier parental à traiter',
  minors: 'Mineurs',
  incomplete: 'Fiche incomplète',
};

function matchesFilter(r: Row, filter: Filter): boolean {
  switch (filter) {
    case 'unpaid':
      return r.status === 'pending_payment';
    case 'guardian':
      return r.guardianConsent === 'pending_review' || r.guardianConsent === 'missing';
    case 'minors':
      return r.ageAtEvent < 18;
    case 'incomplete':
      return !r.firstName || !r.email;
    default:
      return true;
  }
}

// Deux onglets plutôt qu'une page unique : les inscriptions se consultent tous
// les jours, la configuration une poignée de fois avant l'événement. Les
// empiler obligeait à faire défiler trois panneaux d'édition pour atteindre le
// tableau des inscrits.
type Tab = 'inscriptions' | 'paiements' | 'configuration';

export default function AdminManiaCupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inscriptions');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mania-cup'] as const,
    queryFn: () => api<Payload>('/api/admin/mania-cup'),
  });

  // Combien de règlements attendent une décision ? L'information vivait
  // uniquement DANS l'onglet Paiements : il fallait déjà s'y trouver pour
  // apprendre qu'il fallait s'y rendre. De l'argent encaissé sans place
  // confirmée mérite mieux qu'un onglet muet.
  //
  // Même clé que PaymentsPanel : React Query ne lance qu'une seule requête pour
  // les deux, quel que soit l'onglet affiché.
  const { data: helloasso } = useQuery({
    queryKey: ['admin', 'mania-cup', 'helloasso'] as const,
    queryFn: () => api<{ counts?: { toReview: number } }>('/api/admin/mania-cup/helloasso'),
  });
  const toReview = helloasso?.counts?.toReview ?? 0;

  const act = useMutation({
    mutationFn: (body: ActionBody) =>
      api('/api/admin/mania-cup', { method: 'PATCH', body }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Action refusée'),
  });

  const syncRoles = useMutation({
    mutationFn: () =>
      api<{ donnes: number; absentsDuServeur: string[] }>('/api/admin/mania-cup', {
        method: 'PATCH',
        body: { action: 'sync_discord_roles' },
      }),
    onSuccess: (r) => {
      const absents = r.absentsDuServeur ?? [];
      // On NOMME ceux qui manquent : « 3 absents » n'aide pas à agir, alors
      // qu'une liste permet d'aller leur envoyer l'invitation du serveur.
      setError(
        absents.length === 0
          ? null
          : `${r.donnes} rôle(s) donné(s). Pas encore sur le Discord Springs : ${absents.join(', ')}.`
      );
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Attribution refusée'),
  });

  async function openDocument(uid: string, kind: string) {
    try {
      const res = await apiDownload(
        `/api/mania-cup/guardian-consent?uid=${encodeURIComponent(uid)}&kind=${kind}`
      );
      if (res.kind === 'blob') {
        const url = URL.createObjectURL(res.blob);
        window.open(url, '_blank', 'noopener');
        // Le document reste en mémoire le temps que l'onglet l'affiche.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Document illisible');
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-8" style={{ color: 'var(--s-text-dim)' }}>
        <Loader2 className="animate-spin" size={20} /> Chargement…
      </div>
    );
  }

  const rows = data?.registrations ?? [];
  const c = data?.counts;

  // La recherche porte sur tout ce par quoi on cherche quelqu'un dans la vraie
  // vie — pseudo Trackmania, pseudo Discord, nom, adresse, code, structure. Le
  // détail est dans `matchesSearch`. Sans casse, parce que personne ne
  // capitalise dans un champ de recherche pressé.
  const needle = search.trim().toLowerCase();

  // Ordre d'arrivée, une fois pour toutes : c'est lui qui arbitre quand les
  // places manquent. Le rang est figé sur la liste ENTIÈRE, donc « le 12e
  // inscrit » reste le 12e même en ne regardant que les impayés.
  const parArrivee = [...rows].sort(
    (a, b) => (a.createdAt?._seconds ?? 0) - (b.createdAt?._seconds ?? 0)
  );
  const rang = new Map(parArrivee.map((r, i) => [r.uid, i + 1]));

  const visibleRows = parArrivee.filter(
    (r) => matchesFilter(r, filter) && matchesSearch(r, needle)
  );

  const aTraiter = visibleRows.filter(needsAction).length;

  /** Cibles proposées pour rattacher un règlement orphelin. */
  const matchTargets: MatchTarget[] = rows
    .filter((r) => r.status !== 'cancelled')
    .map((r) => ({
      uid: r.uid,
      label: r.tmDisplayName || `${r.firstName} ${r.lastName}`.trim() || r.uid,
      code: r.registrationCode,
      status: r.status,
    }));

  /** Liste d'émargement : ce qu'un bénévole a sous les yeux à l'accueil, et ce
   *  qui reste lisible si le réseau tombe. */
  function exportRoster() {
    const header = [
      'Nom', 'Prénom', 'Pseudo Trackmania', 'Pseudo Discord',
      'Structure', 'Équipe', 'Code', 'Réglé', 'Âge', 'Mineur',
      'Autorisation', 'Accompagnant', 'Billet accompagnant', 'Matériel loué',
      'Emplacement', 'Droit à l’image', 'E-mail', 'Téléphone', 'Contact d’urgence',
    ];
    const body = [...visibleRows]
      .sort((a, b) => (a.lastName || a.tmDisplayName).localeCompare(b.lastName || b.tmDisplayName, 'fr'))
      .map((r) => [
        r.lastName,
        r.firstName,
        r.tmDisplayName,
        // Sans arobase : la neutralisation anti-formule la ferait précéder
        // d'une apostrophe dans le tableur, et c'est le pseudo qu'on veut
        // pouvoir recopier tel quel.
        r.discordUsername ?? '',
        r.appartenance?.structure ?? '',
        r.appartenance?.team ?? '',
        r.registrationCode,
        r.status === 'confirmed' ? 'oui' : 'non',
        r.ageAtEvent,
        r.ageAtEvent < 18 ? 'oui' : '',
        r.guardianConsent === 'not_required' ? '' : GUARDIAN_STATUS_LABELS[r.guardianConsent],
        // Le nom du BILLET, celui qu'on contrôle à l'entrée — suivi du pseudo
        // imprimé sur le badge quand il diffère, sans quoi le bénévole ne peut
        // pas rapprocher la personne qu'il a en face de sa liste.
        r.companions
          .map((c) => (c.displayName?.trim() ? `${c.name} (badge : ${c.displayName.trim()})` : c.name))
          .join(' · '),
        r.companions.length === 0
          ? ''
          : `${r.companions.filter((c) => c.ticketItemId != null).length}/${r.companions.length} réglé(s)`,
        // L'article, pas un « oui » : c'est cette colonne qui dit quel
        // matériel sortir pour qui, le samedi matin.
        r.pcRental ? (r.pcRental.label ?? 'location') : '',
        r.seat ?? '',
        r.imageConsent === false ? 'REFUSÉ' : 'accordé',
        r.email,
        r.phone ?? '',
        r.emergencyContact ? `${r.emergencyContact.name} ${r.emergencyContact.phone}` : '',
      ]);
    downloadCsv(`mania-cup-emargement-${new Date().toISOString().slice(0, 10)}.csv`, [
      header,
      ...body,
    ]);
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Springs Mania Cup</h1>
          <p className="mt-2" style={{ color: 'var(--s-text-dim)' }}>
            3 &amp; 4 octobre 2026 · {MANIA_CUP.city} · {MANIA_CUP.maxPlayers} places
          </p>
        </div>
        {/* Aller voir ce que voient les joueurs sans repasser par l'onglet
            Compétitions : c'est le va-et-vient le plus fréquent quand on
            prépare l'événement. */}
        <Link
          href="/mania-cup"
          target="_blank"
          className="btn-springs btn-secondary bevel-sm inline-flex shrink-0 items-center gap-2"
        >
          <ExternalLink size={16} aria-hidden />
          Voir la page publique
        </Link>
      </div>

      {/* Une ligne, pas cinq pavés : cinq nombres n'ont pas besoin de 100 px de
          hauteur. Les places restantes gardent le gros caractère — c'est le seul
          chiffre qu'on regarde tous les jours ; les autres ne s'allument que
          lorsqu'ils appellent une action. */}
      {c && (
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-white/10 py-4">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl leading-none">{c.seatsLeft}</span>
            <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              places restantes sur {c.maxPlayers ?? MANIA_CUP.maxPlayers}
            </span>
          </div>

          <span className="hidden h-6 w-px bg-white/10 sm:block" />

          <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            <strong style={{ color: 'var(--s-text)' }}>{c.total}</strong> inscrits ·{' '}
            <strong style={{ color: 'var(--s-green)' }}>{c.confirmed}</strong> réglés
          </span>

          {/* Ce qui demande une action, et rien d'autre : un « 0 en attente »
              affiché en permanence est du bruit. */}
          {c.pendingPayment > 0 && (
            <button
              onClick={() => setFilter('unpaid')}
              className="text-sm hover:underline"
              style={{ color: 'var(--s-gold)' }}
            >
              {c.pendingPayment} en attente de paiement
            </button>
          )}
          {c.guardianToReview > 0 && (
            <button
              onClick={() => setFilter('guardian')}
              className="text-sm hover:underline"
              style={{ color: 'var(--s-gold)' }}
            >
              {c.guardianToReview} autorisation{c.guardianToReview > 1 ? 's' : ''} à relire
            </button>
          )}
          {c.incomplete > 0 && (
            <button
              onClick={() => setFilter('incomplete')}
              className="text-sm hover:underline"
              style={{ color: 'var(--s-gold)' }}
            >
              {c.incomplete} fiche{c.incomplete > 1 ? 's' : ''} incomplète{c.incomplete > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-6 flex gap-3 border border-red-500/40 bg-red-500/10 p-4 text-red-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      <div className="mt-10 flex gap-1 border-b border-white/10">
        {([
          ['inscriptions', 'Inscriptions'],
          ['paiements', 'Paiements'],
          ['configuration', 'Configuration'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
              tab === key
                ? 'border-[#00D936] text-white'
                : 'border-transparent hover:text-white'
            }`}
            style={tab === key ? undefined : { color: 'var(--s-text-dim)' }}
          >
            {label}
            {key === 'inscriptions' && c ? (
              <span className="ml-2" style={{ color: 'var(--s-text-muted)' }}>
                {c.total}
              </span>
            ) : null}
            {key === 'paiements' && toReview > 0 ? (
              // En or, et pas en gris comme le compteur d'inscriptions : ce
              // n'est pas une statistique, c'est une action qui attend.
              <span
                className="ml-2 inline-flex min-w-5 items-center justify-center px-1.5 py-0.5 text-xs font-bold"
                style={{ background: '#FFB800', color: '#07050b' }}
                title={`${toReview} règlement${toReview > 1 ? 's' : ''} à traiter`}
              >
                {toReview}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'configuration' && (
        <>
      <RulebookPanel
        slug={MANIA_CUP_DOCS.rules}
        title="Règlement"
        publicHref="/mania-cup/reglement"
        note="Publier une nouvelle version archive la précédente. Les joueurs déjà inscrits gardent la trace de celle qu’ils ont acceptée ; les suivants devront accepter la nouvelle."
      />
      <FaqEditor />
      <TicketingSettings />
      <TierMapping />
      <PurgeCovoiturage />
        </>
      )}

      {tab === 'paiements' && <PaymentsPanel targets={matchTargets} />}

      {tab === 'inscriptions' && rows.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
              style={{ color: 'var(--s-text-muted)' }}
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pseudo Trackmania ou Discord, nom, e-mail, code…"
              aria-label="Rechercher une inscription"
              className="settings-input has-icon w-full"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`bevel-sm border px-3 py-1.5 text-sm transition-colors ${
                  filter === f ? 'border-[#00D936] text-white' : 'border-white/15'
                }`}
                style={filter === f ? undefined : { color: 'var(--s-text-dim)' }}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          <button
            onClick={exportRoster}
            className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
            title="Liste triée par nom, à imprimer pour l’accueil"
          >
            <Download size={15} aria-hidden />
            Liste d’émargement
          </button>

          {/* Le rôle suit normalement le règlement. Ce bouton referme l'écart
              des cas que Discord ne sait pas nous signaler : quelqu'un qui a
              payé avant de rejoindre le serveur, ou qui l'a rejoint depuis. */}
          <button
            onClick={() => syncRoles.mutate()}
            disabled={syncRoles.isPending}
            className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2 disabled:opacity-40"
            title="Donner le rôle Discord à tous ceux qui ont réglé"
          >
            {syncRoles.isPending
              ? <Loader2 size={15} className="animate-spin" aria-hidden />
              : <ShieldCheck size={15} aria-hidden />}
            Rôles Discord
          </button>

          <Link
            href="/admin/mania-cup/badges"
            className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
          >
            <IdCard size={15} aria-hidden />
            Badges
          </Link>
        </div>
      )}

      {tab === 'inscriptions' && (
        <WaitlistPanel
          lignes={data?.waitlist ?? []}
          prochain={data?.prochainAInviter ?? null}
          onError={setError}
        />
      )}

      {tab === 'inscriptions' && (rows.length === 0 ? (
        <p className="mt-10" style={{ color: 'var(--s-text-dim)' }}>
          Aucune inscription pour le moment.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="mt-10" style={{ color: 'var(--s-text-dim)' }}>
          Aucune inscription ne correspond à cette recherche.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border-t border-white/10">
          {/* Combien de dossiers portent le filet or, dans ce qui est affiché.
              Le compte du bandeau porte sur TOUT ; ici on parle de la liste
              qu'on a sous les yeux, filtre et recherche compris. */}
          <p className="py-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
            {visibleRows.length} dossier{visibleRows.length > 1 ? 's' : ''} affiché
            {visibleRows.length > 1 ? 's' : ''}
            {aTraiter > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--s-gold)' }}>
                  {aTraiter} en attente d’une action de notre côté
                </span>
              </>
            )}
            {' · '}une ligne s’ouvre au clic
          </p>
          {/* 1250 px, comme avant la colonne Discord : mesuré, le cadre du
              tableau fait 1254 px sur un écran 1920. Un pixel de plus et la
              console gagnait un défilement horizontal qu'elle n'avait pas. */}
          <table className="w-full min-w-[1250px] border-collapse text-sm">
            <thead>
              {/* En-tête collant : à 64 dossiers on descend loin, et sans lui
                  on ne sait plus quelle colonne on lit. */}
              <tr
                className="sticky top-0 z-10 border-b border-white/10 text-left"
                style={{ color: 'var(--s-text-muted)', background: 'var(--s-bg)' }}
              >
                {/* Largeurs recalées à la mesure, pas à l'estimation : le
                    cadre du tableau fait 1254 px sur un écran 1920, et la
                    colonne Discord devait tenir dedans sans pousser le reste
                    au défilement. Chaque retrait ci-dessous a été pris sur du
                    vide constaté au rendu, jamais sur du texte. */}
                <th className="w-10 py-2.5 pr-2 pl-3 font-medium">
                  <span title="Ordre d’arrivée">#</span>
                </th>
                {/* Le panel admin mange 560 px de largeur : ce qui reste au
                    tableau est bien plus étroit que l'écran. Tout figer laissait
                    « Charly LEPRINCE » se couper en deux. Seules les colonnes à
                    contenu prévisible sont bornées ; le nom et les étiquettes
                    d'état se partagent le reste. */}
                <th className="min-w-[150px] py-2.5 pr-4 font-medium">Joueur</th>
                {/* Le pseudo Trackmania et le pseudo Discord n'ont souvent
                    aucun rapport. Sans les deux côte à côte, savoir qui vient
                    de s'inscrire demandait de fouiller.
                    Étroite à dessein : une colonne de plus pousse le tableau
                    vers le défilement horizontal, et un pseudo Discord tient
                    en quinze caractères. */}
                <th className="w-32 py-2.5 pr-4 font-medium">Discord</th>
                {/* Une LAN voit arriver des clubs, pas seulement des individus :
                    savoir que trois inscrits viennent de la même structure
                    change l'accueil, le placement en salle et les badges.
                    « Structure » est le mot du site — on ne dit pas « écurie »
                    sur Trackmania. */}
                <th className="w-44 py-2.5 pr-4 font-medium">Structure</th>
                {/* Rétrécie pour financer la colonne Discord. L'adresse s'y
                    tronque désormais sur les plus longues — elle reste entière
                    dans le dossier, et c'est de là qu'on la copie. Le canal par
                    lequel on joint vraiment quelqu'un est maintenant à
                    gauche. */}
                <th className="w-40 py-2.5 pr-4 font-medium">Contact</th>
                <th className="w-28 py-2.5 pr-4 font-medium">Pays</th>
                <th className="w-20 py-2.5 pr-4 font-medium">Âge</th>
                <th className="w-28 py-2.5 pr-4 font-medium">Code</th>
                <th className="w-36 py-2.5 pr-4 font-medium">Règlement</th>
                <th className="min-w-[170px] py-2.5 pr-4 font-medium">État</th>
                <th className="w-10 py-2.5 pr-3" aria-label="Ouvrir le dossier" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <RegistrationRow
                  key={r.uid}
                  row={r}
                  rank={rang.get(r.uid) ?? 0}
                  onAct={act.mutate}
                  onOpenDocument={openDocument}
                  pending={act.isPending}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}

    </div>
  );
}

// ── Règlement ────────────────────────────────────────────────────────────────

function RulebookPanel({
  slug,
  title,
  publicHref,
  note,
}: {
  slug: string;
  title: string;
  publicHref: string;
  note: string;
}) {
  const qc = useQueryClient();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin', 'mania-cup', 'rulebook', slug] as const,
    queryFn: () =>
      api<{ rulebook: { markdown: string; version: number } | null }>(
        `/api/admin/rulebooks?eventSlug=${slug}`
      ),
  });

  const publish = useMutation({
    mutationFn: (markdown: string) =>
      api<{ version: number }>('/api/admin/rulebooks', {
        method: 'POST',
        body: { eventSlug: slug, markdown },
      }),
    onSuccess: (r) => {
      setMsg(`Version ${r.version} publiée.`);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup', 'rulebook', slug] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Publication refusée'),
  });

  const current = data?.rulebook;
  const value = draft ?? current?.markdown ?? '';

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ScrollText size={22} className="text-[#a364d9]" aria-hidden />
          <h2 className="font-display text-2xl">{title}</h2>
          {current ? (
            <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              version {current.version} publiée
            </span>
          ) : (
            <span className="text-sm text-[#FFB800]">jamais publié</span>
          )}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          {open ? 'Replier' : current ? 'Modifier' : 'Rédiger'}
        </button>
      </div>

      <p className="mt-3 text-sm" style={{ color: 'var(--s-text-dim)' }}>
        {note}
      </p>

      {open && (
        <div className="mt-5">
          <MarkdownEditor
            value={value}
            onChange={setDraft}
            placeholder="Rédige le règlement en Markdown…"
            maxLength={LIMITS.rulebookMarkdown}
            rows={22}
            taRef={taRef}
          />
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button
              disabled={!value.trim() || publish.isPending || draft === null}
              onClick={() => publish.mutate(value)}
              className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-40"
            >
              {publish.isPending ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <Save size={16} aria-hidden />
              )}
              Publier {current ? `la version ${current.version + 1}` : 'la première version'}
            </button>
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Voir la page publique
            </a>
            {msg && <span className="text-sm text-[#00D936]">{msg}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Effacer la carte de covoiturage, une fois la LAN passée.
 *
 * La page de covoiturage annonce aux joueurs que leurs trajets sont supprimés
 * après l'événement. Sans ce bouton, cette phrase n'aurait été qu'un texte :
 * la fonction d'effacement existait dans le code et n'était appelée par
 * personne. Une promesse faite aux joueurs sans moyen de la tenir.
 *
 * Irréversible, donc en deux temps, et journalisé.
 */
function PurgeCovoiturage() {
  const [confirme, setConfirme] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const purge = useMutation({
    mutationFn: () =>
      api<{ efface: number }>('/api/admin/mania-cup', {
        method: 'PATCH',
        body: { action: 'purge_carpool', confirm: true },
      }),
    onSuccess: (r) => {
      setConfirme(false);
      setMessage(
        r.efface === 0
          ? 'Aucun trajet à effacer.'
          : `${r.efface} trajet(s) effacé(s).`
      );
    },
    onError: (e) => setMessage(e instanceof ApiError ? e.message : 'Effacement refusé'),
  });

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <h2 className="font-display text-2xl">Covoiturage</h2>
      <p className="mt-3 max-w-2xl text-sm" style={{ color: 'var(--s-text-dim)' }}>
        Les trajets posés par les joueurs disent où chacun se trouvait à une date
        donnée. La page le leur annonce : tout est effacé une fois la LAN passée.
        À faire après l’événement, pas avant.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {confirme ? (
          <>
            <button
              onClick={() => purge.mutate()}
              disabled={purge.isPending}
              className="inline-flex items-center gap-2 border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              {purge.isPending && <Loader2 size={14} className="animate-spin" aria-hidden />}
              Confirmer l’effacement de tous les trajets
            </button>
            <button
              onClick={() => setConfirme(false)}
              className="text-xs underline"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Annuler
            </button>
          </>
        ) : (
          <button
            onClick={() => { setConfirme(true); setMessage(null); }}
            className="border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Effacer la carte de covoiturage
          </button>
        )}
        <Link
          href="/mania-cup/covoiturage"
          target="_blank"
          className="text-sm underline"
          style={{ color: 'var(--s-text-dim)' }}
        >
          Voir la carte
        </Link>
        {message && <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>{message}</span>}
      </div>
    </section>
  );
}
