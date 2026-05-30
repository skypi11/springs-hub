'use client';

import { useQuery } from '@tanstack/react-query';
import { HardDrive, FileText, Film, Sparkles, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api-client';
import BallchasingAutoParseToggle from './BallchasingAutoParseToggle';

interface StorageUsage {
  docsBytes: number;
  replaysBytes: number;
  totalBytes: number;
  quotaBytes: number;
  premium: boolean;
  remainingBytes: number;
}

interface BcQuota {
  used: number;
  quota: number;
  remaining: number;
  weekStartIso: string;
}

function formatNextReset(weekStartIso: string): string {
  try {
    const start = new Date(weekStartIso);
    const next = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
    return next.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  } catch { return ''; }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Widget jauge de stockage par structure. Affiche le total docs + replays,
// le quota applicable (500 MB free / 10 GB premium), et un breakdown par type.
export default function StorageQuotaCard({ structureId }: { structureId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['structure-storage', structureId],
    queryFn: () => api<StorageUsage>(`/api/structures/${structureId}/storage`),
    staleTime: 30_000,
  });

  // Quota stats ballchasing (hebdo), fetch indépendant, non bloquant pour le rendu.
  const bcQuotaQuery = useQuery({
    queryKey: ['structure-bc-quota', structureId],
    queryFn: () => api<BcQuota>(`/api/structures/${structureId}/ballchasing-quota`),
    staleTime: 30_000,
  });

  if (isPending) {
    return (
      <div className="text-xs py-3 px-2" style={{ color: 'var(--s-text-muted)' }}>
        Chargement du quota…
      </div>
    );
  }
  if (error || !data) {
    return null;
  }

  const pct = data.quotaBytes > 0 ? Math.min(100, (data.totalBytes / data.quotaBytes) * 100) : 0;
  const pctRounded = Math.round(pct);
  const barColor = pct > 90 ? '#ef4444' : pct > 70 ? 'var(--s-gold)' : 'var(--s-green)';
  const docsPct = data.totalBytes > 0 ? (data.docsBytes / data.totalBytes) * 100 : 0;

  return (
    <div className="bevel-sm p-4 space-y-3" style={{
      background: 'var(--s-elevated)',
      border: '1px solid var(--s-border)',
    }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <HardDrive size={14} style={{ color: 'var(--s-gold)' }} />
          <span className="t-label" style={{ color: 'var(--s-text)' }}>STOCKAGE</span>
          {data.premium && (
            <span className="t-label flex items-center gap-1" style={{ color: 'var(--s-gold)' }}>
              <Sparkles size={10} /> PREMIUM
            </span>
          )}
        </div>
        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          <span style={{ color: 'var(--s-text)' }}>{formatBytes(data.totalBytes)}</span>
          {' / '}
          {formatBytes(data.quotaBytes)}
          {' '}
          <span style={{ color: barColor }}>({pctRounded}%)</span>
        </div>
      </div>

      {/* Jauge segmentée docs/replays */}
      <div className="relative" style={{ height: 8, background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: barColor,
          display: 'flex',
        }}>
          <div style={{
            width: `${docsPct}%`,
            background: barColor,
            opacity: 0.6,
          }} />
        </div>
      </div>

      {/* Breakdown */}
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--s-text-dim)' }}>
        <span className="flex items-center gap-1.5">
          <FileText size={11} />
          Documents <span style={{ color: 'var(--s-text)' }}>{formatBytes(data.docsBytes)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Film size={11} />
          Replays <span style={{ color: 'var(--s-text)' }}>{formatBytes(data.replaysBytes)}</span>
        </span>
      </div>

      {/* Hint premium si quota élevé et non-premium */}
      {!data.premium && pct >= 75 && (
        <div className="text-xs px-2 py-2 bevel-sm" style={{
          background: 'var(--s-surface)',
          border: '1px solid rgba(255, 184, 0, 0.3)',
          color: 'var(--s-text-dim)',
        }}>
          {pct >= 95 ? (
            <>Quota presque atteint. Supprime d&apos;anciens fichiers ou passe en premium (5 GB).</>
          ) : (
            <>Tu utilises {pctRounded}% de ton quota. Pense au premium si ton équipe upload beaucoup.</>
          )}
        </div>
      )}

      {/* Sous-bloc : quota stats hebdo (parsing ballchasing) */}
      {bcQuotaQuery.data && (
        <BallchasingQuotaSubBlock data={bcQuotaQuery.data} />
      )}

      {/* Toggle parsing auto */}
      <div className="pt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
        <BallchasingAutoParseToggle structureId={structureId} />
      </div>
    </div>
  );
}

function BallchasingQuotaSubBlock({ data }: { data: BcQuota }) {
  const pct = data.quota > 0 ? Math.min(100, (data.used / data.quota) * 100) : 0;
  const pctRounded = Math.round(pct);
  const barColor = pct >= 100 ? '#ef4444' : pct > 75 ? 'var(--s-gold)' : 'var(--s-green)';
  const resetLabel = formatNextReset(data.weekStartIso);

  return (
    <div className="pt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={13} style={{ color: 'var(--s-gold)' }} />
          <span className="t-label" style={{ color: 'var(--s-text)' }}>STATS PARSÉES (HEBDO)</span>
        </div>
        <div className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          <span style={{ color: 'var(--s-text)' }}>{data.used}</span>
          {' / '}
          {data.quota}
          {' '}
          <span style={{ color: barColor }}>({pctRounded}%)</span>
        </div>
      </div>
      <div style={{ height: 6, background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor }} />
      </div>
      <div className="text-[12px] mt-1.5" style={{ color: 'var(--s-text-muted)' }}>
        {data.remaining > 0
          ? <>Reste {data.remaining} replay{data.remaining > 1 ? 's' : ''} parsable{data.remaining > 1 ? 's' : ''} cette semaine{resetLabel ? <> · reset {resetLabel}</> : null}</>
          : <>Quota atteint{resetLabel ? <> · reset {resetLabel}</> : null}</>}
      </div>
    </div>
  );
}
