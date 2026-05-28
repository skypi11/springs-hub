'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  Shield, Users, Gamepad2, ExternalLink, Trophy, Loader2, AlertCircle,
  User, Globe, Search, MessageSquare, UserPlus, CheckCircle, Calendar,
  Crown, X,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonPageHeader, SkeletonCard } from '@/components/ui/Skeleton';
import { computeMemberRole, groupAffiliations, PRIMARY_ROLE_LABELS, type MemberRoleTeam, type PrimaryRole } from '@/lib/member-role';
import DiscordIcon from '@/components/icons/DiscordIcon';
import { getProfileHref } from '@/lib/user-slug';
import GameTag from '@/components/games/GameTag';
import {
  ALL_GAME_DEFS,
  getGameColor,
  getGameColorRgb,
  getGameLabel,
} from '@/lib/games-registry';

type Member = {
  id: string;
  userId: string;
  slug?: string;
  game: string;
  role: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type TeamPlayer = {
  uid: string;
  slug?: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
};

type Team = {
  id: string;
  name: string;
  game: string;
  players: TeamPlayer[];
  subs: TeamPlayer[];
  staff: TeamPlayer[];
  staffRoles?: Record<string, 'coach' | 'manager'>;
  captainId?: string | null;
  label?: string;
  order?: number;
  groupOrder?: number;
  status?: 'active' | 'archived';
  logoUrl?: string;
};

type StructureData = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  coverUrl: string;
  coverFocus: import('@/types').BannerFocus | null;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  recruiting: { active: boolean; positions: { game: string; role: string }[]; message?: string };
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
  status: string;
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
  members: Member[];
  createdAtMs: number | null;
  eventsCount: number;
};

function formatAgeSince(ms: number | null): string {
  if (!ms) return '';
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `${days} jours`;
  if (days < 30) return `${Math.floor(days / 7)} sem.`;
  if (days < 365) return `${Math.floor(days / 30)} mois`;
  return `${Math.floor(days / 365)} an${days >= 730 ? 's' : ''}`;
}

// Ordre d'affichage des membres, basé sur le rôle dérivé, pas le stocké.
const PRIMARY_ROLE_ORDER: PrimaryRole[] = [
  'fondateur', 'co_fondateur', 'responsable', 'coach_structure',
  'manager_equipe', 'coach_equipe', 'capitaine', 'joueur', 'membre',
];
// Couleur du label principal selon le rôle dérivé.
const PRIMARY_ROLE_COLORS: Record<PrimaryRole, string> = {
  fondateur: 'var(--s-gold)',
  co_fondateur: 'var(--s-gold)',
  responsable: 'var(--s-gold)',
  coach_structure: '#FFB800',
  manager_equipe: 'var(--s-gold)',
  coach_equipe: '#4da6ff',
  capitaine: 'var(--s-gold)',
  joueur: 'var(--s-text)',
  membre: 'var(--s-text-dim)',
};

function PlayerRow({ player, color, isCaptain }: { player: TeamPlayer; color: string; isCaptain?: boolean }) {
  const av = player.avatarUrl || player.discordAvatar;
  return (
    <Link href={getProfileHref(player)}
      className="flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-[var(--s-hover)]"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      {av ? (
        <div className="w-7 h-7 relative flex-shrink-0 overflow-hidden" style={{ border: '1px solid var(--s-border)' }}>
          <Image src={av} alt={player.displayName} fill className="object-cover" unoptimized />
        </div>
      ) : (
        <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <User size={11} style={{ color: 'var(--s-text-muted)' }} />
        </div>
      )}
      <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color }}>
        {player.displayName}
        {isCaptain && <Crown size={11} style={{ color: 'var(--s-gold)' }} />}
      </span>
    </Link>
  );
}

// Card compacte d'équipe, pensée pour scale jusqu'à 20+ équipes sans scroll infini.
// Taille ~220px, affiche l'essentiel (nom, capitaine, cluster avatars, compteur), le détail
// complet (rosters, staff) est dans le TeamDetailPanel qui slide depuis la droite.
function TeamCardCompact({ team, onOpen }: { team: Team; onOpen: () => void }) {
  const gcRaw = getGameColorRgb(team.game);
  const gcVar = getGameColor(team.game);
  const isArchived = team.status === 'archived';

  const captain = team.captainId
    ? [...team.players, ...team.subs].find(p => p.uid === team.captainId)
    : null;

  const allRoster = [...team.players, ...team.subs];
  const visibleAvatars = allRoster.slice(0, 5);
  const overflow = Math.max(0, allRoster.length - 5);

  const tCount = team.players.length;
  const sCount = team.subs.length;
  const stCount = team.staff.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="pillar-card panel relative overflow-hidden text-left w-full transition-all duration-200 group"
      style={{ opacity: isArchived ? 0.75 : 1 }}
    >
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, rgba(${gcRaw},1), rgba(${gcRaw},0.3), transparent 70%)` }} />
      <div className="absolute top-0 right-0 w-[160px] h-[160px] pointer-events-none opacity-[0.06] group-hover:opacity-[0.12] transition-opacity"
        style={{ background: `radial-gradient(circle at top right, rgba(${gcRaw},1), transparent 70%)` }} />

      <div className="relative z-[1] p-4 space-y-3">
        {/* Header : nom + jeu */}
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center overflow-hidden"
            style={{ background: `rgba(${gcRaw},0.1)`, border: `1px solid rgba(${gcRaw},0.25)` }}>
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" className="w-full h-full object-contain" />
            ) : (
              <Gamepad2 size={14} style={{ color: gcVar }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display tracking-wider truncate" style={{ color: 'var(--s-text)', fontSize: '18px', lineHeight: 1.1 }}>
              {team.name}
            </h3>
            {team.label && (
              <p className="t-label mt-0.5 truncate" style={{ color: 'var(--s-text-muted)' }}>{team.label}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <GameTag gameId={team.game} />
            {isArchived && <span className="tag tag-neutral" style={{ fontSize: '8px', padding: '1px 5px' }}>ARCHIVÉE</span>}
          </div>
        </div>

        {/* Capitaine */}
        <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          {captain ? (
            <>
              {(captain.avatarUrl || captain.discordAvatar) ? (
                <div className="w-5 h-5 relative flex-shrink-0 overflow-hidden" style={{ border: '1px solid rgba(255,184,0,0.3)' }}>
                  <Image src={captain.avatarUrl || captain.discordAvatar} alt={captain.displayName} fill className="object-cover" unoptimized />
                </div>
              ) : (
                <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                  <User size={9} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}
              <Crown size={10} style={{ color: 'var(--s-gold)' }} />
              <span className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{captain.displayName}</span>
            </>
          ) : (
            <>
              <Crown size={10} style={{ color: 'var(--s-text-muted)' }} />
              <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Sans capitaine</span>
            </>
          )}
        </div>

        {/* Cluster d'avatars + compteur */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center">
            {visibleAvatars.length > 0 ? (
              <>
                {visibleAvatars.map((p, i) => {
                  const av = p.avatarUrl || p.discordAvatar;
                  return (
                    <div key={p.uid} className="w-7 h-7 relative flex-shrink-0 overflow-hidden"
                      style={{ marginLeft: i === 0 ? 0 : -8, background: 'var(--s-elevated)', border: '2px solid var(--s-surface)', zIndex: visibleAvatars.length - i }}
                      title={p.displayName}>
                      {av ? (
                        <Image src={av} alt={p.displayName} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User size={11} style={{ color: 'var(--s-text-muted)' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-[12px] font-bold"
                    style={{ marginLeft: -8, background: 'var(--s-elevated)', border: '2px solid var(--s-surface)', color: 'var(--s-text-dim)' }}>
                    +{overflow}
                  </div>
                )}
              </>
            ) : (
              <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Roster vide</span>
            )}
          </div>
          <div className="flex items-center gap-1 t-mono text-[12px]" style={{ color: 'var(--s-text-dim)' }}>
            <span title="Titulaires">{tCount}T</span>
            <span style={{ color: 'var(--s-text-muted)' }}>·</span>
            <span title="Remplaçants">{sCount}R</span>
            {stCount > 0 && (
              <>
                <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                <span title="Staff">{stCount}S</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// Panneau latéral slide-in à droite, DA Springs (biseau, hex, bordure neutre).
// Ferme à l'ESC ou via le bouton X ou clic sur l'overlay.
function TeamDetailPanel({ team, onClose }: { team: Team; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const gcRaw = getGameColorRgb(team.game);
  const gcVar = getGameColor(team.game);
  const isArchived = team.status === 'archived';

  return (
    <>
      <div
        className="animate-overlay-in"
        style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.65)' }}
        onClick={onClose}
      />
      <aside
        className="h-screen w-full sm:w-[480px] animate-slide-in-right flex flex-col"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 50,
          background: 'var(--s-surface)',
          borderLeft: '1px solid var(--s-border)',
        }}
        role="dialog"
        aria-label={`Détails équipe ${team.name}`}
      >
        <div className="h-[3px] flex-shrink-0" style={{ background: `linear-gradient(90deg, rgba(${gcRaw},1), rgba(${gcRaw},0.3), transparent 70%)` }} />

        {/* Header sticky */}
        <div className="flex-shrink-0 px-5 py-4 flex items-start gap-3" style={{ background: 'var(--s-surface)', borderBottom: '1px solid var(--s-border)' }}>
          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center overflow-hidden"
            style={{ background: `rgba(${gcRaw},0.1)`, border: `1px solid rgba(${gcRaw},0.25)` }}>
            {team.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={team.logoUrl} alt="" className="w-full h-full object-contain" />
            ) : (
              <Gamepad2 size={16} style={{ color: gcVar }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display tracking-wider" style={{ color: 'var(--s-text)', fontSize: '22px', lineHeight: 1.1 }}>{team.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <GameTag gameId={team.game} variant="full" />
              {team.label && <span className="tag tag-neutral">{team.label}</span>}
              {isArchived && <span className="tag tag-neutral">ARCHIVÉE</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center transition-colors duration-150 hover:bg-[var(--s-hover)]"
            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
            aria-label="Fermer"
          >
            <X size={14} style={{ color: 'var(--s-text-dim)' }} />
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {team.players.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="t-label">TITULAIRES</span>
                <span className="t-mono text-[12px]" style={{ color: 'var(--s-text-muted)' }}>{team.players.length}</span>
              </div>
              <div className="space-y-1.5">
                {team.players.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-text)" isCaptain={team.captainId === p.uid} />)}
              </div>
            </div>
          )}
          {team.subs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="t-label">REMPLAÇANTS</span>
                <span className="t-mono text-[12px]" style={{ color: 'var(--s-text-muted)' }}>{team.subs.length}</span>
              </div>
              <div className="space-y-1.5">
                {team.subs.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-text-dim)" isCaptain={team.captainId === p.uid} />)}
              </div>
            </div>
          )}
          {team.staff.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="t-label">STAFF</span>
                <span className="t-mono text-[12px]" style={{ color: 'var(--s-text-muted)' }}>{team.staff.length}</span>
              </div>
              <div className="space-y-1.5">
                {team.staff.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-gold)" />)}
              </div>
            </div>
          )}
          {team.players.length === 0 && team.subs.length === 0 && team.staff.length === 0 && (
            <div className="text-center py-10">
              <Users size={24} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun membre dans cette équipe.</p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, loading: authLoading } = useAuth();
  const [joinGame, setJoinGame] = useState('');
  const [joinRole, setJoinRole] = useState('joueur');
  const [joinPositionIdx, setJoinPositionIdx] = useState<number | null>(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSent, setJoinSent] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [joinError, setJoinError] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);
  // Onglet actif : gameId d'une registry OU 'archived'. Reste typé string pour
  // accepter automatiquement les futurs jeux ajoutés à la registry.
  const [activeTab, setActiveTab] = useState<string>(ALL_GAME_DEFS[0]?.id ?? 'archived');
  const [panelTeamId, setPanelTeamId] = useState<string | null>(null);

  const structureQ = useQuery({
    queryKey: ['structure', id] as const,
    queryFn: () => api<StructureData>(`/api/structures/${id}`),
    enabled: !authLoading,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return failureCount < 2;
    },
  });
  const teamsQ = useQuery({
    queryKey: ['structure', id, 'teams'] as const,
    queryFn: () => api<{ teams: Team[] }>(`/api/structures/teams?structureId=${id}`),
    enabled: !authLoading && !!structureQ.data,
  });
  const structure = structureQ.data ?? null;
  const teams = teamsQ.data?.teams ?? [];
  const loading = structureQ.isPending;
  const notFound = structureQ.isError && structureQ.error instanceof ApiError && structureQ.error.status === 404;

  if (loading || authLoading) {
    return (
      <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
        <div className="space-y-6 animate-fade-in">
          <SkeletonPageHeader accent="var(--s-gold)" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              <SkeletonCard height={260} accent="var(--s-blue)" />
              <SkeletonCard height={220} accent="var(--s-gold)" />
            </div>
            <div className="space-y-5">
              <SkeletonCard height={180} accent="var(--s-gold)" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !structure) {
    return (
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 lg:py-8 flex items-center justify-center">
        <div className="panel p-10 text-center max-w-md">
          <AlertCircle size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
          <h2 className="font-display text-2xl mb-2">STRUCTURE INTROUVABLE</h2>
          <p className="t-body">Cette structure n&apos;existe pas ou n&apos;est pas accessible.</p>
        </div>
      </div>
    );
  }

  const isOwner = firebaseUser?.uid === structure.founderId || (structure.coFounderIds ?? []).includes(firebaseUser?.uid ?? '');
  const isMember = structure.members.some(m => m.userId === firebaseUser?.uid);
  const socialEntries = Object.entries(structure.socials).filter(([, v]) => v);
  // Couleur principale = 1er jeu de la registry présent dans la structure
  // (fallback or si aucun jeu connu). Marche pour RL/TM/Val/futurs jeux.
  const mainGameDef = ALL_GAME_DEFS.find(g => structure.games?.includes(g.id));
  const mainColor = mainGameDef?.color ?? 'var(--s-gold)';
  const mainColorRaw = mainGameDef?.colorRgb ?? '255,184,0';
  // Calcul du rôle dérivé pour chaque membre, vérité d'affichage unique,
  // même source que le dashboard privé. On cache le résultat par userId pour ne pas recalculer.
  // L'API renvoie `players/subs/staff` enrichis ; computeMemberRole attend
  // playerIds/subIds/staffIds (strings). On reconstruit les IDs ici.
  const roleTeams: MemberRoleTeam[] = teams.map(t => ({
    id: t.id,
    name: t.name,
    playerIds: t.players.map(p => p.uid),
    subIds: t.subs.map(p => p.uid),
    staffIds: t.staff.map(p => p.uid),
    staffRoles: t.staffRoles,
    captainId: t.captainId ?? null,
    status: t.status,
  }));
  const roleByUser = new Map<string, ReturnType<typeof computeMemberRole>>();
  const roleFor = (userId: string) => {
    const hit = roleByUser.get(userId);
    if (hit) return hit;
    const r = computeMemberRole({
      userId,
      founderId: structure.founderId,
      coFounderIds: structure.coFounderIds ?? [],
      managerIds: structure.managerIds ?? [],
      coachIds: structure.coachIds ?? [],
      teams: roleTeams,
    });
    roleByUser.set(userId, r);
    return r;
  };
  // Dedupe par userId (un dirigeant RL + TM apparaît 2× dans structure_members)
  // et tri fondateur puis co-fondateur via PRIMARY_ROLE_ORDER.
  const leadersSeen = new Set<string>();
  const leaders = structure.members
    .filter(m => {
      const p = roleFor(m.userId).primary;
      if (p !== 'fondateur' && p !== 'co_fondateur') return false;
      if (leadersSeen.has(m.userId)) return false;
      leadersSeen.add(m.userId);
      return true;
    })
    .sort((a, b) =>
      PRIMARY_ROLE_ORDER.indexOf(roleFor(a.userId).primary) - PRIMARY_ROLE_ORDER.indexOf(roleFor(b.userId).primary),
    );
  const sortedMembers = [...structure.members].sort((a, b) =>
    PRIMARY_ROLE_ORDER.indexOf(roleFor(a.userId).primary) - PRIMARY_ROLE_ORDER.indexOf(roleFor(b.userId).primary),
  );

  // Dedupe par userId pour la grille membres : un joueur RL + TM ne doit apparaître qu'une fois
  const uniqueMembers: (Member & { games: string[] })[] = [];
  const seen = new Map<string, Member & { games: string[] }>();
  for (const m of sortedMembers) {
    const existing = seen.get(m.userId);
    if (existing) {
      if (!existing.games.includes(m.game)) existing.games.push(m.game);
      continue;
    }
    const entry = { ...m, games: [m.game] };
    seen.set(m.userId, entry);
    uniqueMembers.push(entry);
  }

  async function handleJoinRequest() {
    if (!firebaseUser || !joinGame || !structure) return;
    setJoinLoading(true);
    setJoinError('');
    try {
      await api('/api/structures/join', {
        method: 'POST',
        body: {
          action: 'request_join',
          structureId: structure.id,
          game: joinGame,
          role: joinRole,
          message: joinMessage,
        },
      });
      setJoinSent(true);
      setShowJoinForm(false);
    } catch (err) {
      setJoinError(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setJoinLoading(false);
  }

  const panelTeam = panelTeamId ? teams.find(t => t.id === panelTeamId) ?? null : null;

  // CTA principal, partagé entre l'overlay desktop et le bloc identité mobile.
  const ctaContent = isOwner ? (
    <Link href="/community/my-structure" className="btn-springs btn-secondary bevel-sm flex items-center justify-center gap-2">
      <Shield size={14} /> Gérer
    </Link>
  ) : firebaseUser && !isMember && !joinSent && structure.recruiting?.active ? (
    <button onClick={() => setShowJoinForm(!showJoinForm)}
      className="btn-springs btn-primary bevel-sm flex items-center justify-center gap-2"
      style={{ padding: '10px 20px', fontSize: '13px' }}>
      <UserPlus size={15} /> Postuler
    </button>
  ) : firebaseUser && !isMember && !joinSent && !structure.recruiting?.active ? (
    <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>
      Ne recrute pas
    </span>
  ) : joinSent ? (
    <span className="flex items-center gap-2 text-sm font-bold" style={{ color: '#33ff66' }}>
      <CheckCircle size={15} /> Demande envoyée
    </span>
  ) : isMember ? (
    <span className="tag tag-gold" style={{ fontSize: '12px', padding: '6px 14px' }}>Membre</span>
  ) : null;

  // Tags d'identité (tag structure + jeux + recrute), partagés desktop/mobile.
  const identityTags = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="tag tag-gold">{structure.tag}</span>
      {structure.games?.map(g => (
        <GameTag key={g} gameId={g} variant="full" />
      ))}
      {structure.recruiting?.active && (
        <span className="tag" style={{ background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.3)' }}>
          <Search size={9} /> Recrute
        </span>
      )}
    </div>
  );

  return (
    <>
    <div className="min-h-screen hex-bg px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8">
      <CompactStickyHeader
        icon={Shield}
        title={structure.name}
        accent={mainColor}
      />
      <div className="relative z-[1] space-y-8">

        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Structures', href: '/community/structures' },
          { label: structure.name },
        ]} />

        {/* ═══════════════════════════════════════════════════════════════════
            HERO HEADER, cover vivante + stats
        ═══════════════════════════════════════════════════════════════════ */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${mainColor}, rgba(${mainColorRaw},0.3), transparent 80%)` }} />

          {/* ── Zone hero : bannière en fond, identité posée par-dessus ──
              Ratio 6:1 FIXE (sans max-height, qui rétrécirait la largeur) :
              la bannière est pleine largeur ET son rendu est identique sur tous
              les écrans, c'est ce qui rend l'aperçu de l'éditeur fidèle.
              L'éditeur (BannerFocusEditor) utilise le même ratio 6:1. */}
          <div className="relative overflow-hidden w-full"
            style={{
              aspectRatio: '6 / 1',
              background: `linear-gradient(135deg, rgba(${mainColorRaw},0.22) 0%, rgba(${mainColorRaw},0.06) 45%, var(--s-surface) 100%)`,
            }}>
            {/* Fond : bannière cadrée si fournie, sinon décor aux couleurs du jeu */}
            {structure.coverUrl ? (
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url("${structure.coverUrl}")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: 'cover',
                  backgroundPosition: structure.coverFocus
                    ? `${structure.coverFocus.x}% ${structure.coverFocus.y}%`
                    : 'center',
                }}
              />
            ) : (
              <>
                <div className="absolute inset-0 hex-bg opacity-70 pointer-events-none" />
                <div className="absolute top-0 right-0 w-[500px] h-[300px] pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at top right, rgba(${mainColorRaw},0.2), transparent 70%)` }} />
              </>
            )}
            {/* Voile sombre : bannière nette en haut, texte lisible en bas */}
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(8,8,12,0.95) 0%, rgba(8,8,12,0.72) 32%, rgba(8,8,12,0.34) 68%, rgba(8,8,12,0.12) 100%)' }} />

            {/* Identité desktop, calée en bas, posée sur la bannière */}
            <div className="hidden lg:flex absolute inset-0 z-[1] items-end px-8 pt-8 pb-5">
              <div className="flex items-end gap-6 w-full">
                {/* Logo */}
                <div className="flex-shrink-0 w-[110px] h-[110px] relative overflow-hidden bevel-sm"
                  style={{ background: 'var(--s-elevated)', border: `3px solid rgba(${mainColorRaw},0.45)`, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}>
                  {structure.logoUrl ? (
                    <Image src={structure.logoUrl} alt={structure.name} fill className="object-contain p-2.5" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Shield size={48} style={{ color: 'var(--s-text-muted)' }} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="mb-2.5">{identityTags}</div>
                  {/* Nom */}
                  <h1 className="font-display tracking-wider truncate"
                    style={{ color: 'var(--s-text)', fontSize: '46px', lineHeight: 1, textShadow: '0 2px 16px rgba(0,0,0,0.75)' }}>
                    {structure.name}
                  </h1>
                </div>

                {/* CTA principal */}
                <div className="flex-shrink-0 flex flex-col items-end gap-2">
                  {ctaContent}
                </div>
              </div>
            </div>
          </div>

          {/* ── Identité mobile : empilée sous la bannière ──
              La zone 6:1 fait ~55px de haut sur petit écran, trop fine pour
              porter logo + nom + CTA en superposition. On la sort en flux normal. */}
          <div className="lg:hidden flex flex-col gap-4 px-4 sm:px-6 py-5" style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-[76px] h-[76px] relative overflow-hidden bevel-sm"
                style={{ background: 'var(--s-elevated)', border: `3px solid rgba(${mainColorRaw},0.45)`, boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}>
                {structure.logoUrl ? (
                  <Image src={structure.logoUrl} alt={structure.name} fill className="object-contain p-2" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Shield size={32} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                {identityTags}
                <h1 className="font-display tracking-wider"
                  style={{ color: 'var(--s-text)', fontSize: 'clamp(24px, 6.5vw, 38px)', lineHeight: 1.05 }}>
                  {structure.name}
                </h1>
              </div>
            </div>
            <div className="flex flex-col items-start gap-2">
              {ctaContent}
            </div>
          </div>

          {/* ── Barre d'infos : stats + direction sur fond plein ── */}
          <div className="relative z-[1] px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-x-8 gap-y-3 flex-wrap"
            style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-6 flex-wrap">
              <HeroStat
                icon={<Users size={13} style={{ color: 'var(--s-gold)' }} />}
                value={String(structure.members.length)}
                label={structure.members.length > 1 ? 'membres' : 'membre'}
              />
              {structure.createdAtMs && (
                <HeroStat
                  icon={<Calendar size={13} style={{ color: 'var(--s-text-dim)' }} />}
                  value={formatAgeSince(structure.createdAtMs)}
                  label="d'activité"
                />
              )}
              <HeroStat
                icon={<Trophy size={13} style={{ color: mainColor }} />}
                value={String(structure.eventsCount)}
                label={structure.eventsCount > 1 ? 'événements' : 'événement'}
              />
              {structure.recruiting?.active && structure.recruiting.positions.length > 0 && (
                <HeroStat
                  icon={<Search size={13} style={{ color: 'var(--s-gold)' }} />}
                  value={String(structure.recruiting.positions.length)}
                  label={structure.recruiting.positions.length > 1 ? 'postes ouverts' : 'poste ouvert'}
                  highlight
                />
              )}
            </div>

            {/* Direction, fondateurs inline */}
            {leaders.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>DIRECTION</span>
                <div className="flex items-center gap-3 flex-wrap">
                  {leaders.map(l => {
                    const avatar = l.avatarUrl || l.discordAvatar;
                    const leaderPrimary = roleFor(l.userId).primary;
                    const roleConf = { label: PRIMARY_ROLE_LABELS[leaderPrimary], color: PRIMARY_ROLE_COLORS[leaderPrimary] };
                    return (
                      <Link key={l.id} href={getProfileHref({ uid: l.userId, slug: l.slug })}
                        className="flex items-center gap-2 px-2.5 py-1 transition-colors duration-150 hover:bg-[var(--s-elevated)]"
                        style={{ background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.12)' }}>
                        {avatar ? (
                          <div className="w-6 h-6 relative flex-shrink-0 overflow-hidden" style={{ border: '1px solid rgba(255,184,0,0.2)' }}>
                            <Image src={avatar} alt={l.displayName} fill className="object-cover" unoptimized />
                          </div>
                        ) : (
                          <div className="w-6 h-6 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.2)' }}>
                            <User size={10} style={{ color: 'var(--s-gold)' }} />
                          </div>
                        )}
                        <span className="text-xs font-semibold" style={{ color: 'var(--s-text)' }}>{l.displayName}</span>
                        <span className="t-label" style={{ color: roleConf.color }}>{roleConf.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Formulaire de demande (s'affiche sous le header) */}
        {showJoinForm && (
          <div className="bevel p-6 space-y-4 animate-fade-in" style={{ background: 'var(--s-surface)', border: `1px solid rgba(${mainColorRaw},0.2)` }}>
            <div className="h-[2px] -mt-6 -mx-6 mb-5" style={{ background: `linear-gradient(90deg, rgba(${mainColorRaw},0.5), transparent 60%)` }} />
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 flex items-center justify-center" style={{ background: `rgba(${mainColorRaw},0.08)`, border: `1px solid rgba(${mainColorRaw},0.2)` }}>
                <UserPlus size={14} style={{ color: mainColor }} />
              </div>
              <span className="font-display text-base tracking-wider">DEMANDE DE REJOINDRE</span>
            </div>
            {(() => {
              const positions = structure.recruiting?.active ? (structure.recruiting.positions || []) : [];
              const hasPositions = positions.length > 0;
              const gameLabel = (g: string) => getGameLabel(g);
              const roleLabel = (r: string) => {
                const map: Record<string, string> = { joueur: 'Joueur', titulaire: 'Titulaire', sub: 'Remplaçant', coach: 'Coach', manager: 'Manager' };
                return map[r] || r;
              };
              return (
                <>
                  {hasPositions ? (
                    <div>
                      <label className="t-label block mb-1.5">Poste visé *</label>
                      <select
                        className="settings-input w-full"
                        value={joinPositionIdx ?? ''}
                        onChange={e => {
                          const idx = e.target.value === '' ? null : Number(e.target.value);
                          setJoinPositionIdx(idx);
                          if (idx !== null) {
                            const p = positions[idx];
                            setJoinGame(p.game);
                            setJoinRole(p.role);
                          } else {
                            setJoinGame('');
                            setJoinRole('joueur');
                          }
                        }}
                      >
                        <option value="">Choisir un poste ouvert...</option>
                        {positions.map((p, i) => (
                          <option key={i} value={i}>
                            {gameLabel(p.game)} · {roleLabel(p.role)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="t-label block mb-1.5">Jeu *</label>
                      <select className="settings-input w-full" value={joinGame} onChange={e => { setJoinGame(e.target.value); setJoinRole('joueur'); }}>
                        <option value="">Choisir...</option>
                        {ALL_GAME_DEFS.filter(g => structure.games?.includes(g.id)).map(g => (
                          <option key={g.id} value={g.id}>{g.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="t-label block mb-1.5">Message (optionnel)</label>
                    <textarea
                      className="settings-input w-full"
                      rows={3}
                      maxLength={500}
                      placeholder="Présente-toi rapidement : ton niveau, tes dispos, pourquoi cette structure..."
                      value={joinMessage}
                      onChange={e => setJoinMessage(e.target.value)}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{joinMessage.length}/500</p>
                  </div>
                </>
              );
            })()}
            {joinError && <p className="text-xs" style={{ color: '#ff5555' }}>{joinError}</p>}
            <div className="flex gap-3">
              <button onClick={handleJoinRequest} disabled={!joinGame || joinLoading}
                className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                style={{ opacity: joinGame ? 1 : 0.5 }}>
                {joinLoading ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                Envoyer la demande
              </button>
              <button onClick={() => setShowJoinForm(false)} className="btn-springs btn-ghost text-xs">
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            CONTENU, GRID 2/3 + 1/3
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ─── COLONNE GAUCHE (2/3) ─────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6 animate-fade-in-d1">

            {/* 1. À PROPOS */}
            {structure.description && (
              <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
                <div className="h-[3px]" style={{ background: `linear-gradient(90deg, rgba(${mainColorRaw},0.5), transparent 60%)` }} />
                <div className="absolute top-0 right-0 w-[180px] h-[180px] pointer-events-none opacity-[0.05]"
                  style={{ background: `radial-gradient(circle at top right, rgba(${mainColorRaw},1), transparent 70%)` }} />
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={13} style={{ color: mainColor }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>À PROPOS</span>
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="prose-springs text-sm">
                      <ReactMarkdown>{structure.description}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. ÉQUIPES, onglets par jeu + grille de cards compactes (scale 20+ équipes).
                Le roster complet est dans un panneau latéral (TeamDetailPanel). */}
            {teams.length > 0 && (() => {
              // Onglets dynamiques : un par jeu de la registry qui a des équipes actives,
              // + un "Archivées" si présent. Ajouter un nouveau jeu dans la registry
              // → un onglet apparaît tout seul ici.
              const teamsByGame = new Map<string, Team[]>();
              for (const t of teams) {
                if ((t.status ?? 'active') !== 'active') continue;
                const arr = teamsByGame.get(t.game) ?? [];
                arr.push(t);
                teamsByGame.set(t.game, arr);
              }
              const archAll = teams.filter(t => t.status === 'archived');

              const tabs: { key: string; label: string; count: number; color: string }[] = [];
              for (const g of ALL_GAME_DEFS) {
                const list = teamsByGame.get(g.id) ?? [];
                if (list.length > 0) {
                  tabs.push({ key: g.id, label: g.label, count: list.length, color: g.color });
                }
              }
              if (archAll.length > 0) {
                tabs.push({ key: 'archived', label: 'Archivées', count: archAll.length, color: 'var(--s-text-dim)' });
              }

              if (tabs.length === 0) return null;
              const effectiveTab = tabs.find(t => t.key === activeTab) ? activeTab : tabs[0].key;

              const pool = effectiveTab === 'archived'
                ? archAll
                : (teamsByGame.get(effectiveTab) ?? []);

              const q = teamSearch.trim().toLowerCase();
              const filtered = !q ? pool : pool.filter(t => {
                if (t.name?.toLowerCase().includes(q)) return true;
                if ((t.label ?? '').toLowerCase().includes(q)) return true;
                const allMembers = [...t.players, ...t.subs, ...t.staff];
                return allMembers.some(m => (m.displayName ?? '').toLowerCase().includes(q));
              });

              // Tri : groupOrder puis label, puis order puis nom, cohérent avec le dashboard.
              const sorted = [...filtered].sort((a, b) => {
                const ga = a.groupOrder ?? 0;
                const gb = b.groupOrder ?? 0;
                if (ga !== gb) return ga - gb;
                const la = (a.label ?? '').localeCompare(b.label ?? '');
                if (la !== 0) return la;
                const oa = a.order ?? 0;
                const ob = b.order ?? 0;
                if (oa !== ob) return oa - ob;
                return a.name.localeCompare(b.name);
              });

              const showSearch = pool.length > 4;
              const totalAll = Array.from(teamsByGame.values()).reduce((n, arr) => n + arr.length, 0) + archAll.length;

              return (
                <div className="space-y-5">
                  {/* En-tête section + total */}
                  <div className="flex items-center justify-between">
                    <span className="section-label t-label">ÉQUIPES</span>
                    <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>{totalAll}</span>
                  </div>

                  {/* Onglets par jeu */}
                  <div className="flex items-center gap-1 flex-wrap" style={{ borderBottom: '1px solid var(--s-border)' }}>
                    {tabs.map(t => {
                      const isActive = t.key === effectiveTab;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => { setActiveTab(t.key); setTeamSearch(''); }}
                          className="flex items-center gap-2 px-4 py-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                          style={{
                            background: isActive ? 'var(--s-elevated)' : 'transparent',
                            borderBottom: `2px solid ${isActive ? t.color : 'transparent'}`,
                            marginBottom: '-1px',
                          }}
                        >
                          <span className="t-label" style={{ color: isActive ? t.color : 'var(--s-text-dim)' }}>{t.label}</span>
                          <span className="t-mono text-[12px]" style={{ color: isActive ? t.color : 'var(--s-text-muted)' }}>{t.count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Recherche, uniquement si l'onglet actif a plus de 4 équipes */}
                  {showSearch && (
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                      <input type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                        placeholder={`Rechercher parmi ${pool.length} équipe${pool.length > 1 ? 's' : ''} (nom, label, joueur)...`}
                        className="settings-input has-icon-sm w-full text-sm" />
                    </div>
                  )}

                  {/* Grille */}
                  {sorted.length === 0 ? (
                    <div className="text-center py-8">
                      <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        {q ? `Aucun résultat pour « ${teamSearch} ».` : 'Aucune équipe dans cette catégorie.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {sorted.map(team => (
                        <TeamCardCompact key={team.id} team={team} onOpen={() => setPanelTeamId(team.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 3. MEMBRES */}
            <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-[180px] h-[180px] pointer-events-none opacity-[0.05]"
                style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
              <div className="relative z-[1]">
                <div className="panel-header">
                  <div className="flex items-center gap-2">
                    <Users size={13} style={{ color: 'var(--s-gold)' }} />
                    <span className="t-label" style={{ color: 'var(--s-text)' }}>MEMBRES</span>
                  </div>
                  <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>{structure.members.length}</span>
                </div>
                <div className="p-5">
                  {uniqueMembers.length === 0 ? (
                    <div className="py-6 text-center">
                      <Users size={26} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
                      <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucun membre pour le moment.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {uniqueMembers.map(m => {
                        const derived = roleFor(m.userId);
                        const roleConf = { label: PRIMARY_ROLE_LABELS[derived.primary], color: PRIMARY_ROLE_COLORS[derived.primary] };
                        const avatar = m.avatarUrl || m.discordAvatar;
                        const isLeader = derived.primary === 'fondateur' || derived.primary === 'co_fondateur';
                        const affiliations = groupAffiliations(derived.affiliations);
                        return (
                          <Link
                            key={m.userId}
                            href={getProfileHref({ uid: m.userId, slug: m.slug })}
                            className="flex flex-col items-center text-center gap-2 px-3 py-4 transition-all duration-150 hover:bg-[var(--s-elevated)]"
                            style={{
                              background: 'var(--s-surface)',
                              border: `1px solid ${isLeader ? 'rgba(255,184,0,0.22)' : 'var(--s-border)'}`,
                            }}
                          >
                            {avatar ? (
                              <div className="w-14 h-14 relative flex-shrink-0 overflow-hidden"
                                style={{ background: 'var(--s-elevated)', border: `1px solid ${isLeader ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}` }}>
                                <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                              </div>
                            ) : (
                              <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center"
                                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <User size={18} style={{ color: 'var(--s-text-muted)' }} />
                              </div>
                            )}
                            <div className="w-full min-w-0">
                              <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                              <p className="t-label mt-0.5" style={{ color: roleConf.color }}>{roleConf.label}</p>
                              {affiliations.length > 0 && (
                                <div className="flex items-center justify-center gap-1 mt-1.5 flex-wrap">
                                  {affiliations.map(b => {
                                    const colors: Record<string, { bg: string; fg: string; border: string }> = {
                                      manager: { bg: 'rgba(255,184,0,0.15)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.35)' },
                                      coach: { bg: 'rgba(0,129,255,0.15)', fg: '#4da6ff', border: 'rgba(0,129,255,0.35)' },
                                      capitaine: { bg: 'rgba(255,184,0,0.15)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.35)' },
                                      joueur: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--s-text-dim)', border: 'var(--s-border)' },
                                      remplacant: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--s-text-muted)', border: 'var(--s-border)' },
                                    };
                                    const c = colors[b.key] ?? colors.joueur;
                                    return (
                                      <span key={b.key} className="t-label" title={b.teamNames.join(', ')}
                                        style={{ padding: '2px 6px', background: c.bg, border: `1px solid ${c.border}`, color: c.fg, letterSpacing: '0.06em' }}>
                                        {b.label.toUpperCase()}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {m.country && (
                                <Image
                                  src={`https://flagcdn.com/w40/${m.country.toLowerCase()}.png`}
                                  alt={m.country}
                                  width={14}
                                  height={10}
                                  unoptimized
                                />
                              )}
                              {m.games.map(g => (
                                <GameTag key={g} gameId={g} style={{ padding: '1px 5px' }} />
                              ))}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ─── COLONNE DROITE (1/3) ─────────────────────────────────────── */}
          <div className="space-y-6 animate-fade-in-d2">

            {/* 1. RECRUTEMENT */}
            {structure.recruiting?.active && (structure.recruiting.positions.length > 0 || structure.recruiting.message) && (
              <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
                <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.07]"
                  style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <UserPlus size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>RECRUTEMENT</span>
                    </div>
                    <span className="tag tag-gold" style={{ fontSize: '12px' }}>OUVERT</span>
                  </div>
                  <div className="p-5 space-y-3">
                    {structure.recruiting.message && (
                      <div className="prose-springs text-sm p-3"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <ReactMarkdown>{structure.recruiting.message}</ReactMarkdown>
                      </div>
                    )}
                    {structure.recruiting.positions.map((p, i) => {
                      const canApply = firebaseUser && !isMember && !joinSent;
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={!canApply}
                          onClick={() => {
                            if (!canApply) return;
                            setJoinPositionIdx(i);
                            setJoinGame(p.game);
                            setJoinRole(p.role);
                            setShowJoinForm(true);
                          }}
                          className="w-full flex items-center justify-between px-3 py-2.5 transition-colors duration-150"
                          style={{
                            background: 'var(--s-elevated)',
                            border: '1px solid var(--s-border)',
                            cursor: canApply ? 'pointer' : 'default',
                          }}
                        >
                          <span className="text-sm font-medium" style={{ color: 'var(--s-text)' }}>
                            {p.role.charAt(0).toUpperCase() + p.role.slice(1)}
                          </span>
                          <GameTag gameId={p.game} style={{ padding: '2px 8px' }} />
                        </button>
                      );
                    })}
                    {structure.recruiting.positions.length > 0 && firebaseUser && !isMember && !joinSent ? (
                      <button onClick={() => setShowJoinForm(true)}
                        className="btn-springs btn-primary bevel-sm w-full flex items-center justify-center gap-2 text-xs mt-3">
                        <UserPlus size={12} /> Postuler
                      </button>
                    ) : joinSent ? (
                      <div className="flex items-center justify-center gap-2 mt-3 py-2">
                        <CheckCircle size={12} style={{ color: '#33ff66' }} />
                        <span className="text-xs font-bold" style={{ color: '#33ff66' }}>Demande envoyée</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* 2. LIENS & RÉSEAUX */}
            {(structure.discordUrl || socialEntries.length > 0) && (
              <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.15), transparent 60%)' }} />
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Globe size={13} style={{ color: 'var(--s-text-dim)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>LIENS</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-2">
                    {structure.discordUrl && (
                      <a href={structure.discordUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <span style={{ color: '#7289da' }} className="flex items-center">
                          <DiscordIcon size={16} />
                        </span>
                        <span className="text-sm font-medium" style={{ color: '#7289da' }}>Discord</span>
                        <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--s-text-muted)' }} />
                      </a>
                    )}
                    {socialEntries.map(([key, url]) => {
                      const social = { twitter: 'Twitter / X', youtube: 'YouTube', twitch: 'Twitch', instagram: 'Instagram', tiktok: 'TikTok', website: 'Site web' }[key];
                      if (!social) return null;
                      return (
                        <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <Globe size={14} style={{ color: 'var(--s-text-dim)' }} />
                          <span className="text-sm font-medium" style={{ color: 'var(--s-text)' }}>{social}</span>
                          <ExternalLink size={10} className="ml-auto" style={{ color: 'var(--s-text-muted)' }} />
                        </a>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 3. PALMARÈS */}
            {structure.achievements && structure.achievements.length > 0 && (
              <div className="pillar-card panel relative overflow-hidden group transition-all duration-200">
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
                <div className="absolute top-0 right-0 w-[150px] h-[150px] pointer-events-none opacity-[0.05]"
                  style={{ background: 'radial-gradient(circle at top right, var(--s-gold), transparent 70%)' }} />
                <div className="relative z-[1]">
                  <div className="panel-header">
                    <div className="flex items-center gap-2">
                      <Trophy size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-text)' }}>PALMARÈS</span>
                    </div>
                  </div>
                  <div className="p-5 space-y-2">
                    {structure.achievements.map((a, i) => {
                      const medalColor = a.placement === '1er' ? 'var(--s-gold)' : a.placement === '2e' ? '#c0c0c0' : a.placement === '3e' ? '#cd7f32' : 'var(--s-text-dim)';
                      return (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5"
                          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center"
                            style={{ background: `${medalColor}10`, border: `1px solid ${medalColor}30` }}>
                            <span className="font-display text-sm" style={{ color: medalColor }}>{a.placement}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{a.competition}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <GameTag gameId={a.game} style={{ fontSize: '8px', padding: '0px 4px' }} />
                              {a.date && (
                                <span className="t-mono" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
                                  {new Date(a.date + '-01').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
    {panelTeam && <TeamDetailPanel team={panelTeam} onClose={() => setPanelTeamId(null)} />}
    </>
  );
}

function HeroStat({
  icon, value, label, highlight = false,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-7 h-7 flex items-center justify-center flex-shrink-0"
        style={{
          background: highlight ? 'rgba(255,184,0,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${highlight ? 'rgba(255,184,0,0.25)' : 'var(--s-border)'}`,
        }}
      >
        {icon}
      </div>
      <div className="leading-tight">
        <p className="font-display" style={{ color: highlight ? 'var(--s-gold)' : 'var(--s-text)', fontSize: '18px', lineHeight: 1 }}>
          {value}
        </p>
        <p className="t-label mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{label}</p>
      </div>
    </div>
  );
}
