'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Flag, Loader2, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import GameTag from '@/components/games/GameTag';
import { getGameColor, getGameColorRgb } from '@/lib/games-registry';

type RankReport = {
  id: string;
  targetUid: string;
  targetName: string;
  /** Jeu signalé ('rocket_league' | 'valorant' | …). Default RL pour docs legacy. */
  game: string;
  /** Rang affiché par la cible pour le jeu signalé (générique). */
  targetRank: string;
  targetRlRank: string;
  reporterUid: string;
  reporterName: string;
  motif: 'rank_lie' | 'smurf';
  message: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  reporterStats: { total: number; resolved: number; dismissed: number; pending: number };
};

const MOTIF_META: Record<'rank_lie' | 'smurf', { label: string; bg: string; color: string; border: string }> = {
  rank_lie: {
    label: 'Rang faux',
    bg: 'rgba(0,129,255,0.1)',
    color: '#4fb3ff',
    border: 'rgba(0,129,255,0.4)',
  },
  smurf: {
    label: 'Smurf',
    bg: 'rgba(239,68,68,0.1)',
    color: '#ff8a8a',
    border: 'rgba(239,68,68,0.4)',
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

export default function AdminRankReportsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const toast = useToast();
  const [reports, setReports] = useState<RankReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const data = await api<{ reports?: RankReport[] }>('/api/admin/rank-reports');
      setReports(data.reports ?? []);
    } catch (err) {
      console.error('[admin/rank-reports] load', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  async function resolve(id: string, resolution: 'resolved' | 'dismissed') {
    setActingId(id);
    try {
      await api(`/api/admin/rank-reports/${id}`, {
        method: 'PATCH',
        body: { resolution },
      });
      toast.success(resolution === 'resolved' ? 'Signalement marqué résolu.' : 'Signalement rejeté.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setActingId(null);
    }
  }

  const visible = useMemo(
    () => reports.filter(r => filter === 'all' || r.status === 'pending'),
    [reports, filter],
  );
  const pendingCount = reports.filter(r => r.status === 'pending').length;

  if (loading) return <AdminContentSkeleton />;

  return (
    <>
      <div className="flex items-center gap-3">
        <Flag size={18} style={{ color: 'var(--s-gold)' }} />
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          SIGNALEMENTS DE RANG ({pendingCount})
        </h2>
      </div>

      <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
        Quand un joueur signale le rang d&apos;un autre, c&apos;est ici. Va voir le tracker
        et tranche.
      </p>

      <div className="flex gap-1.5">
        {[
          { value: 'pending', label: `À traiter (${pendingCount})` },
          { value: 'all', label: `Tous (${reports.length})` },
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value as 'pending' | 'all')}
            className="tag"
            style={{
              background: filter === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
              color: filter === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
              borderColor: filter === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
              cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="panel p-8 text-center">
          <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
            {filter === 'pending' ? 'Aucun signalement à traiter.' : 'Aucun signalement.'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(r => (
          <div key={r.id} className="panel p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/profile/${r.targetUid}`}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: 'var(--s-text)' }}>
                    {r.targetName || r.targetUid}
                  </Link>
                  <GameTag gameId={r.game} size="sm" />
                  <span className="tag" style={{
                    fontSize: '12px',
                    background: `rgba(${getGameColorRgb(r.game)},0.1)`,
                    color: getGameColor(r.game),
                    borderColor: `rgba(${getGameColorRgb(r.game)},0.4)`,
                  }}>
                    {r.targetRank || '—'}
                  </span>
                  {/* Motif du signalement */}
                  {(() => {
                    const meta = MOTIF_META[r.motif] ?? MOTIF_META.rank_lie;
                    return (
                      <span className="tag" style={{
                        background: meta.bg, color: meta.color, borderColor: meta.border, fontSize: '12px',
                      }}>
                        {meta.label}
                      </span>
                    );
                  })()}
                  {r.status === 'pending' && (
                    <span className="tag" style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '12px' }}>
                      EN ATTENTE
                    </span>
                  )}
                  {r.status === 'resolved' && (
                    <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px' }}>
                      ✓ RÉSOLU
                    </span>
                  )}
                  {r.status === 'dismissed' && (
                    <span className="tag" style={{ background: 'rgba(255,85,85,0.08)', color: '#ff8a8a', borderColor: 'rgba(255,85,85,0.3)', fontSize: '12px' }}>
                      ✗ REJETÉ
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                  Signalé par <Link href={`/profile/${r.reporterUid}`} className="hover:underline">{r.reporterName}</Link>
                  {' · '}{formatDate(r.createdAt)}
                </p>
                {/* Track-record du reporter, pour repérer les serial-signaleurs */}
                {r.reporterStats && r.reporterStats.total > 1 && (() => {
                  const s = r.reporterStats;
                  // Flag rouge si > 50% rejetés (risque d'abus)
                  const abuseRisk = s.dismissed >= 2 && s.dismissed / s.total > 0.5;
                  return (
                    <p className="text-xs mt-0.5"
                      style={{ color: abuseRisk ? '#ff8a8a' : 'var(--s-text-muted)' }}
                      title="Historique des signalements de ce reporter (résolus = légitimes, rejetés = abusifs)"
                    >
                      Reporter : {s.total} signalements, {s.resolved} résolu{s.resolved > 1 ? 's' : ''}, {s.dismissed} rejeté{s.dismissed > 1 ? 's' : ''}
                      {s.pending > 0 ? `, ${s.pending} en attente` : ''}
                      {abuseRisk && ' (potentiel signalement abusif)'}
                    </p>
                  );
                })()}
                {r.message && (
                  <p className="text-sm mt-2 p-2"
                    style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}>
                    « {r.message} »
                  </p>
                )}
              </div>
              <Link href={`/profile/${r.targetUid}`} target="_blank" rel="noopener noreferrer"
                className="btn-springs btn-secondary bevel-sm text-xs inline-flex items-center gap-1.5">
                Voir profil <ExternalLink size={11} />
              </Link>
            </div>

            {r.status === 'pending' && (
              <div className="flex gap-2 mt-3">
                <button type="button"
                  onClick={() => resolve(r.id, 'resolved')}
                  disabled={!!actingId}
                  className="btn-springs btn-primary bevel-sm text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  {actingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  Marquer résolu
                </button>
                <button type="button"
                  onClick={() => resolve(r.id, 'dismissed')}
                  disabled={!!actingId}
                  className="btn-springs btn-secondary bevel-sm text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  <XCircle size={11} /> Rejeter
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
