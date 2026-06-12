'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { RefreshCw, Loader2, ExternalLink, CheckCircle, XCircle, ArrowRight } from 'lucide-react';

type ChangeRequest = {
  id: string;
  userUid: string;
  userName: string;
  currentRiotId: string;
  currentRank: string;
  currentTrackerUrl: string;
  requestedRiotId: string;
  requestedTrackerUrl: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  adminNote: string | null;
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

export default function AdminValorantLinkChangesPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const data = await api<{ requests?: ChangeRequest[] }>('/api/admin/valorant-link-changes');
      setRequests(data.requests ?? []);
    } catch (err) {
      console.error('[admin/valorant-link-changes] load', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin]);

  async function decide(r: ChangeRequest, decision: 'approve' | 'reject') {
    const ok = await confirm({
      title: decision === 'approve' ? 'Approuver le changement' : 'Refuser la demande',
      message: decision === 'approve'
        ? `Tu vas remplacer le compte Riot vérifié de ${r.userName} :\n\n` +
          `Avant : ${r.currentRiotId || '—'}\nAprès : ${r.requestedRiotId || '—'}\n\n` +
          `Le rang sera re-synchronisé sur le nouveau compte. Action immédiate et journalisée.`
        : `Refuser la demande de ${r.userName} ? Son compte vérifié actuel reste inchangé.`,
      variant: decision === 'approve' ? 'default' : 'danger',
      confirmLabel: decision === 'approve' ? 'Approuver' : 'Refuser',
    });
    if (!ok) return;
    setActingId(r.id);
    try {
      await api(`/api/admin/valorant-link-changes/${r.id}`, {
        method: 'PATCH',
        body: { decision },
      });
      toast.success(decision === 'approve' ? 'Changement appliqué.' : 'Demande refusée.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau.');
    } finally {
      setActingId(null);
    }
  }

  const visible = useMemo(
    () => requests.filter(r => filter === 'all' || r.status === 'pending'),
    [requests, filter],
  );
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  if (loading) return <AdminContentSkeleton />;

  return (
    <>
      <div className="flex items-center gap-3">
        <RefreshCw size={18} style={{ color: '#FF6B78' }} />
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          CHANGEMENTS DE COMPTE RIOT ({pendingCount})
        </h2>
      </div>

      <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
        Les demandes de changement de compte Riot (Valorant) arrivent ici. Vérifie
        les deux profils tracker.gg avant de trancher. Un passage d'un compte haut
        vers un compte bas est un drapeau rouge évident (smurf / sandbagging).
      </p>

      <div className="flex gap-1.5">
        {[
          { value: 'pending', label: `À traiter (${pendingCount})` },
          { value: 'all', label: `Toutes (${requests.length})` },
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
            {filter === 'pending' ? 'Aucune demande en attente.' : 'Aucune demande.'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {visible.map(r => (
          <div key={r.id} className="panel p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/profile/${r.userUid}`}
                className="text-sm font-semibold hover:underline"
                style={{ color: 'var(--s-text)' }}>
                {r.userName || r.userUid}
              </Link>
              <span className="tag" style={{
                background: 'rgba(255,70,85,0.10)', color: '#FF6B78',
                borderColor: 'rgba(255,70,85,0.4)', fontSize: '12px',
              }}>
                VALORANT
              </span>
              {r.status === 'pending' && (
                <span className="tag" style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '12px' }}>
                  EN ATTENTE
                </span>
              )}
              {r.status === 'approved' && (
                <span className="tag" style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px' }}>
                  ✓ APPROUVÉ
                </span>
              )}
              {r.status === 'rejected' && (
                <span className="tag" style={{ background: 'rgba(255,85,85,0.08)', color: '#ff8a8a', borderColor: 'rgba(255,85,85,0.3)', fontSize: '12px' }}>
                  ✗ REFUSÉ
                </span>
              )}
              <span className="text-xs ml-auto" style={{ color: 'var(--s-text-muted)' }}>
                {formatDate(r.createdAt)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3 p-3"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
              <div>
                <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>Actuel · Riot</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{r.currentRiotId || '—'}</p>
                {r.currentRank && (
                  <p className="t-mono text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{r.currentRank}</p>
                )}
                {r.currentTrackerUrl && (
                  <a href={r.currentTrackerUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
                    style={{ color: '#FF6B78' }}>
                    tracker.gg <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <ArrowRight size={16} style={{ color: 'var(--s-gold)' }} className="hidden md:block" />
              <div>
                <p className="t-label mb-1" style={{ color: 'var(--s-text-muted)' }}>Demandé · Riot</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--s-gold)' }}>{r.requestedRiotId || '—'}</p>
                {r.requestedTrackerUrl && (
                  <a href={r.requestedTrackerUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs mt-1.5 hover:underline"
                    style={{ color: '#FF6B78' }}>
                    tracker.gg <ExternalLink size={10} />
                  </a>
                )}
              </div>
            </div>

            {r.reason && (
              <p className="text-sm p-2" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--s-border)', color: 'var(--s-text)' }}>
                <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>RAISON</span>
                <br />
                {r.reason}
              </p>
            )}

            {r.status === 'pending' && (
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => decide(r, 'approve')}
                  disabled={!!actingId}
                  className="btn-springs btn-primary bevel-sm text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  {actingId === r.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  Approuver
                </button>
                <button type="button"
                  onClick={() => decide(r, 'reject')}
                  disabled={!!actingId}
                  className="btn-springs btn-secondary bevel-sm text-xs inline-flex items-center gap-1.5 disabled:opacity-50">
                  <XCircle size={11} /> Refuser
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
