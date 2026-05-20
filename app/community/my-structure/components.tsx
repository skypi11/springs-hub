import { useState } from 'react';
import Image from 'next/image';
import {
  User, ChevronUp, ChevronDown, Crown, X, Plus, type LucideIcon,
} from 'lucide-react';
import { TAB_DEFS } from './constants';
import type { DashboardTab } from './types';

// ─── Onglets de navigation du dashboard structure ──────────────────────
export function TabBar({
  active, onChange, visible,
}: {
  active: DashboardTab;
  onChange: (t: DashboardTab) => void;
  visible: DashboardTab[];
}) {
  const tabsToShow = TAB_DEFS.filter(t => visible.includes(t.key));
  return (
    <div className="flex items-end gap-1 relative flex-wrap" style={{ borderBottom: '1px solid var(--s-border)' }}>
      {tabsToShow.map(t => {
        const isActive = active === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className="relative font-display text-sm tracking-wider transition-all duration-150 cursor-pointer px-3 py-2 sm:px-5 sm:py-2.5"
            style={{
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

// ─── Panel pliable avec accent + glow Springs ──────────────────────────
export function SectionPanel({
  accent, icon: Icon, title, action, children, collapsed, onToggle,
}: {
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
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}50, transparent 70%)` }} />
      <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none"
        style={{ background: `radial-gradient(circle at 100% 0%, ${accent}08, transparent 70%)` }} />
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
          {!collapsed && action && <div onClick={e => e.stopPropagation()}>{action}</div>}
          {onToggle && (
            <div className="w-6 h-6 flex items-center justify-center" style={{ color: 'var(--s-text-muted)' }}>
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </div>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="relative z-[1] p-5">
          {children}
        </div>
      )}
    </div>
  );
}

type RosterMember = { uid: string; displayName: string; avatarUrl: string; discordAvatar: string };
type RosterAvailable = { id: string; userId: string; displayName: string; avatarUrl: string; discordAvatar: string };

// ─── Carte "slot rempli" : un membre dans un roster ───────────────────
function FilledMemberSlot({
  member, isCaptain, badge, loading, onRemove,
}: {
  member: RosterMember;
  isCaptain?: boolean;
  badge?: React.ReactNode;       // pastille rôle pour le staff (Coach/Mgr)
  loading: boolean;
  onRemove: () => void;
}) {
  const avatar = member.avatarUrl || member.discordAvatar;
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
    >
      {avatar ? (
        <Image src={avatar} alt={member.displayName} width={28} height={28}
          className="flex-shrink-0 bevel-sm" unoptimized />
      ) : (
        <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center bevel-sm"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <User size={14} style={{ color: 'var(--s-text-muted)' }} />
        </div>
      )}
      <span className="text-sm truncate flex-1" style={{ color: 'var(--s-text)' }}>
        {member.displayName}
      </span>
      {isCaptain && (
        <span title="Capitaine"
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center bevel-sm"
          style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', border: '1px solid rgba(255,184,0,0.3)' }}>
          <Crown size={11} />
        </span>
      )}
      {badge}
      <button
        type="button"
        onClick={onRemove}
        disabled={loading}
        title="Retirer de l'équipe"
        className="flex-shrink-0 p-1 text-[var(--s-text-muted)] hover:text-[#ff5555] transition-colors disabled:opacity-40"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Slot vide : placeholder pointillé "+ Ajouter …" (select natif) ───
function EmptyAddSlot({
  emptyLabel, available, loading, onAdd,
}: {
  emptyLabel: string;
  available: RosterAvailable[];
  loading: boolean;
  onAdd: (uid: string) => void;
}) {
  if (available.length === 0) {
    return (
      <div
        className="flex items-center justify-center gap-1.5 px-2 py-2 text-xs"
        style={{ border: '1px dashed var(--s-border)', color: 'var(--s-text-muted)' }}
      >
        Aucun joueur disponible
      </div>
    );
  }
  return (
    <div
      className="relative flex items-center transition-colors"
      style={{ border: '1px dashed rgba(255,255,255,0.18)' }}
    >
      <Plus size={13} className="absolute left-2.5 pointer-events-none" style={{ color: 'var(--s-text-dim)' }} />
      <select
        value=""
        disabled={loading}
        onChange={e => { if (e.target.value) onAdd(e.target.value); }}
        className="w-full cursor-pointer bg-transparent text-xs"
        style={{ color: 'var(--s-text-dim)', padding: '8px 8px 8px 28px' }}
      >
        <option value="">{loading ? 'Chargement…' : `Ajouter ${emptyLabel}`}</option>
        {available.map(m => (
          <option key={m.userId} value={m.userId}>{m.displayName}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Slot roster joueurs (titulaires/remplaçants) avec capitaine ──────
// `capacity` défini (RL) → on affiche les slots vides jusqu'à la capacité.
// `capacity` undefined (TM, illimité) → un seul slot d'ajout après les membres.
export function RosterSlot({
  label, labelColor, members, available, canAdd, loading, onAdd, onRemove, captainId,
  capacity, emptyLabel = 'un membre',
}: {
  label: string;
  labelColor: string;
  members: RosterMember[];
  available: RosterAvailable[];
  canAdd: boolean;
  loading: boolean;
  onAdd: (uid: string) => void;
  onRemove: (uid: string) => void;
  captainId?: string | null;
  capacity?: number;
  emptyLabel?: string;
}) {
  const filled = members.length;
  const emptySlots = canAdd
    ? (capacity !== undefined ? Math.max(0, capacity - filled) : 1)
    : 0;
  const isFull = capacity !== undefined && filled >= capacity;

  return (
    <div className="p-3" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="t-label" style={{ color: labelColor }}>{label}</p>
        {capacity !== undefined && (
          <span
            className="t-mono font-bold"
            style={{ fontSize: '12px', color: isFull ? 'var(--s-green)' : 'var(--s-gold)' }}
          >
            {filled}/{capacity}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {members.map(p => (
          <FilledMemberSlot
            key={p.uid}
            member={p}
            isCaptain={!!captainId && captainId === p.uid}
            loading={loading}
            onRemove={() => onRemove(p.uid)}
          />
        ))}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <EmptyAddSlot
            key={`empty-${i}`}
            emptyLabel={emptyLabel}
            available={available}
            loading={loading}
            onAdd={onAdd}
          />
        ))}
        {filled === 0 && emptySlots === 0 && (
          <p className="text-xs text-center py-2" style={{ color: 'var(--s-text-muted)' }}>
            Aucun membre
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Slot staff : role picker (Coach/Manager) à l'ajout + toggle live ─
// Pas de capacité (illimité). Slots remplis = même carte que les joueurs,
// avec une pastille Coach/Mgr cliquable à la place du badge capitaine.
export function StaffRosterSlot({
  label, labelColor, members, staffRoles, available, canAdd, loading, onAdd, onRemove, onChangeRole,
}: {
  label: string;
  labelColor: string;
  members: RosterMember[];
  staffRoles: Record<string, 'coach' | 'manager'>;
  available: RosterAvailable[];
  canAdd: boolean;
  loading: boolean;
  onAdd: (uid: string, role: 'coach' | 'manager') => void;
  onRemove: (uid: string) => void;
  onChangeRole: (uid: string, role: 'coach' | 'manager') => void;
}) {
  const [pendingUid, setPendingUid] = useState('');
  const [pendingRole, setPendingRole] = useState<'coach' | 'manager'>('coach');
  return (
    <div className="p-3" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="t-label" style={{ color: labelColor }}>{label}</p>
        {members.length > 0 && (
          <span className="t-mono font-bold" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
            {members.length}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {members.map(p => {
          const role = staffRoles[p.uid] ?? 'coach';
          const isManager = role === 'manager';
          const pillBg = isManager ? 'rgba(255,184,0,0.15)' : 'rgba(0,129,255,0.12)';
          const pillFg = isManager ? 'var(--s-gold)' : '#4db1ff';
          const pillBorder = isManager ? 'rgba(255,184,0,0.35)' : 'rgba(0,129,255,0.3)';
          return (
            <FilledMemberSlot
              key={p.uid}
              member={p}
              loading={loading}
              onRemove={() => onRemove(p.uid)}
              badge={
                <button type="button"
                  onClick={() => onChangeRole(p.uid, isManager ? 'coach' : 'manager')}
                  disabled={loading}
                  title={isManager ? 'Passer en Coach' : 'Passer en Manager'}
                  className="flex-shrink-0 bevel-sm"
                  style={{
                    fontSize: '12px', padding: '3px 8px', letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontWeight: 700,
                    background: pillBg, color: pillFg, border: `1px solid ${pillBorder}`, cursor: 'pointer',
                  }}>
                  {isManager ? 'Mgr' : 'Coach'}
                </button>
              }
            />
          );
        })}
        {members.length === 0 && (!canAdd || available.length === 0) && (
          <p className="text-xs text-center py-2" style={{ color: 'var(--s-text-muted)' }}>
            Aucun staff
          </p>
        )}
      </div>
      {canAdd && available.length > 0 && (
        <div className="mt-2 p-2 space-y-2" style={{ border: '1px dashed rgba(255,255,255,0.18)' }}>
          <select
            className="settings-input w-full"
            style={{ padding: '6px 8px', fontSize: '12px' }}
            value={pendingUid}
            disabled={loading}
            onChange={e => setPendingUid(e.target.value)}>
            <option value="">{loading ? 'Chargement…' : '+ Ajouter du staff'}</option>
            {available.map(m => (
              <option key={m.userId} value={m.userId}>{m.displayName}</option>
            ))}
          </select>
          {pendingUid && (
            <div className="flex items-center gap-1.5">
              <select
                className="settings-input flex-1"
                style={{ padding: '6px 8px', fontSize: '12px' }}
                value={pendingRole}
                disabled={loading}
                onChange={e => setPendingRole(e.target.value as 'coach' | 'manager')}>
                <option value="coach">Coach</option>
                <option value="manager">Manager</option>
              </select>
              <button type="button"
                disabled={loading}
                onClick={() => { onAdd(pendingUid, pendingRole); setPendingUid(''); setPendingRole('coach'); }}
                className="bevel-sm"
                style={{
                  fontSize: '12px', padding: '6px 14px', fontWeight: 700,
                  background: 'var(--s-gold)', color: '#0a0a13',
                  border: '1px solid var(--s-gold)', cursor: 'pointer',
                }}>
                Ajouter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Chip action dans les cards équipe (drawer détail) ────────────────
export function TeamActionChip({
  icon, label, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
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
