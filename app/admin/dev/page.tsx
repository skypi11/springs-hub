'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import {
  Wrench, Loader2, Database, KeyRound, Clock, ExternalLink,
  CheckCircle2, XCircle, Server, AlertCircle,
} from 'lucide-react';

type DevData = {
  counts: { name: string; count: number; error: string | null }[];
  env: { key: string; set: boolean }[];
  runtime: {
    nodeEnv: string;
    vercelEnv: string | null;
    vercelRegion: string | null;
    vercelGitCommit: string | null;
    serverTime: string;
  };
  crons: { path: string; schedule: string }[];
};

const EXTERNAL_LINKS = [
  { label: 'Firebase Console (monthly-cup)', url: 'https://console.firebase.google.com/project/monthly-cup' },
  { label: 'Vercel — springs-hub',            url: 'https://vercel.com/dashboard' },
  { label: 'GitHub — skypi11/springs-hub',    url: 'https://github.com/skypi11/springs-hub' },
  { label: 'Cloudflare R2 dashboard',         url: 'https://dash.cloudflare.com/' },
  { label: 'Upstash Redis',                   url: 'https://console.upstash.com/' },
  { label: 'Sentry',                          url: 'https://sentry.io/' },
];

export default function AdminDevPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<DevData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<DevData>('/api/admin/dev'));
    } catch (err) {
      console.error('[Admin/Dev] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const isDev = data.runtime.nodeEnv === 'development';
  const missingEnv = data.env.filter(e => !e.set);

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          OUTILS DEV
        </h2>
        <span className="tag" style={{
          background: isDev ? 'rgba(255,184,0,0.12)' : 'rgba(255,184,0,0.12)',
          color: isDev ? '#FFB800' : 'var(--s-gold)',
          borderColor: isDev ? 'rgba(255,184,0,0.4)' : 'rgba(255,184,0,0.4)',
          fontSize: '10px', padding: '2px 8px',
        }}>
          {data.runtime.nodeEnv.toUpperCase()}
        </span>
      </div>

      {/* Runtime info */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server size={14} style={{ color: 'var(--s-text-dim)' }} />
          <span className="t-label">Runtime</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <RuntimeLine label="NODE_ENV" value={data.runtime.nodeEnv} />
          <RuntimeLine label="VERCEL_ENV" value={data.runtime.vercelEnv ?? '—'} />
          <RuntimeLine label="Région" value={data.runtime.vercelRegion ?? '—'} />
          <RuntimeLine label="Commit" value={data.runtime.vercelGitCommit ?? '—'} mono />
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--s-text-muted)' }}>
          Heure serveur : <span className="t-mono">{data.runtime.serverTime}</span>
        </p>
      </div>

      {/* Counts collections */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Database size={14} style={{ color: 'var(--s-text-dim)' }} />
          <span className="t-label">Documents par collection</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {data.counts.map(c => (
            <div key={c.name} className="flex items-baseline justify-between gap-2 p-2" style={{
              background: 'var(--s-elevated)',
              borderRadius: '2px',
            }}>
              <span className="t-mono text-xs" style={{ color: 'var(--s-text-dim)' }}>{c.name}</span>
              {c.error ? (
                <span className="tag" style={{
                  background: 'rgba(255,85,85,0.12)', color: '#ff5555',
                  borderColor: 'rgba(255,85,85,0.4)',
                  fontSize: '9px', padding: '1px 6px',
                }}>err</span>
              ) : (
                <span className="font-display text-sm" style={{ color: 'var(--s-text)' }}>{c.count}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Env vars */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={14} style={{ color: 'var(--s-text-dim)' }} />
          <span className="t-label">Variables d&apos;env ({data.env.filter(e => e.set).length}/{data.env.length})</span>
          {missingEnv.length > 0 && (
            <span className="tag" style={{
              background: 'rgba(255,184,0,0.12)', color: '#FFB800',
              borderColor: 'rgba(255,184,0,0.4)',
              fontSize: '9px', padding: '1px 6px',
            }}>
              {missingEnv.length} manquante(s)
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {data.env.map(e => (
            <div key={e.key} className="flex items-center gap-2 text-xs">
              {e.set ? (
                <CheckCircle2 size={12} style={{ color: '#33ff66', flexShrink: 0 }} />
              ) : (
                <XCircle size={12} style={{ color: '#ff5555', flexShrink: 0 }} />
              )}
              <span className="t-mono" style={{ color: e.set ? 'var(--s-text-dim)' : '#ff5555' }}>
                {e.key}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Crons */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={14} style={{ color: 'var(--s-text-dim)' }} />
          <span className="t-label">Crons Vercel ({data.crons.length})</span>
          <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
            Hobby: 1x/jour max
          </span>
        </div>
        <div className="space-y-1.5">
          {data.crons.map(c => (
            <div key={c.path} className="flex items-center justify-between gap-3 text-xs">
              <span className="t-mono" style={{ color: 'var(--s-text-dim)' }}>{c.path}</span>
              <span className="t-mono" style={{ color: 'var(--s-text-muted)' }}>{c.schedule}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions dev-only */}
      {isDev && (
        <div className="panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench size={14} style={{ color: '#FFB800' }} />
            <span className="t-label" style={{ color: '#FFB800' }}>Actions dev-only (local)</span>
          </div>
          <div className="flex items-start gap-2 p-2 mb-3" style={{
            background: 'rgba(255,184,0,0.08)',
            border: '1px solid rgba(255,184,0,0.3)',
            borderRadius: '3px',
          }}>
            <AlertCircle size={14} style={{ color: '#FFB800', flexShrink: 0, marginTop: '2px' }} />
            <p className="text-xs" style={{ color: '#FFB800' }}>
              Ces endpoints sont bloqués en production (NODE_ENV !== &apos;development&apos;). Ils partagent pourtant
              le même projet Firebase que la prod — utiliser avec précaution.
            </p>
          </div>
          <div className="space-y-2 text-xs">
            <DevEndpoint
              method="POST"
              path="/api/dev/seed"
              description="Crée la structure Phoenix Esports (15 équipes, staff, calendrier, devoirs)"
            />
            <DevEndpoint
              method="POST"
              path="/api/dev/cleanup"
              description="Supprime tous les docs taggés isDev:true + comptes Firebase Auth"
            />
            <DevEndpoint
              method="POST"
              path="/api/dev/impersonate"
              description="Génère un custom token pour un compte discord_dev_*"
            />
          </div>
        </div>
      )}

      {/* Liens externes */}
      <div className="panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <ExternalLink size={14} style={{ color: 'var(--s-text-dim)' }} />
          <span className="t-label">Services externes</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {EXTERNAL_LINKS.map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 p-2 hover:underline text-xs"
              style={{
                background: 'var(--s-elevated)',
                borderRadius: '2px',
                color: 'var(--s-gold)',
              }}>
              <span>{l.label}</span>
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}

function RuntimeLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ color: 'var(--s-text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span className={mono ? 't-mono' : ''} style={{ color: 'var(--s-text)' }}>
        {value}
      </span>
    </div>
  );
}

function DevEndpoint({ method, path, description }: { method: string; path: string; description: string }) {
  return (
    <div className="flex items-start gap-2 p-2" style={{
      background: 'var(--s-elevated)', borderRadius: '2px',
    }}>
      <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px', flexShrink: 0 }}>
        {method}
      </span>
      <div className="flex-1 min-w-0">
        <div className="t-mono text-xs" style={{ color: 'var(--s-gold)' }}>{path}</div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{description}</p>
      </div>
    </div>
  );
}
