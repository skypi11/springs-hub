'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { User, Search, Loader2, Gamepad2, ArrowUpDown, Sparkles, Star } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';

type PlayerCard = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
  games: string[];
  isAvailableForRecruitment: boolean;
  recruitmentRole: string;
  recruitmentMessage: string;
  rlRank: string;
  rlMmr: number | null;
  rlIconUrl: string;
  pseudoTM: string;
  tmTrophies: number | null;
  tmEchelon: number | null;
  structurePerGame: Record<string, string>;
};

type SortKey = 'default' | 'alpha' | 'available' | 'mmr';

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameFilter, setGameFilter] = useState('');
  const [recruitingFilter, setRecruitingFilter] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gameFilter) params.set('game', gameFilter);
      if (recruitingFilter) params.set('recruiting', 'true');
      const res = await fetch(`/api/players?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players ?? []);
      }
    } catch (err) {
      console.error('[Players] load error:', err);
    }
    setLoading(false);
  }, [gameFilter, recruitingFilter]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? players.filter(p =>
          p.displayName.toLowerCase().includes(q) ||
          (p.pseudoTM && p.pseudoTM.toLowerCase().includes(q))
        )
      : players;
    const arr = [...base];
    switch (sortKey) {
      case 'alpha':
        arr.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
      case 'available':
        arr.sort((a, b) => Number(b.isAvailableForRecruitment) - Number(a.isAvailableForRecruitment));
        break;
      case 'mmr':
        arr.sort((a, b) => (b.rlMmr ?? -1) - (a.rlMmr ?? -1));
        break;
    }
    return arr;
  }, [players, search, sortKey]);

  const availableCount = players.filter(p => p.isAvailableForRecruitment).length;
  const count = filtered.length;
  const hasFilters = search.trim() !== '' || gameFilter !== '' || recruitingFilter;

  const gridCols = count < 4
    ? 'grid-cols-1 md:grid-cols-2'
    : count < 9
    ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-6">
      <div className="relative z-[1] space-y-6">
        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Joueurs' },
        ]} />
        {/* Header compact */}
        <header
          className="bevel relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-blue), rgba(0,129,255,0.3), transparent 70%)' }} />
          <div className="absolute top-0 left-0 w-40 h-40 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(0,129,255,0.06), transparent 60%)' }} />
          <div className="relative z-[1] px-6 py-4 flex items-center gap-5 flex-wrap">
            {/* Titre + compteur */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'rgba(0,129,255,0.08)', border: '1px solid rgba(0,129,255,0.2)' }}>
                <User size={18} style={{ color: 'var(--s-blue)' }} />
              </div>
              <div>
                <h1 className="font-display text-xl tracking-wider leading-none">JOUEURS</h1>
                <p className="t-mono text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                  {loading ? 'Chargement…' : `${players.length} joueur${players.length > 1 ? 's' : ''}${availableCount > 0 ? ` · ${availableCount} disponible${availableCount > 1 ? 's' : ''}` : ''}`}
                </p>
              </div>
            </div>

            {/* Recherche */}
            <div className="flex-1 relative min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
              <input type="text" className="settings-input w-full pl-9" style={{ fontSize: '14px' }}
                placeholder="Rechercher par pseudo ou pseudo TM…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Filtres jeux */}
            <div className="flex items-center gap-2">
              <FilterChip active={!gameFilter} onClick={() => setGameFilter('')} color="neutral">Tous</FilterChip>
              <FilterChip active={gameFilter === 'rocket_league'} onClick={() => setGameFilter(gameFilter === 'rocket_league' ? '' : 'rocket_league')} color="blue">RL</FilterChip>
              <FilterChip active={gameFilter === 'trackmania'} onClick={() => setGameFilter(gameFilter === 'trackmania' ? '' : 'trackmania')} color="green">TM</FilterChip>
            </div>

            {/* Disponibles */}
            <FilterChip
              active={recruitingFilter}
              onClick={() => setRecruitingFilter(!recruitingFilter)}
              color="green"
            >
              <Star size={10} style={{ marginRight: '4px' }} />
              Dispo au recrutement
            </FilterChip>

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
                <option value="available">Disponibles en 1er</option>
                <option value="mmr">MMR RL décroissant</option>
              </select>
            </div>
          </div>
        </header>

        {/* Compteur de résultats */}
        {!loading && hasFilters && (
          <p className="t-mono text-xs animate-fade-in-d1" style={{ color: 'var(--s-text-muted)' }}>
            {count} résultat{count > 1 ? 's' : ''}
            {count !== players.length && ` sur ${players.length}`}
          </p>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasFilters={hasFilters}
            totalCount={players.length}
            onReset={() => { setSearch(''); setGameFilter(''); setRecruitingFilter(false); }}
          />
        ) : (
          <div className={`grid ${gridCols} gap-4 animate-fade-in-d2`}>
            {filtered.map(p => <PlayerItem key={p.uid} p={p} />)}
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
    ? { bg: 'rgba(0,217,54,0.12)', fg: '#33ff66', border: 'rgba(0,217,54,0.35)' }
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

function PlayerItem({ p }: { p: PlayerCard }) {
  const avatar = p.avatarUrl || p.discordAvatar;
  const hasAny = p.rlRank || p.pseudoTM;

  return (
    <Link href={`/profile/${p.uid}`}
      className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      {/* Accent top */}
      {p.isAvailableForRecruitment && (
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-green), transparent 80%)' }} />
      )}
      <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.05), transparent 70%)' }} />
      <div className="relative z-[1] p-4">
        <div className="flex items-center gap-3 mb-3">
          {avatar ? (
            <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Image src={avatar} alt={p.displayName} fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <User size={16} style={{ color: 'var(--s-text-muted)' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {p.country && (
                <Image src={`https://flagcdn.com/16x12/${p.country.toLowerCase()}.png`}
                  alt={p.country} width={14} height={10} className="flex-shrink-0" unoptimized />
              )}
              <div className="flex gap-1">
                {p.games.map(g => (
                  <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                    style={{ fontSize: '9px', padding: '1px 5px' }}>
                    {g === 'rocket_league' ? 'RL' : 'TM'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        {hasAny && (
          <div className="space-y-1.5 pt-3 mt-3" style={{ borderTop: '1px dashed var(--s-border)' }}>
            {p.rlRank && (
              <div className="flex items-center gap-2">
                {p.rlIconUrl && <Image src={p.rlIconUrl} alt="" width={14} height={14} unoptimized />}
                <span className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>{p.rlRank}</span>
              </div>
            )}
            {p.pseudoTM && (
              <div className="flex items-center gap-2">
                <Gamepad2 size={11} style={{ color: 'var(--s-green)' }} />
                <span className="text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>{p.pseudoTM}</span>
              </div>
            )}
          </div>
        )}

        {/* Badge recrutement */}
        {p.isAvailableForRecruitment && (
          <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid rgba(0,217,54,0.2)' }}>
            <div className="flex items-center gap-1.5">
              <Star size={11} style={{ color: '#33ff66', fill: '#33ff66' }} />
              <span className="text-xs font-bold" style={{ color: '#33ff66' }}>
                Cherche {ROLE_LABELS[p.recruitmentRole] || 'équipe'}
              </span>
            </div>
            {p.recruitmentMessage && (
              <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--s-text-muted)' }}>
                {p.recruitmentMessage}
              </p>
            )}
          </div>
        )}
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
          Aucun joueur ne correspond à tes filtres.
        </p>
        <button type="button" onClick={onReset} className="btn-springs btn-secondary bevel-sm">
          Réinitialiser les filtres
        </button>
      </div>
    );
  }
  return (
    <div className="bevel p-12 text-center animate-fade-in-d2 relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,129,255,0.07), transparent 60%)' }} />
      <div className="relative z-[1]">
        <Sparkles size={32} className="mx-auto mb-4" style={{ color: 'var(--s-blue)' }} />
        <h3 className="font-display text-xl tracking-wider mb-2">
          {totalCount === 0 ? 'PERSONNE N\'EST ENCORE INSCRIT' : 'AUCUN JOUEUR DISPONIBLE'}
        </h3>
        <p className="t-body mb-6 max-w-md mx-auto" style={{ color: 'var(--s-text-dim)' }}>
          {totalCount === 0
            ? 'Sois le premier joueur Springs — crée ton profil et rejoins la communauté.'
            : 'Personne n\'est marqué comme disponible au recrutement pour l\'instant.'}
        </p>
        <Link href="/settings" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2">
          <Star size={14} />
          Marque-toi disponible
        </Link>
      </div>
    </div>
  );
}
