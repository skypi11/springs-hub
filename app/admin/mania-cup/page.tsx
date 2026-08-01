'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, FileText, Check, X, Euro, AlertTriangle, ShieldCheck, ScrollText, Save,
} from 'lucide-react';
import { api, apiDownload, ApiError } from '@/lib/api-client';
import CountryFlag from '@/components/ui/CountryFlag';
import { countries } from '@/lib/countries';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import FaqEditor from '@/components/mania-cup/FaqEditor';
import TicketingSettings from '@/components/mania-cup/TicketingSettings';
import { MANIA_CUP, MANIA_CUP_DOCS, GUARDIAN_DOC_KINDS, GUARDIAN_DOC_LABELS } from '@/lib/mania-cup';

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
  countryCode: string;
  ageAtEvent: number;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  guardianConsent: 'not_required' | 'missing' | 'pending_review' | 'approved' | 'rejected';
  guardianDocs: Partial<Record<'consent' | 'guardian_id', { name: string }>>;
  guardianRejectionReason: string | null;
  registrationCode: string;
  companion: { name: string; role: string } | null;
};

type Payload = {
  registrations: Row[];
  counts: {
    total: number;
    confirmed: number;
    pendingPayment: number;
    guardianToReview: number;
    guardianMissing: number;
    minors: number;
    seatsLeft: number;
  };
};

const countryName = (code: string) =>
  countries.find((c) => c.code === code)?.name ?? code;

export default function AdminManiaCupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mania-cup'] as const,
    queryFn: () => api<Payload>('/api/admin/mania-cup'),
  });

  const act = useMutation({
    mutationFn: (body: { uid: string; action: string; reason?: string }) =>
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
          <Stat label="Places restantes" value={c.seatsLeft} />
        </div>
      )}

      {error && (
        <div className="mt-6 flex gap-3 border border-red-500/40 bg-red-500/10 p-4 text-red-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      <RulebookPanel
        slug={MANIA_CUP_DOCS.rules}
        title="Règlement"
        publicHref="/mania-cup/reglement"
        note="Publier une nouvelle version archive la précédente. Les joueurs déjà inscrits gardent la trace de celle qu’ils ont acceptée ; les suivants devront accepter la nouvelle."
      />
      <FaqEditor />
      <TicketingSettings />

      {rows.length === 0 ? (
        <p className="mt-10" style={{ color: 'var(--s-text-dim)' }}>
          Aucune inscription pour le moment.
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
              {rows.map((r) => (
                <tr key={r.uid} className="border-b border-white/5 align-top">
                  <td className="py-4 pr-4 font-semibold">{r.tmDisplayName || '—'}</td>
                  <td className="py-4 pr-4">
                    <span className="flex items-center gap-2">
                      <CountryFlag code={r.countryCode} size={20} />
                      {countryName(r.countryCode)}
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    {r.ageAtEvent}
                    {r.ageAtEvent < 18 && (
                      <span className="ml-2 bg-[#FFB800]/20 px-1.5 py-0.5 text-xs text-[#FFB800]">
                        mineur
                      </span>
                    )}
                  </td>
                  <td className="py-4 pr-4 font-mono text-xs">{r.registrationCode}</td>
                  <td className="py-4 pr-4">
                    {r.companion ? (
                      <div>
                        <div>{r.companion.name}</div>
                        <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                          {r.companion.role}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--s-text-muted)' }}>—</span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    {r.status === 'confirmed' ? (
                      <button
                        onClick={() => act.mutate({ uid: r.uid, action: 'mark_unpaid' })}
                        className="inline-flex items-center gap-1.5 text-[#22c55e] hover:underline"
                      >
                        <Check size={15} aria-hidden /> Payé
                      </button>
                    ) : (
                      <button
                        onClick={() => act.mutate({ uid: r.uid, action: 'mark_paid' })}
                        className="inline-flex items-center gap-1.5 border border-white/20 px-2.5 py-1 hover:bg-white/10"
                      >
                        <Euro size={14} aria-hidden /> Marquer payé
                      </button>
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
      )}
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
