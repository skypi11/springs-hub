'use client';

import { useEffect, useState } from 'react';
import { X, CalendarClock, ClipboardList, Film } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import type { UserContext } from '@/lib/event-permissions';
import TeamAvailabilityView from './TeamAvailabilityView';
import TeamTodosPanel from './TeamTodosPanel';
import ReplaysPanel from '@/components/replays/ReplaysPanel';

export type DrawerTab = 'availability' | 'todos' | 'replays';

type TeamMember = {
  uid: string;
  displayName: string;
  avatarUrl: string;
  discordAvatar: string;
};

export type DrawerTeam = {
  id: string;
  name: string;
  game: string;
  players: TeamMember[];
  subs: TeamMember[];
  staff: TeamMember[];
};

export default function TeamDetailDrawer({
  open,
  onClose,
  structureId,
  team,
  initialTab,
  canEditConfig,
  userContext,
}: {
  open: boolean;
  onClose: () => void;
  structureId: string;
  team: DrawerTeam | null;
  initialTab: DrawerTab;
  canEditConfig: boolean;
  userContext: UserContext;
}) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<DrawerTab>(initialTab);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || !team) return null;

  const gameColor = team.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
  const gameLabel = team.game === 'rocket_league' ? 'RL' : 'TM';

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9500,
          display: 'flex',
          justifyContent: 'flex-end',
          background: visible ? 'rgba(4,4,8,0.72)' : 'rgba(4,4,8,0)',
          transition: 'background 0.25s ease',
        }}
        onClick={onClose}
      >
        <aside
          onClick={e => e.stopPropagation()}
          style={{
            width: 'min(920px, 94vw)',
            height: '100%',
            background: 'var(--s-surface)',
            borderLeft: '1px solid var(--s-border)',
            boxShadow: '-24px 0 64px rgba(0,0,0,0.55)',
            transform: visible ? 'translateX(0)' : 'translateX(24px)',
            opacity: visible ? 1 : 0,
            transition: 'transform 0.25s ease, opacity 0.25s ease',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Accent bar */}
          <div className="h-[3px] flex-shrink-0" style={{ background: `linear-gradient(90deg, ${gameColor}, transparent 70%)` }} />

          {/* Header */}
          <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--s-border)' }}>
            <div className="flex items-center gap-3 min-w-0">
              <span className={`tag ${team.game === 'rocket_league' ? 'tag-blue' : 'tag-green'}`} style={{ fontSize: '10px', padding: '3px 8px' }}>
                {gameLabel}
              </span>
              <h2 className="font-display text-2xl truncate" style={{ letterSpacing: '0.04em', color: 'var(--s-text)' }}>
                {team.name}
              </h2>
              <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
                · {team.players.length + team.subs.length} joueur{team.players.length + team.subs.length > 1 ? 's' : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center transition-opacity duration-150 hover:opacity-100"
              aria-label="Fermer"
              style={{
                width: 36,
                height: 36,
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                color: 'var(--s-text-dim)',
                opacity: 0.85,
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </header>

          {/* Tabs */}
          <div className="flex flex-shrink-0 px-6" style={{ borderBottom: '1px solid var(--s-border)', gap: 4 }}>
            <TabButton
              label="DISPOS & MATCHING"
              icon={<CalendarClock size={14} />}
              active={tab === 'availability'}
              onClick={() => setTab('availability')}
            />
            <TabButton
              label="DEVOIRS"
              icon={<ClipboardList size={14} />}
              active={tab === 'todos'}
              onClick={() => setTab('todos')}
            />
            <TabButton
              label="REPLAYS"
              icon={<Film size={14} />}
              active={tab === 'replays'}
              onClick={() => setTab('replays')}
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden' }}>
            <div className="px-6 py-6">
              {tab === 'availability' && (
                <TeamAvailabilityView
                  structureId={structureId}
                  teamId={team.id}
                  canEditConfig={canEditConfig}
                />
              )}
              {tab === 'todos' && (
                <TeamTodosPanel
                  structureId={structureId}
                  team={{
                    id: team.id,
                    name: team.name,
                    players: team.players,
                    subs: team.subs,
                    staff: team.staff,
                  }}
                  embedded
                />
              )}
              {tab === 'replays' && (
                <ReplaysPanel
                  structureId={structureId}
                  teamId={team.id}
                  eventId={null}
                  mode="library"
                  userContext={userContext}
                />
              )}
            </div>
          </div>
        </aside>
      </div>
    </Portal>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-3 t-label transition-all duration-150"
      style={{
        fontSize: '12px',
        color: active ? 'var(--s-text)' : 'var(--s-text-muted)',
        borderBottom: `2px solid ${active ? 'var(--s-gold)' : 'transparent'}`,
        marginBottom: '-1px',
        cursor: 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
