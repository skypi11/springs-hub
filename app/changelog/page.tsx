'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { Sparkles } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { api } from '@/lib/api-client';
import { useAuth } from '@/context/AuthContext';
import {
  ALL_CHANGELOG_CATEGORIES,
  getChangelogCategory,
  type ChangelogCategory,
} from '@/lib/changelog-categories';
import {
  parseChangelogSections,
  dominantCategory,
  type ChangelogSection,
} from '@/lib/changelog-auto-tag';

interface ChangelogItem {
  id: string;
  key: string;
  title: string;
  description: string;
  category: string;       // catégorie "principale" override admin (fallback si pas de sections)
  publishedAt: string;
}

interface ParsedItem extends ChangelogItem {
  sections: ChangelogSection[];
  /** Catégorie d'avatar de la card : override admin si défini, sinon dominante des sections */
  mainCategory: ChangelogCategory;
  /** Set des catégories présentes (sections + main) pour filtrage rapide */
  allCategories: Set<ChangelogCategory>;
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
  const { firebaseUser, refreshProfile } = useAuth();
  const [filter, setFilter] = useState<ChangelogCategory | 'all'>('all');

  const { data, isPending } = useQuery({
    queryKey: ['changelog'] as const,
    queryFn: () => api<{ items: ChangelogItem[] }>('/api/changelog'),
    staleTime: 60_000,
  });

  // Mark as seen au mount + recharge le profil pour que le dot rouge
  // sidebar disparaisse immédiatement (sans attendre un F5).
  useEffect(() => {
    if (!firebaseUser) return;
    api('/api/profile/mark-changelog-seen', { method: 'POST' })
      .then(() => refreshProfile())
      .catch(() => {
        // Silencieux : non bloquant.
      });
  }, [firebaseUser, refreshProfile]);

  // Pré-parse toutes les descriptions en sections. Mémoïsé pour éviter
  // le re-parse à chaque changement de filtre.
  const items = data?.items ?? [];
  const parsed = useMemo<ParsedItem[]>(() => {
    return items.map(it => {
      const sections = parseChangelogSections(it.description);
      // Catégorie principale = override admin si valide, sinon dominante des sections
      const adminMain = getChangelogCategory(it.category).id;
      const main = sections.length > 0 ? dominantCategory(sections) : adminMain;
      const all = new Set<ChangelogCategory>([main]);
      for (const s of sections) all.add(s.category);
      return {
        ...it,
        sections,
        mainCategory: main,
        allCategories: all,
      };
    });
  }, [items]);

  // Filtre : pour chaque card, on filtre les sections matching. Une card est
  // affichée si elle a au moins une section matching (ou si filter === 'all').
  const filtered = useMemo<ParsedItem[]>(() => {
    if (filter === 'all') return parsed;
    return parsed
      .filter(it => it.allCategories.has(filter))
      .map(it => ({
        ...it,
        // On garde aussi les sections sans catégorie (intro) pour préserver le contexte
        sections: it.sections.filter(s => s.category === filter),
      }));
  }, [parsed, filter]);

  // Compteurs par catégorie sur l'ensemble (pas le filtré)
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const it of parsed) {
      for (const cat of it.allCategories) {
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
    return counts;
  }, [parsed]);

  // Groupage par mois
  const grouped = useMemo(() => {
    const map = new Map<string, ParsedItem[]>();
    for (const i of filtered) {
      const monthKey = i.publishedAt.slice(0, 7);
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
                Tout ce qui a changé sur Aedral, du plus récent au plus ancien.
              </p>
            </div>
          </div>
        </header>

        {/* Filtres par catégorie */}
        {parsed.length > 0 && (
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
              Tous · {parsed.length}
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

        {/* Loading : skeletons cohérents avec la card timeline plutôt qu'un
            spinner brut (audit 30/05 polish #10). 3 cards = approximation
            visuelle de ce qui s'affiche à hover, pas trop long pour la 1ère
            paint. */}
        {isPending && (
          <div className="space-y-4">
            <SkeletonCard height={140} />
            <SkeletonCard height={140} />
            <SkeletonCard height={140} />
          </div>
        )}

        {/* Empty (no items) */}
        {!isPending && parsed.length === 0 && (
          <div className="bevel p-10 text-center animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <Sparkles size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
            <h2 className="font-display text-xl mb-2">Aucune nouveauté pour l'instant</h2>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
              Reviens plus tard pour voir les évolutions du site.
            </p>
          </div>
        )}

        {/* Empty (filtré) */}
        {!isPending && parsed.length > 0 && filtered.length === 0 && (
          <div className="bevel p-8 text-center animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
              Aucun patch dans cette catégorie.
            </p>
          </div>
        )}

        {/* Timeline groupée par mois */}
        {!isPending && grouped.length > 0 && (
          <div className="space-y-10">
            {grouped.map(({ month, items: monthItems }) => (
              <section key={month} className="space-y-4 animate-fade-in">
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

                <div className="space-y-4">
                  {monthItems.map((item, idx) => (
                    <ChangelogCard key={item.id} item={item} delayMs={idx * 50} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card patch ─────────────────────────────────────────────────────────────

function ChangelogCard({ item, delayMs }: { item: ParsedItem; delayMs: number }) {
  const mainCat = getChangelogCategory(item.mainCategory);

  return (
    <article
      id={item.key}
      className="bevel relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', animationDelay: `${delayMs}ms` }}
    >
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${mainCat.color}, ${mainCat.color}50, transparent 70%)` }}
      />
      <div
        className="absolute top-0 right-0 w-48 h-48 pointer-events-none opacity-[0.08]"
        style={{ background: `radial-gradient(circle at top right, ${mainCat.color}, transparent 70%)` }}
      />
      <div className="relative z-[1] p-5 sm:p-6 space-y-4">
        {/* Header card */}
        <div className="flex items-start gap-3 flex-wrap">
          <div
            className="flex-shrink-0 flex items-center justify-center bevel-sm"
            style={{
              width: 44,
              height: 44,
              background: `rgba(${mainCat.colorRgb}, 0.10)`,
              border: `1px solid rgba(${mainCat.colorRgb}, 0.25)`,
              fontSize: 22,
            }}
          >
            {mainCat.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {/* Tags de toutes les catégories présentes (multi) */}
              {Array.from(item.allCategories).map(catId => {
                const cat = getChangelogCategory(catId);
                return (
                  <span
                    key={catId}
                    className="tag"
                    style={{
                      fontSize: '12px',
                      background: `rgba(${cat.colorRgb}, 0.12)`,
                      color: cat.color,
                      borderColor: `rgba(${cat.colorRgb}, 0.30)`,
                      padding: '2px 8px',
                    }}
                    title={cat.hint}
                  >
                    {cat.emoji} {cat.label.toUpperCase()}
                  </span>
                );
              })}
              <span className="t-mono text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
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

        {/* Sections, chacune avec son sous-tag de catégorie */}
        {item.sections.length === 0 ? (
          // Pas de sections détectées : fallback rendu markdown brut
          <div className="prose-springs text-sm max-w-none" style={{ color: 'var(--s-text-dim)' }}>
            <ReactMarkdown>{item.description}</ReactMarkdown>
          </div>
        ) : (
          <div className="space-y-4">
            {item.sections.map((section, sIdx) => (
              <ChangelogSectionBlock key={sIdx} section={section} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Section block ──────────────────────────────────────────────────────────

function ChangelogSectionBlock({ section }: { section: ChangelogSection }) {
  const cat = getChangelogCategory(section.category);
  const hasTitle = !!section.title;

  return (
    <div
      className="relative"
      style={{
        paddingLeft: hasTitle ? 16 : 0,
        borderLeft: hasTitle ? `2px solid rgba(${cat.colorRgb}, 0.25)` : 'none',
      }}
    >
      {hasTitle && (
        <div className="flex items-start gap-2 mb-2 flex-wrap">
          <h3
            className="font-display text-sm sm:text-base"
            style={{ letterSpacing: '0.02em', color: 'var(--s-text)' }}
          >
            {section.emoji && <span className="mr-1.5">{section.emoji}</span>}
            {section.title}
          </h3>
          <span
            className="tag"
            style={{
              fontSize: '12px',
              background: `rgba(${cat.colorRgb}, 0.10)`,
              color: cat.color,
              borderColor: `rgba(${cat.colorRgb}, 0.25)`,
              padding: '2px 6px',
            }}
          >
            {cat.label.toUpperCase()}
          </span>
        </div>
      )}
      {section.body && (
        <div className="prose-springs text-sm max-w-none" style={{ color: 'var(--s-text-dim)' }}>
          <ReactMarkdown>{section.body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
