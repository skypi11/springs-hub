'use client';

import { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { User, Search, Gamepad2, ArrowUpDown, Sparkles, Star, Target, SlidersHorizontal, X, Bookmark, BookmarkCheck, Link2, Check } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import InviteToStructureButton from '@/components/community/InviteToStructureButton';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';

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

type SortKey = 'default' | 'alpha' | 'available' | 'mmr' | 'match';

type OpenPosition = { game: string; role: string };

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

const GAME_SHORT: Record<string, string> = {
  rocket_league: 'RL',
  trackmania: 'TM',
};

// Retourne la liste (dédupliquée) des positions ouvertes qui matchent un joueur.
// Un match = le poste ouvert a le même `role` que le `recruitmentRole` du joueur
// ET le jeu du poste est dans les jeux pratiqués par le joueur.
function matchPositions(
  playerRole: string,
  playerGames: string[],
  positions: OpenPosition[]
): OpenPosition[] {
  if (!playerRole || positions.length === 0) return [];
  const matches: OpenPosition[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    if (p.role !== playerRole) continue;
    if (!playerGames.includes(p.game)) continue;
    const key = `${p.game}:${p.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(p);
  }
  return matches;
}

export default function PlayersPage() {
  const { firebaseUser } = useAuth();
  const [gameFilter, setGameFilter] = useState('');
  const [recruitingFilter, setRecruitingFilter] = useState(false);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [mmrMin, setMmrMin] = useState('');
  const [mmrMax, setMmrMax] = useState('');
  const [echelonMin, setEchelonMin] = useState('');
  const [echelonMax, setEchelonMax] = useState('');
  const [noStructureFilter, setNoStructureFilter] = useState(false);
  const [localShortlist, setLocalShortlist] = useState<Set<string>>(new Set());
  const [copiedLinkFor, setCopiedLinkFor] = useState<string | null>(null);

  const playersQ = useQuery({
    queryKey: ['players', { game: gameFilter, recruiting: recruitingFilter }] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (gameFilter) params.set('game', gameFilter);
      if (recruitingFilter) params.set('recruiting', 'true');
      return api<{ players: PlayerCard[] }>(`/api/players?${params.toString()}`);
    },
  });
  const players = playersQ.data?.players ?? [];
  const loading = playersQ.isPending;

  type StructureMy = {
    id: string;
    status: string;
    accessLevel?: string;
    managerIds?: string[];
    recruiting?: { active?: boolean; positions?: { game?: string; role?: string }[] };
  };
  const myStructuresQ = useQuery({
    queryKey: ['structures', 'my'] as const,
    queryFn: () => api<{ structures: StructureMy[] }>('/api/structures/my'),
    enabled: !!firebaseUser,
  });

  const { viewerOpenPositions, viewerStructureId } = useMemo(() => {
    if (!firebaseUser || !myStructuresQ.data) {
      return { viewerOpenPositions: [] as OpenPosition[], viewerStructureId: null as string | null };
    }
    const positions: OpenPosition[] = [];
    let firstRecruiterActive: string | null = null;
    const uid = firebaseUser.uid;
    for (const s of myStructuresQ.data.structures || []) {
      if (s.status !== 'active') continue;
      const isDirigeant = s.accessLevel === 'dirigeant';
      const isManager = (s.managerIds ?? []).includes(uid);
      if (!isDirigeant && !isManager) continue;
      if (!firstRecruiterActive) firstRecruiterActive = s.id;
      if (!s.recruiting?.active) continue;
      for (const p of s.recruiting.positions || []) {
        if (p?.game && p?.role) positions.push({ game: p.game, role: p.role });
      }
    }
    return { viewerOpenPositions: positions, viewerStructureId: firstRecruiterActive };
  }, [firebaseUser, myStructuresQ.data]);

  const shortlistQ = useQuery({
    queryKey: ['structures', viewerStructureId, 'shortlist'] as const,
    queryFn: () => api<{ shortlist: { uid: string }[] }>(`/api/structures/${viewerStructureId}/shortlist`),
    enabled: !!firebaseUser && !!viewerStructureId,
  });
  const serverShortlistIds = useMemo(() => {
    return new Set<string>((shortlistQ.data?.shortlist ?? []).map(s => s.uid));
  }, [shortlistQ.data]);
  const shortlistIds = useMemo(() => {
    if (localShortlist.size === 0) return serverShortlistIds;
    const merged = new Set(serverShortlistIds);
    for (const id of localShortlist) merged.has(id) ? merged.delete(id) : merged.add(id);
    return merged;
  }, [serverShortlistIds, localShortlist]);

  const generateTargetedLink = useCallback(async (targetUid: string, targetGame: string) => {
    if (!firebaseUser || !viewerStructureId) return;
    try {
      const data = await api<{ token?: string }>('/api/structures/invitations', {
        method: 'POST',
        body: {
          action: 'create_link',
          structureId: viewerStructureId,
          targetUserId: targetUid,
          game: targetGame,
        },
      });
      if (!data.token) {
        alert('Impossible de générer le lien');
        return;
      }
      const url = `${window.location.origin}/community/join/${data.token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt('Lien copié impossible — copie manuellement :', url);
      }
      setCopiedLinkFor(targetUid);
      setTimeout(() => setCopiedLinkFor(prev => (prev === targetUid ? null : prev)), 2000);
    } catch {
      alert('Erreur réseau');
    }
  }, [firebaseUser, viewerStructureId]);

  const toggleShortlist = useCallback(async (targetUid: string) => {
    if (!firebaseUser || !viewerStructureId) return;
    const alreadyIn = shortlistIds.has(targetUid);
    setLocalShortlist(prev => {
      const next = new Set(prev);
      next.has(targetUid) ? next.delete(targetUid) : next.add(targetUid);
      return next;
    });
    try {
      const url = `/api/structures/${viewerStructureId}/shortlist${alreadyIn ? `?userId=${encodeURIComponent(targetUid)}` : ''}`;
      await api(url, {
        method: alreadyIn ? 'DELETE' : 'POST',
        body: alreadyIn ? null : { userId: targetUid },
      });
    } catch {
      setLocalShortlist(prev => {
        const next = new Set(prev);
        next.has(targetUid) ? next.delete(targetUid) : next.add(targetUid);
        return next;
      });
    }
  }, [firebaseUser, viewerStructureId, shortlistIds]);

  // Enrichit chaque joueur avec ses positions matching (calcul local, pas de round-trip)
  const playersWithMatches = useMemo(() => {
    if (viewerOpenPositions.length === 0) return players.map(p => ({ player: p, matches: [] as OpenPosition[] }));
    return players.map(p => ({
      player: p,
      matches: p.isAvailableForRecruitment
        ? matchPositions(p.recruitmentRole, p.games, viewerOpenPositions)
        : [],
    }));
  }, [players, viewerOpenPositions]);

  // Liste unique des pays présents chez les joueurs actuellement chargés.
  // Dérivée du dataset plutôt que codée en dur — si seule la FR est représentée,
  // on n'affiche que FR dans le select pour éviter des filtres qui retournent 0.
  const availableCountries = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.country) set.add(p.country);
    return [...set].sort();
  }, [players]);

  const mmrMinNum = mmrMin ? parseInt(mmrMin, 10) : null;
  const mmrMaxNum = mmrMax ? parseInt(mmrMax, 10) : null;
  const echelonMinNum = echelonMin ? parseInt(echelonMin, 10) : null;
  const echelonMaxNum = echelonMax ? parseInt(echelonMax, 10) : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = playersWithMatches.filter(({ player: p }) => {
      if (q && !(p.displayName.toLowerCase().includes(q) || (p.pseudoTM && p.pseudoTM.toLowerCase().includes(q)))) return false;
      if (roleFilter && p.recruitmentRole !== roleFilter) return false;
      if (countryFilter && p.country !== countryFilter) return false;
      if (mmrMinNum !== null && (p.rlMmr == null || p.rlMmr < mmrMinNum)) return false;
      if (mmrMaxNum !== null && (p.rlMmr == null || p.rlMmr > mmrMaxNum)) return false;
      if (echelonMinNum !== null && (p.tmEchelon == null || p.tmEchelon < echelonMinNum)) return false;
      if (echelonMaxNum !== null && (p.tmEchelon == null || p.tmEchelon > echelonMaxNum)) return false;
      if (noStructureFilter) {
        const hasAny = Object.values(p.structurePerGame || {}).some(Boolean);
        if (hasAny) return false;
      }
      return true;
    });
    const arr = [...base];
    switch (sortKey) {
      case 'alpha':
        arr.sort((a, b) => a.player.displayName.localeCompare(b.player.displayName));
        break;
      case 'available':
        arr.sort((a, b) => Number(b.player.isAvailableForRecruitment) - Number(a.player.isAvailableForRecruitment));
        break;
      case 'mmr':
        arr.sort((a, b) => (b.player.rlMmr ?? -1) - (a.player.rlMmr ?? -1));
        break;
      case 'match':
        arr.sort((a, b) => b.matches.length - a.matches.length);
        break;
    }
    return arr;
  }, [playersWithMatches, search, sortKey, roleFilter, countryFilter, mmrMinNum, mmrMaxNum, echelonMinNum, echelonMaxNum, noStructureFilter]);

  const availableCount = players.filter(p => p.isAvailableForRecruitment).length;
  const count = filtered.length;
  const hasAdvancedFilters = roleFilter !== '' || countryFilter !== '' || mmrMin !== '' || mmrMax !== '' || echelonMin !== '' || echelonMax !== '' || noStructureFilter;
  const hasFilters = search.trim() !== '' || gameFilter !== '' || recruitingFilter || hasAdvancedFilters;

  const resetAll = () => {
    setSearch(''); setGameFilter(''); setRecruitingFilter(false);
    setRoleFilter(''); setCountryFilter(''); setMmrMin(''); setMmrMax('');
    setEchelonMin(''); setEchelonMax(''); setNoStructureFilter(false);
  };

  const gridCols = count < 4
    ? 'grid-cols-1 md:grid-cols-2'
    : count < 9
    ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
    : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-6">
      <CompactStickyHeader
        icon={User}
        title="Joueurs"
        accent="var(--s-violet-light)"
      />
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
                {viewerOpenPositions.length > 0 && <option value="match">Match avec ma structure</option>}
              </select>
            </div>

            {/* Toggle filtres avancés */}
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="tag transition-all duration-150 inline-flex items-center gap-1.5"
              style={{
                background: showAdvanced || hasAdvancedFilters ? 'rgba(123,47,190,0.12)' : 'transparent',
                color: showAdvanced || hasAdvancedFilters ? 'var(--s-violet-light)' : 'var(--s-text-muted)',
                borderColor: showAdvanced || hasAdvancedFilters ? 'rgba(123,47,190,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}
            >
              <SlidersHorizontal size={12} />
              Filtres avancés
              {hasAdvancedFilters && (
                <span className="tag" style={{ fontSize: '12px', padding: '0 5px', background: 'rgba(123,47,190,0.25)', color: 'var(--s-violet-light)', borderColor: 'transparent' }}>
                  {[roleFilter, countryFilter, mmrMin, mmrMax, echelonMin, echelonMax, noStructureFilter ? '1' : ''].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>

          {/* Panel filtres avancés (expand) */}
          {showAdvanced && (
            <div className="relative z-[1] px-6 py-4 border-t animate-fade-in-d1" style={{ borderColor: 'var(--s-border)', background: 'rgba(123,47,190,0.03)' }}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Rôle recherché */}
                <div className="space-y-1.5">
                  <label className="t-label" style={{ color: 'var(--s-text-dim)' }}>Rôle recherché</label>
                  <select
                    value={roleFilter}
                    onChange={e => setRoleFilter(e.target.value)}
                    className="settings-input w-full"
                    style={{ fontSize: '13px', padding: '6px 10px', cursor: 'pointer' }}
                  >
                    <option value="">Tous</option>
                    <option value="joueur">Joueur</option>
                    <option value="coach">Coach</option>
                    <option value="manager">Manager</option>
                  </select>
                </div>

                {/* Pays */}
                <div className="space-y-1.5">
                  <label className="t-label" style={{ color: 'var(--s-text-dim)' }}>Pays</label>
                  <select
                    value={countryFilter}
                    onChange={e => setCountryFilter(e.target.value)}
                    className="settings-input w-full"
                    style={{ fontSize: '13px', padding: '6px 10px', cursor: 'pointer' }}
                    disabled={availableCountries.length === 0}
                  >
                    <option value="">Tous</option>
                    {availableCountries.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Sans structure */}
                <div className="space-y-1.5">
                  <label className="t-label" style={{ color: 'var(--s-text-dim)' }}>Statut structure</label>
                  <button
                    type="button"
                    onClick={() => setNoStructureFilter(v => !v)}
                    className="tag transition-all duration-150 inline-flex items-center gap-1.5 w-full justify-center"
                    style={{
                      background: noStructureFilter ? 'rgba(0,217,54,0.12)' : 'transparent',
                      color: noStructureFilter ? '#33ff66' : 'var(--s-text-muted)',
                      borderColor: noStructureFilter ? 'rgba(0,217,54,0.35)' : 'var(--s-border)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      padding: '6px 10px',
                    }}
                  >
                    {noStructureFilter && <Star size={11} />}
                    Sans structure uniquement
                  </button>
                </div>

                {/* MMR RL min/max */}
                <div className="space-y-1.5">
                  <label className="t-label" style={{ color: 'var(--s-text-dim)' }}>MMR RL (min / max)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="min"
                      value={mmrMin}
                      onChange={e => setMmrMin(e.target.value)}
                      className="settings-input w-full"
                      style={{ fontSize: '13px', padding: '6px 10px' }}
                    />
                    <span style={{ color: 'var(--s-text-muted)' }}>→</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="max"
                      value={mmrMax}
                      onChange={e => setMmrMax(e.target.value)}
                      className="settings-input w-full"
                      style={{ fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                </div>

                {/* Échelon TM min/max */}
                <div className="space-y-1.5">
                  <label className="t-label" style={{ color: 'var(--s-text-dim)' }}>Échelon TM (min / max)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="min"
                      value={echelonMin}
                      onChange={e => setEchelonMin(e.target.value)}
                      className="settings-input w-full"
                      style={{ fontSize: '13px', padding: '6px 10px' }}
                    />
                    <span style={{ color: 'var(--s-text-muted)' }}>→</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="max"
                      value={echelonMax}
                      onChange={e => setEchelonMax(e.target.value)}
                      className="settings-input w-full"
                      style={{ fontSize: '13px', padding: '6px 10px' }}
                    />
                  </div>
                </div>

                {/* Reset */}
                <div className="space-y-1.5 flex flex-col justify-end">
                  {hasAdvancedFilters && (
                    <button
                      type="button"
                      onClick={resetAll}
                      className="tag transition-all duration-150 inline-flex items-center gap-1.5 justify-center"
                      style={{
                        background: 'transparent',
                        color: '#ff5555',
                        borderColor: 'rgba(255,85,85,0.3)',
                        cursor: 'pointer',
                        fontSize: '13px',
                        padding: '6px 10px',
                      }}
                    >
                      <X size={11} />
                      Réinitialiser
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
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
          <SkeletonGrid count={8} cols="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" cardHeight={220} accent="var(--s-violet)" />
        ) : filtered.length === 0 ? (
          <EmptyState
            hasFilters={hasFilters}
            totalCount={players.length}
            onReset={resetAll}
          />
        ) : (
          <div className={`grid ${gridCols} gap-4 animate-fade-in-d2`}>
            {filtered.map(({ player, matches }) => (
              <PlayerItem
                key={player.uid}
                p={player}
                matches={matches}
                canShortlist={!!viewerStructureId}
                isShortlisted={shortlistIds.has(player.uid)}
                onToggleShortlist={() => toggleShortlist(player.uid)}
                linkCopied={copiedLinkFor === player.uid}
                onGenerateLink={() => generateTargetedLink(player.uid, player.games?.[0] || 'rocket_league')}
              />
            ))}
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

function PlayerItem({
  p, matches, canShortlist, isShortlisted, onToggleShortlist, linkCopied, onGenerateLink,
}: {
  p: PlayerCard;
  matches: OpenPosition[];
  canShortlist: boolean;
  isShortlisted: boolean;
  onToggleShortlist: () => void;
  linkCopied: boolean;
  onGenerateLink: () => void;
}) {
  const avatar = p.avatarUrl || p.discordAvatar;
  const hasAny = p.rlRank || p.pseudoTM;
  const hasMatch = matches.length > 0;

  return (
    <div
      className="pillar-card panel bevel-sm relative overflow-hidden group transition-all duration-200"
      style={{
        background: 'var(--s-surface)',
        border: hasMatch ? '1px solid rgba(0,217,54,0.35)' : '1px solid var(--s-border)',
        boxShadow: hasMatch ? '0 0 0 1px rgba(0,217,54,0.1) inset' : undefined,
      }}>
      <Link href={`/profile/${p.uid}`} className="absolute inset-0 z-[2]" aria-label={p.displayName} />
      {/* Accent top */}
      {(hasMatch || p.isAvailableForRecruitment) && (
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-green), transparent 80%)' }} />
      )}
      {/* Toolbar — actions dirigeant/manager + badge match (évite de chevaucher l'avatar) */}
      {(canShortlist || hasMatch) && (
        <div
          className="relative z-[3] flex items-center justify-between gap-2 px-2 py-1.5"
          style={{ background: 'var(--s-elevated)', borderBottom: '1px solid var(--s-border)' }}
        >
          <div className="flex gap-1">
            {canShortlist && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleShortlist(); }}
                  className="w-7 h-7 flex items-center justify-center transition-colors duration-150 bevel-sm"
                  style={{
                    background: isShortlisted ? 'rgba(255,184,0,0.15)' : 'var(--s-surface)',
                    border: `1px solid ${isShortlisted ? 'rgba(255,184,0,0.5)' : 'var(--s-border)'}`,
                    color: isShortlisted ? 'var(--s-gold)' : 'var(--s-text-muted)',
                  }}
                  aria-label={isShortlisted ? 'Retirer de la shortlist' : 'Ajouter à la shortlist'}
                  title={isShortlisted ? 'Retirer de la shortlist' : 'Ajouter à la shortlist'}
                >
                  {isShortlisted ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onGenerateLink(); }}
                  className="w-7 h-7 flex items-center justify-center transition-colors duration-150 bevel-sm"
                  style={{
                    background: linkCopied ? 'rgba(0,217,54,0.15)' : 'var(--s-surface)',
                    border: `1px solid ${linkCopied ? 'rgba(0,217,54,0.5)' : 'var(--s-border)'}`,
                    color: linkCopied ? '#33ff66' : 'var(--s-text-muted)',
                  }}
                  aria-label={linkCopied ? 'Lien copié' : 'Générer un lien d\'invitation perso'}
                  title={linkCopied ? 'Lien copié !' : 'Générer un lien d\'invitation perso (single-use)'}
                >
                  {linkCopied ? <Check size={14} /> : <Link2 size={14} />}
                </button>
              </>
            )}
          </div>
          {hasMatch && (
            <div className="flex flex-wrap gap-1 justify-end max-w-[65%]">
              {matches.map((m, i) => (
                <span key={i} className="tag inline-flex items-center gap-1"
                  style={{
                    fontSize: '12px', padding: '2px 7px',
                    background: 'rgba(0,217,54,0.15)',
                    color: '#33ff66',
                    borderColor: 'rgba(0,217,54,0.45)',
                    fontWeight: 700,
                  }}>
                  <Target size={10} />
                  Match {ROLE_LABELS[m.role] || m.role} {GAME_SHORT[m.game] || m.game.toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
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
            <div className="relative z-[3] mt-3">
              <InviteToStructureButton
                targetUserId={p.uid}
                targetDisplayName={p.displayName}
                targetGames={p.games}
                isAvailableForRecruitment={p.isAvailableForRecruitment}
                compact
              />
            </div>
          </div>
        )}
      </div>
    </div>
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
