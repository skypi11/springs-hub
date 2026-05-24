'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  User, Search, Gamepad2, Sparkles, Star, Target, SlidersHorizontal,
  X, Bookmark, BookmarkCheck, Link2, Check, ShieldCheck, ShieldAlert, Crown,
  LayoutGrid, List, Loader2, ArrowDownNarrowWide, ChevronDown,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import Portal from '@/components/ui/Portal';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import InviteToStructureButton from '@/components/community/InviteToStructureButton';
import RLIdentityBadge from '@/components/players/RLIdentityBadge';
import CountryFlag from '@/components/ui/CountryFlag';
import RankBadge, { getRankTierConfig } from '@/components/rl/RankBadge';
import { PRIMARY_ROLE_LABELS, type PrimaryRole, type TeamAffiliation } from '@/lib/member-role';
import { RL_RANKS } from '@/lib/rl-ranks';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';

type EnrichedStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  game: string;
  primaryRole: PrimaryRole;
  affiliations: TeamAffiliation[];
};

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
  rlIconUrl: string;
  rlAccountVerified: boolean;
  rlAccountName: string;
  rlAccountPlatform: 'epic' | 'steam' | '';
  rlSteamId64: string;
  pseudoTM: string;
  structures: EnrichedStructure[];
  createdAt: string | null;
};

type PlayersPage = { players: PlayerCard[]; nextCursor: string | null; pageSize: number };
type SortKey = 'recommended' | 'recent' | 'alpha';
type OpenPosition = { game: string; role: string };

const ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

// Score "Recommandé" : vérifié + dispo recrutement > vérifié > dispo > reste
function recommendedScore(p: PlayerCard): number {
  let s = 0;
  if (p.rlAccountVerified) s += 10;
  if (p.isAvailableForRecruitment) s += 5;
  if (p.structures.length > 0) s += 1;
  return s;
}

// Hiérarchie pour choisir LA structure principale à afficher dans la card
// (un joueur peut être fondateur d'une structure ET responsable d'une autre —
// on doit toujours mettre en avant le rôle le plus important).
const ROLE_PRIORITY: Record<PrimaryRole, number> = {
  fondateur: 0,
  co_fondateur: 1,
  responsable: 2,
  coach_structure: 3,
  manager_equipe: 4,
  coach_equipe: 5,
  capitaine: 6,
  joueur: 7,
  membre: 8,
};
function sortStructuresByPriority(structures: EnrichedStructure[]): EnrichedStructure[] {
  return [...structures].sort(
    (a, b) => (ROLE_PRIORITY[a.primaryRole] ?? 99) - (ROLE_PRIORITY[b.primaryRole] ?? 99),
  );
}

function matchPositions(playerRole: string, playerGames: string[], positions: OpenPosition[]): OpenPosition[] {
  if (!playerRole || positions.length === 0) return [];
  const seen = new Set<string>();
  const matches: OpenPosition[] = [];
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
  const qc = useQueryClient();

  // Filtres (envoyés au serveur)
  const [gameFilter, setGameFilter] = useState('');
  const [recruitingFilter, setRecruitingFilter] = useState(false);
  const [verifiedOnlyFilter, setVerifiedOnlyFilter] = useState(false);
  const [countryFilter, setCountryFilter] = useState('');
  // Filtres client (sur la page courante)
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [rankMinFilter, setRankMinFilter] = useState('');
  const [noStructureFilter, setNoStructureFilter] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Tri (client)
  const [sortKey, setSortKey] = useState<SortKey>('recommended');

  // Vue grille/liste — par défaut LISTE (annuaire dense), persistant.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  useEffect(() => {
    try {
      const stored = localStorage.getItem('aedral_players_view');
      if (stored === 'grid' || stored === 'list') setViewMode(stored);
    } catch { /* SSR */ }
  }, []);
  const setViewModeStored = (m: 'grid' | 'list') => {
    setViewMode(m);
    try { localStorage.setItem('aedral_players_view', m); } catch { /* noop */ }
  };

  // Shortlist (recruteurs) + génération de lien
  const [localShortlist, setLocalShortlist] = useState<Set<string>>(new Set());
  const [copiedLinkFor, setCopiedLinkFor] = useState<string | null>(null);

  // ── Fetch paginé (cursor) via useInfiniteQuery ─────────────────────────
  const queryKey = ['players', { game: gameFilter, recruiting: recruitingFilter, verified: verifiedOnlyFilter, country: countryFilter }] as const;
  const playersQ = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (gameFilter) params.set('game', gameFilter);
      if (recruitingFilter) params.set('recruiting', 'true');
      if (verifiedOnlyFilter) params.set('verifiedOnly', 'true');
      if (countryFilter) params.set('country', countryFilter);
      if (pageParam) params.set('cursor', pageParam);
      return api<PlayersPage>(`/api/players?${params.toString()}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const allPlayers = useMemo(
    () => (playersQ.data?.pages ?? []).flatMap(p => p.players),
    [playersQ.data],
  );
  const loading = playersQ.isPending;

  // ── Structures du viewer (pour shortlist + matching positions) ─────────
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
  const serverShortlistIds = useMemo(
    () => new Set<string>((shortlistQ.data?.shortlist ?? []).map(s => s.uid)),
    [shortlistQ.data],
  );
  const shortlistIds = useMemo(() => {
    if (localShortlist.size === 0) return serverShortlistIds;
    const merged = new Set(serverShortlistIds);
    for (const id of localShortlist) {
      if (merged.has(id)) merged.delete(id);
      else merged.add(id);
    }
    return merged;
  }, [serverShortlistIds, localShortlist]);

  const generateTargetedLink = useCallback(async (targetUid: string, targetGame: string) => {
    if (!firebaseUser || !viewerStructureId) return;
    try {
      const data = await api<{ token?: string }>('/api/structures/invitations', {
        method: 'POST',
        body: { action: 'create_link', structureId: viewerStructureId, targetUserId: targetUid, game: targetGame },
      });
      if (!data.token) { alert('Impossible de générer le lien'); return; }
      const url = `${window.location.origin}/community/join/${data.token}`;
      try { await navigator.clipboard.writeText(url); }
      catch { window.prompt('Lien copié impossible — copie manuellement :', url); }
      setCopiedLinkFor(targetUid);
      setTimeout(() => setCopiedLinkFor(prev => (prev === targetUid ? null : prev)), 2000);
    } catch { alert('Erreur réseau'); }
  }, [firebaseUser, viewerStructureId]);

  const toggleShortlist = useCallback(async (targetUid: string) => {
    if (!firebaseUser || !viewerStructureId) return;
    const alreadyIn = shortlistIds.has(targetUid);
    setLocalShortlist(prev => {
      const next = new Set(prev);
      if (next.has(targetUid)) next.delete(targetUid);
      else next.add(targetUid);
      return next;
    });
    try {
      const url = `/api/structures/${viewerStructureId}/shortlist${alreadyIn ? `?userId=${encodeURIComponent(targetUid)}` : ''}`;
      await api(url, { method: alreadyIn ? 'DELETE' : 'POST', body: alreadyIn ? null : { userId: targetUid } });
    } catch {
      setLocalShortlist(prev => {
        const next = new Set(prev);
        if (next.has(targetUid)) next.delete(targetUid);
        else next.add(targetUid);
        return next;
      });
    }
  }, [firebaseUser, viewerStructureId, shortlistIds]);

  // ── Enrichi avec matches + filtres client ──────────────────────────────
  const playersWithMatches = useMemo(() => {
    if (viewerOpenPositions.length === 0) return allPlayers.map(p => ({ player: p, matches: [] as OpenPosition[] }));
    return allPlayers.map(p => ({
      player: p,
      matches: p.isAvailableForRecruitment
        ? matchPositions(p.recruitmentRole, p.games, viewerOpenPositions)
        : [],
    }));
  }, [allPlayers, viewerOpenPositions]);

  const availableCountries = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPlayers) if (p.country) set.add(p.country);
    return [...set].sort();
  }, [allPlayers]);

  // Rang RL min : on compare l'index dans RL_RANKS (ordre croissant)
  const rankMinIndex = rankMinFilter ? RL_RANKS.indexOf(rankMinFilter as typeof RL_RANKS[number]) : -1;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = playersWithMatches.filter(({ player: p }) => {
      if (q && !(p.displayName.toLowerCase().includes(q) || (p.pseudoTM && p.pseudoTM.toLowerCase().includes(q)))) return false;
      if (roleFilter && p.recruitmentRole !== roleFilter) return false;
      if (noStructureFilter && p.structures.length > 0) return false;
      if (rankMinIndex >= 0) {
        // Pour comparer, on a besoin du rang VÉRIFIÉ. Sinon, on exclut.
        if (!p.rlAccountVerified || !p.rlRank) return false;
        const playerIdx = RL_RANKS.indexOf(p.rlRank as typeof RL_RANKS[number]);
        if (playerIdx < 0 || playerIdx < rankMinIndex) return false;
      }
      return true;
    });
    const arr = [...base];
    switch (sortKey) {
      case 'recommended':
        arr.sort((a, b) => {
          const sa = recommendedScore(a.player) + (a.matches.length > 0 ? 100 : 0);
          const sb = recommendedScore(b.player) + (b.matches.length > 0 ? 100 : 0);
          if (sb !== sa) return sb - sa;
          return a.player.displayName.localeCompare(b.player.displayName);
        });
        break;
      case 'recent':
        arr.sort((a, b) => {
          const ta = a.player.createdAt ? new Date(a.player.createdAt).getTime() : 0;
          const tb = b.player.createdAt ? new Date(b.player.createdAt).getTime() : 0;
          return tb - ta;
        });
        break;
      case 'alpha':
        arr.sort((a, b) => a.player.displayName.localeCompare(b.player.displayName));
        break;
    }
    return arr;
  }, [playersWithMatches, search, sortKey, roleFilter, noStructureFilter, rankMinIndex]);

  const hasAdvancedFilters = roleFilter !== '' || countryFilter !== '' || rankMinFilter !== '' || noStructureFilter || verifiedOnlyFilter;
  const hasFilters = search.trim() !== '' || gameFilter !== '' || recruitingFilter || hasAdvancedFilters;
  const advancedFiltersCount = [roleFilter, countryFilter, rankMinFilter, noStructureFilter ? '1' : '', verifiedOnlyFilter ? '1' : ''].filter(Boolean).length;

  const resetAll = () => {
    setSearch(''); setGameFilter(''); setRecruitingFilter(false);
    setVerifiedOnlyFilter(false);
    setRoleFilter(''); setCountryFilter(''); setRankMinFilter(''); setNoStructureFilter(false);
    qc.invalidateQueries({ queryKey: ['players'] });
  };

  // ── Scroll infini : observer sur un sentinel en bas de la liste ────────
  const loadMoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !playersQ.hasNextPage) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !playersQ.isFetchingNextPage) {
        playersQ.fetchNextPage();
      }
    }, { rootMargin: '400px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [playersQ]);

  const count = filtered.length;

  return (
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6">
      <CompactStickyHeader icon={User} title="Joueurs" accent="var(--s-gold)" />
      <div className="relative z-[1] space-y-6">
        <Breadcrumbs items={[{ label: 'Communauté', href: '/community' }, { label: 'Joueurs' }]} />

        {/* Header compact */}
        <header className="bevel relative overflow-hidden animate-fade-in"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
          <div className="relative z-[1] px-6 py-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="w-10 h-10 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                <User size={18} style={{ color: 'var(--s-gold)' }} />
              </div>
              <div>
                <h1 className="font-display text-xl tracking-wider leading-none">JOUEURS</h1>
                <p className="t-mono text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                  {loading ? 'Chargement…' : `${allPlayers.length}${playersQ.hasNextPage ? '+' : ''} joueur${allPlayers.length > 1 ? 's' : ''} chargé${allPlayers.length > 1 ? 's' : ''}`}
                </p>
              </div>
            </div>

            <div className="flex-1 relative min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
              <input type="text" className="settings-input has-icon w-full" style={{ fontSize: '14px' }}
                placeholder="Rechercher par pseudo…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="flex items-center gap-2">
              <FilterChip active={!gameFilter} onClick={() => setGameFilter('')} color="neutral">Tous</FilterChip>
              <FilterChip active={gameFilter === 'rocket_league'} onClick={() => setGameFilter(gameFilter === 'rocket_league' ? '' : 'rocket_league')} color="blue">RL</FilterChip>
              <FilterChip active={gameFilter === 'trackmania'} onClick={() => setGameFilter(gameFilter === 'trackmania' ? '' : 'trackmania')} color="green">TM</FilterChip>
            </div>

            <FilterChip active={recruitingFilter} onClick={() => setRecruitingFilter(!recruitingFilter)} color="green">
              <Star size={10} style={{ marginRight: '4px' }} />
              Dispo au recrutement
            </FilterChip>

            <SortDropdown value={sortKey} onChange={setSortKey} hasMatches={viewerOpenPositions.length > 0} />

            <ViewToggle viewMode={viewMode} onChange={setViewModeStored} />

            <button type="button" onClick={() => setShowAdvanced(v => !v)}
              className="tag transition-all duration-150 inline-flex items-center gap-1.5"
              style={{
                background: showAdvanced || hasAdvancedFilters ? 'rgba(255,184,0,0.12)' : 'transparent',
                color: showAdvanced || hasAdvancedFilters ? 'var(--s-gold)' : 'var(--s-text-muted)',
                borderColor: showAdvanced || hasAdvancedFilters ? 'rgba(255,184,0,0.35)' : 'var(--s-border)',
                cursor: 'pointer',
              }}>
              <SlidersHorizontal size={12} />
              Filtres
              {advancedFiltersCount > 0 && (
                <span className="tag" style={{ fontSize: '12px', padding: '0 5px', background: 'rgba(255,184,0,0.25)', color: 'var(--s-gold)', borderColor: 'transparent' }}>
                  {advancedFiltersCount}
                </span>
              )}
            </button>
          </div>

          {/* Panel filtres avancés — 3 groupes Identité / RL / TM */}
          {showAdvanced && (
            <div className="relative z-[1] px-6 py-5 border-t animate-fade-in-d1"
              style={{ borderColor: 'var(--s-border)', background: 'rgba(255,184,0,0.02)' }}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Groupe IDENTITÉ */}
                <FilterGroup icon={<User size={11} />} title="IDENTITÉ" accent="var(--s-text)">
                  <div className="space-y-3">
                    <Field label="Rôle recherché">
                      <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="settings-input w-full text-sm">
                        <option value="">Tous</option>
                        <option value="joueur">Joueur</option>
                        <option value="coach">Coach</option>
                        <option value="manager">Manager</option>
                      </select>
                    </Field>
                    <Field label="Pays">
                      <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)} className="settings-input w-full text-sm"
                        disabled={availableCountries.length === 0}>
                        <option value="">Tous</option>
                        {availableCountries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Switch label="Libre (sans structure)" value={noStructureFilter} onChange={setNoStructureFilter} />
                  </div>
                </FilterGroup>

                {/* Groupe ROCKET LEAGUE */}
                <FilterGroup icon={<Gamepad2 size={11} />} title="ROCKET LEAGUE" accent="var(--s-blue)">
                  <div className="space-y-3">
                    <Field label="Rang minimum (vérifié uniquement)">
                      <select value={rankMinFilter} onChange={e => setRankMinFilter(e.target.value)} className="settings-input w-full text-sm">
                        <option value="">Tous</option>
                        {RL_RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Field>
                    <Switch label="Compte vérifié uniquement (Epic/Steam)" value={verifiedOnlyFilter} onChange={setVerifiedOnlyFilter} accent="var(--s-gold)" />
                  </div>
                </FilterGroup>

                {/* Groupe TRACKMANIA */}
                <FilterGroup icon={<Gamepad2 size={11} />} title="TRACKMANIA" accent="var(--s-green)">
                  <div className="space-y-3">
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Aucun filtre TM disponible — utilise &laquo; Jeux : TM &raquo; en haut pour ne voir que les joueurs Trackmania.
                    </p>
                  </div>
                </FilterGroup>
              </div>

              {/* Footer panel */}
              <div className="mt-5 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--s-border)' }}>
                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  {advancedFiltersCount > 0 ? `${advancedFiltersCount} filtre${advancedFiltersCount > 1 ? 's' : ''} actif${advancedFiltersCount > 1 ? 's' : ''}` : 'Aucun filtre actif'}
                </span>
                {hasFilters && (
                  <button type="button" onClick={resetAll}
                    className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors"
                    style={{ background: 'transparent', border: '1px solid rgba(255,85,85,0.3)', color: '#ff5555' }}>
                    <X size={11} /> Réinitialiser
                  </button>
                )}
              </div>
            </div>
          )}
        </header>

        {/* Compteur résultats */}
        {!loading && hasFilters && (
          <p className="t-mono text-xs animate-fade-in-d1" style={{ color: 'var(--s-text-muted)' }}>
            {count} résultat{count > 1 ? 's' : ''}{count !== allPlayers.length && ` sur ${allPlayers.length} chargé${allPlayers.length > 1 ? 's' : ''}`}
          </p>
        )}

        {/* Liste */}
        {loading ? (
          <SkeletonGrid count={8} cols="grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" cardHeight={180} accent="var(--s-gold)" />
        ) : filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} totalCount={allPlayers.length} onReset={resetAll} />
        ) : viewMode === 'list' ? (
          <div className="bevel overflow-hidden animate-fade-in-d2"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            {filtered.map(({ player, matches }, idx) => (
              <PlayerRow key={player.uid} p={player} matches={matches}
                canShortlist={!!viewerStructureId}
                isShortlisted={shortlistIds.has(player.uid)}
                onToggleShortlist={() => toggleShortlist(player.uid)}
                linkCopied={copiedLinkFor === player.uid}
                onGenerateLink={() => generateTargetedLink(player.uid, player.games?.[0] || 'rocket_league')}
                isLast={idx === filtered.length - 1} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-fade-in-d2">
            {filtered.map(({ player, matches }) => (
              <PlayerItem key={player.uid} p={player} matches={matches}
                canShortlist={!!viewerStructureId}
                isShortlisted={shortlistIds.has(player.uid)}
                onToggleShortlist={() => toggleShortlist(player.uid)}
                linkCopied={copiedLinkFor === player.uid}
                onGenerateLink={() => generateTargetedLink(player.uid, player.games?.[0] || 'rocket_league')} />
            ))}
          </div>
        )}

        {/* Sentinel scroll infini */}
        {playersQ.hasNextPage && (
          <div ref={loadMoreRef} className="flex justify-center py-6">
            {playersQ.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={14} className="animate-spin" /> Chargement de la suite…
              </span>
            ) : (
              <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Fais défiler pour charger la suite</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────

function FilterChip({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: 'neutral' | 'blue' | 'green'; children: React.ReactNode }) {
  const palette = color === 'blue'
    ? { bg: 'rgba(0,129,255,0.12)', fg: 'var(--s-blue)', border: 'rgba(0,129,255,0.35)' }
    : color === 'green'
      ? { bg: 'rgba(0,217,54,0.12)', fg: '#33ff66', border: 'rgba(0,217,54,0.35)' }
      : { bg: 'rgba(255,255,255,0.08)', fg: 'var(--s-text)', border: 'rgba(255,255,255,0.2)' };
  return (
    <button type="button" onClick={onClick} className="tag transition-all duration-150"
      style={{
        background: active ? palette.bg : 'transparent',
        color: active ? palette.fg : 'var(--s-text-muted)',
        borderColor: active ? palette.border : 'var(--s-border)',
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

function ViewToggle({ viewMode, onChange }: { viewMode: 'grid' | 'list'; onChange: (m: 'grid' | 'list') => void }) {
  return (
    <div className="inline-flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)', background: 'var(--s-surface)' }}>
      <button type="button" onClick={() => onChange('list')} title="Vue liste compacte"
        className="px-2 py-1.5 transition-colors"
        style={{ background: viewMode === 'list' ? 'var(--s-elevated)' : 'transparent', color: viewMode === 'list' ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
        <List size={13} />
      </button>
      <button type="button" onClick={() => onChange('grid')} title="Vue grille"
        className="px-2 py-1.5 transition-colors"
        style={{ background: viewMode === 'grid' ? 'var(--s-elevated)' : 'transparent', color: viewMode === 'grid' ? 'var(--s-gold)' : 'var(--s-text-muted)', borderLeft: '1px solid var(--s-border)' }}>
        <LayoutGrid size={13} />
      </button>
    </div>
  );
}

// Dropdown custom de tri (pas <select> natif moche)
function SortDropdown({ value, onChange, hasMatches }: { value: SortKey; onChange: (k: SortKey) => void; hasMatches: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Le parent header a .bevel + overflow-hidden — un menu en absolute serait
  // clippé. On le rend via Portal en position: fixed, ancré sous le bouton.
  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const options: { key: SortKey; label: string; hint?: string }[] = [
    { key: 'recommended', label: 'Recommandé', hint: hasMatches ? 'Match + vérifié + dispo' : 'Vérifié + dispo' },
    { key: 'recent', label: 'Plus récents' },
    { key: 'alpha', label: 'A → Z' },
  ];
  const current = options.find(o => o.key === value) ?? options[0];
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(v => !v)}
        className="tag transition-all duration-150 inline-flex items-center gap-1.5"
        style={{
          background: open ? 'rgba(255,184,0,0.12)' : 'transparent',
          color: open ? 'var(--s-gold)' : 'var(--s-text-muted)',
          borderColor: open ? 'rgba(255,184,0,0.35)' : 'var(--s-border)',
          cursor: 'pointer',
        }}>
        <ArrowDownNarrowWide size={12} />
        Tri : <strong>{current.label}</strong>
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>
      {open && pos && (
        <Portal>
          <div ref={menuRef}
            className="bevel-sm overflow-hidden"
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              minWidth: 220,
              zIndex: 1000,
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
            {options.map(o => {
              const active = o.key === value;
              return (
                <button key={o.key} type="button"
                  onClick={() => { onChange(o.key); setOpen(false); }}
                  className="w-full text-left px-3 py-2 transition-colors hover:bg-[var(--s-elevated)] flex items-center gap-2"
                  style={{ color: active ? 'var(--s-gold)' : 'var(--s-text)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{o.label}</div>
                    {o.hint && <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>{o.hint}</div>}
                  </div>
                  {active && <Check size={13} style={{ color: 'var(--s-gold)' }} />}
                </button>
              );
            })}
          </div>
        </Portal>
      )}
    </>
  );
}

function FilterGroup({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="bevel-sm p-4" style={{ background: 'var(--s-surface)', border: `1px solid var(--s-border)` }}>
      <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: `1px solid var(--s-border)` }}>
        <span style={{ color: accent }}>{icon}</span>
        <span className="t-label" style={{ color: accent }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="t-label block mb-1" style={{ color: 'var(--s-text-dim)', fontSize: '11px' }}>{label}</label>
      {children}
    </div>
  );
}

// Ligne d'affiliation : [logo] [Rôle] [équipe] chez [STRUCTURE]
// L'équipe (s'il y en a une) est positionnée entre le rôle et la structure,
// ordre validé avec l'utilisateur : "Joueur LU Tomioka chez ARAN".
function StructureLine({ s, size = 'sm' }: { s: EnrichedStructure; size?: 'sm' | 'xs' }) {
  const logoSize = size === 'sm' ? 14 : 12;
  const textColor = 'var(--s-text-dim)';
  const team = s.affiliations[0]?.teamName;
  return (
    <div className="flex items-center gap-2 min-w-0" style={{ color: textColor, fontSize: size === 'sm' ? '12px' : '11px' }}>
      {s.logoUrl ? (
        <Image src={s.logoUrl} alt={s.name} width={logoSize} height={logoSize} unoptimized className="flex-shrink-0" />
      ) : (
        <Crown size={logoSize - 2} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
      )}
      <span className="truncate">
        <strong style={{ color: 'var(--s-text)' }}>{PRIMARY_ROLE_LABELS[s.primaryRole]}</strong>
        {team && (
          <span style={{ color: 'var(--s-text-muted)' }}> {team}</span>
        )}
        {' chez '}
        <span style={{ color: 'var(--s-text)' }}>{s.tag || s.name}</span>
      </span>
    </div>
  );
}

function Switch({ label, value, onChange, accent = '#33ff66' }: { label: string; value: boolean; onChange: (v: boolean) => void; accent?: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)} aria-pressed={value}
      className="flex items-center justify-between w-full gap-3 text-left transition-colors px-2 py-1.5 hover:bg-[var(--s-elevated)]"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
      <span className="text-sm" style={{ color: value ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{label}</span>
      <span className="flex-shrink-0 relative transition-all" style={{
        width: 34, height: 18,
        background: value ? accent : 'var(--s-elevated)',
        border: `1px solid ${value ? accent : 'var(--s-border)'}`,
      }}>
        <span className="absolute top-1/2 -translate-y-1/2 transition-all" style={{
          left: value ? 18 : 2,
          width: 12, height: 12,
          background: value ? '#000' : 'var(--s-text-dim)',
        }} />
      </span>
    </button>
  );
}

// ─── Card grille (hauteur fixe propre ~180px) ─────────────────────────────
function PlayerItem({ p, matches, canShortlist, isShortlisted, onToggleShortlist, linkCopied, onGenerateLink }: {
  p: PlayerCard; matches: OpenPosition[]; canShortlist: boolean; isShortlisted: boolean;
  onToggleShortlist: () => void; linkCopied: boolean; onGenerateLink: () => void;
}) {
  const { firebaseUser } = useAuth();
  const avatar = p.avatarUrl || p.discordAvatar;
  const hasMatch = matches.length > 0;
  const tier = getRankTierConfig(p.rlRank);
  const accentColor = hasMatch ? 'rgba(0,217,54,0.55)' : (p.rlAccountVerified && p.isAvailableForRecruitment) ? 'rgba(255,184,0,0.55)' : 'var(--s-border)';
  const accentWidth = hasMatch || (p.rlAccountVerified && p.isAvailableForRecruitment) ? '2px' : '1px';
  // Top 2 structures triées par hiérarchie (fondateur > responsable > … > joueur)
  const sortedStructures = sortStructuresByPriority(p.structures);
  const visibleStructures = sortedStructures.slice(0, 2);
  const extraCount = sortedStructures.length - visibleStructures.length;

  return (
    <div className="bevel-sm relative overflow-hidden group transition-all duration-200 hover:border-white/30"
      style={{
        background: 'var(--s-surface)',
        border: `${accentWidth} solid ${accentColor}`,
        minHeight: 180,
      }}>
      <Link href={`/profile/${p.uid}`} className="absolute inset-0 z-[2]" aria-label={p.displayName} />

      {(hasMatch || (p.rlAccountVerified && p.isAvailableForRecruitment)) && (
        <div className="h-[3px]" style={{
          background: hasMatch
            ? 'linear-gradient(90deg, var(--s-green), transparent 80%)'
            : 'linear-gradient(90deg, var(--s-gold), transparent 80%)',
        }} />
      )}

      {canShortlist && (
        <div className="relative z-[3] flex items-center justify-end gap-1 px-2 py-1.5"
          style={{ background: 'var(--s-elevated)', borderBottom: '1px solid var(--s-border)' }}>
          {hasMatch && (
            <span className="tag inline-flex items-center gap-1 mr-auto"
              style={{ fontSize: '11px', padding: '2px 6px', background: 'rgba(0,217,54,0.15)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.45)', fontWeight: 600 }}>
              <Target size={10} /> Match {ROLE_LABELS[matches[0].role] || matches[0].role}
            </span>
          )}
          <IconButton onClick={onToggleShortlist} active={isShortlisted} accent="var(--s-gold)"
            title={isShortlisted ? 'Retirer de la shortlist' : 'Ajouter à la shortlist'}>
            {isShortlisted ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          </IconButton>
          <IconButton onClick={onGenerateLink} active={linkCopied} accent="#33ff66"
            title={linkCopied ? 'Lien copié !' : "Générer un lien d'invitation"}>
            {linkCopied ? <Check size={14} /> : <Link2 size={14} />}
          </IconButton>
        </div>
      )}

      <div className="relative z-[3] p-4" style={{ pointerEvents: 'none' }}>
        {/* Header user */}
        <div className="flex items-center gap-3 mb-3">
          {avatar ? (
            <div className="w-11 h-11 relative flex-shrink-0 overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <Image src={avatar} alt={p.displayName} fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <User size={16} style={{ color: 'var(--s-text-muted)' }} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</p>
              {p.rlAccountVerified && (
                <span title="Compte RL vérifié" style={{ color: 'var(--s-gold)', display: 'inline-flex', flexShrink: 0 }}>
                  <ShieldCheck size={12} />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <CountryFlag code={p.country} size={16} />
              <div className="flex gap-1">
                {p.games.map(g => (
                  <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                    style={{ fontSize: '11px', padding: '1px 5px' }}>
                    {g === 'rocket_league' ? 'RL' : 'TM'}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {/* Rang RL avec vraie icône Psyonix si vérifié */}
          {p.rlRank && p.rlAccountVerified && tier && (
            <div className="flex-shrink-0">
              <RankBadge rank={p.rlRank} size={44} />
            </div>
          )}
        </div>

        {/* Affiliations : top 2 structures triées par hiérarchie de rôle */}
        {visibleStructures.length > 0 ? (
          <div className="flex flex-col gap-1 mb-2">
            {visibleStructures.map(s => (
              <StructureLine key={`${s.id}-${s.game}`} s={s} />
            ))}
            {extraCount > 0 && (
              <div className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                + {extraCount} autre{extraCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs mb-2 italic" style={{ color: 'var(--s-text-muted)' }}>Sans structure</div>
        )}

        {/* Badge "non vérifié" subtle si RL sans vérif */}
        {p.games.includes('rocket_league') && !p.rlAccountVerified && (
          <div className="mb-2" style={{ pointerEvents: 'auto' }}>
            <RLIdentityBadge games={p.games} rlAccountVerified={p.rlAccountVerified}
              rlAccountName={p.rlAccountName} rlAccountPlatform={p.rlAccountPlatform}
              rlSteamId64={p.rlSteamId64} rlRank={p.rlRank}
              targetUid={p.uid} targetName={p.displayName}
              canReport={!!firebaseUser && firebaseUser.uid !== p.uid}
              size="sm" tone="subtle" />
          </div>
        )}

        {/* Pseudo TM si présent */}
        {p.pseudoTM && (
          <div className="flex items-center gap-1.5 text-xs mb-2" style={{ color: 'var(--s-text-dim)' }}>
            <Gamepad2 size={11} style={{ color: 'var(--s-green)' }} />
            <span className="truncate">{p.pseudoTM}</span>
          </div>
        )}

        {/* Badge recrutement */}
        {p.isAvailableForRecruitment && (
          <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(0,217,54,0.2)' }}>
            <div className="flex items-center gap-1.5">
              <Star size={11} style={{ color: '#33ff66', fill: '#33ff66' }} />
              <span className="text-xs font-bold" style={{ color: '#33ff66' }}>
                Cherche {ROLE_LABELS[p.recruitmentRole] || 'équipe'}
              </span>
            </div>
            <div className="relative z-[3] mt-2" style={{ pointerEvents: 'auto' }}>
              <InviteToStructureButton targetUserId={p.uid} targetDisplayName={p.displayName}
                targetGames={p.games} isAvailableForRecruitment={p.isAvailableForRecruitment} compact />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ children, onClick, active, accent, title }: { children: React.ReactNode; onClick: () => void; active: boolean; accent: string; title: string }) {
  return (
    <button type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="w-7 h-7 flex items-center justify-center transition-colors duration-150 bevel-sm"
      style={{
        background: active ? `${accent}26` : 'var(--s-surface)',
        border: `1px solid ${active ? accent : 'var(--s-border)'}`,
        color: active ? accent : 'var(--s-text-muted)',
      }}
      title={title}>
      {children}
    </button>
  );
}

// ─── Vue liste — 1 ligne par joueur ──────────────────────────────────────
function PlayerRow({ p, matches, canShortlist, isShortlisted, onToggleShortlist, linkCopied, onGenerateLink, isLast }: {
  p: PlayerCard; matches: OpenPosition[]; canShortlist: boolean; isShortlisted: boolean;
  onToggleShortlist: () => void; linkCopied: boolean; onGenerateLink: () => void; isLast: boolean;
}) {
  const avatar = p.avatarUrl || p.discordAvatar;
  const hasMatch = matches.length > 0;
  const sortedStructures = sortStructuresByPriority(p.structures);
  const visibleStructures = sortedStructures.slice(0, 2);
  const extraCount = sortedStructures.length - visibleStructures.length;
  const tier = getRankTierConfig(p.rlRank);

  return (
    <div className="relative group transition-colors hover:bg-[var(--s-elevated)]"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--s-border)',
        background: hasMatch ? 'rgba(0,217,54,0.04)' : undefined,
      }}>
      <Link href={`/profile/${p.uid}`} className="absolute inset-0 z-[1]" aria-label={p.displayName} />
      <div className="relative z-[2] flex items-center gap-3 px-4 py-2.5" style={{ pointerEvents: 'none' }}>
        {/* Avatar */}
        {avatar ? (
          <div className="w-9 h-9 relative flex-shrink-0 overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <Image src={avatar} alt={p.displayName} fill className="object-cover" unoptimized />
          </div>
        ) : (
          <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <User size={14} style={{ color: 'var(--s-text-muted)' }} />
          </div>
        )}

        <div className="flex items-center gap-1.5 min-w-0" style={{ flex: '0 0 180px' }}>
          <span className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
          {p.rlAccountVerified && (
            <span title="Compte RL vérifié" style={{ color: 'var(--s-gold)', flexShrink: 0, display: 'inline-flex' }}>
              <ShieldCheck size={11} />
            </span>
          )}
        </div>

        <CountryFlag code={p.country} size={20} />

        <div className="flex gap-1" style={{ flex: '0 0 60px' }}>
          {p.games.map(g => (
            <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
              style={{ fontSize: '11px', padding: '1px 5px' }}>
              {g === 'rocket_league' ? 'RL' : 'TM'}
            </span>
          ))}
        </div>

        {/* Rang RL avec icône */}
        <div className="hidden md:flex items-center gap-1.5 text-xs min-w-0" style={{ flex: '0 0 160px', color: 'var(--s-text-dim)' }}>
          {p.rlRank && p.rlAccountVerified && tier ? (
            <>
              <RankBadge rank={p.rlRank} size={20} />
              <span className="truncate" style={{ color: tier.color }}>{p.rlRank}</span>
            </>
          ) : p.games.includes('rocket_league') && !p.rlAccountVerified ? (
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--s-text-muted)' }}>
              <ShieldAlert size={10} /> Non vérifié
            </span>
          ) : p.pseudoTM ? (
            <>
              <Gamepad2 size={11} style={{ color: 'var(--s-green)' }} />
              <span className="truncate">{p.pseudoTM}</span>
            </>
          ) : null}
        </div>

        {/* Structures (top 2 par hiérarchie) */}
        <div className="hidden lg:flex flex-col gap-0.5 min-w-0" style={{ flex: '1 1 0' }}>
          {visibleStructures.length > 0 ? (
            <>
              {visibleStructures.map(s => (
                <StructureLine key={`${s.id}-${s.game}`} s={s} size="xs" />
              ))}
              {extraCount > 0 && (
                <span className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>
                  + {extraCount} autre{extraCount > 1 ? 's' : ''}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>Sans structure</span>
          )}
        </div>

        {/* Badge recrutement */}
        <div className="hidden lg:block" style={{ flex: '0 0 130px' }}>
          {p.isAvailableForRecruitment && (
            <span className="tag inline-flex items-center gap-1"
              style={{ background: 'rgba(0,217,54,0.10)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.30)', fontSize: '11px', padding: '2px 6px' }}>
              <Star size={10} style={{ fill: '#33ff66' }} />
              {ROLE_LABELS[p.recruitmentRole] || 'Cherche équipe'}
            </span>
          )}
        </div>

        {hasMatch && (
          <span className="hidden xl:inline-flex tag items-center gap-1 flex-shrink-0"
            style={{ fontSize: '11px', padding: '2px 7px', background: 'rgba(0,217,54,0.15)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.45)', fontWeight: 600 }}>
            <Target size={10} /> Match
          </span>
        )}

        {canShortlist && (
          <div className="flex gap-1 flex-shrink-0" style={{ pointerEvents: 'auto' }}>
            <IconButton onClick={onToggleShortlist} active={isShortlisted} accent="var(--s-gold)"
              title={isShortlisted ? 'Retirer de la shortlist' : 'Ajouter à la shortlist'}>
              {isShortlisted ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
            </IconButton>
            <IconButton onClick={onGenerateLink} active={linkCopied} accent="#33ff66"
              title={linkCopied ? 'Lien copié !' : "Générer un lien d'invitation"}>
              {linkCopied ? <Check size={13} /> : <Link2 size={13} />}
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ hasFilters, totalCount, onReset }: { hasFilters: boolean; totalCount: number; onReset: () => void }) {
  if (hasFilters) {
    return (
      <div className="bevel p-12 text-center animate-fade-in-d2" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <Search size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
        <h3 className="font-display text-lg tracking-wider mb-2">AUCUN RÉSULTAT</h3>
        <p className="t-body mb-5" style={{ color: 'var(--s-text-dim)' }}>Aucun joueur ne correspond à tes filtres.</p>
        <button type="button" onClick={onReset} className="btn-springs btn-secondary bevel-sm">Réinitialiser les filtres</button>
      </div>
    );
  }
  return (
    <div className="bevel p-12 text-center animate-fade-in-d2 relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,129,255,0.07), transparent 60%)' }} />
      <div className="relative z-[1]">
        <Sparkles size={32} className="mx-auto mb-4" style={{ color: 'var(--s-blue)' }} />
        <h3 className="font-display text-xl tracking-wider mb-2">
          {totalCount === 0 ? "PERSONNE N'EST ENCORE INSCRIT" : 'AUCUN JOUEUR DISPONIBLE'}
        </h3>
        <p className="t-body mb-6 max-w-md mx-auto" style={{ color: 'var(--s-text-dim)' }}>
          {totalCount === 0
            ? 'Sois le premier joueur Aedral — crée ton profil et rejoins la communauté.'
            : "Personne n'est marqué comme disponible au recrutement pour l'instant."}
        </p>
        <Link href="/settings" className="btn-springs btn-primary bevel-sm inline-flex items-center gap-2">
          <Star size={14} /> Marque-toi disponible
        </Link>
      </div>
    </div>
  );
}
