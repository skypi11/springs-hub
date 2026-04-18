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
  Crown, Archive, ArchiveRestore, MoreVertical, Tag, Image as ImageIcon,
  Hash, AtSign,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import CalendarSection from '@/components/calendar/CalendarSection';
import TeamDetailDrawer, { type DrawerTab, type DrawerTeam } from '@/components/calendar/TeamDetailDrawer';
import MemberActionsMenu from '@/components/structure/MemberActionsMenu';
import { CalendarClock, ClipboardList } from 'lucide-react';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import PublicPreviewFrame from '@/components/ui/PublicPreviewFrame';
import Portal from '@/components/ui/Portal';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import type { UserContext } from '@/lib/event-permissions';
import PlayerStructureView, { type PlayerStructure } from '@/components/structure/PlayerStructureView';
import MarkdownEditor from '@/components/ui/MarkdownEditor';
import { LIMITS } from '@/lib/validation';
import { computeMemberRole, groupAffiliations, PRIMARY_ROLE_LABELS, type MemberRoleTeam, type PrimaryRole } from '@/lib/member-role';

// navigator.clipboard.writeText échoue avec NotAllowedError si le document n'a pas
// le focus (onglet inactif, prompt ouvert…). Fallback sur un textarea éphémère.
async function safeCopy(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallthrough to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

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
  joinedAt?: number | null;
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
  transferPending?: {
    toUid: string;
    keepAsCoFounder: boolean;
    initiatedBy: string;
    initiatedAt: string | null;
    scheduledAtMs: number | null;
  } | null;
  managerIds?: string[];
  coachIds?: string[];
  discordIntegration?: {
    guildId: string;
    guildName: string;
    guildIconHash?: string | null;
    installedBy: string;
    // Config étendue (Livraison B) — pings sur events scope=structure / game / staff
    structureChannelId?: string | null;
    structureChannelName?: string | null;
    structureRoleId?: string | null;
    structureRoleName?: string | null;
    gameChannels?: Record<string, {
      channelId?: string | null;
      channelName?: string | null;
      roleId?: string | null;
      roleName?: string | null;
    }>;
    staffChannelId?: string | null;
    staffChannelName?: string | null;
    staffRoleId?: string | null;
    staffRoleName?: string | null;
  } | null;
  members: Member[];
  requestedAt?: string;
  validatedAt?: string;
  accessLevel?: 'dirigeant' | 'staff';
};

const DEPARTURE_NOTICE_DAYS = 7;
const DEPARTURE_NOTICE_MS = DEPARTURE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

// Ordre d'affichage des membres — basé sur le rôle dérivé (cf. lib/member-role).
const PRIMARY_ROLE_ORDER: PrimaryRole[] = [
  'fondateur', 'co_fondateur', 'responsable', 'coach_structure',
  'manager_equipe', 'coach_equipe', 'capitaine', 'joueur', 'membre',
];
// Couleur du label principal selon le rôle dérivé.
const PRIMARY_ROLE_COLORS: Record<PrimaryRole, string> = {
  fondateur: 'var(--s-gold)',
  co_fondateur: 'var(--s-gold)',
  responsable: 'var(--s-violet-light)',
  coach_structure: '#FFB800',
  manager_equipe: 'var(--s-violet-light)',
  coach_equipe: '#4da6ff',
  capitaine: 'var(--s-gold)',
  joueur: 'var(--s-text-dim)',
  membre: 'var(--s-text-muted)',
};

const STATUS_INFO: Record<string, { label: string; color: string; icon: typeof CheckCircle; desc: string }> = {
  pending_validation: { label: 'En attente de validation', color: '#FFB800', icon: Clock, desc: 'Ta demande est en cours de traitement. Un entretien vocal sera organisé.' },
  active: { label: 'Active', color: '#33ff66', icon: CheckCircle, desc: 'Ta structure est active et visible publiquement.' },
  suspended: { label: 'Suspendue', color: '#ff5555', icon: Ban, desc: 'Ta structure est suspendue. Contacte un admin Springs.' },
  rejected: { label: 'Refusée', color: '#ff5555', icon: AlertCircle, desc: 'Ta demande a été refusée.' },
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
function RosterSlot({ label, labelColor, members, available, canAdd, loading, onAdd, onRemove, captainId }: {
  label: string;
  labelColor: string;
  members: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  available: { id: string; userId: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  canAdd: boolean;
  loading: boolean;
  onAdd: (uid: string) => void;
  onRemove: (uid: string) => void;
  captainId?: string | null;
}) {
  return (
    <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <p className="t-label mb-2" style={{ color: labelColor }}>{label}</p>
      <div className="space-y-1.5">
        {members.map(p => {
          const isCaptain = !!captainId && captainId === p.uid;
          return (
            <div key={p.uid} className="flex items-center gap-1.5 group/slot">
              {(p.avatarUrl || p.discordAvatar) ? (
                <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
              ) : (
                <User size={10} style={{ color: 'var(--s-text-muted)' }} />
              )}
              <span className="text-xs truncate flex-1" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
              {isCaptain && (
                <span title="Capitaine" className="inline-flex items-center flex-shrink-0" style={{ color: 'var(--s-gold)' }}>
                  <Crown size={10} />
                </span>
              )}
              <button type="button" onClick={() => onRemove(p.uid)}
                className="opacity-0 group-hover/slot:opacity-100 transition-opacity duration-100 p-0.5"
                style={{ color: '#ff5555' }}>
                <Trash2 size={9} />
              </button>
            </div>
          );
        })}
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

// ─── Staff slot : role picker (Coach / Manager) à l'ajout + toggle sur membre existant
function StaffRosterSlot({ label, labelColor, members, staffRoles, available, canAdd, loading, onAdd, onRemove, onChangeRole }: {
  label: string;
  labelColor: string;
  members: { uid: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  staffRoles: Record<string, 'coach' | 'manager'>;
  available: { id: string; userId: string; displayName: string; avatarUrl: string; discordAvatar: string }[];
  canAdd: boolean;
  loading: boolean;
  onAdd: (uid: string, role: 'coach' | 'manager') => void;
  onRemove: (uid: string) => void;
  onChangeRole: (uid: string, role: 'coach' | 'manager') => void;
}) {
  const [pendingUid, setPendingUid] = useState('');
  const [pendingRole, setPendingRole] = useState<'coach' | 'manager'>('coach');
  return (
    <div className="p-2.5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <p className="t-label mb-2" style={{ color: labelColor }}>{label}</p>
      <div className="space-y-1.5">
        {members.map(p => {
          const role = staffRoles[p.uid] ?? 'coach';
          const isManager = role === 'manager';
          const pillBg = isManager ? 'rgba(123,47,190,0.15)' : 'rgba(0,129,255,0.12)';
          const pillFg = isManager ? 'var(--s-violet-light)' : '#4db1ff';
          const pillBorder = isManager ? 'rgba(123,47,190,0.35)' : 'rgba(0,129,255,0.3)';
          return (
            <div key={p.uid} className="flex items-center gap-1.5 group/slot">
              {(p.avatarUrl || p.discordAvatar) ? (
                <Image src={p.avatarUrl || p.discordAvatar} alt={p.displayName} width={14} height={14} className="flex-shrink-0" unoptimized />
              ) : (
                <User size={10} style={{ color: 'var(--s-text-muted)' }} />
              )}
              <span className="text-xs truncate flex-1" style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
              <button type="button"
                onClick={() => onChangeRole(p.uid, isManager ? 'coach' : 'manager')}
                disabled={loading}
                title={isManager ? 'Passer en Coach' : 'Passer en Manager'}
                className="flex-shrink-0"
                style={{
                  fontSize: '8px', padding: '1px 5px', letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: pillBg, color: pillFg, border: `1px solid ${pillBorder}`, cursor: 'pointer',
                }}>
                {isManager ? 'Mgr' : 'Coach'}
              </button>
              <button type="button" onClick={() => onRemove(p.uid)}
                className="opacity-0 group-hover/slot:opacity-100 transition-opacity duration-100 p-0.5"
                style={{ color: '#ff5555' }}>
                <Trash2 size={9} />
              </button>
            </div>
          );
        })}
      </div>
      {canAdd && available.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <select
            className="settings-input flex-1 text-xs"
            style={{ padding: '3px 6px', fontSize: '10px' }}
            value={pendingUid}
            disabled={loading}
            onChange={e => setPendingUid(e.target.value)}>
            <option value="">{loading ? '...' : '+ Ajouter'}</option>
            {available.map(m => (
              <option key={m.userId} value={m.userId}>{m.displayName}</option>
            ))}
          </select>
          <select
            className="settings-input text-xs"
            style={{ padding: '3px 6px', fontSize: '10px', width: 70 }}
            value={pendingRole}
            disabled={loading || !pendingUid}
            onChange={e => setPendingRole(e.target.value as 'coach' | 'manager')}>
            <option value="coach">Coach</option>
            <option value="manager">Manager</option>
          </select>
          <button type="button"
            disabled={loading || !pendingUid}
            onClick={() => { if (pendingUid) { onAdd(pendingUid, pendingRole); setPendingUid(''); setPendingRole('coach'); } }}
            style={{
              fontSize: '10px', padding: '3px 8px',
              background: pendingUid ? 'var(--s-gold)' : 'var(--s-elevated)',
              color: pendingUid ? '#0a0a13' : 'var(--s-text-muted)',
              border: '1px solid var(--s-border)',
              cursor: pendingUid ? 'pointer' : 'not-allowed',
              fontWeight: 700,
            }}>
            OK
          </button>
        </div>
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

// Presentational : affiche un bloc "salon + rôle à ping" pour un scope donné.
// Mode replié = résumé. Mode déplié = pickers + Save/Cancel. Le state draft
// (channel/role en cours d'édition) vit dans ce composant pour que chaque bloc
// ait ses propres brouillons indépendants.
function DiscordConfigBlockRenderer(props: {
  opts: {
    label: string;
    accentColor: string;
    currentChannelId: string | null;
    currentChannelName: string | null;
    currentRoleId: string | null;
    currentRoleName: string | null;
  };
  expanded: boolean;
  saving: boolean;
  openPicker: () => void;
  closePicker: () => void;
  channels: Array<{ id: string; name: string; parentName: string | null }> | null;
  channelsLoading: boolean;
  channelsError: string | null;
  roles: Array<{ id: string; name: string; color: number; mentionable: boolean }> | null;
  rolesLoading: boolean;
  rolesError: string | null;
  onSave: (channelId: string | null, roleId: string | null) => void;
  onReloadChannels: () => void;
  onReloadRoles: () => void;
}) {
  const { opts, expanded, saving, openPicker, closePicker } = props;
  const [draftChannelId, setDraftChannelId] = useState<string>(opts.currentChannelId ?? '');
  const [draftRoleId, setDraftRoleId] = useState<string>(opts.currentRoleId ?? '');

  // Reset des drafts à l'ouverture (utile si l'user ferme sans save puis rouvre).
  useEffect(() => {
    if (expanded) {
      setDraftChannelId(opts.currentChannelId ?? '');
      setDraftRoleId(opts.currentRoleId ?? '');
    }
  }, [expanded, opts.currentChannelId, opts.currentRoleId]);

  // Groupement des salons par catégorie pour l'optgroup.
  const channelsByCategory = new Map<string, typeof props.channels>();
  for (const c of props.channels ?? []) {
    const cat = c.parentName ?? 'Sans catégorie';
    if (!channelsByCategory.has(cat)) channelsByCategory.set(cat, []);
    channelsByCategory.get(cat)!.push(c);
  }

  return (
    <div className="bevel-sm"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
      {/* Ligne de résumé cliquable */}
      <div className="flex items-center gap-3 p-3">
        <div className="w-1.5 h-6 flex-shrink-0" style={{ background: opts.accentColor }} />
        <div className="flex-1 min-w-0">
          <div className="t-sub">{opts.label}</div>
          <div className="text-xs flex items-center gap-3 mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
            <span className="flex items-center gap-1 truncate">
              <Hash size={10} />
              {opts.currentChannelName ? <span style={{ color: 'var(--s-text-dim)' }}>{opts.currentChannelName}</span> : <span>aucun salon</span>}
            </span>
            <span className="flex items-center gap-1 truncate">
              <AtSign size={10} />
              {opts.currentRoleName ? <span style={{ color: 'var(--s-text-dim)' }}>@{opts.currentRoleName}</span> : <span>aucun ping</span>}
            </span>
          </div>
        </div>
        {!expanded ? (
          <button type="button"
            className="btn-springs btn-secondary bevel-sm text-xs"
            style={{ padding: '4px 10px' }}
            onClick={openPicker}>
            Modifier
          </button>
        ) : (
          <button type="button"
            className="btn-springs btn-ghost bevel-sm text-xs"
            style={{ padding: '4px 10px' }}
            onClick={closePicker}>
            Fermer
          </button>
        )}
      </div>

      {/* Pickers (mode déplié) */}
      {expanded && (
        <div className="p-3 space-y-3 border-t" style={{ borderColor: 'var(--s-border)' }}>
          {/* Channel picker */}
          <div>
            <label className="t-label block mb-1.5">Salon Discord</label>
            {props.channelsLoading ? (
              <div className="text-xs flex items-center gap-2" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={12} className="animate-spin" />
                Chargement…
              </div>
            ) : props.channelsError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs flex-1" style={{ color: '#ff5555' }}>{props.channelsError}</p>
                <button type="button" className="text-xs underline" style={{ color: 'var(--s-text-dim)' }}
                  onClick={props.onReloadChannels}>Réessayer</button>
              </div>
            ) : (
              <select className="settings-input w-full text-sm"
                value={draftChannelId}
                onChange={e => setDraftChannelId(e.target.value)}>
                <option value="">— Aucun salon (pas de post) —</option>
                {Array.from(channelsByCategory.entries()).map(([cat, chans]) => (
                  <optgroup key={cat} label={cat}>
                    {chans!.map(c => (
                      <option key={c.id} value={c.id}># {c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
          {/* Role picker */}
          <div>
            <label className="t-label block mb-1.5">Rôle à ping (optionnel)</label>
            {props.rolesLoading ? (
              <div className="text-xs flex items-center gap-2" style={{ color: 'var(--s-text-muted)' }}>
                <Loader2 size={12} className="animate-spin" />
                Chargement…
              </div>
            ) : props.rolesError ? (
              <div className="flex items-center gap-2">
                <p className="text-xs flex-1" style={{ color: '#ff5555' }}>{props.rolesError}</p>
                <button type="button" className="text-xs underline" style={{ color: 'var(--s-text-dim)' }}
                  onClick={props.onReloadRoles}>Réessayer</button>
              </div>
            ) : (
              <>
                <select className="settings-input w-full text-sm"
                  value={draftRoleId}
                  onChange={e => setDraftRoleId(e.target.value)}
                  disabled={!draftChannelId}>
                  <option value="">— Pas de ping —</option>
                  {(props.roles ?? []).map(r => (
                    <option key={r.id} value={r.id} disabled={!r.mentionable && r.id !== opts.currentRoleId}>
                      @{r.name}{!r.mentionable ? ' (non-mentionnable)' : ''}
                    </option>
                  ))}
                </select>
                {!draftChannelId && (
                  <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                    Choisis d&apos;abord un salon pour activer le ping.
                  </p>
                )}
                {draftRoleId && (props.roles ?? []).find(r => r.id === draftRoleId && !r.mentionable) && (
                  <p className="text-xs mt-1" style={{ color: 'var(--s-gold)' }}>
                    Ce rôle n&apos;est pas mentionnable côté Discord — le ping ne partira pas tant
                    que tu n&apos;actives pas &quot;Autoriser tout le monde à @mentionner ce rôle&quot;
                    dans les paramètres du rôle.
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={closePicker}
              className="btn-springs btn-ghost bevel-sm text-xs"
              style={{ padding: '6px 12px' }}>
              Annuler
            </button>
            <button type="button" disabled={saving}
              onClick={() => props.onSave(draftChannelId || null, draftRoleId || null)}
              className="btn-springs btn-primary bevel-sm text-xs flex items-center gap-1"
              style={{ padding: '6px 12px' }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
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
    staffRoles?: Record<string, 'coach' | 'manager'>;
    captainId?: string | null;
    label?: string;
    order?: number;
    groupOrder?: number;
    status?: 'active' | 'archived';
    logoUrl?: string;
    discordChannelId?: string | null;
    discordChannelName?: string | null;
  };
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamGame, setNewTeamGame] = useState('');
  const [newTeamLabel, setNewTeamLabel] = useState('');
  const [newTeamLogoUrl, setNewTeamLogoUrl] = useState('');
  const [teamLogoEdit, setTeamLogoEdit] = useState<{ teamId: string; value: string } | null>(null);
  const [teamDiscordEdit, setTeamDiscordEdit] = useState<string | null>(null); // teamId en cours d'édition
  type DiscordChannel = { id: string; name: string; parentId: string | null; parentName: string | null; position: number };
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[] | null>(null);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [discordChannelsError, setDiscordChannelsError] = useState<string | null>(null);
  type DiscordRole = { id: string; name: string; color: number; position: number; mentionable: boolean };
  const [discordRoles, setDiscordRoles] = useState<DiscordRole[] | null>(null);
  const [discordRolesLoading, setDiscordRolesLoading] = useState(false);
  const [discordRolesError, setDiscordRolesError] = useState<string | null>(null);
  const [discordConfigSaving, setDiscordConfigSaving] = useState<string | null>(null); // clé = scope (structure|game:rocket_league|staff)
  type DiscordConfigScope = { scope: 'structure' | 'staff' } | { scope: 'game'; game: string };
  const [discordConfigExpanded, setDiscordConfigExpanded] = useState<Record<string, boolean>>({});
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [teamActionLoading, setTeamActionLoading] = useState<string | null>(null);
  const [discordLoading, setDiscordLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  // Groupes d'équipes "dépliés" (au-delà du cap par groupe). Key = label du groupe.
  const [expandedTeamGroups, setExpandedTeamGroups] = useState<Set<string>>(new Set());
  const [healthOpen, setHealthOpen] = useState<boolean | null>(null);
  const [teamMenuOpen, setTeamMenuOpen] = useState<string | null>(null);
  // Coordonnées fixes du bouton kebab quand le menu est ouvert — permet au menu
  // d'être rendu via Portal hors du clip-path "bevel" de la SectionPanel parent.
  const [teamMenuRect, setTeamMenuRect] = useState<{ top: number; right: number } | null>(null);
  const [captainPickerOpen, setCaptainPickerOpen] = useState<string | null>(null);
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
  // Historique d'appartenance (Phase 3 item N)
  type HistoryItem = {
    id: string;
    userId: string;
    displayName: string;
    avatarUrl: string;
    discordAvatar: string;
    country: string;
    game: string;
    role: string;
    joinReason: string;
    leftReason: string | null;
    joinedAt: number | null;
    leftAt: number | null;
    durationDays: number | null;
    isOpen: boolean;
  };
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
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
    // Suggestions : dirigeant ou manager
    const canSeeSuggestions = !!uid && (
      s.founderId === uid ||
      (s.coFounderIds ?? []).includes(uid) ||
      (s.managerIds ?? []).includes(uid)
    );
    if (canSeeSuggestions && s.recruiting?.active) loadSuggestions(s.id);
    else setSuggestions([]);
    // Shortlist : dirigeant (founder/cofounder/manager) uniquement
    if (canLoadInvitations) loadShortlist(s.id);
    else setShortlist([]);
    // Historique d'appartenance : dirigeant uniquement (Phase 3 item N)
    if (canLoadInvitations) loadHistory(s.id);
    else setHistory([]);
  }

  async function handleCreateTeam() {
    if (!activeStructure || !firebaseUser || !newTeamName.trim() || !newTeamGame || !newTeamLabel.trim()) return;
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
          label: newTeamLabel.trim(),
          logoUrl: newTeamLogoUrl.trim(),
          playerIds: [],
          subIds: [],
          staffIds: [],
        }),
      });
      if (res.ok) {
        setNewTeamName('');
        setNewTeamLabel('');
        setNewTeamLogoUrl('');
        setShowNewTeam(false);
        await loadTeams(activeStructure.id);
        toast.success('Équipe créée');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] create team error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleArchiveTeam(teamId: string, archive: boolean) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(teamId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: archive ? 'archive' : 'unarchive',
          structureId: activeStructure.id,
          teamId,
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
        toast.success(archive ? 'Équipe archivée' : 'Équipe désarchivée');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] archive team error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
    setTeamMenuOpen(null);
  }

  async function handleSetCaptain(teamId: string, captainId: string | null) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_captain`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          captainId,
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
        toast.success(captainId ? 'Capitaine désigné' : 'Capitaine retiré');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] set captain error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  async function handleUpdateTeamLogo(teamId: string, rawLogoUrl: string) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_logo`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          logoUrl: rawLogoUrl.trim(),
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
        toast.success(rawLogoUrl.trim() ? 'Logo mis à jour' : 'Logo retiré');
        setTeamLogoEdit(null);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] update team logo error:', err);
      toast.error('Erreur réseau');
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

  // Met à jour staffIds + staffRoles simultanément. Utilisé quand on ajoute/retire
  // un staff ou quand on toggle son rôle (coach ↔ manager).
  async function handleUpdateTeamStaff(teamId: string, staffIds: string[], staffRoles: Record<string, 'coach' | 'manager'>) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_staffIds`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          staffIds,
          staffRoles,
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] update team staff error:', err);
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

  // Retour du flow Discord install : on lit ?discord=... dans l'URL, on affiche
  // un toast, puis on nettoie la query string pour ne pas re-déclencher au refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const discord = params.get('discord');
    if (!discord) return;
    if (discord === 'connected') {
      toast.success('Bot Discord connecté à ton serveur.');
    } else if (discord === 'cancelled') {
      toast.info('Connexion Discord annulée.');
    } else if (discord === 'error') {
      toast.error('Impossible de connecter Discord. Réessaie.');
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('discord');
    url.searchParams.delete('reason');
    url.searchParams.delete('structureId');
    window.history.replaceState({}, '', url.toString());
  }, [toast]);

  async function handleConnectDiscord() {
    if (!activeStructure || !firebaseUser || discordLoading) return;
    setDiscordLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/discord/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ structureId: activeStructure.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        toast.error(data.error || 'Impossible de démarrer la connexion.');
        setDiscordLoading(false);
        return;
      }
      // Navigation vers Discord — le retour se fait sur /api/discord/install/callback
      // qui redirige vers /community/my-structure?discord=connected.
      window.location.href = data.url;
    } catch (err) {
      console.error('[MyStructure] discord connect error:', err);
      toast.error('Erreur réseau');
      setDiscordLoading(false);
    }
  }

  // Charge (ou recharge) la liste des salons Discord postables. Appelé la première
  // fois que le fondateur ouvre un picker dans une card d'équipe. On cache dans
  // discordChannels pour ne pas re-solliciter l'API à chaque ouverture.
  // Ferme le menu kebab des équipes quand on scroll ou qu'on redimensionne :
  // le menu est rendu via Portal en position fixe, ses coordonnées calculées à
  // l'ouverture deviennent obsolètes au moindre scroll.
  useEffect(() => {
    if (!teamMenuOpen) return;
    const close = () => { setTeamMenuOpen(null); setTeamMenuRect(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [teamMenuOpen]);

  // Invalide le cache des salons quand la structure active change ou que le bot
  // est (dé)connecté — évite d'afficher les salons d'un autre serveur.
  useEffect(() => {
    setDiscordChannels(null);
    setDiscordChannelsError(null);
    setDiscordRoles(null);
    setDiscordRolesError(null);
    setTeamDiscordEdit(null);
    setDiscordConfigExpanded({});
  }, [activeStructure?.id, activeStructure?.discordIntegration?.guildId]);

  async function loadDiscordChannels(force = false) {
    if (!activeStructure || !firebaseUser) return;
    if (!force && discordChannels !== null) return;
    setDiscordChannelsLoading(true);
    setDiscordChannelsError(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/discord/channels?structureId=${encodeURIComponent(activeStructure.id)}`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDiscordChannelsError(data.error || 'Impossible de charger les salons.');
        setDiscordChannels([]);
      } else {
        setDiscordChannels(Array.isArray(data.channels) ? data.channels : []);
      }
    } catch (err) {
      console.error('[MyStructure] load discord channels error:', err);
      setDiscordChannelsError('Erreur réseau');
      setDiscordChannels([]);
    }
    setDiscordChannelsLoading(false);
  }

  async function loadDiscordRoles(force = false) {
    if (!activeStructure || !firebaseUser) return;
    if (!force && discordRoles !== null) return;
    setDiscordRolesLoading(true);
    setDiscordRolesError(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/discord/roles?structureId=${encodeURIComponent(activeStructure.id)}`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDiscordRolesError(data.error || 'Impossible de charger les rôles.');
        setDiscordRoles([]);
      } else {
        setDiscordRoles(Array.isArray(data.roles) ? data.roles : []);
      }
    } catch (err) {
      console.error('[MyStructure] load discord roles error:', err);
      setDiscordRolesError('Erreur réseau');
      setDiscordRoles([]);
    }
    setDiscordRolesLoading(false);
  }

  async function handleSaveDiscordConfig(
    scope: DiscordConfigScope,
    channelId: string | null,
    roleId: string | null,
  ) {
    if (!activeStructure || !firebaseUser) return;
    const key = scope.scope === 'game' ? `game:${scope.game}` : scope.scope;
    setDiscordConfigSaving(key);
    try {
      const channel = channelId ? (discordChannels ?? []).find(c => c.id === channelId) : null;
      const role = roleId ? (discordRoles ?? []).find(r => r.id === roleId) : null;
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/discord/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          structureId: activeStructure.id,
          scope: scope.scope,
          ...(scope.scope === 'game' ? { game: scope.game } : {}),
          channelId: channelId ?? null,
          channelName: channel?.name ?? null,
          roleId: roleId ?? null,
          roleName: role?.name ?? null,
        }),
      });
      if (res.ok) {
        // Patch optimiste local : on met à jour activeStructure.discordIntegration
        // sans re-fetch complet pour garder une UI fluide.
        const next = { ...(activeStructure.discordIntegration ?? {}) } as NonNullable<MyStructure['discordIntegration']>;
        if (scope.scope === 'structure') {
          next.structureChannelId = channelId;
          next.structureChannelName = channel?.name ?? null;
          next.structureRoleId = roleId;
          next.structureRoleName = role?.name ?? null;
        } else if (scope.scope === 'game') {
          next.gameChannels = { ...(next.gameChannels ?? {}) };
          next.gameChannels[scope.game] = {
            channelId,
            channelName: channel?.name ?? null,
            roleId,
            roleName: role?.name ?? null,
          };
        } else {
          next.staffChannelId = channelId;
          next.staffChannelName = channel?.name ?? null;
          next.staffRoleId = roleId;
          next.staffRoleName = role?.name ?? null;
        }
        setActiveStructure({ ...activeStructure, discordIntegration: next });
        setDiscordConfigExpanded(prev => ({ ...prev, [key]: false }));
        toast.success('Config Discord enregistrée.');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] save discord config error:', err);
      toast.error('Erreur réseau');
    }
    setDiscordConfigSaving(null);
  }

  async function handleUpdateTeamDiscordChannel(teamId: string, channelId: string | null, channelName: string | null) {
    if (!activeStructure || !firebaseUser) return;
    setTeamActionLoading(`${teamId}_discord`);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          action: 'update',
          structureId: activeStructure.id,
          teamId,
          discordChannelId: channelId,
          discordChannelName: channelName,
        }),
      });
      if (res.ok) {
        await loadTeams(activeStructure.id);
        setTeamDiscordEdit(null);
        toast.success(channelId ? 'Salon Discord lié à l\u0027équipe.' : 'Salon Discord retiré.');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] update team discord channel error:', err);
      toast.error('Erreur réseau');
    }
    setTeamActionLoading(null);
  }

  // Helper JSX : un bloc de config Discord (un par scope structure/jeu/staff).
  // État "replié" = résumé + bouton "Modifier". État "déplié" = 2 selects + Save.
  function renderDiscordConfigBlock(opts: {
    key: string;
    scope: DiscordConfigScope;
    label: string;
    accentColor: string;
    currentChannelId: string | null;
    currentChannelName: string | null;
    currentRoleId: string | null;
    currentRoleName: string | null;
  }) {
    const expanded = !!discordConfigExpanded[opts.key];
    const saving = discordConfigSaving === opts.key;
    const openPicker = () => {
      setDiscordConfigExpanded(prev => ({ ...prev, [opts.key]: true }));
      loadDiscordChannels();
      loadDiscordRoles();
    };
    const closePicker = () => {
      setDiscordConfigExpanded(prev => ({ ...prev, [opts.key]: false }));
    };
    return (
      <DiscordConfigBlockRenderer
        key={opts.key}
        opts={opts}
        expanded={expanded}
        saving={saving}
        openPicker={openPicker}
        closePicker={closePicker}
        channels={discordChannels}
        channelsLoading={discordChannelsLoading}
        channelsError={discordChannelsError}
        roles={discordRoles}
        rolesLoading={discordRolesLoading}
        rolesError={discordRolesError}
        onSave={(channelId, roleId) => handleSaveDiscordConfig(opts.scope, channelId, roleId)}
        onReloadChannels={() => loadDiscordChannels(true)}
        onReloadRoles={() => loadDiscordRoles(true)}
      />
    );
  }

  async function handleDisconnectDiscord() {
    if (!activeStructure || !firebaseUser || discordLoading) return;
    const integration = activeStructure.discordIntegration;
    const ok = await confirm({
      title: 'Déconnecter Discord',
      message: `Déconnecter le bot de "${integration?.guildName ?? 'ce serveur'}" ? Les notifications s'arrêteront. Tu devras retirer le bot manuellement côté Discord si tu veux aussi le faire sortir du serveur.`,
      variant: 'danger',
      confirmLabel: 'Déconnecter',
    });
    if (!ok) return;
    setDiscordLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/discord/install?structureId=${encodeURIComponent(activeStructure.id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        setActiveStructure({ ...activeStructure, discordIntegration: null });
        await loadStructures();
        toast.success('Discord déconnecté.');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[MyStructure] discord disconnect error:', err);
      toast.error('Erreur réseau');
    }
    setDiscordLoading(false);
  }

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
  // - Manager   : équipes + recrutement (liens/demandes/invites/shortlist/suggestions — toggle ON/OFF
  //               + message public = dirigeant-only via PUT API gate) + membres + calendrier
  // - Coach     : membres (readonly) + calendrier (avec dispos/todos par équipe)
  // La branding et le toggle recrutement restent dirigeant-only (PUT API gate).
  // Capitaine-seul : accès uniquement à "son" équipe via ÉQUIPES (scope automatique)
  // et au calendrier. Pas de recrutement ni de membres structure-wide.
  const captainOnlyAccess = !isDirigeantOfActive && !isManagerOfActive && !isCoachOfActive && firebaseUser
    ? teams.some(t => t.captainId === firebaseUser.uid)
    : false;
  const visibleTabs: DashboardTab[] = isDirigeantOfActive
    ? ['general', 'teams', 'recruitment', 'members', 'calendar']
    : isManagerOfActive
    ? ['teams', 'recruitment', 'members', 'calendar']
    : isCoachOfActive
    ? ['members', 'calendar']
    : captainOnlyAccess
    ? ['teams', 'calendar']
    : ['calendar'];
  const myDepartureIso = firebaseUser ? s.coFounderDepartures?.[firebaseUser.uid] : null;
  const myDepartureRemainingMs = myDepartureIso ? Math.max(0, new Date(myDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;

  // Transfert de propriété en cours (fenêtre 24h pour annuler)
  const transferPending = s.transferPending ?? null;
  const transferRemainingMs = transferPending?.scheduledAtMs
    ? Math.max(0, transferPending.scheduledAtMs - now)
    : null;
  const transferReady = transferPending?.scheduledAtMs != null && now >= transferPending.scheduledAtMs;
  const transferTargetMember = transferPending
    ? s.members.find(m => m.userId === transferPending.toUid)
    : null;
  const transferTargetName = transferTargetMember?.displayName || transferTargetMember?.discordUsername || 'le nouveau fondateur';
  const isTransferTarget = !!firebaseUser && transferPending?.toUid === firebaseUser.uid;

  // Contexte user pour le calendrier (derivé des données déjà chargées).
  const myMemberRole = firebaseUser ? s.members.find(m => m.userId === firebaseUser.uid)?.role : undefined;
  const staffedTeamIds = firebaseUser
    ? teams.filter(t => t.staff.some(st => st.uid === firebaseUser.uid)).map(t => t.id)
    : [];
  const captainOfTeamIds = firebaseUser
    ? teams.filter(t => t.captainId === firebaseUser.uid).map(t => t.id)
    : [];
  // Vue scopée sur ÉQUIPES pour tout rôle non-dirigeant (manager, coach, capitaine) :
  // n'affiche que les équipes où l'utilisateur est staff ou capitaine.
  const teamScopeActive = !isDirigeantOfActive && !!firebaseUser;
  const isTeamInScope = (team: TeamData) =>
    !teamScopeActive ||
    team.staff.some(st => st.uid === firebaseUser?.uid) ||
    team.captainId === firebaseUser?.uid;
  const userContext: UserContext = {
    uid: firebaseUser?.uid ?? '',
    isFounder: isFounderOfActive,
    isCoFounder: isCoFounderOfActive,
    isManager: myMemberRole === 'manager' || (firebaseUser ? (s.managerIds ?? []).includes(firebaseUser.uid) : false),
    isCoach: myMemberRole === 'coach' || (firebaseUser ? (s.coachIds ?? []).includes(firebaseUser.uid) : false),
    staffedTeamIds,
    captainOfTeamIds,
  };
  const calendarTeams = teams.map(t => ({
    id: t.id,
    name: t.name,
    game: t.game,
    logoUrl: t.logoUrl,
    playerIds: t.players.map(p => p.uid),
    subIds: t.subs.map(p => p.uid),
    staffIds: t.staff.map(p => p.uid),
  }));

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

  async function loadHistory(structureId: string) {
    if (!firebaseUser) return;
    setHistoryLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/history`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history ?? []);
      }
    } catch (err) {
      console.error('[MyStructure] load history error:', err);
    }
    setHistoryLoading(false);
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
        const copied = await safeCopy(link);
        if (copied) {
          setCopiedLink(data.token);
          setTimeout(() => setCopiedLink(''), 3000);
        } else {
          toast.error('Lien créé — impossible de le copier, il est visible dans la liste.');
        }
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
      title: 'Lancer le transfert',
      message: `Tu vas programmer le transfert de ${activeStructure.name} à ${memberName}. Une fenêtre de 24h s'ouvrira pour te laisser annuler si besoin. Au-delà, le transfert pourra être finalisé. Lancer ?`,
      variant: 'danger',
      confirmLabel: 'Lancer le transfert',
    });
    if (!confirmTransfer) return;
    setInvActionLoading(userId);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'initiate', structureId: activeStructure.id, newFounderId: userId, keepAsCoFounder }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success(`Transfert lancé. Tu as ${24}h pour annuler.`);
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleCancelTransfer() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Annuler le transfert',
      message: 'Tu vas annuler le transfert de propriété en cours. Tu resteras fondateur.',
      confirmLabel: 'Annuler le transfert',
    });
    if (!ok) return;
    setInvActionLoading('transfer-cancel');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'cancel', structureId: activeStructure.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success('Transfert annulé');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setInvActionLoading(null);
  }

  async function handleConfirmTransfer() {
    if (!activeStructure || !firebaseUser) return;
    const ok = await confirm({
      title: 'Finaliser le transfert',
      message: 'La fenêtre de 24h est écoulée. Le changement de fondateur sera appliqué immédiatement.',
      variant: 'danger',
      confirmLabel: 'Finaliser',
    });
    if (!ok) return;
    setInvActionLoading('transfer-confirm');
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/structures/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ action: 'confirm', structureId: activeStructure.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        toast.success('Transfert finalisé');
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

    // Contextualiser le confirm : équipes impactées + rôles tenus (manager, coach,
    // capitaine…) pour éviter les retraits accidentels d'un membre clé.
    const member = activeStructure.members.find(m => m.id === memberId);
    const memberUid = member?.userId;
    const teamsImpacted = memberUid
      ? teams.filter(t =>
          t.players.some(p => p.uid === memberUid) ||
          t.subs.some(p => p.uid === memberUid) ||
          t.staff.some(p => p.uid === memberUid),
        )
      : [];
    const specialRoles: string[] = [];
    if (memberUid && (activeStructure.managerIds ?? []).includes(memberUid)) specialRoles.push('manager de structure');
    if (memberUid && (activeStructure.coachIds ?? []).includes(memberUid)) specialRoles.push('coach de structure');
    const captainOf = memberUid ? teams.filter(t => t.captainId === memberUid).map(t => t.name) : [];
    if (captainOf.length > 0) specialRoles.push(`capitaine de ${captainOf.join(', ')}`);

    let msg = `Retirer ${memberName} de la structure ?`;
    if (teamsImpacted.length > 0) {
      msg += `\n\nIl sera aussi retiré de ${teamsImpacted.length} équipe${teamsImpacted.length > 1 ? 's' : ''} : ${teamsImpacted.map(t => t.name).slice(0, 5).join(', ')}${teamsImpacted.length > 5 ? '…' : ''}.`;
    }
    if (specialRoles.length > 0) {
      msg += `\n\n⚠ Attention — ${memberName} est actuellement : ${specialRoles.join(' · ')}. Ce rôle sera perdu.`;
    }
    msg += '\n\nCette action est irréversible : si tu veux le réintégrer, il devra refaire une demande.';

    const ok = await confirm({
      title: `Retirer ${memberName}`,
      message: msg,
      variant: 'danger',
      confirmLabel: 'Retirer définitivement',
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

        {/* ═══ Bandeau transfert de propriété en cours ═══ */}
        {transferPending && (
          <div className="bevel relative"
            style={{
              background: 'rgba(255,184,0,0.06)',
              border: '1px solid rgba(255,184,0,0.35)',
            }}>
            <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.4) 60%, transparent)' }} />
            <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center"
                  style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)' }}>
                  <AlertCircle size={14} style={{ color: 'var(--s-gold)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm tracking-wider mb-0.5" style={{ color: 'var(--s-gold)' }}>
                    Transfert de propriété en cours
                  </div>
                  <div className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    {isTransferTarget
                      ? <>Le fondateur t&apos;a désigné comme nouveau propriétaire de <strong style={{ color: 'var(--s-text)' }}>{s.name}</strong>.</>
                      : <>Tu as programmé le transfert à <strong style={{ color: 'var(--s-text)' }}>{transferTargetName}</strong>.</>}
                    {' '}
                    {transferReady
                      ? 'La fenêtre de 24h est écoulée — le transfert peut être finalisé.'
                      : transferRemainingMs != null
                      ? <>Il reste <strong style={{ color: 'var(--s-text)' }}>
                          {Math.max(1, Math.ceil(transferRemainingMs / (60 * 60 * 1000)))}h
                        </strong> avant de pouvoir le finaliser.</>
                      : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isFounderOfActive && (
                  <button type="button" onClick={handleCancelTransfer}
                    disabled={invActionLoading === 'transfer-cancel'}
                    className="btn-springs btn-secondary bevel-sm-border text-xs"
                    style={{ color: 'var(--s-text)' }}>
                    {invActionLoading === 'transfer-cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    <span>Annuler le transfert</span>
                  </button>
                )}
                {(isFounderOfActive || isTransferTarget) && transferReady && (
                  <button type="button" onClick={handleConfirmTransfer}
                    disabled={invActionLoading === 'transfer-confirm'}
                    className="btn-springs btn-primary bevel-sm">
                    {invActionLoading === 'transfer-confirm' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    <span>Finaliser maintenant</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

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
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-1" style={{ color: 'var(--s-text-muted)', fontSize: '12px' }}>
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

            {/* Bot Discord — pour les notifs automatiques dans les salons d'équipe */}
            <SectionPanel accent="#5865F2" icon={MessageSquare} title="BOT DISCORD"
              collapsed={collapsed.discordBot} onToggle={() => toggle('discordBot')}>
              {activeStructure?.discordIntegration ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bevel-sm"
                    style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.25)' }}>
                    <div className="flex items-center justify-center w-10 h-10 bevel-sm"
                      style={{ background: 'rgba(88,101,242,0.2)', border: '1px solid rgba(88,101,242,0.4)' }}>
                      <Check size={18} style={{ color: '#5865F2' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="t-sub truncate">Connecté à {activeStructure.discordIntegration.guildName}</div>
                      <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        Le bot peut poster les notifs d&apos;événements dans les salons d&apos;équipe.
                      </div>
                    </div>
                  </div>
                  {/* Config Discord par scope (structure, par jeu, staff).
                      Les salons par équipe sont configurés depuis la card
                      de l'équipe (menu kebab → "Configurer le salon Discord"). */}
                  <div className="space-y-2">
                    <div className="t-label flex items-center gap-2" style={{ color: 'var(--s-text-dim)' }}>
                      <Settings size={12} />
                      Salons & rôles par scope
                    </div>
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Pour les events qui ciblent toute la structure, un jeu entier,
                      ou le staff : choisis le salon où poster et le rôle à ping.
                      Les salons par équipe se configurent directement sur la card
                      de chaque équipe.
                    </p>
                    {renderDiscordConfigBlock({
                      key: 'structure',
                      scope: { scope: 'structure' },
                      label: 'Toute la structure',
                      accentColor: '#FFB800',
                      currentChannelId: activeStructure.discordIntegration.structureChannelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.structureChannelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.structureRoleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.structureRoleName ?? null,
                    })}
                    {activeStructure.games.includes('rocket_league') && renderDiscordConfigBlock({
                      key: 'game:rocket_league',
                      scope: { scope: 'game', game: 'rocket_league' },
                      label: 'Rocket League',
                      accentColor: '#0081FF',
                      currentChannelId: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.gameChannels?.rocket_league?.channelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.gameChannels?.rocket_league?.roleName ?? null,
                    })}
                    {activeStructure.games.includes('trackmania') && renderDiscordConfigBlock({
                      key: 'game:trackmania',
                      scope: { scope: 'game', game: 'trackmania' },
                      label: 'Trackmania',
                      accentColor: '#00D936',
                      currentChannelId: activeStructure.discordIntegration.gameChannels?.trackmania?.channelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.gameChannels?.trackmania?.channelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.gameChannels?.trackmania?.roleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.gameChannels?.trackmania?.roleName ?? null,
                    })}
                    {renderDiscordConfigBlock({
                      key: 'staff',
                      scope: { scope: 'staff' },
                      label: 'Staff',
                      accentColor: 'var(--s-violet-light)',
                      currentChannelId: activeStructure.discordIntegration.staffChannelId ?? null,
                      currentChannelName: activeStructure.discordIntegration.staffChannelName ?? null,
                      currentRoleId: activeStructure.discordIntegration.staffRoleId ?? null,
                      currentRoleName: activeStructure.discordIntegration.staffRoleName ?? null,
                    })}
                  </div>
                  <div className="flex justify-end pt-2 border-t" style={{ borderColor: 'var(--s-border)' }}>
                    <button type="button"
                      className="btn-springs btn-secondary bevel-sm flex items-center gap-2"
                      disabled={discordLoading}
                      onClick={handleDisconnectDiscord}>
                      {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      Déconnecter
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                    Connecte le bot Springs Hub à ton serveur Discord pour recevoir
                    automatiquement les notifications d&apos;événements dans le salon
                    de chaque équipe. Tu pourras choisir le salon par équipe après la connexion.
                  </p>
                  <div className="p-3 bevel-sm text-xs space-y-1"
                    style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', color: 'var(--s-text-dim)' }}>
                    <div className="flex items-center gap-2 font-medium" style={{ color: 'var(--s-gold)' }}>
                      <AlertCircle size={12} />
                      Le bot demande la permission Administrator
                    </div>
                    <p>
                      C&apos;est nécessaire pour poster dans les salons privés des équipes
                      sans que tu doives ajouter le bot manuellement sur chaque salon. Le bot
                      ne fait rien d&apos;autre que poster des embeds d&apos;événements —
                      tu peux révoquer son accès à tout moment en le retirant du serveur.
                    </p>
                  </div>
                  <button type="button"
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2"
                    disabled={discordLoading}
                    onClick={handleConnectDiscord}>
                    {discordLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                    Connecter Discord
                  </button>
                </div>
              )}
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
            {tab === 'recruitment' && isDirigeantOfActive && (
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

                {/* Save bar — vit avec le formulaire qu'elle sauvegarde,
                    bien plus intuitif que le bouton global tout en bas de la page. */}
                <div className="flex items-center gap-3 pt-4" style={{ borderTop: '1px solid var(--s-border)' }}>
                  <button onClick={handleSave} disabled={saving}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2 px-5 py-2.5">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle size={14} /> : <Save size={14} />}
                    <span className="font-display text-xs tracking-wider">
                      {saving ? 'SAUVEGARDE...' : saved ? 'SAUVEGARDÉ !' : 'SAUVEGARDER'}
                    </span>
                  </button>
                  {error && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: '#ff5555' }}>
                      <AlertCircle size={12} />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              </div>
            </SectionPanel>
            )}

            {/* ═══ RECRUTEMENT — Liens d'invitation ═══ */}
            {tab === 'recruitment' && (isDirigeantOfActive || isManagerOfActive) && (
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
                        <button type="button" onClick={async () => {
                          const ok = await safeCopy(`${window.location.origin}/community/join/${link.token}`);
                          if (ok) {
                            setCopiedLink(link.token);
                            setTimeout(() => setCopiedLink(''), 2000);
                          } else {
                            toast.error('Copie impossible — sélectionne le lien manuellement.');
                          }
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
            {tab === 'recruitment' && (isDirigeantOfActive || isManagerOfActive) && (
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
            {tab === 'recruitment' && (isDirigeantOfActive || isManagerOfActive) && (
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
            {tab === 'recruitment' && (isDirigeantOfActive || isManagerOfActive) && (
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

            {tab === 'recruitment' && (isDirigeantOfActive || isManagerOfActive) && s.recruiting?.active && (
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
                            <label className="t-label block mb-1">Placement *</label>
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
                            <label className="t-label block mb-1">Compétition *</label>
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
                          <label className="t-label block mb-1">Jeu</label>
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
                          <label className="t-label block mb-1">Date</label>
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
            {tab === 'teams' && (() => {
              // Filtrage par recherche (nom équipe / label / pseudo joueur)
              const q = teamSearch.trim().toLowerCase();
              const matchTeam = (t: TeamData) => {
                if (!q) return true;
                if (t.name?.toLowerCase().includes(q)) return true;
                if ((t.label ?? '').toLowerCase().includes(q)) return true;
                const allMembers = [...t.players, ...t.subs, ...t.staff];
                return allMembers.some(m => (m.displayName ?? '').toLowerCase().includes(q));
              };
              const activeTeams = teams.filter(t => (t.status ?? 'active') === 'active' && matchTeam(t) && isTeamInScope(t));
              const archivedTeams = teams.filter(t => t.status === 'archived' && matchTeam(t) && isTeamInScope(t));
              const archivedCount = teams.filter(t => t.status === 'archived' && isTeamInScope(t)).length;

              // Grouper par label (label vide = "Sans label")
              type Group = { label: string; displayLabel: string; groupOrder: number; teams: TeamData[] };
              const groupsMap = new Map<string, Group>();
              for (const t of activeTeams) {
                const label = (t.label ?? '').trim();
                const key = label || '__nolabel__';
                if (!groupsMap.has(key)) {
                  groupsMap.set(key, {
                    label,
                    displayLabel: label || 'Sans label',
                    groupOrder: typeof t.groupOrder === 'number' ? t.groupOrder : 0,
                    teams: [],
                  });
                } else {
                  // Garder le plus petit groupOrder trouvé (cohérence)
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

              // Helpers UI
              const renderTeamCard = (team: TeamData, isArchived: boolean) => {
                const gameColor = team.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
                const assignedIds = [...team.players.map(p => p.uid), ...team.subs.map(p => p.uid), ...team.staff.map(p => p.uid)];
                // "1 joueur = 1 équipe par jeu" : exclure les joueurs déjà titulaires/remplaçants
                // d'une AUTRE équipe active du même jeu (staff autorisé sur plusieurs équipes).
                const rosterLockedIds = new Set<string>();
                for (const t of teams) {
                  if (t.id === team.id) continue;
                  if ((t.status ?? 'active') !== 'active') continue;
                  if (t.game !== team.game) continue;
                  for (const p of t.players) rosterLockedIds.add(p.uid);
                  for (const p of t.subs) rosterLockedIds.add(p.uid);
                }
                const availableForRoster = s.members.filter(m =>
                  m.game === team.game && !assignedIds.includes(m.userId) && !rosterLockedIds.has(m.userId)
                );
                // Staff pas verrouillé par jeu — un coach peut encadrer plusieurs équipes.
                const availableForStaff = s.members.filter(m =>
                  m.game === team.game && !assignedIds.includes(m.userId)
                );
                const isRL = team.game === 'rocket_league';
                const canAddPlayer = !isRL || team.players.length < 3;
                const canAddSub = !isRL || team.subs.length < 2;
                const captainId = team.captainId ?? null;
                const canManageTeam = isDirigeantOfActive;
                const canDeleteTeam = isFounderOfActive;
                const menuOpen = teamMenuOpen === team.id;

                return (
                  <div key={team.id} id={`team-${team.id}`} className="relative"
                    style={{
                      background: 'var(--s-elevated)',
                      border: '1px solid var(--s-border)',
                      opacity: isArchived ? 0.65 : 1,
                    }}>
                    <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${gameColor}, transparent 60%)` }} />
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 7px' }}>
                            {team.game === 'rocket_league' ? 'RL' : 'TM'}
                          </span>
                          {team.logoUrl ? (
                            <span className="relative w-6 h-6 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={team.logoUrl} alt="" className="w-full h-full object-contain" />
                            </span>
                          ) : null}
                          <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{team.name}</span>
                          {isArchived && (
                            <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '2px 7px' }}>ARCHIVÉE</span>
                          )}
                          {team.discordChannelId && team.discordChannelName && !isArchived && (
                            <span
                              className="inline-flex items-center gap-1 tag bevel-sm cursor-pointer"
                              style={{
                                fontSize: '10px',
                                padding: '2px 7px',
                                background: 'rgba(88,101,242,0.12)',
                                border: '1px solid rgba(88,101,242,0.35)',
                                color: '#a5b0ff',
                              }}
                              title={`Salon Discord : #${team.discordChannelName}`}
                              onClick={canManageTeam ? () => { setTeamDiscordEdit(team.id); loadDiscordChannels(); } : undefined}>
                              <MessageSquare size={9} />
                              <span className="normal-case" style={{ letterSpacing: 0 }}>#{team.discordChannelName}</span>
                            </span>
                          )}
                          {(() => {
                            const cap = captainId ? team.players.find(p => p.uid === captainId) : null;
                            const canPick = canManageTeam && !isArchived && team.players.length > 0;
                            const pickerOpen = captainPickerOpen === team.id;
                            const busyCaptain = teamActionLoading === `${team.id}_captain`;

                            if (!canPick) {
                              return cap && !isArchived ? (
                                <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--s-gold)' }}>
                                  <Crown size={11} />
                                  <span className="font-semibold">{cap.displayName}</span>
                                </span>
                              ) : null;
                            }

                            return (
                              <div className="relative inline-flex">
                                <button
                                  type="button"
                                  onClick={() => setCaptainPickerOpen(pickerOpen ? null : team.id)}
                                  disabled={busyCaptain}
                                  title={cap ? 'Changer le capitaine' : 'Désigner un capitaine'}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs transition-colors duration-150 disabled:opacity-50"
                                  style={{
                                    color: cap ? 'var(--s-gold)' : 'var(--s-text-muted)',
                                    border: `1px solid ${cap ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                                    background: pickerOpen ? 'var(--s-hover)' : 'transparent',
                                  }}
                                >
                                  <Crown size={11} />
                                  <span className="font-semibold">
                                    {cap ? cap.displayName : 'Désigner capitaine'}
                                  </span>
                                </button>
                                {pickerOpen && (
                                  <>
                                    <div className="fixed inset-0 z-10" onClick={() => setCaptainPickerOpen(null)} />
                                    <div
                                      className="absolute left-0 top-full mt-1 z-20 min-w-[200px] py-1 bevel-sm"
                                      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
                                    >
                                      <div className="px-3 py-1.5 t-label" style={{ color: 'var(--s-text-muted)' }}>Capitaine</div>
                                      <div className="space-y-0.5">
                                        {team.players.map(p => (
                                          <button
                                            key={p.uid}
                                            type="button"
                                            onClick={() => {
                                              handleSetCaptain(team.id, captainId === p.uid ? null : p.uid);
                                              setCaptainPickerOpen(null);
                                            }}
                                            disabled={busyCaptain}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left hover:bg-[var(--s-hover)] disabled:opacity-50"
                                          >
                                            <Crown size={11} style={{ color: captainId === p.uid ? 'var(--s-gold)' : 'var(--s-text-muted)' }} />
                                            <span style={{ color: 'var(--s-text)' }}>{p.displayName}</span>
                                            {captainId === p.uid && (
                                              <span className="ml-auto text-xs" style={{ color: 'var(--s-gold)' }}>actuel</span>
                                            )}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {canManageTeam && (
                          <div className="relative">
                            <button type="button"
                              onClick={(e) => {
                                if (menuOpen) {
                                  setTeamMenuOpen(null);
                                  setTeamMenuRect(null);
                                } else {
                                  const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                  // Ancre le menu juste sous le bouton, aligné sur son bord droit.
                                  setTeamMenuRect({ top: r.bottom + 4, right: window.innerWidth - r.right });
                                  setTeamMenuOpen(team.id);
                                }
                              }}
                              className="p-1.5 transition-opacity duration-150"
                              style={{ color: 'var(--s-text-dim)', opacity: 0.7 }}
                              aria-label="Menu de l'équipe">
                              <MoreVertical size={14} />
                            </button>
                            {menuOpen && teamMenuRect && (
                              <Portal>
                                <div className="fixed inset-0 z-[60]" onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); }} />
                                <div className="fixed z-[61] min-w-[220px] py-1 bevel-sm animate-fade-in"
                                  style={{
                                    top: teamMenuRect.top,
                                    right: teamMenuRect.right,
                                    background: 'var(--s-surface)',
                                    border: '1px solid var(--s-border)',
                                    boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                                  }}>
                                  {!isArchived && (
                                    <button type="button"
                                      onClick={() => { setTeamMenuOpen(null); setTeamLogoEdit({ teamId: team.id, value: team.logoUrl ?? '' }); }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                                      style={{ color: 'var(--s-text)' }}>
                                      <ImageIcon size={12} />
                                      <span>{team.logoUrl ? 'Modifier le logo' : 'Ajouter un logo'}</span>
                                    </button>
                                  )}
                                  {!isArchived && (
                                    <button type="button"
                                      onClick={() => {
                                        setTeamMenuOpen(null);
                                        setTeamDiscordEdit(team.id);
                                        loadDiscordChannels();
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                                      style={{ color: 'var(--s-text)' }}>
                                      <MessageSquare size={12} />
                                      <span>{team.discordChannelId ? 'Modifier le salon Discord' : 'Configurer le salon Discord'}</span>
                                    </button>
                                  )}
                                  {!isArchived ? (
                                    <button type="button"
                                      onClick={() => handleArchiveTeam(team.id, true)}
                                      disabled={teamActionLoading === team.id}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                                      style={{ color: 'var(--s-text)' }}>
                                      <Archive size={12} />
                                      <span>Archiver l&apos;équipe</span>
                                    </button>
                                  ) : (
                                    <button type="button"
                                      onClick={() => handleArchiveTeam(team.id, false)}
                                      disabled={teamActionLoading === team.id}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left"
                                      style={{ color: 'var(--s-text)' }}>
                                      <ArchiveRestore size={12} />
                                      <span>Désarchiver</span>
                                    </button>
                                  )}
                                  {canDeleteTeam && (
                                    <button type="button"
                                      onClick={() => { setTeamMenuOpen(null); setTeamMenuRect(null); handleDeleteTeam(team.id, team.name); }}
                                      disabled={teamActionLoading === team.id}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--s-hover)] text-left border-t"
                                      style={{ color: '#ff5555', borderColor: 'var(--s-border)' }}>
                                      <Trash2 size={12} />
                                      <span>Supprimer définitivement</span>
                                    </button>
                                  )}
                                </div>
                              </Portal>
                            )}
                          </div>
                        )}
                      </div>

                      {teamDiscordEdit === team.id && (
                        <div className="p-3 bevel-sm space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid rgba(88,101,242,0.25)' }}>
                          <div className="flex items-center gap-2">
                            <MessageSquare size={14} style={{ color: '#5865F2' }} />
                            <span className="t-label">Salon Discord de l&apos;équipe</span>
                          </div>
                          {!activeStructure?.discordIntegration ? (
                            <p className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              Connecte d&apos;abord le bot Discord depuis l&apos;onglet <strong>Général → Bot Discord</strong>.
                            </p>
                          ) : discordChannelsLoading ? (
                            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                              <Loader2 size={12} className="animate-spin" />
                              <span>Chargement des salons…</span>
                            </div>
                          ) : discordChannelsError ? (
                            <div className="space-y-2">
                              <p className="text-xs" style={{ color: '#ff5555' }}>{discordChannelsError}</p>
                              <button type="button"
                                onClick={() => loadDiscordChannels(true)}
                                className="btn-springs btn-ghost bevel-sm text-xs">
                                Réessayer
                              </button>
                            </div>
                          ) : (
                            <>
                              <select
                                className="settings-input w-full text-sm"
                                value={team.discordChannelId ?? ''}
                                disabled={teamActionLoading === `${team.id}_discord`}
                                onChange={e => {
                                  const id = e.target.value || null;
                                  if (!id) {
                                    handleUpdateTeamDiscordChannel(team.id, null, null);
                                  } else {
                                    const ch = (discordChannels ?? []).find(c => c.id === id);
                                    handleUpdateTeamDiscordChannel(team.id, id, ch?.name ?? null);
                                  }
                                }}>
                                <option value="">— Aucun salon —</option>
                                {(() => {
                                  const groups = new Map<string, DiscordChannel[]>();
                                  for (const c of (discordChannels ?? [])) {
                                    const key = c.parentName ?? '';
                                    if (!groups.has(key)) groups.set(key, []);
                                    groups.get(key)!.push(c);
                                  }
                                  const nodes: React.ReactNode[] = [];
                                  for (const [groupName, list] of groups) {
                                    if (groupName) {
                                      nodes.push(
                                        <optgroup key={`g_${groupName}`} label={groupName.toUpperCase()}>
                                          {list.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                        </optgroup>
                                      );
                                    } else {
                                      for (const c of list) {
                                        nodes.push(<option key={c.id} value={c.id}>#{c.name}</option>);
                                      }
                                    }
                                  }
                                  return nodes;
                                })()}
                              </select>
                              <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                Le bot doit avoir accès à ce salon. Les événements de cette équipe y seront postés automatiquement.
                              </p>
                            </>
                          )}
                          <div className="flex items-center justify-end">
                            <button type="button"
                              onClick={() => setTeamDiscordEdit(null)}
                              className="btn-springs btn-ghost bevel-sm text-xs">
                              Fermer
                            </button>
                          </div>
                        </div>
                      )}

                      {teamLogoEdit?.teamId === team.id && (
                        <div className="p-3 bevel-sm space-y-2" style={{ background: 'var(--s-surface)', border: '1px solid rgba(0,129,255,0.25)' }}>
                          <label className="t-label block">Logo de l&apos;équipe (URL)</label>
                          <div className="flex items-center gap-2">
                            {teamLogoEdit.value.trim() ? (
                              <span className="relative w-10 h-10 flex-shrink-0 bevel-sm overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={teamLogoEdit.value} alt="" className="w-full h-full object-contain" />
                              </span>
                            ) : null}
                            <input type="url" className="settings-input flex-1 text-sm" placeholder="https://..."
                              value={teamLogoEdit.value}
                              onChange={e => setTeamLogoEdit({ teamId: team.id, value: e.target.value })} />
                          </div>
                          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                            Lien direct vers une image (PNG/JPG). Laisser vide pour retirer le logo.
                          </p>
                          <div className="flex items-center gap-2">
                            <button type="button"
                              onClick={() => handleUpdateTeamLogo(team.id, teamLogoEdit.value)}
                              disabled={teamActionLoading === `${team.id}_logo`}
                              className="btn-springs btn-primary bevel-sm flex items-center gap-1.5 text-xs">
                              {teamActionLoading === `${team.id}_logo` ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              <span>Enregistrer</span>
                            </button>
                            <button type="button"
                              onClick={() => setTeamLogoEdit(null)}
                              className="btn-springs btn-ghost bevel-sm text-xs">
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-3">
                        <RosterSlot
                          label={`TITULAIRES${isRL ? ' (max 3)' : ''}`}
                          labelColor={gameColor}
                          members={team.players}
                          available={availableForRoster}
                          canAdd={canAddPlayer && !isArchived}
                          loading={teamActionLoading === `${team.id}_playerIds`}
                          captainId={captainId}
                          onAdd={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', [...team.players.map(p => p.uid), uid])}
                          onRemove={(uid) => handleUpdateTeamRoster(team.id, 'playerIds', team.players.filter(p => p.uid !== uid).map(p => p.uid))}
                        />
                        <RosterSlot
                          label={`REMPLAÇANTS${isRL ? ' (max 2)' : ''}`}
                          labelColor="var(--s-text-dim)"
                          members={team.subs}
                          available={availableForRoster}
                          canAdd={canAddSub && !isArchived}
                          loading={teamActionLoading === `${team.id}_subIds`}
                          onAdd={(uid) => handleUpdateTeamRoster(team.id, 'subIds', [...team.subs.map(p => p.uid), uid])}
                          onRemove={(uid) => handleUpdateTeamRoster(team.id, 'subIds', team.subs.filter(p => p.uid !== uid).map(p => p.uid))}
                        />
                        <StaffRosterSlot
                          label="STAFF"
                          labelColor="var(--s-gold)"
                          members={team.staff}
                          staffRoles={team.staffRoles ?? {}}
                          available={availableForStaff}
                          canAdd={!isArchived}
                          loading={teamActionLoading === `${team.id}_staffIds`}
                          onAdd={(uid, role) => {
                            const newStaffIds = [...team.staff.map(p => p.uid), uid];
                            const newRoles = { ...(team.staffRoles ?? {}), [uid]: role };
                            handleUpdateTeamStaff(team.id, newStaffIds, newRoles);
                          }}
                          onRemove={(uid) => {
                            const newStaffIds = team.staff.filter(p => p.uid !== uid).map(p => p.uid);
                            const nextRoles = { ...(team.staffRoles ?? {}) };
                            delete nextRoles[uid];
                            handleUpdateTeamStaff(team.id, newStaffIds, nextRoles);
                          }}
                          onChangeRole={(uid, role) => {
                            const newRoles = { ...(team.staffRoles ?? {}), [uid]: role };
                            handleUpdateTeamStaff(team.id, team.staff.map(p => p.uid), newRoles);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              };

              const emptyQueryMatches = !teamsLoading && activeTeams.length === 0 && archivedTeams.length === 0;
              const noActiveAtAll = !teamsLoading && teams.filter(t => (t.status ?? 'active') === 'active').length === 0;

              return (
            <SectionPanel accent="var(--s-blue)" icon={Gamepad2} title={`ÉQUIPES${teams.length > 0 ? ` · ${teams.filter(t => (t.status ?? 'active') === 'active' && isTeamInScope(t)).length}` : ''}`}
              collapsed={collapsed.teams} onToggle={() => toggle('teams')}
              action={isDirigeantOfActive ? (
                <button type="button" onClick={() => setShowNewTeam(!showNewTeam)}
                  className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-blue)' }}>
                  {showNewTeam ? <ChevronUp size={11} /> : <Plus size={11} />}
                  {showNewTeam ? 'Annuler' : 'Nouvelle équipe'}
                </button>
              ) : null}>

              {/* Banner vue scopée — manager/coach/capitaine ne voit que ses équipes */}
              {teamScopeActive && (
                <div className="flex items-center gap-2 mb-3 px-3 py-2 bevel-sm" style={{ background: 'rgba(123,47,190,0.08)', border: '1px solid rgba(123,47,190,0.25)' }}>
                  <Eye size={12} style={{ color: 'var(--s-violet-light)', flexShrink: 0 }} />
                  <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                    Vue limitée aux équipes où tu es <span style={{ color: 'var(--s-violet-light)' }}>staff</span> ou <span style={{ color: 'var(--s-gold)' }}>capitaine</span>.
                  </span>
                </div>
              )}

              {/* Dashboard santé équipes — dirigeant only — Lot 6 (collapsible à partir de 5 flags) */}
              {isDirigeantOfActive && !teamsLoading && (() => {
                const activeAll = teams.filter(t => (t.status ?? 'active') === 'active');
                if (activeAll.length === 0) return null;
                const noCaptain = activeAll.filter(t => !t.captainId);
                const noStaff = activeAll.filter(t => t.staff.length === 0);
                const rlIncomplete = activeAll.filter(t => t.game === 'rocket_league' && t.players.length < 3);
                const totalFlagged = noCaptain.length + noStaff.length + rlIncomplete.length;
                if (totalFlagged === 0) return null;
                // Auto-collapse si beaucoup de flags (>5), sauf override utilisateur
                const defaultOpen = totalFlagged <= 5;
                const isOpen = healthOpen ?? defaultOpen;
                const flagRow = (
                  label: string,
                  list: TeamData[],
                  color: string,
                ) => list.length === 0 ? null : (
                  <div key={label} className="flex items-start gap-2 py-1.5">
                    <AlertCircle size={12} style={{ color, flexShrink: 0, marginTop: 2 }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--s-text)' }}>
                        {label} <span className="font-normal" style={{ color: 'var(--s-text-muted)' }}>· {list.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map(t => (
                          <button key={t.id} type="button"
                            onClick={() => { if (t.id) document.getElementById(`team-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                            className="text-xs px-1.5 py-0.5 transition-colors duration-150"
                            style={{ background: 'var(--s-elevated)', border: `1px solid ${color}40`, color: 'var(--s-text-dim)' }}>
                            {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <div className="mb-4 p-3 bevel-sm relative overflow-hidden"
                    style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.25)' }}>
                    <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), transparent 70%)' }} />
                    <button type="button" onClick={() => setHealthOpen(!isOpen)}
                      className="w-full flex items-center gap-2 transition-colors duration-150"
                      style={{ cursor: 'pointer' }}>
                      <AlertCircle size={13} style={{ color: 'var(--s-gold)' }} />
                      <span className="t-label" style={{ color: 'var(--s-gold)' }}>Santé des équipes</span>
                      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        · {totalFlagged} point{totalFlagged > 1 ? 's' : ''} d&apos;attention
                      </span>
                      <div className="flex-1" />
                      {isOpen ? <ChevronUp size={12} style={{ color: 'var(--s-text-dim)' }} /> : <ChevronDown size={12} style={{ color: 'var(--s-text-dim)' }} />}
                    </button>
                    {isOpen && (
                      <div className="mt-2 divide-y" style={{ borderColor: 'var(--s-border)' }}>
                        {flagRow('Sans capitaine', noCaptain, '#ffb800')}
                        {flagRow('Sans staff (manager/coach)', noStaff, '#7a7a95')}
                        {flagRow('Roster RL incomplet (<3 titulaires)', rlIncomplete, '#0081ff')}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Toolbar : recherche */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
                  <input type="text" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                    placeholder="Rechercher une équipe, un label, un joueur..."
                    className="settings-input w-full pl-7 text-sm" />
                </div>
              </div>

              {/* Formulaire nouvelle équipe */}
              {showNewTeam && isDirigeantOfActive && (
                <div className="p-4 mb-4 space-y-3" style={{ background: 'var(--s-elevated)', border: '1px solid rgba(0,129,255,0.2)' }}>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="t-label block mb-1.5">Nom de l&apos;équipe *</label>
                      <input type="text" className="settings-input w-full" placeholder="Équipe principale"
                        value={newTeamName} onChange={e => setNewTeamName(e.target.value)} />
                    </div>
                    <div>
                      <label className="t-label block mb-1.5">Label de niveau *</label>
                      <input type="text" className="settings-input w-full" placeholder="Elite, Academy, Amateur..."
                        value={newTeamLabel} onChange={e => setNewTeamLabel(e.target.value)}
                        list="team-labels-datalist" />
                      <datalist id="team-labels-datalist">
                        {Array.from(new Set(teams.map(t => (t.label ?? '').trim()).filter(Boolean))).map(l => (
                          <option key={l} value={l} />
                        ))}
                      </datalist>
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
                  <div>
                    <label className="t-label block mb-1.5">Logo de l&apos;équipe (URL, optionnel)</label>
                    <input type="url" className="settings-input w-full text-sm" placeholder="https://..."
                      value={newTeamLogoUrl} onChange={e => setNewTeamLogoUrl(e.target.value)} />
                    <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                      Lien direct vers une image (PNG/JPG). Si vide, une icône générique est utilisée.
                    </p>
                  </div>
                  <button type="button" onClick={handleCreateTeam}
                    disabled={!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame || teamActionLoading === 'create'}
                    className="btn-springs btn-primary bevel-sm flex items-center gap-2 text-xs"
                    style={{ opacity: (!newTeamName.trim() || !newTeamLabel.trim() || !newTeamGame) ? 0.5 : 1 }}>
                    {teamActionLoading === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    <span>Créer</span>
                  </button>
                </div>
              )}

              {teamsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
                </div>
              ) : noActiveAtAll && archivedCount === 0 ? (
                <div className="text-center py-6">
                  <Gamepad2 size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe créée.</p>
                </div>
              ) : emptyQueryMatches ? (
                <div className="text-center py-6">
                  <Search size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun résultat pour « {teamSearch} ».</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Groupes actifs par label — pagination douce : au-delà de 12 équipes
                      le groupe est tronqué et un bouton "Afficher tout" le déplie. */}
                  {groups.map(g => {
                    const groupKey = g.label || '__nolabel__';
                    const TEAM_GROUP_CAP = 12;
                    const expanded = expandedTeamGroups.has(groupKey);
                    const needsPagination = g.teams.length > TEAM_GROUP_CAP;
                    const shownTeams = needsPagination && !expanded ? g.teams.slice(0, TEAM_GROUP_CAP) : g.teams;
                    const hiddenCount = g.teams.length - shownTeams.length;
                    return (
                      <div key={groupKey} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Tag size={12} style={{ color: 'var(--s-gold)' }} />
                          <h3 className="t-label" style={{ color: 'var(--s-gold)' }}>
                            {g.displayLabel}
                          </h3>
                          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                            {g.teams.length} équipe{g.teams.length > 1 ? 's' : ''}
                          </span>
                          <div className="flex-1 h-px" style={{ background: 'var(--s-border)' }} />
                        </div>
                        <div className="space-y-3">
                          {shownTeams.map(t => renderTeamCard(t, false))}
                        </div>
                        {needsPagination && (
                          <button
                            type="button"
                            onClick={() => setExpandedTeamGroups(prev => {
                              const next = new Set(prev);
                              if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
                              return next;
                            })}
                            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors"
                            style={{ color: 'var(--s-text-dim)' }}
                          >
                            {expanded ? (
                              <>
                                <ChevronUp size={11} />
                                <span>Réduire</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown size={11} />
                                <span>Afficher les {hiddenCount} équipe{hiddenCount > 1 ? 's' : ''} suivante{hiddenCount > 1 ? 's' : ''}</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Section archivées (collapse) */}
                  {archivedCount > 0 && (
                    <div className="pt-2">
                      <button type="button" onClick={() => setShowArchived(!showArchived)}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors"
                        style={{ color: 'var(--s-text-dim)' }}>
                        <Archive size={12} />
                        <span>Archivées · {archivedCount}</span>
                        {showArchived ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                      {showArchived && (
                        <div className="mt-3 space-y-3">
                          {archivedTeams.length === 0 ? (
                            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune archive ne correspond à la recherche.</p>
                          ) : archivedTeams.map(t => renderTeamCard(t, true))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </SectionPanel>
              );
            })()}

            {/* ═══ Save button — onglet général uniquement (recrutement a son propre save in-panel) ═══ */}
            {tab === 'general' && isDirigeantOfActive && (<>
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

            {/* ═══ MEMBRES — Joueurs sans équipe + bannière nouvelle recrue ═══ */}
            {tab === 'members' && isDirigeantOfActive && (() => {
              // Uids assignés à une équipe active (player, sub, staff, capitaine)
              const assignedUids = new Set<string>();
              for (const t of teams) {
                if ((t.status ?? 'active') !== 'active') continue;
                for (const p of t.players) assignedUids.add(p.uid);
                for (const p of t.subs) assignedUids.add(p.uid);
                for (const p of t.staff) assignedUids.add(p.uid);
                if (t.captainId) assignedUids.add(t.captainId);
              }
              const unassigned = s.members.filter(m =>
                m.role !== 'fondateur' && m.role !== 'co_fondateur' && !assignedUids.has(m.userId)
              );
              if (unassigned.length === 0) return null;
              const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
              const recentRecruits = unassigned.filter(m => (m.joinedAt ?? 0) >= sevenDaysAgo);
              return (
                <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid rgba(255,184,0,0.35)' }}>
                  <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
                  <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)' }}>
                        <UserPlus size={13} style={{ color: 'var(--s-gold)' }} />
                      </div>
                      <div>
                        <span className="font-display text-sm tracking-wider">SANS ÉQUIPE</span>
                        {recentRecruits.length > 0 && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--s-gold)' }}>
                            {recentRecruits.length} nouvelle{recentRecruits.length > 1 ? 's' : ''} recrue{recentRecruits.length > 1 ? 's' : ''} cette semaine à placer
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="font-display text-lg" style={{ color: 'var(--s-gold)' }}>{unassigned.length}</span>
                  </div>
                  <div className="relative z-[1] divide-y" style={{ borderColor: 'var(--s-border)' }}>
                    {unassigned.map(m => {
                      const avatar = m.avatarUrl || m.discordAvatar;
                      const isRecentRecruit = (m.joinedAt ?? 0) >= sevenDaysAgo;
                      const daysSince = m.joinedAt ? Math.floor((Date.now() - m.joinedAt) / (24 * 60 * 60 * 1000)) : null;
                      return (
                        <div key={m.id} className="flex items-center gap-3 px-5 py-3">
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
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{m.displayName}</p>
                                <span className={`tag ${m.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                                  {m.game === 'rocket_league' ? 'RL' : 'TM'}
                                </span>
                                {isRecentRecruit && (
                                  <span className="tag" style={{ fontSize: '9px', padding: '2px 6px', background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.35)' }}>
                                    NOUVELLE RECRUE
                                  </span>
                                )}
                              </div>
                              {daysSince != null && (
                                <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                                  Rejoint il y a {daysSince === 0 ? "aujourd'hui" : `${daysSince}j`}
                                </p>
                              )}
                            </div>
                          </Link>
                          <button type="button" onClick={() => setTab('teams')}
                            className="text-xs font-semibold px-3 py-1.5 transition-colors duration-150 bevel-sm"
                            style={{ background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', border: '1px solid rgba(255,184,0,0.3)' }}>
                            Placer en équipe
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
                    {[...s.members]
                      .map(m => ({
                        m,
                        derived: computeMemberRole({
                          userId: m.userId,
                          founderId: s.founderId,
                          coFounderIds: s.coFounderIds ?? [],
                          managerIds: s.managerIds ?? [],
                          coachIds: s.coachIds ?? [],
                          teams: teams as unknown as MemberRoleTeam[],
                        }),
                      }))
                      .sort((a, b) =>
                        PRIMARY_ROLE_ORDER.indexOf(a.derived.primary) - PRIMARY_ROLE_ORDER.indexOf(b.derived.primary)
                      )
                      .map(({ m, derived }) => {
                      const avatar = m.avatarUrl || m.discordAvatar;
                      const primaryLabel = PRIMARY_ROLE_LABELS[derived.primary];
                      const affiliationBadges = groupAffiliations(derived.affiliations);
                      const isFounderRow = derived.primary === 'fondateur';
                      const isCoFounderRow = derived.primary === 'co_fondateur';
                      const isManagerRow = (s.managerIds ?? []).includes(m.userId);
                      const isCoachRow = (s.coachIds ?? []).includes(m.userId);
                      const structuralColor = PRIMARY_ROLE_COLORS[derived.primary];
                      const canRemove = !isFounderRow && !isCoFounderRow && isDirigeantOfActive;
                      const canManageStaffRoles = (isFounderOfActive || isCoFounderOfActive) && !isFounderRow;
                      const memberDepartureIso = s.coFounderDepartures?.[m.userId];
                      const memberRemainingMs = memberDepartureIso ? Math.max(0, new Date(memberDepartureIso).getTime() + DEPARTURE_NOTICE_MS - now) : null;
                      const daysLeft = memberRemainingMs != null ? Math.ceil(memberRemainingMs / (24 * 60 * 60 * 1000)) : null;
                      const badgeColors: Record<string, { bg: string; fg: string; border: string }> = {
                        manager: { bg: 'rgba(123,47,190,0.1)', fg: 'var(--s-violet-light)', border: 'rgba(123,47,190,0.3)' },
                        coach: { bg: 'rgba(0,129,255,0.1)', fg: '#4db1ff', border: 'rgba(0,129,255,0.3)' },
                        capitaine: { bg: 'rgba(255,184,0,0.1)', fg: 'var(--s-gold)', border: 'rgba(255,184,0,0.3)' },
                        joueur: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--s-text-dim)', border: 'var(--s-border)' },
                        remplacant: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--s-text-muted)', border: 'var(--s-border)' },
                      };
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
                                <p className="t-mono" style={{ fontSize: '10px', color: structuralColor }}>{primaryLabel}</p>
                                {affiliationBadges.map(b => {
                                  const c = badgeColors[b.key] ?? badgeColors.joueur;
                                  const names = b.teamNames.join(', ');
                                  return (
                                    <span key={b.key} className="tag" title={names}
                                      style={{ fontSize: '8px', padding: '1px 6px', background: c.bg, color: c.fg, borderColor: c.border }}>
                                      {b.label}
                                      {b.teamNames.length > 0 && (
                                        <span style={{ opacity: 0.75, marginLeft: 4 }}>· {names}</span>
                                      )}
                                    </span>
                                  );
                                })}
                                {isCoFounderRow && daysLeft != null && (
                                  <span className="tag" style={{ fontSize: '8px', padding: '1px 6px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                                    Préavis : {daysLeft}j
                                  </span>
                                )}
                              </div>
                            </div>
                          </Link>
                          <MemberActionsMenu
                            canManageStaffRoles={canManageStaffRoles}
                            canManageCoFounder={isFounderOfActive && !isFounderRow}
                            canRemove={canRemove}
                            isCoach={isCoachRow}
                            isManager={isManagerRow}
                            isCoFounder={isCoFounderRow}
                            busyKey={invActionLoading}
                            memberId={m.id}
                            userId={m.userId}
                            onToggleCoach={() => handleToggleStaffRole(m.userId, m.displayName, 'coach', !isCoachRow)}
                            onToggleManager={() => handleToggleStaffRole(m.userId, m.displayName, 'manager', !isManagerRow)}
                            onPromoteCoFounder={() => handlePromoteToCoFounder(m.userId, m.displayName)}
                            onDemoteCoFounder={() => handleDemoteCoFounder(m.userId, m.displayName)}
                            onTransferOwnership={() => handleTransferOwnership(m.userId, m.displayName)}
                            onRemove={() => handleRemoveMember(m.id, m.displayName)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ═══ MEMBRES — Historique d'appartenance (dirigeants only) — Phase 3 item N ═══ */}
            {tab === 'members' && (isDirigeantOfActive || isManagerOfActive) && (
            <div className="bevel relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
              <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-text-dim), rgba(122,122,149,0.3), transparent 70%)' }} />
              <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
                style={{ background: 'radial-gradient(circle at 100% 0%, rgba(122,122,149,0.06), transparent 70%)' }} />
              <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(122,122,149,0.08)', border: '1px solid rgba(122,122,149,0.2)' }}>
                    <Clock size={13} style={{ color: 'var(--s-text-dim)' }} />
                  </div>
                  <span className="font-display text-sm tracking-wider">HISTORIQUE</span>
                </div>
                <span className="font-display text-lg" style={{ color: 'var(--s-text-dim)' }}>{history.length}</span>
              </div>
              <div className="relative z-[1]">
                {historyLoading ? (
                  <div className="p-6 text-center">
                    <Loader2 size={16} className="animate-spin mx-auto" style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                ) : history.length === 0 ? (
                  <div className="p-6 text-center">
                    <Clock size={20} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun passage enregistré.</p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
                    {history.map(h => {
                      const avatar = h.avatarUrl || h.discordAvatar;
                      const joinLabel = h.joinedAt ? new Date(h.joinedAt).toLocaleDateString('fr-FR') : '—';
                      const leftLabel = h.leftAt ? new Date(h.leftAt).toLocaleDateString('fr-FR') : null;
                      const reasonMap: Record<string, string> = {
                        founder: 'Fondateur',
                        direct_invite: 'Invite directe',
                        join_request: 'Candidature',
                        invite_link: 'Lien',
                        targeted_link: 'Lien perso',
                        other: '—',
                      };
                      const leftReasonMap: Record<string, string> = {
                        removed: 'Retiré',
                        left: 'Parti',
                        structure_deleted: 'Structure dissoute',
                        other: '—',
                      };
                      return (
                        <div key={h.id} className="flex items-center gap-3 px-5 py-3 group transition-all duration-150"
                          style={{ background: 'transparent' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-elevated)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <Link href={`/profile/${h.userId}`} className="flex items-center gap-3 flex-1 min-w-0">
                            {avatar ? (
                              <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <Image src={avatar} alt={h.displayName} fill className="object-cover" unoptimized />
                              </div>
                            ) : (
                              <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                                <User size={12} style={{ color: 'var(--s-text-muted)' }} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{h.displayName || h.userId}</p>
                                <span className={`tag ${h.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '12px', padding: '2px 8px' }}>
                                  {h.game === 'rocket_league' ? 'RL' : 'TM'}
                                </span>
                                {h.isOpen ? (
                                  <span className="tag" style={{ fontSize: '12px', padding: '2px 8px', background: 'rgba(0,217,54,0.12)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.35)' }}>
                                    Actif
                                  </span>
                                ) : (
                                  <span className="tag" style={{ fontSize: '12px', padding: '2px 8px', background: 'rgba(255,85,85,0.1)', color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                                    {leftReasonMap[h.leftReason || 'other'] || 'Parti'}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
                                {reasonMap[h.joinReason] || '—'} · {joinLabel}
                                {leftLabel && ` → ${leftLabel}`}
                                {h.durationDays != null && ` · ${h.durationDays}j`}
                              </p>
                            </div>
                          </Link>
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
                <p className="t-label mt-1 relative z-[1]">ÉQUIPES RL</p>
              </div>
              <div className="bevel-sm p-4 text-center relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(0,217,54,0.06), transparent 70%)' }} />
                <p className="font-display text-2xl relative z-[1]" style={{ color: 'var(--s-green)' }}>{teams.filter(t => t.game === 'trackmania').length}</p>
                <p className="t-label mt-1 relative z-[1]">ÉQUIPES TM</p>
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
            structureLogoUrl={s.logoUrl}
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
