'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  Shield, Users, Gamepad2, Trophy, Loader2, AlertCircle,
  User, Save, Plus, Trash2, Eye, Clock, Ban, CheckCircle,
  Search, ChevronUp, ChevronDown, Link2, MessageSquare, Settings, LucideIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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
  recruiting: { active: boolean; positions: { game: string; role: string }[] };
  achievements: { placement?: string; title?: string; competition?: string; game?: string; date?: string }[];
  status: string;
  reviewComment?: string;
  founderId: string;
  members: Member[];
  requestedAt?: string;
  validatedAt?: string;
};

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
    <div className="bevel relative overflow-hidden transition-all duration-200"
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

export default function MyStructurePage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [structures, setStructures] = useState<MyStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStructure, setActiveStructure] = useState<MyStructure | null>(null);

  // Editing state
  const [editDesc, setEditDesc] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editDiscordUrl, setEditDiscordUrl] = useState('');
  const [editSocials, setEditSocials] = useState<Record<string, string>>({});
  const [editRecruiting, setEditRecruiting] = useState<{ active: boolean; positions: { game: string; role: string }[] }>({ active: false, positions: [] });
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

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showEmojis, setShowEmojis] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/my', {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
        if (data.structures?.length > 0 && !activeStructure) {
          selectStructure(data.structures[0]);
        }
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
    setEditRecruiting(s.recruiting || { active: false, positions: [] });
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

  async function handleDeleteTeam(teamId: string, teamName: string) {
    if (!activeStructure || !firebaseUser) return;
    if (!confirm(`Supprimer l'équipe "${teamName}" ? Cette action est irréversible.`)) return;
    setTeamActionLoading(teamId);
    try {
      const idToken = await firebaseUser.getIdToken();
      await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'delete', structureId: activeStructure.id, teamId }),
      });
      await loadTeams(activeStructure.id);
    } catch (err) {
      console.error('[MyStructure] delete team error:', err);
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
  const canEdit = s.status === 'active';

  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  // ─── Not active state ────────────────────────────────────────────────

  if (!canEdit) {
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
      <div className="relative z-[1] space-y-8">

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
            <Link href={`/community/structure/${s.id}`} className="btn-springs btn-secondary bevel-sm-border flex-shrink-0">
              <span><Eye size={14} /></span> <span>Page publique</span>
            </Link>
          </div>
        </header>

        {/* ═══ Dashboard grid ═══ */}
        <div className="grid grid-cols-3 gap-6">

          {/* ─── Colonne gauche — édition ──────────────────────────────── */}
          <div className="col-span-2 space-y-6 animate-fade-in-d1">

            {/* Description */}
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
                      <div className="absolute left-0 top-full mt-1 p-2 z-10 grid grid-cols-10 gap-1" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                        {['🏆', '🥇', '🥈', '🥉', '⭐', '🔥', '💪', '🎮', '🎯', '🚀', '⚽', '🏎️', '🏁', '👑', '💎', '🛡️', '⚔️', '🎉', '📢', '💬', '✅', '❌', '🔵', '🟢', '🟡', '🔴', '⚡', '💥', '🌟', '🏅', '👊', '🤝', '📊', '📈', '🗓️', '🎪', '🏟️', '🎖️', '🧩', '🕹️'].map(emoji => (
                          <button key={emoji} type="button" className="w-7 h-7 flex items-center justify-center text-base hover:scale-125 transition-transform duration-100"
                            style={{ background: 'transparent' }}
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

            {/* Recrutement */}
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
                  <div className="space-y-3 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
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

            {/* Palmarès */}
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

            {/* ═══ Équipes ═══ */}
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

                          {/* Roster grid */}
                          <div className="grid grid-cols-3 gap-3">
                            {/* Titulaires */}
                            <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <p className="t-label mb-2" style={{ fontSize: '9px', color: gameColor }}>
                                TITULAIRES {team.game === 'rocket_league' && '(3)'}
                              </p>
                              {team.players.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>—</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {team.players.map(p => (
                                    <div key={p.uid} className="flex items-center gap-1.5">
                                      {(p.avatarUrl || p.discordAvatar) ? (
                                        <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
                                      ) : (
                                        <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                      )}
                                      <span className="text-xs truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Remplaçants */}
                            <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <p className="t-label mb-2" style={{ fontSize: '9px', color: 'var(--s-text-dim)' }}>
                                REMPLAÇANTS {team.game === 'rocket_league' && '(2)'}
                              </p>
                              {team.subs.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>—</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {team.subs.map(p => (
                                    <div key={p.uid} className="flex items-center gap-1.5">
                                      {(p.avatarUrl || p.discordAvatar) ? (
                                        <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
                                      ) : (
                                        <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                      )}
                                      <span className="text-xs truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Staff */}
                            <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              <p className="t-label mb-2" style={{ fontSize: '9px', color: 'var(--s-gold)' }}>STAFF</p>
                              {team.staff.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>—</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {team.staff.map(p => (
                                    <div key={p.uid} className="flex items-center gap-1.5">
                                      {(p.avatarUrl || p.discordAvatar) ? (
                                        <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
                                      ) : (
                                        <User size={10} style={{ color: 'var(--s-text-muted)' }} />
                                      )}
                                      <span className="text-xs truncate" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionPanel>

            {/* ═══ Save button ═══ */}
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
          </div>

          {/* ─── Colonne droite ─────────────────────────────────────────── */}
          <div className="space-y-6 animate-fade-in-d2">

            {/* Membres */}
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
                      const roleColor = m.role === 'fondateur' ? 'var(--s-gold)' : m.role === 'co_fondateur' ? 'var(--s-gold)' : 'var(--s-text-muted)';
                      return (
                        <Link key={m.id} href={`/profile/${m.userId}`}
                          className="flex items-center gap-3 px-5 py-3 transition-all duration-150"
                          style={{ background: 'transparent' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
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
                            <p className="t-mono" style={{ fontSize: '10px', color: roleColor }}>{ROLE_LABELS[m.role] ?? m.role}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Infos */}
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

            {/* Quick stats */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
