'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ticket, Save, Loader2, ExternalLink, Euro } from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  type ManiaCupSettings,
  type NumericSettingKey,
} from '@/lib/mania-cup-settings';

// Tarifs, jauge et liens de billetterie — tout ce que Matt doit pouvoir changer
// sans déploiement.
//
// Les tarifs vivaient dans les constantes du code : un cashprize revu à la
// hausse quand un sponsor s'ajoute, une remise négociée, et il aurait fallu
// passer par moi pour un chiffre.

const MONEY: { key: NumericSettingKey; label: string; help?: string }[] = [
  { key: 'priceEuros', label: 'Inscription joueur', help: 'Le tarif affiché partout sur le site.' },
  {
    key: 'spectatorEuros',
    label: 'Spectateur',
    help: 'Un seul billet public, valable les deux jours.',
  },
  {
    key: 'companionEuros',
    label: 'Accompagnant',
    help: 'Le billet qui donne accès à la zone joueurs.',
  },
  {
    key: 'pcRentalEuros',
    label: 'Location de poste',
    help: 'Laisser à 0 tant que le prix n’est pas arrêté : le bouton reste alors muet.',
  },
  { key: 'prizePoolEuros', label: 'Cashprize total' },
];

const LINKS: {
  key: keyof ManiaCupSettings;
  label: string;
  help: string;
  /** La boutique n'existera qu'au moment de louer du matériel : son absence
   *  ne doit pas faire passer l'écran pour incomplet. */
  optional?: boolean;
}[] = [
  {
    key: 'ticketingUrl',
    label: 'Billetterie',
    help: 'La campagne HelloAsso qui porte les trois tarifs. Un seul lien : joueurs, accompagnants et spectateurs achètent au même endroit.',
  },
  {
    key: 'shopUrl',
    label: 'Boutique de location',
    optional: true,
    help: 'La boutique du matériel à louer, quand elle existera. Ses produits doivent aussi demander le code d’inscription.',
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
      setMsg('Enregistré. Le site est à jour.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup', 'settings'] });
      void qc.invalidateQueries({ queryKey: ['mania-cup', 'settings'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Enregistrement refusé'),
  });

  const current: ManiaCupSettings = draft ?? data?.settings ?? DEFAULT_SETTINGS;
  // Seul le lien de la billetterie est indispensable : c'est lui qui décide si
  // un joueur peut payer.
  const requiredLinks = LINKS.filter((f) => !f.optional);
  const filledLinks = requiredLinks.filter((f) => current[f.key]).length;
  const isError = msg?.includes('refus') || msg?.includes('doivent');

  function set<K extends keyof ManiaCupSettings>(key: K, value: ManiaCupSettings[K]) {
    setDraft({ ...current, [key]: value });
    setMsg(null);
  }

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Ticket size={22} className="text-[#a364d9]" aria-hidden />
          <h2 className="font-display text-2xl">Tarifs et billetterie</h2>
          <span
            className="text-sm"
            style={{ color: filledLinks === requiredLinks.length ? '#22c55e' : '#FFB800' }}
          >
            {filledLinks === requiredLinks.length
              ? 'Billetterie reliée'
              : 'Billetterie à relier'}
          </span>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          {collapsed ? 'Déplier' : 'Replier'}
        </button>
      </div>

      {!collapsed &&
        (isLoading ? (
          <div className="mt-6 flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
            <Loader2 className="animate-spin" size={18} /> Chargement…
          </div>
        ) : (
          <>
            {/* ---- Tarifs et jauge ---- */}
            <h3 className="mt-6 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
              <Euro size={15} className="text-[#a364d9]" aria-hidden />
              Tarifs et places
            </h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Ces montants s’affichent sur tout le site — page publique, inscription,
              page spectateurs — et dans les messages envoyés aux joueurs.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MONEY.map((f) => (
                <div key={f.key}>
                  <label htmlFor={f.key} className="block text-sm font-semibold">
                    {f.label}
                  </label>
                  <div className="mt-2 flex items-center">
                    <input
                      id={f.key}
                      type="number"
                      inputMode="numeric"
                      min={SETTINGS_BOUNDS[f.key].min}
                      max={SETTINGS_BOUNDS[f.key].max}
                      value={current[f.key]}
                      onChange={(e) => set(f.key, Number(e.target.value))}
                      className="w-full border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
                    />
                    <span
                      className="border border-l-0 border-white/15 px-3 py-2"
                      style={{ color: 'var(--s-text-dim)' }}
                    >
                      €
                    </span>
                  </div>
                  {f.help && (
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {f.help}
                    </p>
                  )}
                </div>
              ))}

              <div>
                <label htmlFor="maxPlayers" className="block text-sm font-semibold">
                  Nombre de places
                </label>
                <input
                  id="maxPlayers"
                  type="number"
                  inputMode="numeric"
                  min={SETTINGS_BOUNDS.maxPlayers.min}
                  max={SETTINGS_BOUNDS.maxPlayers.max}
                  value={current.maxPlayers}
                  onChange={(e) => set('maxPlayers', Number(e.target.value))}
                  className="mt-2 w-full border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
                />
                <p className="mt-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  La jauge se ferme quand ce nombre d’inscriptions est <em>réglé</em>.
                </p>
              </div>
            </div>

            {/* ---- Liens ---- */}
            <h3 className="mt-8 flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
              <Ticket size={15} className="text-[#a364d9]" aria-hidden />
              Liens HelloAsso
            </h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Une seule campagne HelloAsso porte les trois billets : joueur,
              accompagnant et spectateur mènent au même endroit. Tant que le lien
              est vide, les boutons du site s’affichent en « billetterie bientôt
              ouverte ».
            </p>

            <div className="mt-4 space-y-5">
              {LINKS.map((f) => (
                <div key={f.key}>
                  <label htmlFor={f.key} className="block text-sm font-semibold">
                    {f.label}
                    {f.optional && (
                      <span className="ml-2 font-normal text-[#8d89a8]">facultatif</span>
                    )}
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      id={f.key}
                      value={current[f.key] as string}
                      onChange={(e) => set(f.key, e.target.value as never)}
                      placeholder="https://www.helloasso.com/associations/..."
                      className="w-full border border-white/15 bg-black/40 px-3 py-2 text-white outline-none focus:border-[#00D936]"
                    />
                    {current[f.key] && (
                      <a
                        href={current[f.key] as string}
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
                <span className="text-sm" style={{ color: isError ? '#ef4444' : '#22c55e' }}>
                  {msg}
                </span>
              )}
            </div>

            <p className="mt-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Seules des adresses HelloAsso en https sont acceptées : c’est une page de
              paiement, un lien collé de travers enverrait les joueurs n’importe où.
            </p>
          </>
        ))}
    </section>
  );
}
