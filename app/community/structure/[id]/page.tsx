'use client';

import { useState, useEffect, use } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/context/AuthContext';
import {
  Shield, Users, Gamepad2, ExternalLink, Trophy, Loader2, AlertCircle,
  User, Globe, Search, MessageSquare, UserPlus, CheckCircle, Calendar,
  Crown, Archive, ChevronDown, ChevronUp, Tag,
} from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import { SkeletonPageHeader, SkeletonCard } from '@/components/ui/Skeleton';
import { computeMemberRole, groupAffiliations, PRIMARY_ROLE_LABELS, type MemberRoleTeam, type PrimaryRole } from '@/lib/member-role';

type Member = {
  id: string;
  userId: string;
  game: string;
  role: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type TeamPlayer = {
  uid: string;
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
};

type StructureData = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  coverUrl: string;
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

// Ordre d'affichage des membres — basé sur le rôle dérivé, pas le stocké.
const PRIMARY_ROLE_ORDER: PrimaryRole[] = [
  'fondateur', 'co_fondateur', 'responsable', 'manager_equipe',
  'coach_equipe', 'capitaine', 'joueur', 'membre',
];
// Couleur du label principal selon le rôle dérivé.
const PRIMARY_ROLE_COLORS: Record<PrimaryRole, string> = {
  fondateur: 'var(--s-gold)',
  co_fondateur: 'var(--s-gold)',
  responsable: 'var(--s-violet-light)',
  manager_equipe: 'var(--s-violet-light)',
  coach_equipe: '#4da6ff',
  capitaine: 'var(--s-gold)',
  joueur: 'var(--s-text)',
  membre: 'var(--s-text-dim)',
};

function ArchivedTeamsSection({ teams, renderCard }: { teams: Team[]; renderCard: (team: Team, isArchived: boolean) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="section-label flex items-center gap-2 w-full transition-colors"
        style={{ color: 'var(--s-text-dim)' }}>
        <Archive size={11} />
        <span className="t-label">Équipes archivées</span>
        <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '2px 7px' }}>{teams.length}</span>
        {open ? <ChevronUp size={11} className="ml-auto" /> : <ChevronDown size={11} className="ml-auto" />}
      </button>
      {open && (
        <div className={`grid ${teams.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-5`}>
          {teams.map(team => renderCard(team, true))}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ player, color, isCaptain }: { player: TeamPlayer; color: string; isCaptain?: boolean }) {
  const av = player.avatarUrl || player.discordAvatar;
  return (
    <Link href={`/profile/${player.uid}`}
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

export default function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { firebaseUser, loading: authLoading } = useAuth();
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [joinGame, setJoinGame] = useState('');
  const [joinRole, setJoinRole] = useState('joueur');
  const [joinPositionIdx, setJoinPositionIdx] = useState<number | null>(null);
  const [joinMessage, setJoinMessage] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinSent, setJoinSent] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [joinError, setJoinError] = useState('');
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    if (authLoading) return;
    async function load() {
      try {
        const res = await fetch(`/api/structures/${id}`);
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const data = await res.json();
        setStructure(data);
        try {
          const teamsRes = await fetch(`/api/structures/teams?structureId=${id}`);
          if (teamsRes.ok) {
            const teamsData = await teamsRes.json();
            setTeams(teamsData.teams ?? []);
          }
        } catch { /* ignore */ }
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    }
    load();
  }, [id, authLoading]);

  if (loading || authLoading) {
    return (
      <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
        <div className="space-y-6 animate-fade-in">
          <SkeletonPageHeader accent="var(--s-gold)" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              <SkeletonCard height={260} accent="var(--s-blue)" />
              <SkeletonCard height={220} accent="var(--s-gold)" />
            </div>
            <div className="space-y-5">
              <SkeletonCard height={180} accent="var(--s-violet)" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !structure) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
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
  const mainColor = structure.games?.includes('rocket_league') ? 'var(--s-blue)' : structure.games?.includes('trackmania') ? 'var(--s-green)' : 'var(--s-gold)';
  const mainColorRaw = structure.games?.includes('rocket_league') ? '0,129,255' : structure.games?.includes('trackmania') ? '0,217,54' : '255,184,0';
  // Calcul du rôle dérivé pour chaque membre — vérité d'affichage unique,
  // même source que le dashboard privé. On cache le résultat par userId pour ne pas recalculer.
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
      teams: teams as unknown as MemberRoleTeam[],
    });
    roleByUser.set(userId, r);
    return r;
  };
  const leaders = structure.members.filter(m => {
    const p = roleFor(m.userId).primary;
    return p === 'fondateur' || p === 'co_fondateur';
  });
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
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'request_join',
          structureId: structure.id,
          game: joinGame,
          role: joinRole,
          message: joinMessage,
        }),
      });
      const data = await res.json();
      if (res.ok) { setJoinSent(true); setShowJoinForm(false); }
      else { setJoinError(data.error || 'Erreur'); }
    } catch {
      setJoinError('Erreur réseau');
    }
    setJoinLoading(false);
  }

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
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
            HERO HEADER — cover vivante + stats
        ═══════════════════════════════════════════════════════════════════ */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${mainColor}, rgba(${mainColorRaw},0.3), transparent 80%)` }} />

          {/* Cover : image si fournie, sinon gradient vivant aux couleurs du jeu */}
          <div className="relative h-[180px] overflow-hidden"
            style={{ background: `linear-gradient(135deg, rgba(${mainColorRaw},0.22) 0%, rgba(${mainColorRaw},0.05) 40%, var(--s-surface) 100%)` }}>
            {structure.coverUrl ? (
              <Image src={structure.coverUrl} alt="" fill className="object-cover opacity-50" unoptimized />
            ) : (
              <>
                <div className="absolute inset-0 hex-bg opacity-70 pointer-events-none" />
                <div className="absolute top-0 right-0 w-[500px] h-[300px] pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at top right, rgba(${mainColorRaw},0.18), transparent 70%)` }} />
                <div className="absolute bottom-0 left-0 w-[400px] h-[250px] pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at bottom left, rgba(${mainColorRaw},0.12), transparent 70%)` }} />
              </>
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 0%, transparent 50%, var(--s-surface) 100%)' }} />
          </div>

          <div className="relative z-[1] px-8 pb-6 -mt-[70px]">
            <div className="flex items-end gap-7 mb-5">
              {/* Logo plus grand */}
              <div className="flex-shrink-0 w-36 h-36 relative overflow-hidden bevel-sm"
                style={{ background: 'var(--s-elevated)', border: `3px solid rgba(${mainColorRaw},0.35)`, boxShadow: `0 0 32px rgba(${mainColorRaw},0.15)` }}>
                {structure.logoUrl ? (
                  <Image src={structure.logoUrl} alt={structure.name} fill className="object-contain p-3" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Shield size={56} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 pb-2">
                {/* Tags */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="tag tag-gold">{structure.tag}</span>
                  {structure.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>
                      {g === 'rocket_league' ? 'Rocket League' : 'Trackmania'}
                    </span>
                  ))}
                  {structure.recruiting?.active && (
                    <span className="tag" style={{ background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.25)' }}>
                      <Search size={9} /> Recrute
                    </span>
                  )}
                </div>

                {/* Nom */}
                <h1 className="font-display tracking-wider" style={{ color: 'var(--s-text)', fontSize: '48px', lineHeight: 1 }}>
                  {structure.name}
                </h1>
              </div>

              {/* CTA principal bien visible */}
              <div className="flex-shrink-0 flex flex-col items-end gap-2 pb-2">
                {isOwner ? (
                  <Link href="/community/my-structure" className="btn-springs btn-secondary bevel-sm flex items-center gap-2">
                    <Shield size={14} /> Gérer
                  </Link>
                ) : firebaseUser && !isMember && !joinSent ? (
                  <button onClick={() => setShowJoinForm(!showJoinForm)}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                    style={{ padding: '10px 20px', fontSize: '13px' }}>
                    <UserPlus size={15} /> Postuler
                  </button>
                ) : joinSent ? (
                  <span className="flex items-center gap-2 text-sm font-bold" style={{ color: '#33ff66' }}>
                    <CheckCircle size={15} /> Demande envoyée
                  </span>
                ) : isMember ? (
                  <span className="tag tag-gold" style={{ fontSize: '11px', padding: '6px 14px' }}>Membre</span>
                ) : null}
              </div>
            </div>

            {/* Stats line */}
            <div className="flex items-center gap-6 flex-wrap mb-5 pl-1">
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

            {/* Direction — fondateurs inline */}
            {leaders.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap pl-1">
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>DIRECTION</span>
                <div className="flex items-center gap-3 flex-wrap">
                  {leaders.map(l => {
                    const avatar = l.avatarUrl || l.discordAvatar;
                    const leaderPrimary = roleFor(l.userId).primary;
                    const roleConf = { label: PRIMARY_ROLE_LABELS[leaderPrimary], color: PRIMARY_ROLE_COLORS[leaderPrimary] };
                    return (
                      <Link key={l.id} href={`/profile/${l.userId}`}
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
              const gameLabel = (g: string) => g === 'rocket_league' ? 'Rocket League' : g === 'trackmania' ? 'Trackmania' : g;
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
                            {gameLabel(p.game)} — {roleLabel(p.role)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="t-label block mb-1.5">Jeu *</label>
                      <select className="settings-input w-full" value={joinGame} onChange={e => { setJoinGame(e.target.value); setJoinRole('joueur'); }}>
                        <option value="">Choisir...</option>
                        {structure.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                        {structure.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
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
            CONTENU — GRID 2/3 + 1/3
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-6">

          {/* ─── COLONNE GAUCHE (2/3) ─────────────────────────────────────── */}
          <div className="col-span-2 space-y-6 animate-fade-in-d1">

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

            {/* 2. ÉQUIPES — groupées par label, actives en tête, archivées pliées */}
            {teams.length > 0 && (() => {
              const q = teamSearch.trim().toLowerCase();
              const matchTeam = (t: Team) => {
                if (!q) return true;
                if (t.name?.toLowerCase().includes(q)) return true;
                if ((t.label ?? '').toLowerCase().includes(q)) return true;
                const allMembers = [...t.players, ...t.subs, ...t.staff];
                return allMembers.some(m => (m.displayName ?? '').toLowerCase().includes(q));
              };
              const activeList = teams.filter(t => (t.status ?? 'active') === 'active' && matchTeam(t));
              const archivedList = teams.filter(t => t.status === 'archived' && matchTeam(t));
              const showSearch = teams.length > 4;
              const noMatch = q && activeList.length === 0 && archivedList.length === 0;

              // Groupes par label pour les actives (tri groupOrder puis alpha label,
              // puis tri order puis nom à l'intérieur du groupe — mêmes règles que le dashboard)
              type Group = { label: string; displayLabel: string; groupOrder: number; teams: Team[] };
              const groupsMap = new Map<string, Group>();
              for (const t of activeList) {
                const label = (t.label ?? '').trim();
                const key = label || '__nolabel__';
                if (!groupsMap.has(key)) {
                  groupsMap.set(key, {
                    label,
                    displayLabel: label || 'Équipes',
                    groupOrder: typeof t.groupOrder === 'number' ? t.groupOrder : 0,
                    teams: [],
                  });
                } else {
                  const g = groupsMap.get(key)!;
                  if (typeof t.groupOrder === 'number' && t.groupOrder < g.groupOrder) g.groupOrder = t.groupOrder;
                }
                groupsMap.get(key)!.teams.push(t);
              }
              const groups = Array.from(groupsMap.values())
                .sort((a, b) => a.groupOrder - b.groupOrder || a.displayLabel.localeCompare(b.displayLabel));
              for (const g of groups) {
                g.teams.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
              }

              const renderTeamCard = (team: Team, isArchived: boolean) => {
                const gc = team.game === 'rocket_league' ? '0,129,255' : '0,217,54';
                const gcVar = team.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
                const gameLabel = team.game === 'rocket_league' ? 'RL' : 'TM';
                return (
                  <div key={team.id} className="pillar-card panel relative overflow-hidden group transition-all duration-200"
                    style={{ opacity: isArchived ? 0.75 : 1 }}>
                    <div className="h-[3px]" style={{ background: `linear-gradient(90deg, rgba(${gc},1), rgba(${gc},0.3), transparent 70%)` }} />
                    <div className="absolute top-0 right-0 w-[180px] h-[180px] pointer-events-none opacity-[0.06]"
                      style={{ background: `radial-gradient(circle at top right, rgba(${gc},1), transparent 70%)` }} />

                    <div className="relative z-[1]">
                      <div className="panel-header">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Gamepad2 size={13} style={{ color: gcVar }} />
                          <span className="t-label" style={{ color: 'var(--s-text)' }}>{team.name}</span>
                          {isArchived && (
                            <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '2px 7px' }}>ARCHIVÉE</span>
                          )}
                        </div>
                        <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}>{gameLabel}</span>
                      </div>

                      <div className="p-5 space-y-3">
                        {team.players.length > 0 && (
                          <div>
                            <span className="t-label block mb-2">TITULAIRES</span>
                            <div className="space-y-1.5">
                              {team.players.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-text)" isCaptain={team.captainId === p.uid} />)}
                            </div>
                          </div>
                        )}
                        {team.subs.length > 0 && (
                          <div>
                            <span className="t-label block mb-2">REMPLAÇANTS</span>
                            <div className="space-y-1.5">
                              {team.subs.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-text-dim)" />)}
                            </div>
                          </div>
                        )}
                        {team.staff.length > 0 && (
                          <div>
                            <span className="t-label block mb-2">STAFF</span>
                            <div className="space-y-1.5">
                              {team.staff.map(p => <PlayerRow key={p.uid} player={p} color="var(--s-violet-light)" />)}
                            </div>
                          </div>
                        )}
                        {team.players.length === 0 && team.subs.length === 0 && team.staff.length === 0 && (
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun membre dans cette équipe.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <div className="space-y-6">
                  {/* Barre de recherche — affichée à partir de 5 équipes */}
                  {showSearch && (
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                      <input type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                        placeholder={`Rechercher parmi ${teams.length} équipes (nom, label, joueur)...`}
                        className="settings-input w-full pl-7 text-sm" />
                    </div>
                  )}

                  {noMatch && (
                    <div className="text-center py-6">
                      <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat pour « {teamSearch} ».</p>
                    </div>
                  )}

                  {/* Groupes actifs */}
                  {groups.map(g => (
                    <div key={g.label || '__nolabel__'} className="space-y-4">
                      <div className="section-label flex items-center gap-2">
                        <span className="t-label">{g.displayLabel}</span>
                        {g.label && (
                          <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '2px 7px' }}>
                            <Tag size={9} className="inline mr-1" />
                            {g.teams.length} équipe{g.teams.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div className={`grid ${g.teams.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-5`}>
                        {g.teams.map(team => renderTeamCard(team, false))}
                      </div>
                    </div>
                  ))}

                  {/* Section archivées — repliée par défaut */}
                  {archivedList.length > 0 && (
                    <ArchivedTeamsSection teams={archivedList} renderCard={renderTeamCard} />
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
                            href={`/profile/${m.userId}`}
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
                                      manager: { bg: 'rgba(123,47,190,0.15)', fg: 'var(--s-violet-light)', border: 'rgba(123,47,190,0.35)' },
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
                                <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                  style={{ fontSize: '9px', padding: '1px 5px' }}>
                                  {g === 'rocket_league' ? 'RL' : 'TM'}
                                </span>
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
                          <span className={`tag ${p.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                            style={{ fontSize: '12px', padding: '2px 8px' }}>
                            {p.game === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#7289da">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.079.11 18.1.128 18.114c2.052 1.5 4.044 2.414 5.993 3.016a.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028c1.961-.6 3.95-1.505 6.002-3.016a.077.077 0 0 0 .032-.027c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                        </svg>
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
                              <span className={`tag ${a.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                                style={{ fontSize: '8px', padding: '0px 4px' }}>
                                {a.game === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                              {a.date && (
                                <span className="t-mono" style={{ color: 'var(--s-text-muted)', fontSize: '9px' }}>
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
