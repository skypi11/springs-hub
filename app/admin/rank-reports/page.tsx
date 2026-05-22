'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { Flag, Loader2, ExternalLink, CheckCircle, XCircle } from 'lucide-react';

type RankReport = {
  id: string;
  targetUid: string;
  targetName: string;
  targetRlRank: string;
  reporterUid: string;
  reporterName: string;
  message: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
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
        Quand un joueur signale le rang d'un autre, c'est ici. Va voir le tracker
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
            {filter === 'pending' ? 'Aucun signalement à traiter — ✓ propre.' : 'Aucun signalement.'}
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
                  <span className="tag tag-blue" style={{ fontSize: '10px' }}>
                    {r.targetRlRank || '—'}
                  </span>
                  {r.status === 'pending' && (
                    <span className="tag" style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '10px' }}>
                      EN ATTENTE
                    </span>
                  )}
                  {r.status === 'resolved' && (
                    <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '10px' }}>
                      ✓ RÉSOLU
                    </span>
                  )}
                  {r.status === 'dismissed' && (
                    <span className="tag" style={{ background: 'rgba(255,85,85,0.08)', color: '#ff8a8a', borderColor: 'rgba(255,85,85,0.3)', fontSize: '10px' }}>
                      ✗ REJETÉ
                    </span>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                  Signalé par <Link href={`/profile/${r.reporterUid}`} className="hover:underline">{r.reporterName}</Link>
                  {' · '}{formatDate(r.createdAt)}
                </p>
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
