'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';
import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import { getStructureHref } from '@/lib/structure-slug';
import { BarChart3, AlertTriangle, Lock, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';

type PerStructure = {
  structureId: string;
  structureSlug: string | null;
  structureName: string;
  structureTag: string;
  used: number;
  quota: number;
  pctOfQuota: number;
  failed: number;
  quotaExceeded: number;
};

type Data = {
  weekStartIso: string;
  ballchasingConfigured: boolean;
  global: { used: number; quota: number; remaining: number; pct: number };
  structureQuotaPerWeek: number;
  structures: PerStructure[];
  failedCount: number;
  quotaExceededCount: number;
};

function formatNextReset(weekStartIso: string): string {
  try {
    const start = new Date(weekStartIso);
    const next = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    return next.toLocaleString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

export default function AdminBallchasingPage() {
  const { firebaseUser, isAdmin } = useAuth();
  // On retient POUR QUI les données ont été chargées : si l'identité change
  // (déconnexion puis reconnexion), elles redeviennent obsolètes et le squelette
  // réapparaît tout seul, sans repasser par un setState synchrone dans l'effet.
  const [loaded, setLoaded] = useState<{ owner: User; data: Data } | null>(null);

  useEffect(() => {
    if (!firebaseUser || !isAdmin) return;
    const owner = firebaseUser;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await api<Data>('/api/admin/ballchasing');
        if (!cancelled) setLoaded({ owner, data: fresh });
      } catch (err) {
        console.error('[Admin/Ballchasing] load error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [firebaseUser, isAdmin]);

  if (!firebaseUser || !isAdmin) return null;
  const data = loaded && loaded.owner === firebaseUser ? loaded.data : null;
  if (!data) return <AdminContentSkeleton />;

  const globalBarColor = data.global.pct >= 100 ? '#ef4444' : data.global.pct > 75 ? 'var(--s-gold)' : 'var(--s-green)';
  const resetLabel = formatNextReset(data.weekStartIso);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 size={16} style={{ color: 'var(--s-gold)' }} />
          <h1 className="font-display text-2xl">BALLCHASING, QUOTA HEBDO</h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
          Suivi du compteur d&apos;uploads ballchasing pour la semaine en cours.
          Le quota Aedral est de <strong>{data.global.quota}/semaine</strong> (tier Patreon Gold).
          Chaque structure est limitée à <strong>{data.structureQuotaPerWeek}/semaine</strong>.
        </p>
        {resetLabel && (
          <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
            Prochain reset : <strong style={{ color: 'var(--s-text)' }}>{resetLabel}</strong>
          </p>
        )}
        {!data.ballchasingConfigured && (
          <div className="mt-3 flex items-start gap-2 p-3 bevel-sm"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.30)', color: '#ef4444' }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span className="text-sm">BALLCHASING_API_KEY n&apos;est pas configurée, les uploads sont désactivés.</span>
          </div>
        )}
      </div>

      {/* Quota global Aedral */}
      <section className="bevel p-5" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <span className="t-label" style={{ color: 'var(--s-gold)' }}>QUOTA GLOBAL AEDRAL</span>
          <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>
            <span className="font-display text-2xl" style={{ color: 'var(--s-text)' }}>{data.global.used}</span>
            {' / '}
            {data.global.quota}
            {' '}
            <span style={{ color: globalBarColor }}>({data.global.pct}%)</span>
          </span>
        </div>
        <div style={{ height: 10, background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
          <div style={{ height: '100%', width: `${Math.min(100, data.global.pct)}%`, background: globalBarColor }} />
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
          Reste <strong style={{ color: 'var(--s-text)' }}>{data.global.remaining}</strong> uploads disponibles cette semaine.
        </p>
      </section>

      {/* Stats globales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={<CheckCircle2 size={14} style={{ color: 'var(--s-green)' }} />}
          label="Uploads réussis (semaine)"
          value={data.global.used}
        />
        <StatCard
          icon={<XCircle size={14} style={{ color: '#ef4444' }} />}
          label="Échecs (semaine)"
          value={data.failedCount}
        />
        <StatCard
          icon={<Lock size={14} style={{ color: 'var(--s-gold)' }} />}
          label="Bloqués quota (semaine)"
          value={data.quotaExceededCount}
        />
      </div>

      {/* Par structure */}
      <section>
        <h2 className="t-label mb-3" style={{ color: 'var(--s-text)' }}>
          PAR STRUCTURE ({data.structures.length})
        </h2>
        {data.structures.length === 0 ? (
          <p className="text-sm py-6 text-center bevel-sm"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
            Aucun upload ballchasing cette semaine.
          </p>
        ) : (
          <div className="bevel-sm overflow-x-auto" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ color: 'var(--s-text-muted)', borderBottom: '1px solid var(--s-border)' }}>
                  <th className="text-left px-4 py-3 font-normal">Structure</th>
                  <th className="text-right px-4 py-3 font-normal">Uploads</th>
                  <th className="text-left px-4 py-3 font-normal" style={{ minWidth: 200 }}>Quota</th>
                  <th className="text-right px-4 py-3 font-normal">Échecs</th>
                  <th className="text-right px-4 py-3 font-normal">Bloqués quota</th>
                  <th className="text-right px-4 py-3 font-normal">Lien</th>
                </tr>
              </thead>
              <tbody>
                {data.structures.map(s => {
                  const barColor = s.pctOfQuota >= 100 ? '#ef4444' : s.pctOfQuota > 75 ? 'var(--s-gold)' : 'var(--s-green)';
                  return (
                    <tr key={s.structureId} style={{ color: 'var(--s-text)', borderTop: '1px solid var(--s-border)' }}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{s.structureName || '(sans nom)'}</div>
                        {s.structureTag && (
                          <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>[{s.structureTag}]</div>
                        )}
                      </td>
                      <td className="text-right px-4 py-3 t-mono">{s.used} / {s.quota}</td>
                      <td className="px-4 py-3">
                        <div style={{ height: 6, background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, s.pctOfQuota)}%`, background: barColor }} />
                        </div>
                        <div className="text-[12px] mt-1" style={{ color: 'var(--s-text-muted)' }}>{s.pctOfQuota}%</div>
                      </td>
                      <td className="text-right px-4 py-3 t-mono" style={{ color: s.failed > 0 ? '#ef4444' : 'var(--s-text-muted)' }}>
                        {s.failed}
                      </td>
                      <td className="text-right px-4 py-3 t-mono" style={{ color: s.quotaExceeded > 0 ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
                        {s.quotaExceeded}
                      </td>
                      <td className="text-right px-4 py-3">
                        <a href={getStructureHref({ id: s.structureId, slug: s.structureSlug })} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs"
                          style={{ color: 'var(--s-blue)' }}>
                          Voir <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bevel-sm p-4" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="t-label" style={{ color: 'var(--s-text-muted)' }}>{label}</span></div>
      <p className="font-display text-2xl" style={{ color: 'var(--s-text)' }}>{value}</p>
    </div>
  );
}
