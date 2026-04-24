import { useState } from 'react';
import Image from 'next/image';
import {
  User, Trash2, ChevronUp, ChevronDown, Crown, type LucideIcon,
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

// ─── Slot roster joueurs (titulaires/remplaçants) avec capitaine ──────
export function RosterSlot({
  label, labelColor, members, available, canAdd, loading, onAdd, onRemove, captainId,
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

// ─── Slot staff : role picker (Coach/Manager) à l'ajout + toggle live ─
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
                  fontSize: '10px', padding: '2px 7px', letterSpacing: '0.06em', textTransform: 'uppercase',
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
