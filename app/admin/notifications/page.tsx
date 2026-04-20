'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  Bell, Loader2, Send, CheckCircle2, AlertCircle, History,
} from 'lucide-react';

type Recent = {
  id: string;
  userId: string;
  userName: string;
  type: string;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string | null;
};

type NotifData = {
  stats: {
    total: number;
    unread: number;
    last7d: number;
    byType: { type: string; count: number }[];
  };
  recent: Recent[];
  truncated: boolean;
};

type Audience = 'all' | 'user' | 'structure';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminNotificationsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<NotifData | null>(null);
  const [loading, setLoading] = useState(true);

  const [audience, setAudience] = useState<Audience>('user');
  const [targetId, setTargetId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<NotifData>('/api/admin/notifications'));
    } catch (err) {
      console.error('[Admin/Notifications] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser) return;
    setSending(true);
    setResult(null);
    try {
      const json = await api<{ sent: number }>('/api/admin/notifications', {
        method: 'POST',
        body: {
          title, message, link,
          audience,
          targetId: audience === 'all' ? '' : targetId,
        },
      });
      setResult({ ok: true, text: `${json.sent} notif(s) envoyée(s)` });
      setTitle(''); setMessage(''); setLink('');
      load();
    } catch (err) {
      setResult({ ok: false, text: err instanceof ApiError ? err.message : 'Erreur réseau' });
    }
    setSending(false);
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          NOTIFICATIONS
        </h2>
        {data.truncated && <span className="tag tag-gold">Résultats tronqués</span>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Bell size={14} />}
          label="Chargées (derniers)"
          value={data.stats.total}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<Bell size={14} />}
          label="Non lues"
          value={data.stats.unread}
          color={data.stats.unread > 0 ? '#FFB800' : 'var(--s-text-dim)'}
        />
        <StatCard
          icon={<History size={14} />}
          label="Envoyées 7j"
          value={data.stats.last7d}
          color="var(--s-violet-light)"
        />
        <StatCard
          icon={<Bell size={14} />}
          label="Types distincts"
          value={data.stats.byType.length}
          color="var(--s-text-dim)"
        />
      </div>

      {/* Formulaire d'envoi */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send size={14} style={{ color: 'var(--s-violet-light)' }} />
          <span className="t-label">Envoyer une notification</span>
        </div>

        <form onSubmit={handleSend} className="space-y-3">
          <div className="flex gap-1 flex-wrap">
            {([
              { value: 'user',      label: 'Un utilisateur (UID)' },
              { value: 'structure', label: 'Une structure (ID)' },
              { value: 'all',       label: 'TOUS les utilisateurs' },
            ] as const).map(a => (
              <button key={a.value} type="button" onClick={() => setAudience(a.value)}
                className="tag transition-all duration-150"
                style={{
                  background: audience === a.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                  color: audience === a.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                  borderColor: audience === a.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                  cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
                }}>
                {a.label}
              </button>
            ))}
          </div>

          {audience !== 'all' && (
            <input
              type="text"
              value={targetId}
              onChange={e => setTargetId(e.target.value)}
              placeholder={audience === 'user' ? 'discord_123456789…' : 'structureId'}
              className="settings-input w-full"
              style={{ fontSize: '12px' }}
              required
            />
          )}

          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Titre (120 car. max)"
            maxLength={120}
            className="settings-input w-full"
            style={{ fontSize: '13px' }}
            required
          />

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message (500 car. max)"
            maxLength={500}
            rows={3}
            className="settings-input w-full"
            style={{ fontSize: '13px', resize: 'vertical' }}
            required
          />

          <input
            type="text"
            value={link}
            onChange={e => setLink(e.target.value)}
            placeholder="Lien (optionnel, ex: /competitions/rl/xxx)"
            className="settings-input w-full"
            style={{ fontSize: '12px' }}
          />

          {audience === 'all' && (
            <div className="flex items-start gap-2 p-2" style={{
              background: 'rgba(255,184,0,0.08)',
              border: '1px solid rgba(255,184,0,0.3)',
              borderRadius: '3px',
            }}>
              <AlertCircle size={14} style={{ color: '#FFB800', flexShrink: 0, marginTop: '2px' }} />
              <p className="text-xs" style={{ color: '#FFB800' }}>
                Broadcast global : sera envoyé à TOUS les utilisateurs non bannis (max 2000). À utiliser avec parcimonie.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={sending}
              className="btn-springs btn-primary bevel-sm"
              style={{ fontSize: '12px', padding: '8px 16px', opacity: sending ? 0.6 : 1 }}>
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {sending ? 'Envoi…' : 'Envoyer'}
            </button>
            {result && (
              <div className="flex items-center gap-1.5 text-xs" style={{ color: result.ok ? '#33ff66' : '#ff5555' }}>
                {result.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {result.text}
              </div>
            )}
          </div>
        </form>
      </div>

      {/* Historique récent */}
      <div className="flex items-center gap-2 mt-4">
        <History size={14} style={{ color: 'var(--s-text-dim)' }} />
        <span className="t-label">Dernières notifications ({data.recent.length})</span>
      </div>

      <div className="space-y-2">
        {data.recent.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucune notification envoyée.
            </p>
          </div>
        )}
        {data.recent.map(n => (
          <div key={n.id} className="panel p-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{
                background: n.read ? 'var(--s-elevated)' : 'rgba(123,47,190,0.15)',
              }}>
                <Bell size={14} style={{ color: n.read ? 'var(--s-text-muted)' : 'var(--s-violet-light)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{n.title || '(sans titre)'}</span>
                  <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                    {n.type}
                  </span>
                  {!n.read && (
                    <span className="tag tag-gold" style={{ fontSize: '9px', padding: '1px 6px' }}>
                      NON LUE
                    </span>
                  )}
                </div>
                {n.message && (
                  <p className="t-body text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                    {n.message}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  <span>{formatDate(n.createdAt)}</span>
                  <span className="flex items-center gap-1.5">
                    <span>pour</span>
                    <AdminUserRef uid={n.userId} name={n.userName} layout="inline" />
                  </span>
                  {n.link && (
                    <Link href={n.link} className="hover:underline" style={{ color: 'var(--s-violet-light)' }}>
                      {n.link}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5" style={{ color }}>
        {icon}
        <span className="t-label">{label}</span>
      </div>
      <p className="font-display text-2xl mt-1" style={{ letterSpacing: '0.04em', color }}>
        {value}
      </p>
    </div>
  );
}
