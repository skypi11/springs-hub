'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Loader2 } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { api } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  ALL_CHANGELOG_CATEGORIES,
  getChangelogCategory,
  type ChangelogCategory,
} from '@/lib/changelog-categories';

interface ChangelogItem {
  id: string;
  key: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export default function ChangelogPage() {
  const { firebaseUser } = useAuth();
  const [filter, setFilter] = useState<ChangelogCategory | 'all'>('all');

  const { data, isPending } = useQuery({
    queryKey: ['changelog'] as const,
    queryFn: () => api<{ items: ChangelogItem[] }>('/api/changelog'),
    // Pas besoin de refetch agressif — la timeline change rarement
    staleTime: 60_000,
  });

  // Mark as seen au mount (silencieux, ignore les erreurs).
  // Le user authentifié signale au serveur qu'il a vu la page → reset le dot rouge sidebar.
  useEffect(() => {
    if (!firebaseUser) return;
    api('/api/profile/mark-changelog-seen', { method: 'POST' }).catch(() => {
      // Silencieux : non bloquant. Le dot restera mais l'user a vu la page.
    });
  }, [firebaseUser]);

  const items = data?.items ?? [];
  const filtered = useMemo(
    () => filter === 'all' ? items : items.filter(i => i.category === filter),
    [items, filter]
  );

  // Compteurs par catégorie (sur l'ensemble, pas le filtré — montre le scope)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.category] = (counts[i.category] ?? 0) + 1;
    return counts;
  }, [items]);

  // Groupage par mois pour les séparateurs visuels de la timeline
  const grouped = useMemo(() => {
    const map = new Map<string, ChangelogItem[]>();
    for (const i of filtered) {
      const monthKey = i.publishedAt.slice(0, 7); // YYYY-MM
      const arr = map.get(monthKey) ?? [];
      arr.push(i);
      map.set(monthKey, arr);
    }
    return Array.from(map.entries()).map(([month, items]) => ({ month, items }));
  }, [filtered]);

  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
      <CompactStickyHeader
        icon={Sparkles}
        title="Nouveautés"
        accent="var(--s-gold)"
      />
      <div className="relative z-[1] space-y-8 max-w-4xl mx-auto">
        <Breadcrumbs items={[{ label: 'Nouveautés' }]} />

        {/* Header */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.4), transparent 70%)' }} />
          <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-5 sm:p-6 flex items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <Sparkles size={22} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-2xl sm:text-3xl lg:text-4xl" style={{ letterSpacing: '0.04em' }}>NOUVEAUTÉS</h1>
              <p className="t-body mt-1" style={{ color: 'var(--s-text-dim)' }}>
                Tout ce qui a changé sur Aedral, dans l'ordre du plus récent.
              </p>
            </div>
          </div>
        </header>

        {/* Filtres par catégorie */}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="tag transition-all duration-150"
              style={{
                background: filter === 'all' ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: filter === 'all' ? 'var(--s-text)' : 'var(--s-text-muted)',
                borderColor: filter === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--s-border)',
                cursor: 'pointer',
                padding: '6px 12px',
                fontSize: '12px',
              }}
            >
              Tous · {items.length}
            </button>
            {ALL_CHANGELOG_CATEGORIES.map(cat => {
              const count = categoryCounts[cat.id] ?? 0;
              if (count === 0) return null;
              const active = filter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setFilter(active ? 'all' : cat.id)}
                  className="tag transition-all duration-150 flex items-center gap-1.5"
                  style={{
                    background: active ? `rgba(${cat.colorRgb}, 0.12)` : 'transparent',
                    color: active ? cat.color : 'var(--s-text-muted)',
                    borderColor: active ? `rgba(${cat.colorRgb}, 0.35)` : 'var(--s-border)',
                    cursor: 'pointer',
                    padding: '6px 12px',
                    fontSize: '12px',
                  }}
                >
                  <span>{cat.emoji}</span>
                  {cat.label} · {count}
                </button>
              );
            })}
          </div>
        )}

        {/* Loading */}
        {isPending && (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        )}

        {/* Empty */}
        {!isPending && items.length === 0 && (
          <div className="bevel p-10 text-center animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <Sparkles size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
            <h2 className="font-display text-xl mb-2">Aucune nouveauté pour l'instant</h2>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
              Reviens plus tard pour voir les évolutions du site.
            </p>
          </div>
        )}

        {/* Timeline groupée par mois */}
        {!isPending && grouped.length > 0 && (
          <div className="space-y-10">
            {grouped.map(({ month, items: monthItems }) => (
              <section key={month} className="space-y-4 animate-fade-in">
                {/* Séparateur de mois */}
                <div className="flex items-center gap-3">
                  <span
                    className="font-display text-sm tracking-wider"
                    style={{ color: 'var(--s-gold)', textTransform: 'uppercase' }}
                  >
                    {fmtMonth(monthItems[0].publishedAt)}
                  </span>
                  <div
                    className="flex-1 h-px"
                    style={{ background: 'linear-gradient(90deg, rgba(255,184,0,0.3), transparent)' }}
                  />
                  <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    {monthItems.length} {monthItems.length > 1 ? 'patchs' : 'patch'}
                  </span>
                </div>

                {/* Cards de patch */}
                <div className="space-y-4">
                  {monthItems.map((item, idx) => {
                    const cat = getChangelogCategory(item.category);
                    return (
                      <article
                        key={item.id}
                        id={item.key}
                        className="bevel relative overflow-hidden"
                        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', animationDelay: `${idx * 50}ms` }}
                      >
                        <div
                          className="h-[3px]"
                          style={{ background: `linear-gradient(90deg, ${cat.color}, ${cat.color}50, transparent 70%)` }}
                        />
                        <div
                          className="absolute top-0 right-0 w-48 h-48 pointer-events-none opacity-[0.08]"
                          style={{ background: `radial-gradient(circle at top right, ${cat.color}, transparent 70%)` }}
                        />
                        <div className="relative z-[1] p-5 sm:p-6 space-y-3">
                          {/* Header card */}
                          <div className="flex items-start gap-3 flex-wrap">
                            <div
                              className="flex-shrink-0 flex items-center justify-center bevel-sm"
                              style={{
                                width: 40,
                                height: 40,
                                background: `rgba(${cat.colorRgb}, 0.10)`,
                                border: `1px solid rgba(${cat.colorRgb}, 0.25)`,
                                fontSize: 20,
                              }}
                            >
                              {cat.emoji}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span
                                  className="tag"
                                  style={{
                                    fontSize: '10px',
                                    background: `rgba(${cat.colorRgb}, 0.12)`,
                                    color: cat.color,
                                    borderColor: `rgba(${cat.colorRgb}, 0.30)`,
                                    padding: '2px 6px',
                                  }}
                                >
                                  {cat.label.toUpperCase()}
                                </span>
                                <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                  {fmtDate(item.publishedAt)}
                                </span>
                              </div>
                              <h2
                                className="font-display text-lg sm:text-xl"
                                style={{ letterSpacing: '0.02em', color: 'var(--s-text)' }}
                              >
                                {item.title}
                              </h2>
                            </div>
                          </div>

                          {/* Body markdown — rendu avec le prose Aedral */}
                          <div className="prose-springs text-sm max-w-none" style={{ color: 'var(--s-text-dim)' }}>
                            <ReactMarkdown>{item.description}</ReactMarkdown>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
