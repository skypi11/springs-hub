'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import {
  MessagesSquare, Loader2, Users, Image as ImageIcon, MapPin,
  CheckCircle2, AlertCircle, Send, Gamepad2,
} from 'lucide-react';

type DiscordData = {
  stats: {
    totalDiscord: number;
    withAvatar: number;
    withBio: number;
    withCountry: number;
    withRlProfile: number;
    withTmProfile: number;
    banned: number;
    active: number;
  };
  signupsByMonth: { ym: string; count: number }[];
  truncated: boolean;
  env: { redirectUri: string };
};

function pct(a: number, b: number): string {
  if (b === 0) return '0%';
  return `${Math.round((a / b) * 100)}%`;
}

export default function AdminDiscordPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<DiscordData | null>(null);
  const [loading, setLoading] = useState(true);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [message, setMessage] = useState('Test depuis Aedral — si tu vois ce message, le webhook marche.');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<DiscordData>('/api/admin/discord'));
    } catch (err) {
      console.error('[Admin/Discord] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser) return;
    setSending(true);
    setResult(null);
    try {
      await api('/api/admin/discord', {
        method: 'POST',
        body: { webhookUrl, message },
      });
      setResult({ ok: true, text: 'Webhook envoyé avec succès' });
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

  const { stats } = data;
  const maxSignups = Math.max(1, ...data.signupsByMonth.map(m => m.count));

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          DISCORD
        </h2>
        {data.truncated && <span className="tag tag-gold">Scan tronqué</span>}
      </div>

      <div className="panel p-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Tous les utilisateurs du Hub se connectent via Discord OAuth. Redirect URI configurée :
          <span className="t-mono ml-1" style={{ color: 'var(--s-text-dim)' }}>{data.env.redirectUri}</span>
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Users size={14} />}
          label="Users Discord"
          value={stats.totalDiscord}
          color="var(--s-violet-light)"
        />
        <StatCard
          icon={<Users size={14} />}
          label="Actifs"
          value={stats.active}
          sub={`${stats.banned} banni(s)`}
          color="#33ff66"
        />
        <StatCard
          icon={<ImageIcon size={14} />}
          label="Avatar"
          value={stats.withAvatar}
          sub={pct(stats.withAvatar, stats.totalDiscord)}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<MessagesSquare size={14} />}
          label="Bio remplie"
          value={stats.withBio}
          sub={pct(stats.withBio, stats.totalDiscord)}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<MapPin size={14} />}
          label="Pays renseigné"
          value={stats.withCountry}
          sub={pct(stats.withCountry, stats.totalDiscord)}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<Gamepad2 size={14} />}
          label="Profil RL"
          value={stats.withRlProfile}
          sub={pct(stats.withRlProfile, stats.totalDiscord)}
          color="#0081FF"
        />
        <StatCard
          icon={<Gamepad2 size={14} />}
          label="Profil TM"
          value={stats.withTmProfile}
          sub={pct(stats.withTmProfile, stats.totalDiscord)}
          color="#00D936"
        />
      </div>

      {/* Inscriptions par mois */}
      {data.signupsByMonth.length > 0 && (
        <div className="panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="t-label">Inscriptions — 12 derniers mois</span>
          </div>
          <div className="flex items-end gap-1 h-24">
            {data.signupsByMonth.map(m => (
              <div key={m.ym} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="text-xs" style={{ color: 'var(--s-text-dim)' }}>{m.count}</div>
                <div
                  className="w-full transition-all"
                  style={{
                    height: `${(m.count / maxSignups) * 70}px`,
                    background: 'linear-gradient(to top, var(--s-violet), var(--s-violet-light))',
                    minHeight: '2px',
                  }}
                />
                <div className="text-xs" style={{ color: 'var(--s-text-muted)', fontSize: '9px' }}>
                  {m.ym.slice(5)}/{m.ym.slice(2, 4)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Webhook tester */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send size={14} style={{ color: 'var(--s-violet-light)' }} />
          <span className="t-label">Tester un webhook Discord</span>
        </div>

        <div className="flex items-start gap-2 p-2" style={{
          background: 'rgba(114,137,218,0.08)',
          border: '1px solid rgba(114,137,218,0.3)',
          borderRadius: '3px',
        }}>
          <AlertCircle size={14} style={{ color: '#7289da', flexShrink: 0, marginTop: '2px' }} />
          <p className="text-xs" style={{ color: '#7289da' }}>
            L&apos;URL doit être un webhook Discord officiel (<span className="t-mono">discord.com/api/webhooks/…</span>).
            Rien n&apos;est stocké — c&apos;est juste un test d&apos;envoi ponctuel.
          </p>
        </div>

        <form onSubmit={handleTest} className="space-y-3">
          <input
            type="url"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            className="settings-input w-full"
            style={{ fontSize: '12px' }}
            required
          />

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Message à envoyer (max 2000 car.)"
            maxLength={2000}
            rows={3}
            className="settings-input w-full"
            style={{ fontSize: '13px', resize: 'vertical' }}
            required
          />

          <div className="flex items-center gap-3">
            <button type="submit" disabled={sending}
              className="btn-springs btn-primary bevel-sm"
              style={{ fontSize: '12px', padding: '8px 16px', opacity: sending ? 0.6 : 1 }}>
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {sending ? 'Envoi…' : 'Tester l\'envoi'}
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

      <div className="panel p-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Prochaines étapes : stocker les webhooks par channel (recrutement, annonces, admin), envois automatiques sur events clés (nouvelle structure validée, comp ouverte, ban critique).
        </p>
      </div>
    </>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5" style={{ color }}>
        {icon}
        <span className="t-label">{label}</span>
      </div>
      <p className="font-display text-2xl mt-1" style={{ letterSpacing: '0.04em', color }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{sub}</p>
      )}
    </div>
  );
}
