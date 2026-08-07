'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, FileText, Check, X, Euro, AlertTriangle, ShieldCheck, ScrollText, Save,
  Search, Download, IdCard,
} from 'lucide-react';
import { api, apiDownload, ApiError } from '@/lib/api-client';
import { countries } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import FaqEditor from '@/components/mania-cup/FaqEditor';
import TicketingSettings from '@/components/mania-cup/TicketingSettings';
import TierMapping from '@/components/mania-cup/TierMapping';
import PaymentsPanel, { type MatchTarget } from '@/components/mania-cup/PaymentsPanel';
import { MANIA_CUP, MANIA_CUP_DOCS, GUARDIAN_DOC_KINDS, GUARDIAN_DOC_LABELS } from '@/lib/mania-cup';

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

type Row = {
  uid: string;
  tmDisplayName: string;
  tmAccountId: string;
  discordId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emergencyContact: { name: string; phone: string } | null;
  imageConsent: boolean | null;
  countryCode: string;
  ageAtEvent: number;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  guardianConsent: 'not_required' | 'missing' | 'pending_review' | 'approved' | 'rejected';
  guardianDocs: Partial<Record<'consent' | 'guardian_id', { name: string }>>;
  guardianRejectionReason: string | null;
  registrationCode: string;
  companions: { name: string; role: string; ticketItemId?: number | null }[];
  payment: { amountCents: number; payerName: string } | null;
  pcRental: { amountCents: number } | null;
  seat: string | null;
  checkedIn: boolean;
  /** Horodatages Firestore sérialisés. L'ordre d'arrivée décide de tout quand
   *  les places manquent : il n'était visible nulle part. */
  createdAt: { _seconds: number } | null;
  paidAt: { _seconds: number } | null;
  staffMessage: string | null;
};

type Payload = {
  registrations: Row[];
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

/** Horodatage Firestore en date lisible. Le jour et l'heure suffisent : on
 *  compare des dossiers entre eux, on ne fait pas de comptabilité. */
function dateCourte(t: { _seconds: number }): string {
  return new Date(t._seconds * 1000).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
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
    mutationFn: (body: { uid: string; action: string; reason?: string; countryCode?: string }) =>
      api('/api/admin/mania-cup', { method: 'PATCH', body }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Action refusée'),
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
  // vie : son pseudo, son nom, son adresse, son code. Sans accents ni casse,
  // parce que personne ne tape « Amélie » avec l'accent dans un champ de
  // recherche pressé.
  const needle = search.trim().toLowerCase();
  const visibleRows = rows.filter((r) => {
    if (!matchesFilter(r, filter)) return false;
    if (!needle) return true;
    return [r.tmDisplayName, r.firstName, r.lastName, r.email, r.registrationCode, r.seat]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

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
      'Nom', 'Prénom', 'Pseudo Trackmania', 'Code', 'Réglé', 'Âge', 'Mineur',
      'Autorisation', 'Accompagnant', 'Billet accompagnant', 'Poste loué',
      'Emplacement', 'Droit à l’image', 'E-mail', 'Téléphone', 'Contact d’urgence',
    ];
    const body = [...visibleRows]
      .sort((a, b) => (a.lastName || a.tmDisplayName).localeCompare(b.lastName || b.tmDisplayName, 'fr'))
      .map((r) => [
        r.lastName,
        r.firstName,
        r.tmDisplayName,
        r.registrationCode,
        r.status === 'confirmed' ? 'oui' : 'non',
        r.ageAtEvent,
        r.ageAtEvent < 18 ? 'oui' : '',
        r.guardianConsent === 'not_required' ? '' : GUARDIAN_STATUS_LABELS[r.guardianConsent],
        r.companions.map((c) => c.name).join(' · '),
        r.companions.length === 0
          ? ''
          : `${r.companions.filter((c) => c.ticketItemId != null).length}/${r.companions.length} réglé(s)`,
        r.pcRental ? 'oui' : '',
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
      <h1 className="font-display text-4xl">Springs Mania Cup</h1>
      <p className="mt-2" style={{ color: 'var(--s-text-dim)' }}>
        3 &amp; 4 octobre 2026 · {MANIA_CUP.city} · {MANIA_CUP.maxPlayers} places
      </p>

      {c && (
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Inscrits" value={c.total} />
          <Stat label="Payés" value={c.confirmed} tone="ok" />
          <Stat label="En attente de paiement" value={c.pendingPayment} />
          <Stat label="Autorisations à relire" value={c.guardianToReview} tone={c.guardianToReview ? 'warn' : undefined} />
          {c.incomplete > 0 ? (
            <Stat label="Fiches incomplètes" value={c.incomplete} tone="warn" />
          ) : (
            <Stat label="Places restantes" value={c.seatsLeft} />
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
              placeholder="Nom, pseudo, e-mail, code…"
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

          <Link
            href="/admin/mania-cup/badges"
            className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
          >
            <IdCard size={15} aria-hidden />
            Badges
          </Link>
        </div>
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
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left" style={{ color: 'var(--s-text-dim)' }}>
                <th className="py-3 pr-4 font-medium">Joueur</th>
                <th className="py-3 pr-4 font-medium">Pays</th>
                <th className="py-3 pr-4 font-medium">Âge</th>
                <th className="py-3 pr-4 font-medium">Code</th>
                <th className="py-3 pr-4 font-medium">Accompagnant</th>
                <th className="py-3 pr-4 font-medium">Paiement</th>
                <th className="py-3 pr-4 font-medium">Autorisation parentale</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr
                  key={r.uid}
                  className="border-b border-white/5 align-top"
                  style={r.status === 'cancelled' ? { opacity: 0.45 } : undefined}
                >
                  <td className="py-4 pr-4">
                    {/* L'identité civile EN PREMIER, et lisible : c'est elle que
                        le bénévole compare à la pièce présentée à l'accueil. Elle
                        était en 12px gris sous le pseudo — présente, mais
                        invisible : l'organisation croyait qu'elle manquait. */}
                    {r.firstName || r.lastName ? (
                      <div className="font-semibold">
                        {`${r.firstName} ${r.lastName}`.trim()}
                      </div>
                    ) : (
                      <div className="font-semibold" style={{ color: 'var(--s-gold)' }}>
                        fiche incomplète
                      </div>
                    )}
                    <div className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                      {r.tmDisplayName || '—'}
                    </div>

                    <div className="mt-1.5 space-y-0.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {r.email && <div>{r.email}</div>}
                      {/* Le téléphone n'existait que dans l'export : pour joindre
                          quelqu'un le jour J, il fallait ouvrir un tableur. */}
                      {r.phone && <div>{r.phone}</div>}
                      {r.emergencyContact && (
                        <div style={{ color: 'var(--s-text-dim)' }}>
                          Urgence : {r.emergencyContact.name} · {r.emergencyContact.phone}
                        </div>
                      )}
                      {r.ageAtEvent < 18 && !r.emergencyContact && (
                        <div style={{ color: 'var(--s-gold)' }}>
                          Aucun contact d’urgence — obligatoire pour un mineur
                        </div>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.status === 'cancelled' && <span className="tag tag-neutral">retirée</span>}
                      {/* Un refus de droit à l'image se signale à l'équipe vidéo
                          AVANT le week-end, pas en relisant un CSV. */}
                      {r.imageConsent === false && (
                        <span className="tag" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,.4)' }}>
                          image refusée
                        </span>
                      )}
                      {r.pcRental && <span className="tag tag-violet">poste loué</span>}
                      {r.checkedIn && <span className="tag tag-green">arrivé</span>}
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    {/* Modifiable ici : le drapeau vient du profil, et
                        l'organisation n'avait aucun moyen de le corriger — un
                        joueur suisse est resté sous drapeau français jusqu'à ce
                        qu'on écrive en base. */}
                    <select
                      value={r.countryCode}
                      onChange={(e) =>
                        act.mutate({ uid: r.uid, action: 'set_country', countryCode: e.target.value })
                      }
                      aria-label={`Pays de ${r.tmDisplayName || r.uid}`}
                      className="settings-input w-full max-w-[11rem] text-sm"
                    >
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-4 pr-4">
                    {r.ageAtEvent}
                    {r.ageAtEvent < 18 && (
                      <span className="ml-2 bg-[#FFB800]/20 px-1.5 py-0.5 text-xs text-[#FFB800]">
                        mineur
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <div className="font-mono text-xs">{r.registrationCode}</div>
                    {/* Les places partent par ordre de reglement : savoir quand
                        un dossier est arrive permet d'arbitrer et de relancer. */}
                    {r.createdAt && (
                      <div className="mt-1 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        inscrit le {dateCourte(r.createdAt)}
                      </div>
                    )}
                    {r.paidAt && (
                      <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        réglé le {dateCourte(r.paidAt)}
                      </div>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    {r.companions.length > 0 ? (
                      <ul className="space-y-1.5">
                        {r.companions.map((c, i) => (
                          <li key={`${c.name}-${i}`}>
                            <div>{c.name}</div>
                            <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              {c.role}
                            </div>
                            {/* Un billet accompagnant ouvre la zone joueurs :
                                savoir s'il est réglé décide de qui entre. */}
                            <div
                              className="text-xs"
                              style={{
                                color: c.ticketItemId != null ? 'var(--s-green)' : 'var(--s-gold)',
                              }}
                            >
                              {c.ticketItemId != null ? 'billet réglé' : 'billet non réglé'}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span style={{ color: 'var(--s-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    {r.status === 'confirmed' ? (
                      <div>
                        <button
                          onClick={() => act.mutate({ uid: r.uid, action: 'mark_unpaid' })}
                          className="inline-flex items-center gap-1.5 text-[#22c55e] hover:underline"
                        >
                          <Check size={15} aria-hidden /> Payé
                        </button>
                        {/* D'où vient l'argent : sans ça, impossible de
                            rapprocher une caisse ni de traiter un remboursement. */}
                        {r.payment && (
                          <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                            {(r.payment.amountCents / 100).toFixed(2).replace('.', ',')} € ·{' '}
                            {r.payment.payerName || 'payeur inconnu'}
                          </div>
                        )}
                      </div>
                    ) : r.status === 'cancelled' ? (
                      <span style={{ color: 'var(--s-text-muted)' }}>—</span>
                    ) : (
                      <button
                        onClick={() => act.mutate({ uid: r.uid, action: 'mark_paid' })}
                        className="inline-flex items-center gap-1.5 border border-white/20 px-2.5 py-1 hover:bg-white/10"
                      >
                        <Euro size={14} aria-hidden /> Marquer payé
                      </button>
                    )}
                    {r.pcRental && (
                      <div className="mt-1 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                        + poste loué
                      </div>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <GuardianCell row={r} onOpen={openDocument} onAct={act.mutate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function GuardianCell({
  row,
  onOpen,
  onAct,
}: {
  row: Row;
  onOpen: (uid: string, kind: string) => void;
  onAct: (b: { uid: string; action: string; reason?: string }) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (row.guardianConsent === 'not_required') {
    return <span style={{ color: 'var(--s-text-muted)' }}>—</span>;
  }
  if (row.guardianConsent === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#22c55e]">
        <ShieldCheck size={15} aria-hidden /> Validée
      </span>
    );
  }
  if (row.guardianConsent === 'missing') {
    const done = GUARDIAN_DOC_KINDS.filter((k) => row.guardianDocs?.[k]).length;
    return (
      <span className="text-[#FFB800]">
        Dossier incomplet ({done}/{GUARDIAN_DOC_KINDS.length} pièces)
      </span>
    );
  }
  if (row.guardianConsent === 'rejected') {
    return (
      <div className="text-red-300">
        Refusée
        {row.guardianRejectionReason && (
          <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
            {row.guardianRejectionReason}
          </div>
        )}
      </div>
    );
  }

  // pending_review
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {GUARDIAN_DOC_KINDS.map((kind) => (
          <button
            key={kind}
            onClick={() => onOpen(row.uid, kind)}
            disabled={!row.guardianDocs?.[kind]}
            className="flex w-full items-center gap-1.5 border border-white/20 px-2.5 py-1 text-left hover:bg-white/10 disabled:opacity-40"
          >
            <FileText size={14} className="shrink-0" aria-hidden />
            <span className="truncate">{GUARDIAN_DOC_LABELS[kind]}</span>
          </button>
        ))}
      </div>

      {rejecting ? (
        <div className="space-y-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motif communiqué au joueur"
            className="w-56 border border-white/20 bg-black/40 px-2 py-1 text-xs outline-none focus:border-[#FFB800]"
          />
          <div className="flex gap-2">
            <button
              disabled={!reason.trim()}
              onClick={() => {
                onAct({ uid: row.uid, action: 'reject_guardian', reason });
                setRejecting(false);
                setReason('');
              }}
              className="border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            >
              Confirmer le refus
            </button>
            <button
              onClick={() => setRejecting(false)}
              className="px-2 py-1 text-xs"
              style={{ color: 'var(--s-text-dim)' }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onAct({ uid: row.uid, action: 'approve_guardian' })}
            className="inline-flex items-center gap-1 border border-[#22c55e]/40 px-2 py-1 text-xs text-[#22c55e] hover:bg-[#22c55e]/10"
          >
            <Check size={13} aria-hidden /> Valider
          </button>
          <button
            onClick={() => setRejecting(true)}
            className="inline-flex items-center gap-1 border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          >
            <X size={13} aria-hidden /> Refuser
          </button>
        </div>
      )}
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

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#FFB800' : 'var(--s-text)';
  return (
    <div className="border border-white/10 bg-white/[0.02] p-4">
      <div className="font-display text-3xl" style={{ color }}>{value}</div>
      <div className="mt-1 text-xs" style={{ color: 'var(--s-text-dim)' }}>{label}</div>
    </div>
  );
}
