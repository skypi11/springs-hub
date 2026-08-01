'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HelpCircle, Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2, Sparkles,
} from 'lucide-react';
import { api, apiPublic, ApiError } from '@/lib/api-client';
import { FAQ_LIMITS, FAQ_SUGGESTIONS, type FaqItem } from '@/lib/mania-cup-faq';

// Éditeur de FAQ, en blocs question/réponse.
//
// Un éditeur markdown obligerait l'organisateur à respecter une convention de
// titres pour que l'accordéon public fonctionne — une contrainte invisible qui
// casse au premier oubli. Ici la structure EST le formulaire : ce qu'il voit
// correspond exactement à ce que verront les joueurs.

export default function FaqEditor() {
  const qc = useQueryClient();
  // Brouillon local superposé aux données : tant qu'il est nul, on affiche ce
  // qui est publié ; dès la première frappe, c'est le brouillon qui gouverne.
  // Recopier la base dans un état via un effet écraserait une saisie en cours
  // au moindre rafraîchissement de la requête.
  const [draft, setDraft] = useState<FaqItem[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'mania-cup', 'faq'] as const,
    queryFn: () => apiPublic<{ items: FaqItem[] }>('/api/mania-cup/faq'),
  });

  const save = useMutation({
    mutationFn: (next: FaqItem[]) =>
      api<{ items: FaqItem[] }>('/api/mania-cup/faq', { method: 'PUT', body: { items: next } }),
    onSuccess: (r) => {
      setMsg(`${r.items.length} question${r.items.length > 1 ? 's' : ''} publiée${r.items.length > 1 ? 's' : ''}.`);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'mania-cup', 'faq'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'Enregistrement refusé'),
  });

  const list = draft ?? data?.items ?? [];

  function update(i: number, patch: Partial<FaqItem>) {
    setDraft(list.map((it, k) => (k === i ? { ...it, ...patch } : it)));
    setMsg(null);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  }

  return (
    <section className="mt-8 border border-white/10 bg-white/[0.02] p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <HelpCircle size={22} className="text-[#a364d9]" aria-hidden />
          <h2 className="font-display text-2xl">Questions fréquentes</h2>
          <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
            {list.length} question{list.length > 1 ? 's' : ''}
          </span>
        </div>
        <a
          href="/mania-cup/faq"
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
          style={{ color: 'var(--s-text-dim)' }}
        >
          Voir la page publique
        </a>
      </div>

      <p className="mt-3 text-sm" style={{ color: 'var(--s-text-dim)' }}>
        Chaque bloc devient une question dépliable sur le site. Les réponses acceptent
        le gras avec <code>**deux astérisques**</code> et les listes avec un tiret.
      </p>

      {isLoading ? (
        <div className="mt-6 flex items-center gap-3" style={{ color: 'var(--s-text-dim)' }}>
          <Loader2 className="animate-spin" size={18} /> Chargement…
        </div>
      ) : (
        <>
          {list.length === 0 && (
            <div className="mt-6 border border-dashed border-white/20 p-6 text-center">
              <p style={{ color: 'var(--s-text-dim)' }}>Aucune question pour l’instant.</p>
              <button
                onClick={() => setDraft(FAQ_SUGGESTIONS)}
                className="mt-4 inline-flex items-center gap-2 border border-[#a364d9]/50 px-4 py-2 text-sm hover:bg-[#7B2FBE]/20"
              >
                <Sparkles size={15} aria-hidden />
                Partir des {FAQ_SUGGESTIONS.length} questions suggérées
              </button>
              <p className="mt-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Elles reprennent ce qu’on s’est dit. Rien n’est publié tant que tu
                n’enregistres pas.
              </p>
            </div>
          )}

          <div className="mt-6 space-y-4">
            {list.map((it, i) => (
              <div key={i} className="border border-white/10 bg-black/30 p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-3 w-6 shrink-0 text-right text-sm"
                    style={{ color: 'var(--s-text-muted)' }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <input
                      value={it.q}
                      maxLength={FAQ_LIMITS.question}
                      onChange={(e) => update(i, { q: e.target.value })}
                      placeholder="La question, telle qu’un joueur la poserait"
                      className="w-full border border-white/15 bg-black/40 px-3 py-2 font-semibold text-white outline-none focus:border-[#00D936]"
                    />
                    <textarea
                      value={it.a}
                      rows={3}
                      maxLength={FAQ_LIMITS.answer}
                      onChange={(e) => update(i, { a: e.target.value })}
                      placeholder="La réponse"
                      className="w-full resize-y border border-white/15 bg-black/40 px-3 py-2 text-[#c9c5d8] outline-none focus:border-[#00D936]"
                    />
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Monter"
                      className="border border-white/15 p-1.5 hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronUp size={14} aria-hidden />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === list.length - 1}
                      aria-label="Descendre"
                      className="border border-white/15 p-1.5 hover:bg-white/10 disabled:opacity-30"
                    >
                      <ChevronDown size={14} aria-hidden />
                    </button>
                    <button
                      onClick={() => setDraft(list.filter((_, k) => k !== i))}
                      aria-label="Supprimer"
                      className="border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button
              onClick={() => setDraft([...list, { q: '', a: '' }])}
              disabled={list.length >= FAQ_LIMITS.items}
              className="inline-flex items-center gap-2 border border-white/20 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
            >
              <Plus size={15} aria-hidden />
              Ajouter une question
            </button>

            <button
              onClick={() => save.mutate(list)}
              disabled={save.isPending}
              className="inline-flex items-center gap-2 bg-[#00D936] px-5 py-2.5 font-bold text-[#07050b] disabled:opacity-40"
            >
              {save.isPending ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <Save size={16} aria-hidden />
              )}
              Enregistrer
            </button>

            {msg && <span className="text-sm text-[#00D936]">{msg}</span>}
          </div>

          <p className="mt-3 text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Les blocs laissés vides sont ignorés à l’enregistrement.
          </p>
        </>
      )}
    </section>
  );
}
