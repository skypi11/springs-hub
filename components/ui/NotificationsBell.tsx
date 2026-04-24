'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Check, UserPlus, CheckCircle2, XCircle, Calendar, Trophy, Inbox, Clock,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from './Toast';
import Portal from './Portal';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAtMs: number | null;
};

function formatAgo(ms: number | null): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} j`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} sem.`;
  return `${Math.floor(days / 30)} mois`;
}

function iconFor(type: string) {
  switch (type) {
    case 'join_request_received': return { Icon: UserPlus, color: 'var(--s-violet-light)' };
    case 'join_request_accepted': return { Icon: CheckCircle2, color: 'var(--s-gold)' };
    case 'join_request_declined': return { Icon: XCircle, color: '#ef4444' };
    case 'invitation_expired': return { Icon: Clock, color: 'var(--s-text-muted)' };
    case 'invitation': return { Icon: UserPlus, color: 'var(--s-violet-light)' };
    case 'new_event': return { Icon: Calendar, color: 'var(--s-blue)' };
    case 'new_competition': return { Icon: Trophy, color: 'var(--s-gold)' };
    default: return { Icon: Bell, color: 'var(--s-text-dim)' };
  }
}

export default function NotificationsBell() {
  const router = useRouter();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const uid = user?.uid ?? null;
  const queryKey = ['notifications', uid] as const;
  const { data, isPending: loading } = useQuery({
    queryKey,
    queryFn: () => api<{ notifications: Notification[]; unread: number }>('/api/notifications'),
    enabled: !!user,
  });
  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!uid) return;
    // Live updates: skip le premier fire (déjà couvert par useQuery initial)
    let first = true;
    const q = query(collection(db, 'notifications'), where('userId', '==', uid));
    const unsub = onSnapshot(q, () => {
      if (first) { first = false; return; }
      qc.invalidateQueries({ queryKey: ['notifications', uid] });
    }, () => {
      // silent on error
    });
    return () => unsub();
  }, [uid, qc]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  async function handleClick(n: Notification) {
    try {
      if (!n.read) {
        await api('/api/notifications', {
          method: 'POST',
          body: { action: 'mark_read', notificationId: n.id },
        });
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossible de marquer comme lue');
    }
    setOpen(false);
    if (n.link) router.push(n.link);
    // reload sera déclenché par onSnapshot
  }

  async function markAllRead() {
    try {
      await api('/api/notifications', {
        method: 'POST',
        body: { action: 'mark_all_read' },
      });
      qc.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossible de tout marquer comme lu');
    }
  }

  if (!user) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 flex items-center justify-center transition-colors duration-150"
        style={{
          background: open ? 'var(--s-hover)' : 'var(--s-elevated)',
          border: '1px solid var(--s-border)',
          color: unread > 0 ? 'var(--s-gold)' : 'var(--s-text-dim)',
        }}
        aria-label="Notifications"
        title={unread > 0 ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Notifications'}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center font-bold px-1"
            style={{
              background: 'var(--s-gold)',
              color: '#000',
              fontSize: '12px',
              lineHeight: 1,
              border: '2px solid var(--s-surface)',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <Portal>
          <div
            ref={panelRef}
            className="fixed z-[90] flex flex-col bevel-sm animate-fade-in"
            style={{
              left: '270px',
              bottom: '88px',
              width: '360px',
              maxHeight: '70vh',
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(123,47,190,0.1)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: '1px solid var(--s-border)' }}
            >
              <div className="flex items-center gap-2">
                <Bell size={14} style={{ color: 'var(--s-violet-light)' }} />
                <span className="t-sub" style={{ color: 'var(--s-text)' }}>Notifications</span>
                {unread > 0 && (
                  <span
                    className="font-display px-1.5"
                    style={{
                      fontSize: '11px',
                      color: 'var(--s-gold)',
                      background: 'rgba(255,184,0,0.1)',
                      border: '1px solid rgba(255,184,0,0.25)',
                    }}
                  >
                    {unread}
                  </span>
                )}
              </div>
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 px-2 py-1 text-xs transition-colors duration-150"
                  style={{ color: 'var(--s-text-dim)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s-text)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s-text-dim)'; }}
                >
                  <Check size={12} />
                  Tout lu
                </button>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="w-12 h-12 mx-auto flex items-center justify-center mb-3"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                    <Inbox size={20} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                  <p className="text-sm font-semibold mb-1" style={{ color: 'var(--s-text)' }}>
                    Aucune notification
                  </p>
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Tu seras prévenu ici quand ça bouge.
                  </p>
                </div>
              ) : (
                notifications.map((n) => {
                  const { Icon, color } = iconFor(n.type);
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors duration-150"
                      style={{
                        background: n.read ? 'transparent' : 'rgba(123,47,190,0.06)',
                        borderBottom: '1px solid var(--s-border)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--s-elevated)'; }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(123,47,190,0.06)';
                      }}
                    >
                      <div
                        className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{
                          background: `color-mix(in srgb, ${color} 12%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
                        }}
                      >
                        <Icon size={14} style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p
                            className="text-sm font-semibold truncate"
                            style={{ color: 'var(--s-text)' }}
                          >
                            {n.title}
                          </p>
                          {!n.read && (
                            <span
                              className="w-1.5 h-1.5 flex-shrink-0"
                              style={{ background: 'var(--s-gold)', borderRadius: '50%' }}
                            />
                          )}
                        </div>
                        <p
                          className="text-xs mb-1"
                          style={{ color: 'var(--s-text-dim)', lineHeight: 1.4 }}
                        >
                          {n.message}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          {formatAgo(n.createdAtMs)}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
