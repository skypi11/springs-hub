'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, RefreshCw, AlertTriangle, Link2, CheckCircle2, HelpCircle, Ticket,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { suggestRegistrationCodes } from '@/lib/mania-cup';
import { TICKET_LABELS } from '@/lib/helloasso/types';

// La caisse : ce que HelloAsso a encaissé, et ce qui n'a pas trouvé son dossier.
//
// Deux choses s'y font, et une seule est mécanique.
//
// Le bouton « Relire les commandes » rattrape les notifications perdues. Le
// webhook est le chemin normal, mais il ne garantit rien : des développeurs ont
// signalé sur le forum de l'éditeur ne jamais recevoir certaines notifications.
// Sans ce bouton, un joueur qui a payé resterait « en attente » jusqu'à ce
// qu'il appelle — le samedi matin, dans la file.
//
// La file de rattachement, elle, demande un humain. Quand un payeur recopie mal
// son code, on propose les dossiers voisins à une lettre près SANS jamais
// trancher : deux codes peuvent être voisins, et confirmer d'autorité
// créditerait un joueur du règlement d'un autre.

type Payment = {
  itemId: number;
  orderId: number;
  ticket: string | null;
  tierLabel: string;
  amountCents: number;
  state: string;
  rawCode: string | null;
  code: string | null;
  participantName: string;
  payerName: string;
  payerEmail: string;
  matchedUid: string | null;
  outcome: string;
  reason: string | null;
  source: string;
};

type Payload = {
  configured: boolean;
  error?: string;
  organizationSlug?: string;
  formSlug?: string;
  payments?: Payment[];
  counts?: { total: number; toReview: number };
};

/** Les dossiers auxquels un règlement orphelin peut être rattaché. */
export type MatchTarget = { uid: string; label: string; code: string; status: string };

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

export default function PaymentsPanel({ targets }: { targets: MatchTarget[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [onlyProblems, setOnlyProblems] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mania-cup', 'helloasso'] as const,
    queryFn: () => api<Payload>('/api/admin/mania-cup/helloasso'),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      api<{ scanned: number; changed: number; truncated: boolean }>(
        '/api/admin/mania-cup/helloasso',
        { method: 'POST', body: { action: 'reconcile' } }
      ),
    onSuccess: (res) => {
      toast.success(
        res.changed > 0
          ? `${res.scanned} lignes relues, ${res.changed} mise${res.changed > 1 ? 's' : ''} à jour.`
          : `${res.scanned} lignes relues, tout était déjà à jour.`
      );
      if (res.truncated) {
        toast.info('Relecture interrompue pour tenir dans le temps imparti. Relance pour la suite.');
      }
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Relecture impossible.'),
  });

  const match = useMutation({
    mutationFn: (body: { itemId: number; targetUid: string }) =>
      api('/api/admin/mania-cup/helloasso', { method: 'POST', body: { action: 'match', ...body } }),
    onSuccess: () => {
      toast.success('Règlement rattaché.');
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Rattachement refusé.'),
  });

  const payments = useMemo(() => {
    const all = data?.payments ?? [];
    return onlyProblems
      ? all.filter((p) => p.outcome === 'unmatched' || p.outcome === 'needs_review')
      : all;
  }, [data?.payments, onlyProblems]);

  if (isLoading) {
    return (
      <div className="mt-8 flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
        <Loader2 className="animate-spin" size={18} /> Lecture de la caisse…
      </div>
    );
  }

  if (!data?.configured) {
    return (
      <div className="panel bevel mt-8">
        <div className="panel-body">
          <h3 className="t-sub">Billetterie non connectée</h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {data?.error ??
              'Les clés HelloAsso ne sont pas renseignées côté serveur. Tant qu’elles manquent, les règlements ne remontent pas tout seuls et se confirment à la main depuis l’onglet Inscriptions.'}
          </p>
          <p className="mt-3 text-sm" style={{ color: 'var(--s-text-muted)' }}>
            À renseigner : <code>HELLOASSO_CLIENT_ID</code>, <code>HELLOASSO_CLIENT_SECRET</code>,{' '}
            <code>HELLOASSO_ORG_SLUG</code>, <code>HELLOASSO_FORM_SLUG</code> et{' '}
            <code>HELLOASSO_WEBHOOK_SECRET</code>.
          </p>
        </div>
      </div>
    );
  }

  const counts = data.counts ?? { total: 0, toReview: 0 };

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="t-sub">Caisse HelloAsso</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {counts.total} règlement{counts.total > 1 ? 's' : ''} enregistré
            {counts.total > 1 ? 's' : ''}
            {counts.toReview > 0 && (
              <>
                {' · '}
                <strong style={{ color: 'var(--s-gold)' }}>
                  {counts.toReview} à traiter
                </strong>
              </>
            )}
          </p>
        </div>

        <button
          onClick={() => reconcile.mutate()}
          disabled={reconcile.isPending}
          className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
        >
          {reconcile.isPending ? (
            <Loader2 className="animate-spin" size={16} aria-hidden />
          ) : (
            <RefreshCw size={16} aria-hidden />
          )}
          Relire les commandes
        </button>
      </div>

      <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
        Les règlements arrivent tout seuls quand HelloAsso nous prévient. « Relire les
        commandes » repasse sur l’intégralité de la billetterie : à faire si un joueur
        affirme avoir payé sans que ça se voie ici.
      </p>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyProblems}
          onChange={(e) => setOnlyProblems(e.target.checked)}
        />
        N’afficher que ce qui demande une décision
      </label>

      {payments.length === 0 ? (
        <div className="panel bevel">
          <div className="panel-body flex items-center gap-3">
            <CheckCircle2 size={18} style={{ color: 'var(--s-green)' }} aria-hidden />
            <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              {onlyProblems
                ? 'Aucun règlement en attente de décision.'
                : 'Aucun règlement enregistré pour le moment.'}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <PaymentRow
              key={p.itemId}
              payment={p}
              targets={targets}
              onMatch={(targetUid) => match.mutate({ itemId: p.itemId, targetUid })}
              busy={match.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentRow({
  payment,
  targets,
  onMatch,
  busy,
}: {
  payment: Payment;
  targets: MatchTarget[];
  onMatch: (uid: string) => void;
  busy: boolean;
}) {
  const [choice, setChoice] = useState('');

  const needsDecision = payment.outcome === 'unmatched' || payment.outcome === 'needs_review';

  // Le payeur a tapé quelque chose qui ressemble à un code : on remonte les
  // dossiers à une lettre près, en tête de liste.
  const suggestions = useMemo(() => {
    if (!payment.rawCode) return [];
    const codes = suggestRegistrationCodes(
      payment.rawCode,
      targets.map((t) => t.code)
    );
    return targets.filter((t) => codes.includes(t.code));
  }, [payment.rawCode, targets]);

  const ticketLabel = payment.ticket
    ? (TICKET_LABELS[payment.ticket as keyof typeof TICKET_LABELS] ?? payment.tierLabel)
    : payment.tierLabel || 'Tarif inconnu';

  return (
    <div className="panel bevel">
      <div className="panel-body">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Ticket size={15} style={{ color: 'var(--s-text-dim)' }} aria-hidden />
              <span className="font-semibold">{ticketLabel}</span>
              <span className="t-mono" style={{ color: 'var(--s-text-dim)' }}>
                {euros(payment.amountCents)}
              </span>
              {payment.state !== 'Processed' && (
                <span className="tag tag-neutral">{payment.state}</span>
              )}
            </div>

            <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Payé par <strong style={{ color: 'var(--s-text)' }}>{payment.payerName || '—'}</strong>
              {payment.payerEmail && ` · ${payment.payerEmail}`}
              {payment.participantName && payment.participantName !== payment.payerName && (
                <> · au nom de {payment.participantName}</>
              )}
            </p>

            <p className="mt-1 text-sm" style={{ color: 'var(--s-text-muted)' }}>
              Code saisi :{' '}
              {payment.rawCode ? (
                <code>{payment.rawCode}</code>
              ) : (
                <em>aucun</em>
              )}
              {' · commande '}
              {payment.orderId}
            </p>
          </div>

          <div className="shrink-0">
            {needsDecision ? (
              <span className="tag tag-gold inline-flex items-center gap-1.5">
                <AlertTriangle size={12} aria-hidden /> à traiter
              </span>
            ) : (
              <span className="tag tag-green inline-flex items-center gap-1.5">
                <CheckCircle2 size={12} aria-hidden /> rattaché
              </span>
            )}
          </div>
        </div>

        {payment.reason && (
          <p
            className="mt-3 border-l-2 pl-3 text-sm"
            style={{ borderColor: 'var(--s-gold)', color: 'var(--s-text-dim)' }}
          >
            {payment.reason}
          </p>
        )}

        {needsDecision && (
          <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--s-border)' }}>
            {suggestions.length > 0 && (
              <div className="mb-3">
                <div className="t-label-soft flex items-center gap-1.5">
                  <HelpCircle size={12} aria-hidden />
                  Dossiers proches du code saisi
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.uid}
                      disabled={busy}
                      onClick={() => onMatch(s.uid)}
                      className="btn-springs btn-secondary bevel-sm text-sm"
                    >
                      {s.label} · {s.code}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                className="settings-input"
                aria-label="Rattacher ce règlement à un dossier"
              >
                <option value="">Rattacher à…</option>
                {targets.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.label} · {t.code}
                    {t.status === 'confirmed' ? ' (déjà réglé)' : ''}
                  </option>
                ))}
              </select>
              <button
                disabled={!choice || busy}
                onClick={() => onMatch(choice)}
                className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2"
              >
                {busy ? (
                  <Loader2 className="animate-spin" size={15} aria-hidden />
                ) : (
                  <Link2 size={15} aria-hidden />
                )}
                Rattacher
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
