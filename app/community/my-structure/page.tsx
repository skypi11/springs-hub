'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import {
  Shield, Users, Gamepad2, Trophy, Loader2, AlertCircle,
  User, Save, Plus, Trash2, Eye, Clock, Ban, CheckCircle,
  Search, ChevronUp, ChevronDown, Link2, MessageSquare, Settings, LucideIcon,
  Copy, Check, UserPlus, UserMinus, Mail, Bookmark, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CalendarSection from '@/components/calendar/CalendarSection';
import TeamDetailDrawer, { type DrawerTab, type DrawerTeam } from '@/components/calendar/TeamDetailDrawer';
import { CalendarClock, ClipboardList } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import PublicPreviewFrame from '@/components/ui/PublicPreviewFrame';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import type { UserContext } from '@/lib/event-permissions';
import PlayerStructureView, { type PlayerStructure } from '@/components/structure/PlayerStructureView';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';

type DashboardTab = 'general' | 'teams' | 'recruitment' | 'members' | 'calendar';

const TAB_DEFS: { key: DashboardTab; label: string; color: string }[] = [
  { key: 'general', label: 'Général', color: 'var(--s-violet-light)' },
  { key: 'teams', label: 'Équipes', color: 'var(--s-blue)' },
  { key: 'recruitment', label: 'Recrutement', color: '#33ff66' },
  { key: 'members', label: 'Membres', color: 'var(--s-gold)' },
  { key: 'calendar', label: 'Calendrier', color: 'var(--s-gold)' },
];

function TabBar({ active, onChange, visible }: { active: DashboardTab; onChange: (t: DashboardTab) => void; visible: DashboardTab[] }) {
  const tabsToShow = TAB_DEFS.filter(t => visible.includes(t.key));
  return (
    <div className="flex items-end gap-1 relative flex-wrap" style={{ borderBottom: '1px solid var(--s-border)' }}>
      {tabsToShow.map(t => {
        const isActive = active === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className="relative font-display text-sm tracking-wider transition-all duration-150 cursor-pointer"
            style={{
              padding: '10px 20px',
              color: isActive ? t.color : 'var(--s-text-dim)',
              background: isActive ? 'rgba(255,255,255,0.03)' : 'transparent',
              borderLeft: '1px solid var(--s-border)',
              borderTop: '1px solid var(--s-border)',
              borderRight: '1px solid var(--s-border)',
              borderBottom: isActive ? '1px solid transparent' : '1px solid var(--s-border)',
              marginBottom: '-1px',
              letterSpacing: '0.05em',
            }}>
            {isActive && (
              <span className="absolute left-0 right-0 top-0 h-[2px]"
                style={{ background: t.color }} />
            )}
            {t.label.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

type Member = {
  id: string;
  userId: string;
  game: string;
  role: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type MyStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  recruiting: { active: boolean; positions: { game: string; role: string }[]; message?: string };
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
  status: string;
  reviewComment?: string;
  founderId: string;
  coFounderIds?: string[];
  coFounderDepartures?: Record<string, string | null>;
  managerIds?: string[];
  coachIds?: string[];
  members: Member[];
  requestedAt?: string;
  validatedAt?: string;
  accessLevel?: 'dirigeant' | 'staff';
};

const DEPARTURE_NOTICE_DAYS = 7;
const DEPARTURE_NOTICE_MS = DEPARTURE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

const STATUS_INFO: Record<string, { label: string; color: string; icon: typeof CheckCircle; desc: string }> = {
  pending_validation: { label: 'En attente de validation', color: '#FFB800', icon: Clock, desc: 'Ta demande est en cours de traitement. Un entretien vocal sera organisé.' },
  active: { label: 'Active', color: '#33ff66', icon: CheckCircle, desc: 'Ta structure est active et visible publiquement.' },
  suspended: { label: 'Suspendue', color: '#ff5555', icon: Ban, desc: 'Ta structure est suspendue. Contacte un admin Springs.' },
  rejected: { label: 'Refusée', color: '#ff5555', icon: AlertCircle, desc: 'Ta demande a été refusée.' },
};

const ROLE_LABELS: Record<string, string> = {
  fondateur: 'Fondateur',
  co_fondateur: 'Co-fondateur',
  manager: 'Manager',
  coach: 'Coach',
  joueur: 'Joueur',
};

const SOCIAL_LABELS: Record<string, string> = {
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  twitch: 'Twitch',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  website: 'Site web',
};

// ─── Collapsible section panel — OUTSIDE the component to avoid remount ─
function SectionPanel({ accent, icon: Icon, title, action, children, collapsed, onToggle }: {
  accent: string;
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="bevel relative transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      {/* Accent bar */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />
      {/* Glow */}
      <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none"
        style={{ background: `radial-gradient(circle at 100% 0%, ${accent}08, transparent 70%)` }} />
      {/* Header — clickable to collapse */}
      <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between cursor-pointer select-none"
        style={{ borderBottom: collapsed ? 'none' : '1px solid var(--s-border)' }}
        onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 flex items-center justify-center" style={{ background: `${accent}10`, border: `1px solid ${accent}25` }}>
            <Icon size={13} style={{ color: accent }} />
          </div>
          <span className="font-display text-sm tracking-wider">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Stop propagation on action buttons so clicking them doesn't toggle the section */}
          {!collapsed && action && <div onClick={e => e.stopPropagation()}>{action}</div>}
          {onToggle && (
            <div className="w-6 h-6 flex items-center justify-center" style={{ color: 'var(--s-text-muted)' }}>
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </div>
          )}
        </div>
      </div>
      {/* Body — hidden when collapsed */}
      {!collapsed && (
        <div className="relative z-[1] p-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Roster slot component — OUTSIDE to avoid remount ─────────────────
function RosterSlot({ label, labelColor, members, available, canAdd, loading, onAdd, onRemove }: {
  label: string;
  labelColor: string;
  members: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  available: { id: string; userId: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  canAdd: boolean;
  loading: boolean;
  onAdd: (uid: string) => void;
  onRemove: (uid: string) => void;
}) {
  return (
    <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <p className="t-label mb-2" style={{ fontSize: '9px', color: labelColor }}>{label}</p>
      <div className="space-y-1.5">
        {members.map(p => (
          <div key={p.uid} className="flex items-center gap-1.5 group/slot">
            {(p.avatarUrl || p.discordAvatar) ? (
              <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
            ) : (
              <User size={10} style={{ color: 'var(--s-text-muted)' }} />
            )}
            <span className="text-xs truncate flex-1" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
            <button type="button" onClick={() => onRemove(p.uid)}
              className="opacity-0 group-hover/slot:opacity-100 transition-opacity duration-100 p-0.5"
              style={{ color: '#ff5555' }}>
              <Trash2 size={9} />
            </button>
          </div>
        ))}
      </div>
      {/* Ajouter un membre */}
      {canAdd && available.length > 0 && (
        <select
          className="settings-input w-full mt-2 text-xs"
          style={{ padding: '3px 6px', fontSize: '10px' }}
          value=""
          disabled={loading}
          onChange={e => { if (e.target.value) onAdd(e.target.value); }}>
          <option value="">{loading ? '...' : '+ Ajouter'}</option>
          {available.map(m => (
            <option key={m.userId} value={m.userId}>{m.displayName}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── Chip action dans les cards équipe — ouvre le drawer détail ───────
function TeamActionChip({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bevel-sm transition-all duration-150 hover:opacity-100"
      style={{
        background: 'var(--s-surface)',
        border: '1px solid var(--s-border)',
        color: 'var(--s-text-dim)',
        opacity: 0.92,
        cursor: 'pointer',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function MyStructurePage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [structures, setStructures] = useState<MyStructure[]>([]);
  const [playerStructures, setPlayerStructures] = useState<PlayerStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStructure, setActiveStructure] = useState<MyStructure | null>(null);

  // Editing state
  const [editDesc, setEditDesc] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editDiscordUrl, setEditDiscordUrl] = useState('');
  const [editSocials, setEditSocials] = useState<Record<string, string>>({});
  const [editRecruiting, setEditRecruiting] = useState<{ active: boolean; positions: { game: string; role: string }[]; message: string }>({ active: false, positions: [], message: '' });
  const recruitMessageRef = useRef<HTMLTextAreaElement>(null);
  const [editAchievements, setEditAchievements] = useState<{ placement: string; competition: string; game: string; date: string }[]>([]);
  // Teams state
  type TeamData = {
    id: string;
    name: string;
    game: string;
    players: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
    subs: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
    staff: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  };
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGame, setNewTeamGame] = useState('');
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [teamActionLoading, setTeamActionLoading] = useState<string | null>(null);
  // Drawer détail équipe (Dispos + Devoirs) — ouvert via chips des cards équipe
  const [drawerState, setDrawerState] = useState<{ team: DrawerTeam; tab: DrawerTab; canEditConfig: boolean } | null>(null);

  // Invitations state
  type InviteLink = { id: string; token: string; status: string; createdAt: string; game: string | null };
  type JoinRequest = { id: string; applicantId: string; displayName: string; discordAvatar: string; avatarUrl: string; message: string; game: string; role: string; country: string; rlRank: string; rlMmr: number | null; pseudoTM: string; createdAt: string };
  type DirectInvite = { id: string; targetUserId: string; displayName: string; discordAvatar: string; avatarUrl: string; message: string; game: string; role: string; country: string; rlRank: string; rlMmr: number | null; pseudoTM: string; createdAt: string };
  type Suggestion = { uid: string; displayName: string; discordAvatar: string; avatarUrl: string; country: string; games: string[]; matchingGames: string[]; recruitmentRole: string; recruitmentMessage: string; rlRank: string; rlMmr: number | null; pseudoTM: string };
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [directInvites, setDirectInvites] = useState<DirectInvite[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Shortlist — favoris à suivre (Phase 3 item L)
  type ShortlistItem = {
    uid: string;
    displayName: string;
    avatarUrl: string;
    discordAvatar: string;
    country: string;
    games: string[];
    recruitmentRole: string;
    isAvailableForRecruitment: boolean;
    rlRank: string;
    rlMmr: number | null;
    pseudoTM: string;
    addedAt: number | null;
    note: string;
  };
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [shortlistLoading, setShortlistLoading] = useState(false);
  const [invLoading, setInvLoading] = useState(false);
  const [invActionLoading, setInvActionLoading] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState('');
  const [newLinkGame, setNewLinkGame] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showEmojis, setShowEmojis] = useState(false);
  const [tab, setTab] = useState<DashboardTab>('general');
  const descRef = useRef<HTMLTextAreaElement>(null);
  // `now` est utilisé pour calculer le temps restant sur les préavis de départ.
  // Lazy-init : appelé une seule fois au montage, puis refresh toutes les 60s.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Si le tab actif n'est pas visible pour le rôle de l'user sur la structure active,
  // on rabat sur le premier tab visible. Calculé ici pour rester au niveau hooks top-level.
  useEffect(() => {
    if (!activeStructure || !firebaseUser) return;
    const isFounder = activeStructure.founderId === firebaseUser.uid;
    const isCoFounder = (activeStructure.coFounderIds ?? []).includes(firebaseUser.uid);
    const isDirigeant = isFounder || isCoFounder;
    const isManager = !isDirigeant && (activeStructure.managerIds ?? []).includes(firebaseUser.uid);
    const isCoach = !isDirigeant && !isManager && (activeStructure.coachIds ?? []).includes(firebaseUser.uid);
    const visible: DashboardTab[] = isDirigeant
      ? ['general', 'teams', 'recruitment', 'members', 'calendar']
      : isManager
      ? ['teams', 'members', 'calendar']
      : isCoach
      ? ['members', 'calendar']
      : ['calendar'];
    if (!visible.includes(tab)) setTab(visible[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStructure?.id, firebaseUser?.uid]);

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const [staffRes, playerRes] = await Promise.all([
        fetch('/api/structures/my', { headers: { 'Authorization': `Bearer ${idToken}` } }),
        fetch('/api/structures/my-player', { headers: { 'Authorization': `Bearer ${idToken}` } }),
      ]);
      if (staffRes.ok) {
        const data = await staffRes.json();
        setStructures(data.structures ?? []);
        if (data.structures?.length > 0 && !activeStructure) {
          selectStructure(data.structures[0]);
        }
      }
      if (playerRes.ok) {
        const data = await playerRes.json();
        setPlayerStructures(data.structures ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load error:', err);
    }
    setLoading(false);
  }

  async function loadTeams(structureId: string) {
    setTeamsLoading(true);
    try {
      const res = await fetch(`/api/structures/teams?structureId=${structureId}`);
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load teams error:', err);
    }
    setTeamsLoading(false);
  }

  function selectStructure(s: MyStructure) {
    setActiveStructure(s);
    setEditDesc(s.description || '');
    setEditLogoUrl(s.logoUrl || '');
    setEditDiscordUrl(s.discordUrl || '');
    setEditSocials(s.socials || {});
    setEditRecruiting({
      active: s.recruiting?.active ?? false,
      positions: s.recruiting?.positions ?? [],
      message: s.recruiting?.message ?? '',
    });
    setEditAchievements((s.achievements || []).map(a => ({
      placement: a.placement || a.title || '',
      competition: a.competition || '',
      game: a.game || s.games?.[0] || 'rocket_league',
      date: a.date || '',
    })));
    setSaved(false);
    setError('');
    setShowNewTeam(false);
    loadTeams(s.id);
    // Invitations : API réservée aux dirigeant/manager — on évite le 403 côté coach.
    const uid = firebaseUser?.uid;
    const canLoadInvitations = !!uid && (
      s.founderId === uid ||
      (s.coFounderIds ?? []).includes(uid) ||
      (s.managerIds ?? []).includes(uid)
    );
    if (canLoadInvitations) loadInvitations(s.id);
    else { setInviteLinks([]); setJoinRequests([]); setDirectInvites([]); }
    // Suggestions : dirigeant uniquement
    const isDirigeantLocal = !!uid && (s.founderId === uid || (s.coFounderIds ?? []).includes(uid));
    if (isDirigeantLocal && s.recruiting?.active) loadSuggestions(s.id);
    else setSuggestions([]);
    // Shortlist : dirigeant (founder/cofounder/manager) uniquement
    if (canLoadInvitations) loadShortlist(s.id);
    else setShortlist([]);
  }

  async function handleCreateTeam() {
    if (!activeStructure || !firebaseUser || !newTeamName.trim() || !newTeamGame) return;
    setTeamActionLoading('create');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'create',
          structureId: activeStructure.id,
          name: newTeamName,
          game: newTeamGame,
          playerIds: [],
          subIds: [],
          staffIds: [],
        }),
      });
      if (res.ok) {
        setNewTeamName('');
        setShowNewTeam(false);
        await loadTeams(activeStructure.id);
      }
    } catch (err) {
      console.error('[MyStructure] create team error:', err);
    }
    setTeamActionLoading(null);
  }

  async function handleUpdateTeamRoster(teamId: string, field: 'playerIds' | 'subIds' | 'staffIds', ids: string[]) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_${field}`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          [field]: ids,
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] update team roster error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleDeleteTeam(teamId: string, teamName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Supprimer l\'équipe',
      message: `Supprimer l'équipe "${teamName}" ? Cette action est irréversible.`,
      variant: 'danger',
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    setTeamActionLoading(teamId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'delete', structureId: activeStructure.id, teamId }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
        toast.success('Équipe supprimée');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] delete team error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.push('/');
      return;
    }
    if (firebaseUser) loadStructures();
  }, [authLoading, firebaseUser]);

  async function handleSave() {
    if (!activeStructure || !firebaseUser) return;
    setSaving(true);
    setError('');
    setSaved(false);

    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/my', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          structureId: activeStructure.id,
          description: editDesc,
          logoUrl: editLogoUrl,
          discordUrl: editDiscordUrl,
          socials: editSocials,
          recruiting: editRecruiting,
          achievements: editAchievements.filter(a => a.placement.trim() && a.competition.trim()),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Erreur lors de la sauvegarde.');
      } else {
        setSaved(true);
        await loadStructures();
      }
    } catch (err) {
      console.error('[MyStructure] save error:', err);
      setError('Erreur réseau.');
    }
    setSaving(false);
  }

  // ─── Loading / empty states ──────────────────────────────────────────

  if (authLoading || loading) {
    return (
      <div className="min-h-screen px-8 py-8 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  if (structures.length === 0) {
    // Vue dédiée joueur : l'user n'est dirigeant/staff nulle part, mais il est
    // membre simple d'au moins une structure — on affiche le layout joueur.
    if (playerStructures.length > 0) {
      return (
        <div className="min-h-screen hex-bg px-4 md:px-8 py-8">
          <div className="relative z-[1] max-w-6xl mx-auto space-y-10">
            <Breadcrumbs items={[{ label: 'Communauté', href: '/community' }, { label: 'Ma structure' }]} />
            {playerStructures.map(ps => (
              <PlayerStructureView key={ps.id} structure={ps} />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen hex-bg px-8 py-8 flex items-center justify-center">
        <div className="relative z-[1] bevel p-10 text-center max-w-md" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="w-14 h-14 mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
            <Shield size={24} style={{ color: 'var(--s-gold)' }} />
          </div>
          <h2 className="font-display text-2xl mb-2">AUCUNE STRUCTURE</h2>
          <p className="t-body mb-6" style={{ color: 'var(--s-text-dim)' }}>Tu n&apos;as pas encore créé de structure.</p>
          <Link href="/community/create-structure" className="btn-springs btn-primary bevel-sm">
            Créer une structure
          </Link>
        </div>
      </div>
    );
  }

  const s = activeStructure!;
  const statusInfo = STATUS_INFO[s.status] ?? STATUS_INFO.pending_validation;
  const StatusIcon = statusInfo.icon;
  // Le dashboard est ouvert au fondateur ET aux co-fondateurs. Certaines actions
  // sont réservées au fondateur (promouvoir/rétrograder, transférer, supprimer).
  const isFounderOfActive = !!firebaseUser && s.founderId === firebaseUser.uid;
  const isCoFounderOfActive = !!firebaseUser && (s.coFounderIds ?? []).includes(firebaseUser.uid);
  const isDirigeantOfActive = isFounderOfActive || isCoFounderOfActive;
  const isManagerOfActive = !!firebaseUser && !isDirigeantOfActive && (s.managerIds ?? []).includes(firebaseUser.uid);
  const isCoachOfActive = !!firebaseUser && !isDirigeantOfActive && !isManagerOfActive && (s.coachIds ?? []).includes(firebaseUser.uid);
  // Matrice de capacités par rôle — cf. visibleTabs ci-dessous pour la vue d'ensemble.
  // Les tabs filtrent déjà 95% des boutons write ; les quelques actions exposées sur des tabs
  // partagés (Membres = dirigeant+manager+coach) sont gatées à la volée via isDirigeantOfActive.
  // Onglets visibles selon le rôle. Les tabs cachés retirent à la fois le contenu
  // et l'entrée de la barre — aucun faux positif possible côté UI.
  // - Dirigeant : tout
  // - Manager   : équipes + membres (invitations côté manager OK, kick/role = dirigeant) + calendrier
  // - Coach     : membres (readonly) + calendrier (avec dispos/todos par équipe)
  // La branding et le toggle recrutement restent dirigeant-only (PUT API gate).
  const visibleTabs: DashboardTab[] = isDirigeantOfActive
    ? ['general', 'teams', 'recruitment', 'members', 'calendar']
    : isManagerOfActive
    ? ['teams', 'members', 'calendar']
    : isCoachOfActive
    ? ['members', 'calendar']
    : ['calendar'];
  const myDepartureIso = firebaseUser ? s.coFounderDepartures?.[firebaseUser.uid] : null;
  const myDepartureRemainingMs = myDepartureIso ? Math.max(0, new Date(myDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;

  // Contexte user pour le calendrier (derivé des données déjà chargées).
  const myMemberRole = firebaseUser ? s.members.find(m => m.userId === firebaseUser.uid)?.role : undefined;
  const staffedTeamIds = firebaseUser
    ? teams.filter(t => t.staff.some(st => st.uid === firebaseUser.uid)).map(t => t.id)
    : [];
  const userContext: UserContext = {
    uid: firebaseUser?.uid ?? '',
    isFounder: isFounderOfActive,
    isCoFounder: isCoFounderOfActive,
    isManager: myMemberRole === 'manager' || (firebaseUser ? (s.managerIds ?? []).includes(firebaseUser.uid) : false),
    isCoach: myMemberRole === 'coach' || (firebaseUser ? (s.coachIds ?? []).includes(firebaseUser.uid) : false),
    staffedTeamIds,
  };
  const calendarTeams = teams.map(t => ({ id: t.id, name: t.name, game: t.game }));

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  async function loadInvitations(structureId: string) {
    if (!firebaseUser) return;
    setInvLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/invitations?structureId=${structureId}`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setInviteLinks(data.links ?? []);
        setJoinRequests(data.requests ?? []);
        setDirectInvites(data.directInvites ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load invitations error:', err);
    }
    setInvLoading(false);
  }

  async function loadSuggestions(structureId: string) {
    if (!firebaseUser) return;
    setSuggestionsLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/recruitment-suggestions`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load suggestions error:', err);
    }
    setSuggestionsLoading(false);
  }

  async function loadShortlist(structureId: string) {
    if (!firebaseUser) return;
    setShortlistLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/shortlist`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setShortlist(data.shortlist ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load shortlist error:', err);
    }
    setShortlistLoading(false);
  }

  async function handleRemoveFromShortlist(targetUserId: string) {
    if (!activeStructure || !firebaseUser) return;
    // Optimistic update
    setShortlist(prev => prev.filter(s => s.uid !== targetUserId));
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(
        `/api/structures/${activeStructure.id}/shortlist?userId=${encodeURIComponent(targetUserId)}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${idToken}` } },
      );
      if (!res.ok) {
        // Rollback
        await loadShortlist(activeStructure.id);
      }
    } catch {
      await loadShortlist(activeStructure.id);
    }
  }

  async function handleCreateLink() {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading('create_link');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'create_link',
          structureId: activeStructure.id,
          game: newLinkGame || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const link = `${window.location.origin}/community/join/${data.token}`;
        await navigator.clipboard.writeText(link);
        setCopiedLink(data.token);
        setTimeout(() => setCopiedLink(''), 3000);
        await loadInvitations(activeStructure.id);
      }
    } catch (err) {
      console.error('[MyStructure] create link error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleRevokeLink(invitationId: string) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      const idToken = await firebaseUser.getIdToken();
      await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'revoke_link', structureId: activeStructure.id, invitationId }),
      });
      await loadInvitations(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] revoke link error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleCancelDirectInvite(invitationId: string) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      const idToken = await firebaseUser.getIdToken();
      await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'cancel_direct_invite', structureId: activeStructure.id, invitationId }),
      });
      await loadInvitations(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] cancel direct invite error:', err);
    }
    setInvActionLoading(null);
  }

  async function handleRequestAction(invitationId: string, accept: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(invitationId);
    try {
      const idToken = await firebaseUser.getIdToken();
      await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: accept ? 'accept_request' : 'decline_request',
          structureId: activeStructure.id,
          invitationId,
        }),
      });
      await loadInvitations(activeStructure.id);
      if (accept) await loadStructures();
    } catch (err) {
      console.error('[MyStructure] request action error:', err);
    }
    setInvActionLoading(null);
  }

  async function handlePromoteToCoFounder(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Promouvoir co-fondateur',
      message: `Promouvoir ${memberName} en co-fondateur ? Il pourra gérer la structure comme toi (sauf transfert, suppression et gestion des co-fondateurs).`,
      confirmLabel: 'Promouvoir',
    });
    if (!ok) return;
    setInvActionLoading(userId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/co-founders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id, targetUserId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success(`${memberName} promu co-fondateur`);
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleDemoteCoFounder(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Rétrograder le co-fondateur',
      message: `Retirer les droits de co-fondateur à ${memberName} ? Il redevient simple joueur de la structure.`,
      variant: 'danger',
      confirmLabel: 'Rétrograder',
    });
    if (!ok) return;
    setInvActionLoading(userId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/co-founders', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id, targetUserId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success(`${memberName} rétrogradé`);
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleToggleStaffRole(userId: string, memberName: string, role: 'manager' | 'coach', enabled: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading(`${userId}:${role}`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/staff-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id, targetUserId: userId, role, enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        const label = role === 'manager' ? 'Manager' : 'Coach';
        toast.success(enabled ? `${memberName} est maintenant ${label}` : `${memberName} n'est plus ${label}`);
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleTransferOwnership(userId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const keepAsCoFounder = await confirm({
      title: `Transférer à ${memberName}`,
      message: `${memberName} deviendra le nouveau fondateur. Veux-tu rester dans la structure en tant que co-fondateur ?\n\n(Clique "Non" pour redevenir simple joueur à la place.)`,
      confirmLabel: 'Oui, co-fondateur',
      cancelLabel: 'Non, simple joueur',
    });
    const confirmTransfer = await confirm({
      title: 'Confirmer le transfert',
      message: `Tu vas transférer la propriété de ${activeStructure.name} à ${memberName}. Cette action est réversible seulement si le nouveau fondateur accepte de te retransférer la structure. Confirmer ?`,
      variant: 'danger',
      confirmLabel: 'Transférer',
    });
    if (!confirmTransfer) return;
    setInvActionLoading(userId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id, newFounderId: userId, keepAsCoFounder }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success(`Propriété transférée à ${memberName}`);
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleLeaveAsCoFounder() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Quitter en tant que co-fondateur',
      message: `Tu vas déposer un préavis de ${DEPARTURE_NOTICE_DAYS} jours. Passé ce délai tu seras automatiquement retiré du rôle de co-fondateur et redeviendra simple joueur. Tu peux annuler ton préavis à tout moment avant expiration.`,
      variant: 'danger',
      confirmLabel: 'Déposer le préavis',
    });
    if (!ok) return;
    setInvActionLoading('leave');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/co-founders/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success('Préavis déposé');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleCancelLeave() {
    if (!activeStructure || !firebaseUser) return;
    setInvActionLoading('leave');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/co-founders/leave', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success('Préavis annulé');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Retirer le membre',
      message: `Retirer ${memberName} de la structure ? Il sera aussi retiré de ses équipes.`,
      variant: 'danger',
      confirmLabel: 'Retirer',
    });
    if (!ok) return;
    setInvActionLoading(memberId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'remove_member', structureId: activeStructure.id, memberId }),
      });
      if (res.ok) {
        await loadStructures();
        toast.success(`${memberName} retiré de la structure`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] remove member error:', err);
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  // ─── Not active state ────────────────────────────────────────────────
  // Structure en attente, suspendue ou refusée — vue minimale pour tous les rôles.
  if (s.status !== 'active') {
    return (
      <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
        <div className="relative z-[1]">
          {/* Header */}
          <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${statusInfo.color}, ${statusInfo.color}50, transparent 80%)` }} />
            <div className="relative z-[1] p-8 flex items-center gap-6">
              <div className="flex-shrink-0 w-16 h-16 relative overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '2px solid var(--s-border)' }}>
                {s.logoUrl ? (
                  <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1" unoptimized />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Shield size={28} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="font-display text-3xl" style={{ letterSpacing: '0.03em' }}>{s.name}</h1>
                  <span className="tag tag-neutral">{s.tag}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIcon size={13} style={{ color: statusInfo.color }} />
                  <span className="t-mono text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
              </div>
            </div>
          </header>

          <div className="bevel p-10 text-center mt-6" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <StatusIcon size={32} className="mx-auto mb-4" style={{ color: statusInfo.color }} />
            <h2 className="font-display text-2xl mb-2">{s.name}</h2>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>{statusInfo.desc}</p>
            {s.reviewComment && (
              <div className="mt-5 px-5 py-3 mx-auto max-w-md" style={{ background: 'var(--s-elevated)', border: `1px solid ${statusInfo.color}30` }}>
                <p className="t-label mb-1" style={{ color: statusInfo.color }}>Message admin</p>
                <p className="t-body">{s.reviewComment}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Active structure — full dashboard ───────────────────────────────

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <CompactStickyHeader
        icon={Shield}
        title={s.name || 'Ma structure'}
        accent="var(--s-gold)"
      />
      <div className="relative z-[1] space-y-8">

        <Breadcrumbs items={[
          { label: 'Communauté', href: '/community' },
          { label: 'Ma structure' },
        ]} />

        {/* Sélecteur si plusieurs structures */}
        {structures.length > 1 && (
          <div className="flex gap-3 animate-fade-in">
            {structures.map(st => (
              <button key={st.id} onClick={() => selectStructure(st)}
                className="tag transition-all duration-150"
                style={{
                  background: st.id === s.id ? 'rgba(255,184,0,0.15)' : 'transparent',
                  color: st.id === s.id ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  borderColor: st.id === s.id ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                  cursor: 'pointer', padding: '8px 16px', fontSize: '12px',
                }}>
                {st.name}
              </button>
            ))}
          </div>
        )}

        {/* ═══ Header ═══ */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: `linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 80%)` }} />
          {/* Glow or subtil */}
          <div className="absolute top-0 left-0 w-64 h-64 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 0% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-8 flex items-center gap-6">
            <div className="flex-shrink-0 w-[72px] h-[72px] relative overflow-hidden bevel-sm" style={{ background: 'var(--s-elevated)', border: '2px solid rgba(255,184,0,0.2)' }}>
              {s.logoUrl ? (
                <Image src={s.logoUrl} alt={s.name} fill className="object-contain p-1.5" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Shield size={30} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="font-display text-4xl" style={{ letterSpacing: '0.04em' }}>{s.name}</h1>
                <span className="tag tag-gold" style={{ fontSize: '11px', padding: '3px 10px' }}>{s.tag}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <StatusIcon size={12} style={{ color: statusInfo.color }} />
                  <span className="t-mono text-xs" style={{ color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                <div className="flex gap-1.5">
                  {s.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                      style={{ fontSize: '9px', padding: '2px 6px' }}>
                      {g === 'rocket_league' ? 'RL' : 'TM'}
                    </span>
                  ))}
                </div>
                <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{s.members.length} membre{s.members.length > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              <Link href={`/community/structure/${s.id}`} className="btn-springs btn-secondary bevel-sm-border">
                <span><Eye size={14} /></span> <span>Page publique</span>
              </Link>
              {isCoFounderOfActive && !myDepartureIso && (
                <button type="button" onClick={handleLeaveAsCoFounder}
                  disabled={invActionLoading === 'leave'}
                  className="btn-springs btn-secondary bevel-sm-border text-xs"
                  style={{ color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                  {invActionLoading === 'leave' ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                  <span>Quitter (préavis {DEPARTURE_NOTICE_DAYS}j)</span>
                </button>
              )}
              {isCoFounderOfActive && myDepartureIso && myDepartureRemainingMs != null && (
                <button type="button" onClick={handleCancelLeave}
                  disabled={invActionLoading === 'leave'}
                  className="btn-springs btn-secondary bevel-sm-border text-xs"
                  style={{ color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.35)' }}>
                  {invActionLoading === 'leave' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span>Annuler préavis ({Math.ceil(myDepartureRemainingMs / (24 * 60 * 60 * 1000))}j restants)</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ═══ Aperçu public (onglet général uniquement) ═══ */}
        {tab === 'general' && s.status === 'active' && (
          <PublicPreviewFrame
            href={`/community/structure/${s.id}`}
            helper="Ta carte telle qu'elle apparaît dans l'annuaire des structures et les feeds communauté."
          >
            <div
              className="panel bevel relative overflow-hidden"
              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
            >
              <div
                className="h-[3px]"
                style={{
                  background: s.games.includes('rocket_league')
                    ? 'linear-gradient(90deg, var(--s-blue), transparent 70%)'
                    : 'linear-gradient(90deg, var(--s-green), transparent 70%)',
                }}
              />
              <div className="p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className="w-14 h-14 flex-shrink-0 relative overflow-hidden"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                  >
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
                      <span
                        className="tag tag-neutral"
                        style={{ fontSize: '9px', padding: '1px 5px', flexShrink: 0 }}
                      >
                        {s.tag}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.games.map((g) => (
                        <span
                          key={g}
                          className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                          style={{ fontSize: '9px', padding: '1px 6px' }}
                        >
                          {g === 'rocket_league' ? 'RL' : 'TM'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between pt-3"
                  style={{ borderTop: '1px dashed var(--s-border)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <Users size={12} style={{ color: 'var(--s-text-muted)' }} />
                    <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>
                      {s.members.length} membre{s.members.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {s.recruiting?.active && (
                    <span className="tag tag-green" style={{ fontSize: '9px', padding: '2px 7px' }}>
                      RECRUTE
                    </span>
                  )}
                </div>
              </div>
            </div>
          </PublicPreviewFrame>
        )}

        {/* ═══ Onglets ═══ */}
        <TabBar active={tab} onChange={setTab} visible={visibleTabs} />

        {/* ═══ Dashboard — layout dynamique par onglet ═══ */}
        {tab !== 'calendar' && (
        <div className={`grid gap-6 animate-fade-in ${tab === 'general' ? 'grid-cols-3' : 'grid-cols-1'}`}>

          {/* ─── Colonne gauche (ou pleine largeur hors général) ──────── */}
          <div className={
            tab === 'general' ? 'col-span-2 space-y-6'
            : tab === 'members' ? 'hidden'
            : 'space-y-6'
          }>

            {/* ═══ GÉNÉRAL — Description / Configuration / Réseaux sociaux ═══ */}
            {tab === 'general' && (<>
            <SectionPanel accent="var(--s-violet)" icon={MessageSquare} title="DESCRIPTION"
              collapsed={collapsed.desc} onToggle={() => toggle('desc')}>
              <div className="space-y-3">
                <div className="relative">
                  <textarea ref={descRef} className="settings-input w-full" rows={5}
                    value={editDesc} onChange={e => setEditDesc(e.target.value)}
                    placeholder="Présente ta structure..." />
                  {/* Emoji picker toggle */}
                  <div className="relative inline-block">
                    <button type="button" onClick={() => setShowEmojis(!showEmojis)}
                      className="mt-1.5 text-xs flex items-center gap-1.5 px-2 py-1 transition-colors duration-150"
                      style={{ color: showEmojis ? 'var(--s-gold)' : 'var(--s-text-muted)', background: showEmojis ? 'rgba(255,184,0,0.08)' : 'transparent', border: `1px solid ${showEmojis ? 'rgba(255,184,0,0.2)' : 'var(--s-border)'}` }}>
                      <span style={{ fontSize: '14px' }}>😀</span> Emojis
                    </button>
                    {showEmojis && (
                      <div className="absolute left-0 top-full mt-1 p-2 z-50 flex flex-wrap" style={{ width: '320px', background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        {['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'].map(emoji => (
                          <button key={emoji} type="button"
                            className="hover:bg-[var(--s-hover)] transition-colors duration-100"
                            style={{ width: '30px', height: '30px', fontSize: '16px', lineHeight: '30px', textAlign: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }}
                            onClick={() => {
                              const ta = descRef.current;
                              if (ta) {
                                const start = ta.selectionStart;
                                const end = ta.selectionEnd;
                                const newVal = editDesc.slice(0, start) + emoji + editDesc.slice(end);
                                setEditDesc(newVal);
                                setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + emoji.length; }, 0);
                              } else {
                                setEditDesc(editDesc + emoji);
                              }
                            }}>
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {/* Légende markdown */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-1" style={{ color: 'var(--s-text-muted)', fontSize: '10px' }}>
                  <span><strong style={{ color: 'var(--s-text-dim)' }}>**gras**</strong></span>
                  <span><em>*italique*</em></span>
                  <span>## Titre</span>
                  <span>- liste</span>
                  <span>[lien](url)</span>
                  <span>&gt; citation</span>
                </div>
                {editDesc.trim() && (
                  <div>
                    <p className="t-label mb-2" style={{ color: 'var(--s-text-muted)' }}>APERÇU</p>
                    <div className="p-3 prose-springs text-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <ReactMarkdown>{editDesc}</ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </SectionPanel>

            {/* Configuration */}
            <SectionPanel accent="var(--s-gold)" icon={Settings} title="CONFIGURATION"
              collapsed={collapsed.config} onToggle={() => toggle('config')}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="t-label block mb-2">Logo URL</label>
                    <input type="url" className="settings-input w-full"
                      value={editLogoUrl} onChange={e => setEditLogoUrl(e.target.value)}
                      placeholder="https://exemple.com/logo.png" />
                    <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>Carré, fond transparent</p>
                  </div>
                  <div>
                    <label className="t-label block mb-2">Serveur Discord</label>
                    <input type="url" className="settings-input w-full"
                      value={editDiscordUrl} onChange={e => setEditDiscordUrl(e.target.value)}
                      placeholder="https://discord.gg/..." />
                  </div>
                </div>
              </div>
            </SectionPanel>

            {/* Réseaux sociaux */}
            <SectionPanel accent="#5865F2" icon={Link2} title="RÉSEAUX SOCIAUX"
              collapsed={collapsed.socials} onToggle={() => toggle('socials')}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {Object.entries(SOCIAL_LABELS).map(([key, label]) => (
                  <div key={key}>
                    <label className="t-label block mb-1.5">{label}</label>
                    <input type="url" className="settings-input w-full" placeholder="https://..."
                      value={editSocials[key] || ''}
                      onChange={e => setEditSocials({ ...editSocials, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </SectionPanel>
            </>)}

            {/* ═══ RECRUTEMENT ═══ */}
            {tab === 'recruitment' && (
            <SectionPanel accent="#33ff66" icon={Search} title="RECRUTEMENT"
              collapsed={collapsed.recruit} onToggle={() => toggle('recruit')}>
              <div className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative w-10 h-5 transition-colors duration-200"
                    style={{
                      background: editRecruiting.active ? 'rgba(0,217,54,0.3)' : 'var(--s-elevated)',
                      border: `1px solid ${editRecruiting.active ? 'rgba(0,217,54,0.5)' : 'var(--s-border)'}`,
                    }}>
                    <div className="absolute top-0.5 w-4 h-4 transition-all duration-200"
                      style={{
                        background: editRecruiting.active ? '#33ff66' : 'var(--s-text-muted)',
                        left: editRecruiting.active ? '20px' : '2px',
                      }} />
                    <input type="checkbox" className="sr-only" checked={editRecruiting.active}
                      onChange={e => setEditRecruiting({ ...editRecruiting, active: e.target.checked })} />
                  </div>
                  <span className="text-sm font-medium" style={{ color: editRecruiting.active ? '#33ff66' : 'var(--s-text-dim)' }}>
                    {editRecruiting.active ? 'Recrutement ouvert' : 'Recrutement fermé'}
                  </span>
                </label>

                {editRecruiting.active && (
                  <div className="space-y-4 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
                    <MarkdownEditor
                      label="Annonce de recrutement (optionnelle)"
                      value={editRecruiting.message}
                      onChange={v => setEditRecruiting({ ...editRecruiting, message: v })}
                      placeholder="Décris ton projet, l'ambiance, ce que tu cherches exactement… (markdown supporté)"
                      maxLength={LIMITS.structureRecruitmentMessage}
                      rows={5}
                      taRef={recruitMessageRef}
                    />
                    <p className="t-label" style={{ color: '#33ff66' }}>Postes recherchés</p>
                    {editRecruiting.positions.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select className="settings-input flex-1" value={p.game}
                          onChange={e => {
                            const positions = [...editRecruiting.positions];
                            positions[i] = { ...p, game: e.target.value };
                            setEditRecruiting({ ...editRecruiting, positions });
                          }}>
                          <option value="rocket_league">Rocket League</option>
                          <option value="trackmania">Trackmania</option>
                        </select>
                        <select className="settings-input flex-1" value={p.role}
                          onChange={e => {
                            const positions = [...editRecruiting.positions];
                            positions[i] = { ...p, role: e.target.value };
                            setEditRecruiting({ ...editRecruiting, positions });
                          }}>
                          <option value="joueur">Joueur</option>
                          <option value="coach">Coach</option>
                          <option value="manager">Manager</option>
                        </select>
                        <button type="button" onClick={() => {
                          const positions = editRecruiting.positions.filter((_, j) => j !== i);
                          setEditRecruiting({ ...editRecruiting, positions });
                        }} className="p-1.5 transition-colors duration-150" style={{ color: '#ff5555' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => {
                      setEditRecruiting({
                        ...editRecruiting,
                        positions: [...editRecruiting.positions, { game: s.games[0] || 'rocket_league', role: 'joueur' }],
                      });
                    }}
                      className="flex items-center gap-2 text-xs font-bold transition-colors duration-150" style={{ color: '#33ff66' }}>
                      <Plus size={12} /> Ajouter un poste
                    </button>
                  </div>
                )}
              </div>
            </SectionPanel>
            )}

            {/* ═══ RECRUTEMENT — Liens d'invitation ═══ */}
            {tab === 'recruitment' && isDirigeantOfActive && (
            <SectionPanel accent="#33ff66" icon={UserPlus} title="LIENS D'INVITATION"
              collapsed={collapsed.inviteLinks} onToggle={() => toggle('inviteLinks')}>
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="t-label block mb-1">Jeu (optionnel — pré-rempli pour le joueur)</label>
                    <select className="settings-input w-full" value={newLinkGame} onChange={e => setNewLinkGame(e.target.value)}>
                      <option value="">Tous les jeux</option>
                      {s.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                      {s.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
                    </select>
                  </div>
                  <button type="button" onClick={handleCreateLink} disabled={invActionLoading === 'create_link'}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs">
                    {invActionLoading === 'create_link' ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                    Créer
                  </button>
                </div>
                {inviteLinks.length > 0 ? (
                  <div className="space-y-2">
                    {inviteLinks.map(link => (
                      <div key={link.id} className="flex items-center gap-2 p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <div className="flex-1 min-w-0">
                          <p className="t-mono text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>
                            /join/{link.token.slice(0, 8)}...
                          </p>
                          {link.game && (
                            <span className={`tag ${link.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                              {link.game === 'rocket_league' ? 'RL' : 'TM'}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/community/join/${link.token}`);
                          setCopiedLink(link.token);
                          setTimeout(() => setCopiedLink(''), 2000);
                        }}
                          className="p-1" style={{ color: copiedLink === link.token ? '#33ff66' : 'var(--s-text-dim)' }}>
                          {copiedLink === link.token ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        <button type="button" onClick={() => handleRevokeLink(link.id)} disabled={invActionLoading === link.id}
                          className="p-1" style={{ color: '#ff5555' }}>
                          {invActionLoading === link.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-center py-2" style={{ color: 'var(--s-text-muted)' }}>
                    Aucun lien actif. Crée-en un pour inviter des joueurs.
                  </p>
                )}
              </div>
            </SectionPanel>
            )}

            {/* ═══ RECRUTEMENT — Demandes reçues ═══ */}
            {tab === 'recruitment' && isDirigeantOfActive && (
            <SectionPanel accent="var(--s-gold)" icon={UserPlus} title={`DEMANDES REÇUES${joinRequests.length > 0 ? ` (${joinRequests.length})` : ''}`}
              collapsed={collapsed.joinRequests} onToggle={() => toggle('joinRequests')}>
              {joinRequests.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
                  {invLoading ? 'Chargement...' : 'Aucune demande en attente.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {joinRequests.map(jr => {
                    const jrAvatar = jr.avatarUrl || jr.discordAvatar;
                    return (
                      <div key={jr.id} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.15)' }}>
                        <div className="flex items-start gap-3 mb-2">
                          {jrAvatar ? (
                            <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <Image src={jrAvatar} alt={jr.displayName} fill className="object-cover" unoptimized />
                            </div>
                          ) : (
                            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/profile/${jr.applicantId}`} className="text-sm font-semibold truncate hover:underline">{jr.displayName}</Link>
                              {jr.country && (
                                <Image src={`https://flagcdn.com/16x12/${jr.country.toLowerCase()}.png`}
                                  alt={jr.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {jr.game && (
                                <span className={`tag ${jr.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                                  {jr.game === 'rocket_league' ? 'RL' : 'TM'}
                                </span>
                              )}
                              {jr.role && jr.role !== 'joueur' && (
                                <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '1px 6px' }}>{jr.role}</span>
                              )}
                              {jr.rlRank && (
                                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                  {jr.rlRank}{jr.rlMmr ? ` · ${jr.rlMmr}` : ''}
                                </span>
                              )}
                              {jr.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{jr.pseudoTM}</span>}
                            </div>
                          </div>
                          <Link href={`/profile/${jr.applicantId}`} target="_blank" rel="noopener"
                            className="p-1.5 flex-shrink-0 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                            title="Voir profil">
                            <Eye size={12} style={{ color: 'var(--s-text-dim)' }} />
                          </Link>
                        </div>
                        {jr.message && (
                          <p className="text-xs mb-2 italic p-2" style={{ background: 'var(--s-surface)', color: 'var(--s-text-dim)' }}>
                            « {jr.message} »
                          </p>
                        )}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleRequestAction(jr.id, true)} disabled={invActionLoading === jr.id}
                            className="btn-springs btn-primary bevel-sm flex-1 justify-center text-xs py-1.5">
                            {invActionLoading === jr.id ? <Loader2 size={11} className="animate-spin" /> : <><Check size={11} /> Accepter</>}
                          </button>
                          <button type="button" onClick={() => handleRequestAction(jr.id, false)} disabled={invActionLoading === jr.id}
                            className="btn-springs btn-secondary bevel-sm-border flex-1 justify-center text-xs py-1.5"
                            style={{ color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)' }}>
                            <Trash2 size={11} /> Refuser
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ RECRUTEMENT — Invitations envoyées ═══ */}
            {tab === 'recruitment' && isDirigeantOfActive && (
            <SectionPanel accent="var(--s-violet)" icon={UserPlus} title={`INVITATIONS ENVOYÉES${directInvites.length > 0 ? ` (${directInvites.length})` : ''}`}
              collapsed={collapsed.sentInvites} onToggle={() => toggle('sentInvites')}>
              {directInvites.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
                  Aucune invitation envoyée en attente. Invite des joueurs depuis l&apos;annuaire ou leurs profils.
                </p>
              ) : (
                <div className="space-y-2">
                  {directInvites.map(di => {
                    const diAvatar = di.avatarUrl || di.discordAvatar;
                    return (
                      <div key={di.id} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(123,47,190,0.2)' }}>
                        <div className="flex items-start gap-3 mb-2">
                          {diAvatar ? (
                            <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <Image src={diAvatar} alt={di.displayName} fill className="object-cover" unoptimized />
                            </div>
                          ) : (
                            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <User size={16} style={{ color: 'var(--s-text-muted)' }} />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Link href={`/profile/${di.targetUserId}`} className="text-sm font-semibold truncate hover:underline">{di.displayName}</Link>
                              {di.country && (
                                <Image src={`https://flagcdn.com/16x12/${di.country.toLowerCase()}.png`}
                                  alt={di.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {di.game && (
                                <span className={`tag ${di.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                                  {di.game === 'rocket_league' ? 'RL' : 'TM'}
                                </span>
                              )}
                              {di.role && di.role !== 'joueur' && (
                                <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '1px 6px' }}>{di.role}</span>
                              )}
                              {di.rlRank && (
                                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                  {di.rlRank}{di.rlMmr ? ` · ${di.rlMmr}` : ''}
                                </span>
                              )}
                              {di.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{di.pseudoTM}</span>}
                              <span className="text-xs italic" style={{ color: 'var(--s-text-muted)' }}>· En attente</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <Link href={`/profile/${di.targetUserId}`} target="_blank" rel="noopener"
                              className="p-1.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                              style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                              title="Voir profil">
                              <Eye size={12} style={{ color: 'var(--s-text-dim)' }} />
                            </Link>
                            <button type="button" onClick={() => handleCancelDirectInvite(di.id)} disabled={invActionLoading === di.id}
                              className="p-1.5" style={{ color: '#ff5555', background: 'var(--s-surface)', border: '1px solid rgba(255,85,85,0.2)' }} title="Annuler">
                              {invActionLoading === di.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ RECRUTEMENT — Candidats suggérés ═══ */}
            {tab === 'recruitment' && isDirigeantOfActive && (
            <SectionPanel accent="var(--s-gold)" icon={Bookmark} title="SHORTLIST"
              collapsed={collapsed.shortlist} onToggle={() => toggle('shortlist')}>
              {shortlistLoading ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>Chargement...</p>
              ) : shortlist.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
                  Aucun joueur en shortlist. Ajoute des favoris depuis l&apos;annuaire <Link href="/community/players" className="underline" style={{ color: 'var(--s-gold)' }}>joueurs</Link>.
                </p>
              ) : (
                <div className="space-y-2">
                  {shortlist.map(sl => {
                    const slAvatar = sl.avatarUrl || sl.discordAvatar;
                    return (
                      <div key={sl.uid} className="flex items-start gap-3 p-2.5"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {slAvatar ? (
                          <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                            <Image src={slAvatar} alt={sl.displayName} fill className="object-cover" unoptimized />
                          </div>
                        ) : (
                          <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                            <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{sl.displayName}</p>
                            {sl.country && (
                              <Image src={`https://flagcdn.com/16x12/${sl.country.toLowerCase()}.png`}
                                alt={sl.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                            )}
                            {sl.isAvailableForRecruitment && (
                              <span className="tag tag-green" style={{ fontSize: '12px', padding: '1px 6px' }}>DISPO</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {sl.games.map(g => (
                              <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                                {g === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                            ))}
                            {sl.rlRank && (
                              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                {sl.rlRank}{sl.rlMmr ? ` · ${sl.rlMmr}` : ''}
                              </span>
                            )}
                            {sl.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{sl.pseudoTM}</span>}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <Link
                            href={`/profile/${sl.uid}`}
                            target="_blank"
                            className="flex items-center justify-center w-7 h-7 transition-colors duration-150"
                            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}
                            title="Voir profil"
                          >
                            <Eye size={13} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromShortlist(sl.uid)}
                            className="flex items-center justify-center w-7 h-7 transition-colors duration-150"
                            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: '#ff5555' }}
                            title="Retirer de la shortlist"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionPanel>
            )}

            {tab === 'recruitment' && isDirigeantOfActive && s.recruiting?.active && (
            <SectionPanel accent="var(--s-gold)" icon={Search} title="CANDIDATS SUGGÉRÉS"
              collapsed={collapsed.suggestions} onToggle={() => toggle('suggestions')}>
              {suggestionsLoading ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>Chargement...</p>
              ) : suggestions.length === 0 ? (
                <p className="text-xs text-center py-3" style={{ color: 'var(--s-text-muted)' }}>
                  Aucun candidat correspondant pour le moment. Les joueurs dispos au recrutement apparaîtront ici.
                </p>
              ) : (
                <div className="space-y-2">
                  {suggestions.slice(0, 10).map(sg => {
                    const sgAvatar = sg.avatarUrl || sg.discordAvatar;
                    return (
                      <Link key={sg.uid} href={`/profile/${sg.uid}`} className="flex items-start gap-3 p-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                        style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {sgAvatar ? (
                          <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                            <Image src={sgAvatar} alt={sg.displayName} fill className="object-cover" unoptimized />
                          </div>
                        ) : (
                          <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                            <User size={14} style={{ color: 'var(--s-text-muted)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{sg.displayName}</p>
                            {sg.country && (
                              <Image src={`https://flagcdn.com/16x12/${sg.country.toLowerCase()}.png`}
                                alt={sg.country} width={14} height={10} className="flex-shrink-0" unoptimized />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {sg.matchingGames.map(g => (
                              <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '1px 6px' }}>
                                {g === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                            ))}
                            {sg.rlRank && (
                              <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                                {sg.rlRank}{sg.rlMmr ? ` · ${sg.rlMmr}` : ''}
                              </span>
                            )}
                            {sg.pseudoTM && <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{sg.pseudoTM}</span>}
                          </div>
                        </div>
                        <Eye size={14} className="flex-shrink-0 mt-1" style={{ color: 'var(--s-text-muted)' }} />
                      </Link>
                    );
                  })}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ GÉNÉRAL — Palmarès ═══ */}
            {tab === 'general' && (
            <SectionPanel accent="var(--s-gold)" icon={Trophy} title="PALMARÈS"
              collapsed={collapsed.palmares} onToggle={() => toggle('palmares')}
              action={
                <button type="button" onClick={() => setEditAchievements([...editAchievements, { placement: '', competition: '', game: s.games[0] || 'rocket_league', date: '' }])}
                  className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-gold)' }}>
                  <Plus size={11} /> Ajouter
                </button>
              }>
              {editAchievements.length === 0 ? (
                <div className="text-center py-4">
                  <Trophy size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat enregistré.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {editAchievements.map((a, i) => (
                    <div key={i} className="p-3 space-y-2.5" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div>
                            <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Placement *</label>
                            <select className="settings-input w-full" value={a.placement}
                              onChange={e => {
                                const achs = [...editAchievements];
                                achs[i] = { ...a, placement: e.target.value };
                                setEditAchievements(achs);
                              }}>
                              <option value="">Choisir...</option>
                              <option value="1er">1er</option>
                              <option value="2e">2e</option>
                              <option value="3e">3e</option>
                              <option value="Top 4">Top 4</option>
                              <option value="Top 8">Top 8</option>
                              <option value="Top 16">Top 16</option>
                              <option value="Demi-finale">Demi-finale</option>
                              <option value="Quart de finale">Quart de finale</option>
                              <option value="Participant">Participant</option>
                            </select>
                          </div>
                          <div>
                            <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Compétition *</label>
                            <input type="text" className="settings-input w-full" placeholder="Springs Cup S2"
                              value={a.competition} onChange={e => {
                                const achs = [...editAchievements];
                                achs[i] = { ...a, competition: e.target.value };
                                setEditAchievements(achs);
                              }} />
                          </div>
                        </div>
                        <button type="button" onClick={() => setEditAchievements(editAchievements.filter((_, j) => j !== i))}
                          className="mt-3 p-1" style={{ color: '#ff5555' }}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Jeu</label>
                          <select className="settings-input w-full" value={a.game}
                            onChange={e => {
                              const achs = [...editAchievements];
                              achs[i] = { ...a, game: e.target.value };
                              setEditAchievements(achs);
                            }}>
                            <option value="rocket_league">Rocket League</option>
                            <option value="trackmania">Trackmania</option>
                          </select>
                        </div>
                        <div>
                          <label className="t-label block mb-1" style={{ fontSize: '9px' }}>Date</label>
                          <input type="month" className="settings-input w-full"
                            value={a.date} onChange={e => {
                              const achs = [...editAchievements];
                              achs[i] = { ...a, date: e.target.value };
                              setEditAchievements(achs);
                            }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ ÉQUIPES ═══ */}
            {tab === 'teams' && (
            <SectionPanel accent="var(--s-blue)" icon={Gamepad2} title="ÉQUIPES"
              collapsed={collapsed.teams} onToggle={() => toggle('teams')}
              action={
                <button type="button" onClick={() => setShowNewTeam(!showNewTeam)}
                  className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-blue)' }}>
                  {showNewTeam ? <ChevronUp size={11} /> : <Plus size={11} />}
                  {showNewTeam ? 'Annuler' : 'Nouvelle équipe'}
                </button>
              }>

              {/* Formulaire nouvelle équipe */}
              {showNewTeam && (
                <div className="p-4 mb-4 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(0,129,255,0.2)' }}>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="t-label block mb-1.5">Nom de l&apos;équipe *</label>
                      <input type="text" className="settings-input w-full" placeholder="Équipe principale"
                        value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
                    </div>
                    <div>
                      <label className="t-label block mb-1.5">Jeu *</label>
                      <select className="settings-input w-full" value={newTeamGame}
                        onChange={e => setNewTeamGame(e.target.value)}>
                        <option value="">Choisir...</option>
                        {s.games?.includes('rocket_league') && <option value="rocket_league">Rocket League</option>}
                        {s.games?.includes('trackmania') && <option value="trackmania">Trackmania</option>}
                      </select>
                    </div>
                  </div>
                  <button type="button" onClick={handleCreateTeam}
                    disabled={!newTeamName.trim() || !newTeamGame || teamActionLoading === 'create'}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                    style={{ opacity: (!newTeamName.trim() || !newTeamGame) ? 0.5 : 1 }}>
                    {teamActionLoading === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    <span>Créer</span>
                  </button>
                </div>
              )}

              {/* Liste des équipes */}
              {teamsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
                </div>
              ) : teams.length === 0 && !showNewTeam ? (
                <div className="text-center py-6">
                  <Gamepad2 size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe créée.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {teams.map(team => {
                    const gameColor = team.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
                    // IDs déjà assignés dans cette équipe
                    const assignedIds = [...team.players.map(p => p.uid), ...team.subs.map(p => p.uid), ...team.staff.map(p => p.uid)];
                    // Membres de la structure non assignés à cette équipe
                    const availableMembers = s.members.filter(m => !assignedIds.includes(m.userId));
                    const isRL = team.game === 'rocket_league';
                    const canAddPlayer = !isRL || team.players.length < 3;
                    const canAddSub = !isRL || team.subs.length < 2;

                    return (
                      <div key={team.id} className="relative overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        {/* Mini accent */}
                        <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${gameColor}, transparent 60%)` }} />
                        <div className="p-4 space-y-3">
                          {/* En-tête équipe */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 7px' }}>
                                {team.game === 'rocket_league' ? 'RL' : 'TM'}
                              </span>
                              <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{team.name}</span>
                            </div>
                            <button type="button" onClick={() => handleDeleteTeam(team.id, team.name)}
                              disabled={teamActionLoading === team.id}
                              className="p-1.5 transition-opacity duration-150"
                              style={{ color: '#ff5555', opacity: teamActionLoading === team.id ? 0.5 : 0.6 }}>
                              {teamActionLoading === team.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>

                          {/* Roster grid — interactif */}
                          <div className="grid grid-cols-3 gap-3">
                            {/* Titulaires */}
                            <RosterSlot
                              label={`TITULAIRES${isRL ? ' (max 3)' : ''}`}
                              labelColor={gameColor}
                              members={team.players}
                              available={availableMembers}
                              canAdd={canAddPlayer}
                              loading={teamActionLoading === `${team.id}_playerIds`}
                              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', [...team.players.map(p => p.uid), uid])}
                              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', team.players.filter(p => p.uid !== uid).map(p => p.uid))}
                            />
                            {/* Remplaçants */}
                            <RosterSlot
                              label={`REMPLAÇANTS${isRL ? ' (max 2)' : ''}`}
                              labelColor="var(--s-text-dim)"
                              members={team.subs}
                              available={availableMembers}
                              canAdd={canAddSub}
                              loading={teamActionLoading === `${team.id}_subIds`}
                              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'subIds', [...team.subs.map(p => p.uid), uid])}
                              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'subIds', team.subs.filter(p => p.uid !== uid).map(p => p.uid))}
                            />
                            {/* Staff */}
                            <RosterSlot
                              label="STAFF"
                              labelColor="var(--s-gold)"
                              members={team.staff}
                              available={availableMembers}
                              canAdd={true}
                              loading={teamActionLoading === `${team.id}_staffIds`}
                              onAdd={(uid) => handleUpdateTeamRoster(team.id, 'staffIds', [...team.staff.map(p => p.uid), uid])}
                              onRemove={(uid) => handleUpdateTeamRoster(team.id, 'staffIds', team.staff.filter(p => p.uid !== uid).map(p => p.uid))}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionPanel>
            )}

            {/* ═══ Save button — visible pour les onglets éditables ═══ */}
            {(tab === 'general' || tab === 'recruitment') && (<>
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bevel-sm" style={{ background: 'rgba(255,50,50,0.08)', border: '1px solid rgba(255,50,50,0.25)' }}>
                <AlertCircle size={14} style={{ color: '#ff5555' }} />
                <span className="text-sm" style={{ color: '#ff5555' }}>{error}</span>
              </div>
            )}

            <button onClick={handleSave} disabled={saving}
              className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-6 py-3">
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <CheckCircle size={15} /> : <Save size={15} />}
              <span className="font-display text-sm tracking-wider">
                {saving ? 'SAUVEGARDE...' : saved ? 'SAUVEGARDÉ !' : 'SAUVEGARDER'}
              </span>
            </button>
            </>)}
          </div>

          {/* ─── Colonne droite ─ Invites+Membres (members) ou Info+Stats (general) ──── */}
          <div className={
            tab === 'general' ? 'space-y-6 animate-fade-in-d2'
            : tab === 'members' ? 'space-y-6 animate-fade-in-d2'
            : 'hidden'
          }>

            {/* ═══ MEMBRES — Invitations & demandes ═══ */}
            {tab === 'members' && (isDirigeantOfActive || isManagerOfActive) && (
            <SectionPanel accent="#33ff66" icon={UserPlus} title="INVITATIONS"
              collapsed={collapsed.invitations} onToggle={() => toggle('invitations')}
              action={
                <button type="button" onClick={handleCreateLink}
                  disabled={invActionLoading === 'create_link'}
                  className="flex items-center gap-1.5 text-xs font-bold" style={{ color: '#33ff66' }}>
                  {invActionLoading === 'create_link' ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                  Créer un lien
                </button>
              }>
              <div className="space-y-4">
                {/* Liens actifs */}
                {inviteLinks.length > 0 && (
                  <div className="space-y-2">
                    <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-text-dim)' }}>LIENS D&apos;INVITATION</p>
                    {inviteLinks.map(link => (
                      <div key={link.id} className="flex items-center gap-2 p-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <div className="flex-1 min-w-0">
                          <p className="t-mono text-xs truncate" style={{ color: 'var(--s-text-dim)' }}>
                            /join/{link.token.slice(0, 8)}...
                          </p>
                        </div>
                        <button type="button" onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/community/join/${link.token}`);
                          setCopiedLink(link.token);
                          setTimeout(() => setCopiedLink(''), 2000);
                        }}
                          className="p-1" style={{ color: copiedLink === link.token ? '#33ff66' : 'var(--s-text-dim)' }}>
                          {copiedLink === link.token ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        <button type="button" onClick={() => handleRevokeLink(link.id)}
                          disabled={invActionLoading === link.id}
                          className="p-1" style={{ color: '#ff5555' }}>
                          {invActionLoading === link.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Demandes en attente */}
                {joinRequests.length > 0 ? (
                  <div className="space-y-2">
                    <p className="t-label" style={{ fontSize: '9px', color: 'var(--s-gold)' }}>
                      DEMANDES EN ATTENTE ({joinRequests.length})
                    </p>
                    {joinRequests.map(jr => {
                      const jrAvatar = jr.avatarUrl || jr.discordAvatar;
                      return (
                        <div key={jr.id} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.15)' }}>
                          <div className="flex items-center gap-3 mb-2">
                            {jrAvatar ? (
                              <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                <Image src={jrAvatar} alt={jr.displayName} fill className="object-cover" unoptimized />
                              </div>
                            ) : (
                              <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                                <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate">{jr.displayName}</p>
                              {jr.message && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--s-text-dim)' }}>{jr.message}</p>}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleRequestAction(jr.id, true)}
                              disabled={invActionLoading === jr.id}
                              className="btn-springs btn-primary bevel-sm flex-1 justify-center text-xs py-1.5">
                              {invActionLoading === jr.id ? <Loader2 size={11} className="animate-spin" /> : <><Check size={11} /> Accepter</>}
                            </button>
                            <button type="button" onClick={() => handleRequestAction(jr.id, false)}
                              disabled={invActionLoading === jr.id}
                              className="btn-springs btn-secondary bevel-sm-border flex-1 justify-center text-xs py-1.5"
                              style={{ color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)' }}>
                              <Trash2 size={11} /> Refuser
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-3">
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {invLoading ? 'Chargement...' : inviteLinks.length === 0 ? 'Crée un lien pour inviter des joueurs.' : 'Aucune demande en attente.'}
                    </p>
                  </div>
                )}
              </div>
            </SectionPanel>
            )}

            {/* ═══ MEMBRES — Liste des membres ═══ */}
            {tab === 'members' && (
            <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
                style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 70%)' }} />
              <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
                    <Users size={13} style={{ color: 'var(--s-gold)' }} />
                  </div>
                  <span className="font-display text-sm tracking-wider">MEMBRES</span>
                </div>
                <span className="font-display text-lg" style={{ color: 'var(--s-gold)' }}>{s.members.length}</span>
              </div>
              <div className="relative z-[1]">
                {s.members.length === 0 ? (
                  <div className="p-6 text-center">
                    <Users size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun membre.</p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
                    {s.members.map(m => {
                      const avatar = m.avatarUrl || m.discordAvatar;
                      const isFounderRow = m.role === 'fondateur';
                      const isCoFounderRow = m.role === 'co_fondateur';
                      const isManagerRow = (s.managerIds ?? []).includes(m.userId);
                      const isCoachRow = (s.coachIds ?? []).includes(m.userId);
                      const structuralColor = isFounderRow || isCoFounderRow ? 'var(--s-gold)' : 'var(--s-text-muted)';
                      const canRemove = !isFounderRow && !isCoFounderRow && isDirigeantOfActive;
                      const canManageStaffRoles = (isFounderOfActive || isCoFounderOfActive) && !isFounderRow;
                      const memberDepartureIso = s.coFounderDepartures?.[m.userId];
                      const memberRemainingMs = memberDepartureIso ? Math.max(0, new Date(memberDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;
                      const daysLeft = memberRemainingMs != null ? Math.ceil(memberRemainingMs / (24 * 60 * 60 * 1000)) : null;
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-5 py-3 group transition-all duration-150"
                          style={{ background: 'transparent' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <Link href={`/profile/${m.userId}`} className="flex items-center gap-3 flex-1 min-w-0">
                            {avatar ? (
                              <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <Image src={avatar} alt={m.displayName} fill className="object-cover" unoptimized />
                              </div>
                            ) : (
                              <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="t-mono" style={{ fontSize: '10px', color: structuralColor }}>{ROLE_LABELS[m.role] ?? m.role}</p>
                                {isManagerRow && (
                                  <span className="tag" style={{ fontSize: '8px', padding: '1px 6px', background: 'rgba(123,47,190,0.1)', color: 'var(--s-violet-light)', borderColor: 'rgba(123,47,190,0.3)' }}>
                                    Manager
                                  </span>
                                )}
                                {isCoachRow && (
                                  <span className="tag" style={{ fontSize: '8px', padding: '1px 6px', background: 'rgba(0,129,255,0.1)', color: '#4db1ff', borderColor: 'rgba(0,129,255,0.3)' }}>
                                    Coach
                                  </span>
                                )}
                                {isCoFounderRow && daysLeft != null && (
                                  <span className="tag" style={{ fontSize: '8px', padding: '1px 6px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                                    Préavis : {daysLeft}j
                                  </span>
                                )}
                              </div>
                            </div>
                          </Link>
                          {/* Toggles staff (coach / manager) — fondateur ET co-fondateurs */}
                          {canManageStaffRoles && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                              <button type="button"
                                onClick={() => handleToggleStaffRole(m.userId, m.displayName, 'coach', !isCoachRow)}
                                disabled={invActionLoading === `${m.userId}:coach`}
                                className="px-1.5 py-0.5 transition-colors duration-150"
                                style={{
                                  fontSize: '9px',
                                  letterSpacing: '0.06em',
                                  textTransform: 'uppercase',
                                  background: isCoachRow ? 'rgba(0,129,255,0.15)' : 'transparent',
                                  color: isCoachRow ? '#4db1ff' : 'var(--s-text-muted)',
                                  border: `1px solid ${isCoachRow ? 'rgba(0,129,255,0.4)' : 'var(--s-border)'}`,
                                }}
                                title={isCoachRow ? 'Retirer Coach' : 'Promouvoir Coach'}>
                                {invActionLoading === `${m.userId}:coach` ? '…' : 'Coach'}
                              </button>
                              <button type="button"
                                onClick={() => handleToggleStaffRole(m.userId, m.displayName, 'manager', !isManagerRow)}
                                disabled={invActionLoading === `${m.userId}:manager`}
                                className="px-1.5 py-0.5 transition-colors duration-150"
                                style={{
                                  fontSize: '9px',
                                  letterSpacing: '0.06em',
                                  textTransform: 'uppercase',
                                  background: isManagerRow ? 'rgba(123,47,190,0.15)' : 'transparent',
                                  color: isManagerRow ? 'var(--s-violet-light)' : 'var(--s-text-muted)',
                                  border: `1px solid ${isManagerRow ? 'rgba(123,47,190,0.4)' : 'var(--s-border)'}`,
                                }}
                                title={isManagerRow ? 'Retirer Manager' : 'Promouvoir Manager'}>
                                {invActionLoading === `${m.userId}:manager` ? '…' : 'Manager'}
                              </button>
                            </div>
                          )}
                          {/* Actions co-fondateur — fondateur uniquement */}
                          {isFounderOfActive && !isFounderRow && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                              {isCoFounderRow ? (
                                <>
                                  <button type="button" onClick={() => handleTransferOwnership(m.userId, m.displayName)}
                                    disabled={invActionLoading === m.userId}
                                    className="p-1" style={{ color: 'var(--s-gold)' }} title="Transférer la propriété">
                                    <Shield size={11} />
                                  </button>
                                  <button type="button" onClick={() => handleDemoteCoFounder(m.userId, m.displayName)}
                                    disabled={invActionLoading === m.userId}
                                    className="p-1" style={{ color: 'var(--s-text-dim)' }} title="Rétrograder co-fondateur"
                                  >
                                    <ChevronDown size={11} />
                                  </button>
                                </>
                              ) : (
                                <button type="button" onClick={() => handlePromoteToCoFounder(m.userId, m.displayName)}
                                  disabled={invActionLoading === m.userId}
                                  className="p-1" style={{ color: 'var(--s-gold)' }} title="Promouvoir co-fondateur">
                                  <ChevronUp size={11} />
                                </button>
                              )}
                            </div>
                          )}
                          {canRemove && (
                            <button type="button" onClick={() => handleRemoveMember(m.id, m.displayName)}
                              disabled={invActionLoading === m.id}
                              className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1"
                              style={{ color: '#ff5555' }} title="Retirer">
                              {invActionLoading === m.id ? <Loader2 size={11} className="animate-spin" /> : <UserMinus size={11} />}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ═══ GÉNÉRAL — Informations ═══ */}
            {tab === 'general' && (
            <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
              <div className="relative z-[1] px-5 py-3.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(123,47,190,0.08)', border: '1px solid rgba(123,47,190,0.2)' }}>
                    <Shield size={13} style={{ color: 'var(--s-violet-light)' }} />
                  </div>
                  <span className="font-display text-sm tracking-wider">INFORMATIONS</span>
                </div>
              </div>
              <div className="relative z-[1] p-5 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Statut</span>
                  <span className="tag" style={{ background: `${statusInfo.color}12`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '2px 8px' }}>
                    {statusInfo.label}
                  </span>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Jeux</span>
                  <div className="flex gap-1.5">
                    {s.games?.map(g => (
                      <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {g === 'rocket_league' ? 'RL' : 'TM'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="divider" />
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Équipes</span>
                  <span className="font-display text-sm">{teams.length}</span>
                </div>
                {s.validatedAt && (
                  <>
                    <div className="divider" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Validée le</span>
                      <span className="t-mono text-xs">{new Date(s.validatedAt).toLocaleDateString('fr-FR')}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}

            {/* ═══ GÉNÉRAL — Quick stats ═══ */}
            {tab === 'general' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,129,255,0.06), transparent 70%)' }} />
                <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-blue)' }}>{teams.filter(t => t.game === 'rocket_league').length}</p>
                <p className="t-label mt-1 relative z-[1]" style={{ fontSize: '8px' }}>ÉQUIPES RL</p>
              </div>
              <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,217,54,0.06), transparent 70%)' }} />
                <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-green)' }}>{teams.filter(t => t.game === 'trackmania').length}</p>
                <p className="t-label mt-1 relative z-[1]" style={{ fontSize: '8px' }}>ÉQUIPES TM</p>
              </div>
            </div>
            )}
          </div>
        </div>
        )}

        {/* ═══ CALENDRIER ═══ */}
        {tab === 'calendar' && (
        <div className="animate-fade-in-d3 space-y-6">
          {/* Launcher Dispos & matching : une carte par équipe accessible (staff ou dirigeant).
              Cœur de l'UX — le coach accède aux dispos de son équipe depuis ici, le manager
              et le dirigeant voient toutes les équipes pour préparer les rosters côté calendrier. */}
          {(() => {
            const isDirigeant = isDirigeantOfActive;
            const isManagerLevel = isDirigeant || isManagerOfActive;
            // Équipes visibles :
            // - dirigeant/manager : toutes les équipes de la structure
            // - coach : uniquement celles dont il est staff (via staffedTeamIds)
            const visibleTeams = isManagerLevel
              ? teams
              : teams.filter(t => staffedTeamIds.includes(t.id));
            if (visibleTeams.length === 0) return null;
            return (
              <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.3), transparent 70%)' }} />
                <div className="absolute top-0 right-0 w-40 h-40 pointer-events-none"
                  style={{ background: 'radial-gradient(circle at 100% 0%, rgba(123,47,190,0.06), transparent 70%)' }} />
                <div className="relative z-[1] px-5 py-3.5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(123,47,190,0.1)', border: '1px solid rgba(123,47,190,0.25)' }}>
                    <CalendarClock size={13} style={{ color: 'var(--s-violet-light)' }} />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-sm tracking-wider">DISPOS &amp; DEVOIRS PAR ÉQUIPE</h2>
                    <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>Ouvre une équipe pour voir le matching des dispos et les devoirs en cours.</p>
                  </div>
                </div>
                <div className="relative z-[1] p-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {visibleTeams.map(team => {
                    const drawerTeam: DrawerTeam = {
                      id: team.id,
                      name: team.name,
                      game: team.game,
                      players: team.players,
                      subs: team.subs,
                      staff: team.staff,
                    };
                    const gameTag = team.game === 'rocket_league' ? 'RL' : team.game === 'trackmania' ? 'TM' : team.game;
                    const gameClass = team.game === 'rocket_league' ? 'tag-blue' : 'tag-green';
                    return (
                      <div key={team.id} className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`tag ${gameClass}`} style={{ fontSize: '9px', padding: '2px 6px' }}>{gameTag}</span>
                          <span className="font-display text-sm tracking-wider flex-1 truncate">{team.name.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <TeamActionChip
                            icon={<CalendarClock size={12} />}
                            label="Dispos & matching"
                            onClick={() => setDrawerState({ team: drawerTeam, tab: 'availability', canEditConfig: isDirigeant })}
                          />
                          <TeamActionChip
                            icon={<ClipboardList size={12} />}
                            label="Devoirs"
                            onClick={() => setDrawerState({ team: drawerTeam, tab: 'todos', canEditConfig: isDirigeant })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          <CalendarSection
            structureId={s.id}
            structureGames={s.games ?? []}
            members={s.members}
            teams={calendarTeams}
            userContext={userContext}
          />
        </div>
        )}
      </div>
      {/* Drawer détail équipe (Dispos + Devoirs) */}
      <TeamDetailDrawer
        open={drawerState !== null}
        onClose={() => setDrawerState(null)}
        structureId={s.id}
        team={drawerState?.team ?? null}
        initialTab={drawerState?.tab ?? 'availability'}
        canEditConfig={drawerState?.canEditConfig ?? false}
      />
    </div>
  );
}
