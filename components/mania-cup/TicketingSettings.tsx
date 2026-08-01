'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket, Save, Loader2, ExternalLink } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';
import type { ManiaCupSettings } from '@/app/api/mania-cup/settings/route';

// Liens de billetterie HelloAsso, renseignés par l'organisateur.
//
// Un lien par tarif, et non un lien unique vers la billetterie : envoyer un
// accompagnant sur la page générique lui ferait choisir le mauvais billet —
// celui à 10 €, qui ne donne pas accès à la zone de jeu. Tant qu'un lien est
// vide, le bouton correspondant reste visible mais désactivé sur le site.

const FIELDS = [
  {
    key: 'ticketingPlayerUrl' as const,
    label: `Billet joueur — ${MANIA_CUP.priceEuros} €`,
    help: 'Utilisé par le bouton « Payer mon inscription » dans l’espace du joueur.',
  },
  {
    key: 'ticketingSpectatorUrl' as const,
    label: `Billets spectateurs — ${MANIA_CUP.spectatorDayEuros} € / ${MANIA_CUP.spectatorTwoDaysEuros} €`,
    help: 'Utilisé sur la page Spectateurs. Peut pointer la billetterie générale si les deux tarifs y figurent.',
  },
  {
    key: 'ticketingCompanionUrl' as const,
    label: `Billet accompagnant — ${MANIA_CUP.companionEuros} €`,
    help: 'Le billet qui donne accès à la zone joueurs. Son formulaire doit demander le code d’inscription du joueur accompagné.',
  },
];

export default function TicketingSettings() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ManiaCupSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mania-cup', 'settings'] as const,
    queryFn: () => apiPublic<{ settings: ManiaCupSettings }>('/api/mania-cup/settings'),
  });

  const save = useMutation({
    mutationFn: (next: ManiaCupSettings) =>
      api<{ settings: ManiaCupSettings }>('/api/mania-cup/settings', {
        method: 'PUT',
        body: next as unknown as Record<string, unknown>,
      }),
    onSuccess: () => {
      setMsg('Liens enregistrés.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup', 'settings'] });
      void qc.invalidateQueries({ queryKey: ['mania-cup', 'settings'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Enregistrement refusé'),
  });

  const current: ManiaCupSettings =
    draft ??
    data?.settings ?? {
      ticketingPlayerUrl: '',
      ticketingSpectatorUrl: '',
      ticketingCompanionUrl: '',
    };

  const filled = FIELDS.filter((f) => current[f.key]).length;

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Ticket size={22} className="text-[#a364d9]" aria-hidden />
          <h2 className="font-display text-2xl">Billetterie HelloAsso</h2>
          <span
            className="text-sm"
            style={{ color: filled === FIELDS.length ? '#22c55e' : '#FFB800' }}
          >
            {filled}/{FIELDS.length} lien{FIELDS.length > 1 ? 's' : ''} renseigné
            {filled > 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          {collapsed ? 'Déplier' : 'Replier'}
        </button>
      </div>

      {!collapsed && (
        <>
          <p className="mt-3 text-sm" style={{ color: 'var(--s-text-dim)' }}>
            Tant qu’un lien est vide, le bouton correspondant s’affiche sur le site en
            « billetterie bientôt ouverte ». Colle ici les adresses de tes tarifs et
            tout s’active.
          </p>

          {isLoading ? (
            <div className="mt-6 flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
              <Loader2 className="animate-spin" size={18} /> Chargement…
            </div>
          ) : (
            <>
              <div className="mt-6 space-y-5">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label htmlFor={f.key} className="block text-sm font-semibold">
                      {f.label}
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id={f.key}
                        value={current[f.key]}
                        onChange={(e) => {
                          setDraft({ ...current, [f.key]: e.target.value });
                          setMsg(null);
                        }}
                        placeholder="https://www.helloasso.com/associations/..."
                        className="w-full border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
                      />
                      {current[f.key] && (
                        <a
                          href={current[f.key]}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Ouvrir le lien"
                          className="shrink-0 border border-white/15 p-2 hover:bg-white/10"
                        >
                          <ExternalLink size={15} aria-hidden />
                        </a>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {f.help}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => save.mutate(current)}
                  disabled={save.isPending || draft === null}
                  className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-40"
                >
                  {save.isPending ? (
                    <Loader2 className="animate-spin" size={16} aria-hidden />
                  ) : (
                    <Save size={16} aria-hidden />
                  )}
                  Enregistrer
                </button>
                {msg && (
                  <span
                    className="text-sm"
                    style={{ color: msg.includes('refus') || msg.includes('doivent') ? '#ef4444' : '#22c55e' }}
                  >
                    {msg}
                  </span>
                )}
              </div>

              <p className="mt-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Seules des adresses HelloAsso en https sont acceptées : c’est une page de
                paiement, un lien collé de travers enverrait les joueurs n’importe où.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
