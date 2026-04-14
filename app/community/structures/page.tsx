'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Shield, Users, Search, Loader2, Sparkles, ArrowUpDown, Plus } from 'lucide-react';

type StructureCard = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  games: string[];
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  memberCount: number;
};

type SortKey = 'default' | 'alpha' | 'members' | 'recruiting';

export default function StructuresPage() {
  const [structures, setStructures] = useState<StructureCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameFilter, setGameFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');

  const loadStructures = useCallback(async () => {
    setLoading(true);
    try {
      const params = gameFilter ? `?game=${gameFilter}` : '';
      const res = await fetch(`/api/structures${params}`);
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
      }
    } catch (err) {
      console.error('[Structures] load error:', err);
    }
    setLoading(false);
  }, [gameFilter]);

  useEffect(() => {
    loadStructures();
  }, [loadStructures]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? structures.filter(s => s.name.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q))
      : structures;
    const arr = [...base];
    switch (sortKey) {
      case 'alpha':
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'members':
        arr.sort((a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0));
        break;
      case 'recruiting':
        arr.sort((a, b) => Number(b.recruiting?.active) - Number(a.recruiting?.active));
        break;
    }
    return arr;
  }, [structures, search, sortKey]);

  const recruitingCount = structures.filter(s => s.recruiting?.active).length;
  const count = filtered.length;
  const hasFilters = search.trim() !== '' || gameFilter !== '';

  // Densité adaptative : grosses cards si peu de résultats, plus dense si beaucoup
  const gridCols = count < 4 ? 'grid-cols-1 md:grid-cols-2' : count < 9 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-6">
      <div className="relative z-[1] space-y-6">
        {/* Header compact */}
        <header
          className="bevel relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="absolute top-0 left-0 w-40 h-40 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] px-6 py-4 flex items-center gap-5 flex-wrap">
            {/* Titre + compteur */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <Shield size={18} style={{ color: 'var(--s-gold)' }} />
              </div>
              <div>
                <h1 className="font-display text-xl tracking-wider leading-none">STRUCTURES</h1>
                <p className="t-mono text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                  {loading ? 'Chargement…' : `${structures.length} active${structures.length > 1 ? 's' : ''}${recruitingCount > 0 ? ` · ${recruitingCount} recrute${recruitingCount > 1 ? 'nt' : ''}` : ''}`}
                </p>
              </div>
            </div>

            {/* Recherche */}
            <div className="flex-1 relative min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
              <input type="text" className="settings-input w-full pl-9" style={{ fontSize: '14px' }}
                placeholder="Rechercher par nom ou tag…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Filtres jeux */}
            <div className="flex items-center gap-2">
              <FilterChip active={!gameFilter} onClick={() => setGameFilter('')} color="neutral">Tous</FilterChip>
              <FilterChip active={gameFilter === 'rocket_league'} onClick={() => setGameFilter(gameFilter === 'rocket_league' ? '' : 'rocket_league')} color="blue">RL</FilterChip>
              <FilterChip active={gameFilter === 'trackmania'} onClick={() => setGameFilter(gameFilter === 'trackmania' ? '' : 'trackmania')} color="green">TM</FilterChip>
            </div>

            {/* Tri */}
            <div className="relative flex items-center gap-2">
              <ArrowUpDown size={13} style={{ color: 'var(--s-text-muted)' }} />
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="settings-input"
                style={{ fontSize: '12px', padding: '6px 10px', cursor: 'pointer' }}
              >
                <option value="default">Par défaut</option>
                <option value="alpha">A → Z</option>
                <option value="members">Plus de membres</option>
                <option value="recruiting">Qui recrutent en 1er</option>
              </select>
            </div>
          </div>
        </header>

        {/* Compteur de résultats */}
        {!loading && hasFilters && (
          <p className="t-mono text-xs animate-fade-in-d1" style={{ color: 'var(--s-text-muted)' }}>
            {count} résultat{count > 1 ? 's' : ''}
            {count !== structures.length && ` sur ${structures.length}`}
          </p>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} totalCount={structures.length} onReset={() => { setSearch(''); setGameFilter(''); }} />
        ) : (
          <div className={`grid ${gridCols} gap-5 animate-fade-in-d2`}>
            {filtered.map(s => <StructureItem key={s.id} s={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active, onClick, color, children,
}: {
  active: boolean;
  onClick: () => void;
  color: 'neutral' | 'blue' | 'green';
  children: React.ReactNode;
}) {
  const palette = color === 'blue'
    ? { bg: 'rgba(0,129,255,0.12)', fg: 'var(--s-blue)', border: 'rgba(0,129,255,0.35)' }
    : color === 'green'
    ? { bg: 'rgba(0,217,54,0.12)', fg: 'var(--s-green)', border: 'rgba(0,217,54,0.35)' }
    : { bg: 'rgba(255,255,255,0.08)', fg: 'var(--s-text)', border: 'rgba(255,255,255,0.2)' };
  return (
    <button
      type="button"
      onClick={onClick}
      className="tag transition-all duration-150"
      style={{
        background: active ? palette.bg : 'transparent',
        color: active ? palette.fg : 'var(--s-text-muted)',
        borderColor: active ? palette.border : 'var(--s-border)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function StructureItem({ s }: { s: StructureCard }) {
  const isRecruiting = s.recruiting?.active;
  const primaryGame = s.games.includes('rocket_league') ? 'rocket_league' : 'trackmania';
  const accentColor = primaryGame === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
  const glowColor = primaryGame === 'rocket_league' ? 'rgba(0,129,255,0.1)' : 'rgba(0,217,54,0.1)';

  return (
    <Link href={`/community/structure/${s.id}`}
      className="pillar-card bevel relative overflow-hidden group transition-all duration-200">
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 70%)` }} />
      <div className="absolute top-0 right-0 w-40 h-40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: `radial-gradient(circle at 100% 0%, ${glowColor}, transparent 70%)` }} />
      <div className="relative z-[1] p-5">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 flex-shrink-0 relative overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            {s.logoUrl ? (
              <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Shield size={20} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-display text-lg tracking-wider truncate">{s.name}</h3>
              <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 5px', flexShrink: 0 }}>{s.tag}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {s.games.map(g => (
                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                  style={{ fontSize: '9px', padding: '1px 6px' }}>
                  {g === 'rocket_league' ? 'RL' : 'TM'}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px dashed var(--s-border)' }}>
          <div className="flex items-center gap-1.5">
            <Users size={12} style={{ color: 'var(--s-text-muted)' }} />
            <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
              {s.memberCount} membre{s.memberCount > 1 ? 's' : ''}
            </span>
          </div>
          {isRecruiting && (
            <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 7px' }}>RECRUTE</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function EmptyState({
  hasFilters, totalCount, onReset,
}: {
  hasFilters: boolean;
  totalCount: number;
  onReset: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="bevel p-12 text-center animate-fade-in-d2" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <Search size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
        <h3 className="font-display text-lg tracking-wider mb-2">AUCUN RÉSULTAT</h3>
        <p className="t-body mb-5" style={{ color: 'var(--s-text-dim)' }}>
          Aucune structure ne correspond à tes filtres.
        </p>
        <button type="button" onClick={onReset} className="btn-springs btn-secondary bevel-sm">
          Réinitialiser les filtres
        </button>
      </div>
    );
  }
  return (
    <div className="bevel p-12 text-center animate-fade-in-d2 relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,184,0,0.07), transparent 60%)' }} />
      <div className="relative z-[1]">
        <Sparkles size={32} className="mx-auto mb-4" style={{ color: 'var(--s-gold)' }} />
        <h3 className="font-display text-xl tracking-wider mb-2">
          {totalCount === 0 ? 'LA COMMUNAUTÉ DÉMARRE' : 'AUCUNE STRUCTURE ACTIVE'}
        </h3>
        <p className="t-body mb-6 max-w-md mx-auto" style={{ color: 'var(--s-text-dim)' }}>
          {totalCount === 0
            ? 'Sois le premier à créer une structure sur Springs Hub et donne vie à la scène !'
            : 'Aucune structure ne correspond au filtre actuel.'}
        </p>
        <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2">
          <Plus size={14} />
          Créer ma structure
        </Link>
      </div>
    </div>
  );
}
