'use client';

import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical, Shield, ChevronUp, ChevronDown, UserMinus,
  Loader2, UserCog, Briefcase,
} from 'lucide-react';

export interface MemberActionsMenuProps {
  canManageStaffRoles: boolean;
  canManageCoFounder: boolean;
  canRemove: boolean;
  isCoach: boolean;
  isManager: boolean;
  isCoFounder: boolean;
  busyKey: string | null;
  memberId: string;
  userId: string;
  onToggleCoach: () => void;
  onToggleManager: () => void;
  onPromoteCoFounder: () => void;
  onDemoteCoFounder: () => void;
  onTransferOwnership: () => void;
  onRemove: () => void;
}

export default function MemberActionsMenu(props: MemberActionsMenuProps) {
  const {
    canManageStaffRoles, canManageCoFounder, canRemove,
    isCoach, isManager, isCoFounder,
    busyKey, memberId, userId,
    onToggleCoach, onToggleManager,
    onPromoteCoFounder, onDemoteCoFounder, onTransferOwnership,
    onRemove,
  } = props;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hasAnyAction = canManageStaffRoles || canManageCoFounder || canRemove;
  if (!hasAnyAction) return null;

  const anyBusy = busyKey !== null && (
    busyKey === memberId || busyKey === userId ||
    busyKey === `${userId}:coach` || busyKey === `${userId}:manager`
  );

  const items: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
    accent?: boolean;
    busy?: boolean;
  }> = [];

  if (canManageStaffRoles) {
    items.push({
      key: 'toggle-coach',
      label: isCoach ? 'Retirer Coach' : 'Promouvoir Coach',
      icon: <UserCog size={13} style={{ color: isCoach ? '#ff8888' : '#4db1ff' }} />,
      onClick: onToggleCoach,
      busy: busyKey === `${userId}:coach`,
    });
    items.push({
      key: 'toggle-manager',
      label: isManager ? 'Retirer Manager' : 'Promouvoir Manager',
      icon: <Briefcase size={13} style={{ color: isManager ? '#ff8888' : 'var(--s-violet-light)' }} />,
      onClick: onToggleManager,
      busy: busyKey === `${userId}:manager`,
    });
  }

  if (canManageCoFounder) {
    if (isCoFounder) {
      items.push({
        key: 'transfer',
        label: 'Transférer la propriété',
        icon: <Shield size={13} style={{ color: 'var(--s-gold)' }} />,
        onClick: onTransferOwnership,
        accent: true,
        busy: busyKey === userId,
      });
      items.push({
        key: 'demote',
        label: 'Rétrograder co-fondateur',
        icon: <ChevronDown size={13} style={{ color: 'var(--s-text-dim)' }} />,
        onClick: onDemoteCoFounder,
        busy: busyKey === userId,
      });
    } else {
      items.push({
        key: 'promote',
        label: 'Promouvoir co-fondateur',
        icon: <ChevronUp size={13} style={{ color: 'var(--s-gold)' }} />,
        onClick: onPromoteCoFounder,
        accent: true,
        busy: busyKey === userId,
      });
    }
  }

  if (canRemove) {
    items.push({
      key: 'remove',
      label: 'Retirer de la structure',
      icon: <UserMinus size={13} style={{ color: '#ff5555' }} />,
      onClick: onRemove,
      danger: true,
      busy: busyKey === memberId,
    });
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        disabled={anyBusy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        className="w-7 h-7 flex items-center justify-center transition-colors duration-150"
        style={{
          background: open ? 'var(--s-hover)' : 'transparent',
          border: `1px solid ${open ? 'rgba(255,255,255,0.18)' : 'var(--s-border)'}`,
          color: 'var(--s-text-dim)',
        }}
      >
        {anyBusy
          ? <Loader2 size={13} className="animate-spin" />
          : <MoreVertical size={14} />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 z-20 py-1 min-w-[220px] animate-fade-in"
          style={{
            background: 'var(--s-elevated)',
            border: '1px solid var(--s-border)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {items.map((it, idx) => {
            const needsDivider = (
              (it.key === 'promote' || it.key === 'transfer') && idx > 0
            ) || it.key === 'remove';
            return (
              <div key={it.key}>
                {needsDivider && (
                  <div className="my-1" style={{ height: 1, background: 'var(--s-border)' }} />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={!!it.busy}
                  onClick={() => { it.onClick(); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors duration-150 disabled:opacity-50"
                  style={{
                    color: it.danger ? '#ff8888' : it.accent ? 'var(--s-gold)' : 'var(--s-text)',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--s-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {it.busy ? <Loader2 size={12} className="animate-spin" /> : it.icon}
                  </span>
                  <span className="flex-1">{it.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
