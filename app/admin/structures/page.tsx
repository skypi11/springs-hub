'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  Building2, CheckCircle, XCircle, Trash2, Loader2, ChevronDown, ChevronUp,
  ExternalLink, Ban, RotateCcw,
} from 'lucide-react';

type StructureRequest = {
  id: string;
  name: string;
  tag: string;
  logoUrl?: string;
  description?: string;
  games: string[];
  legalStatus?: string;
  teamCount?: number;
  staffCount?: number;
  discordUrl?: string;
  message?: string;
  founderId: string;
  founderName: string;
  status: string;
  reviewComment?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  suspendedBy?: string;
  suspendedByName?: string;
  deletionRequestedBy?: string;
  deletionRequestedByName?: string;
  requestedAt?: string;
  validatedAt?: string;
  createdAt?: string;
};

const LEGAL_LABELS: Record<string, string> = {
  none: 'Aucune',
  asso_1901: 'Association loi 1901',
  auto_entreprise: 'Auto-entreprise',
  sas_sarl: 'SAS / SARL',
  other: 'Autre',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending_validation: { label: 'En attente', color: '#FFB800', bg: 'rgba(255,184,0,0.1)' },
  active: { label: 'Active', color: '#33ff66', bg: 'rgba(0,217,54,0.1)' },
  suspended: { label: 'Suspendue', color: '#ff5555', bg: 'rgba(255,50,50,0.1)' },
  rejected: { label: 'Refusée', color: '#ff5555', bg: 'rgba(255,50,50,0.1)' },
  deletion_scheduled: { label: 'Suppression demandée', color: '#ff8800', bg: 'rgba(255,136,0,0.1)' },
};

export default function AdminStructuresPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [structures, setStructures] = useState<StructureRequest[]>([]);
  const [structuresLoading, setStructuresLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});

  async function loadStructures() {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const url = filter
        ? `/api/admin/structures?status=${filter}`
        : '/api/admin/structures';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStructures(data.structures ?? []);
      }
    } catch (err) {
      console.error('[Admin/Structures] load error:', err);
    }
    setStructuresLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) {
      loadStructures();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin, filter]);

  async function handleAction(structureId: string, action: string) {
    setActionLoading(`${structureId}_${action}`);
    try {
      const idToken = await firebaseUser!.getIdToken();
      const res = await fetch('/api/admin/structures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          structureId,
          action,
          comment: commentMap[structureId] || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await loadStructures();
        setExpandedId(null);
        toast.success('Action effectuée');
      } else {
        toast.error(data.error || 'Erreur');
      }
    } catch (err) {
      console.error('[Admin/Structures] action error:', err);
      toast.error('Erreur réseau');
    }
    setActionLoading(null);
  }

  if (structuresLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const pendingCount = structures.filter(s => s.status === 'pending_validation').length;

  return (
    <>
      {/* Titre section + compteur */}
      <div className="flex items-center gap-3">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          STRUCTURES ({structures.length})
        </h2>
        {pendingCount > 0 && <span className="tag tag-gold">{pendingCount} en attente</span>}
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap">
        {[
          { value: '', label: 'Toutes' },
          { value: 'pending_validation', label: 'En attente' },
          { value: 'active', label: 'Actives' },
          { value: 'suspended', label: 'Suspendues' },
          { value: 'rejected', label: 'Refusées' },
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className="tag transition-all duration-150"
            style={{
              background: filter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
              color: filter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
              borderColor: filter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
              cursor: 'pointer',
              padding: '6px 14px',
              fontSize: '11px',
            }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Liste structures */}
      <div className="space-y-3">
        {structures.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>Aucune structure trouvée.</p>
          </div>
        )}

        {structures.map(s => {
          const isExpanded = expandedId === s.id;
          const statusConf = STATUS_CONFIG[s.status] ?? STATUS_CONFIG.pending_validation;

          return (
            <div key={s.id} className="panel">
              <button
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                className="w-full panel-header"
                style={{ cursor: 'pointer' }}>
                <div className="flex items-center gap-3 flex-1">
                  {s.logoUrl ? (
                    <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                      <Image src={s.logoUrl} alt={s.name} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                      <Building2 size={16} style={{ color: 'var(--s-text-muted)' }} />
                    </div>
                  )}
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-base">{s.name}</span>
                      <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>{s.tag}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>par {s.founderName || s.founderId}</span>
                      {s.requestedAt && (
                        <span className="t-mono text-xs" style={{ color: 'var(--s-text-muted)' }}>
                          — {new Date(s.requestedAt).toLocaleDateString('fr-FR')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tag" style={{ background: statusConf.bg, color: statusConf.color, borderColor: statusConf.color + '40' }}>
                    {statusConf.label}
                  </span>
                  {s.games?.map(g => (
                    <span key={g} className={`tag ${g === 'rocket_league' ? 'tag-blue' : 'tag-green'}`}
                      style={{ fontSize: '9px', padding: '1px 6px' }}>
                      {g === 'rocket_league' ? 'RL' : 'TM'}
                    </span>
                  ))}
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {isExpanded && (
                <div className="panel-body space-y-4">
                  <div className="divider" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="t-label mb-1">Description</p>
                      <p className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{s.description || '—'}</p>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="t-label">Forme juridique</span>
                        <span className="t-mono text-xs">{LEGAL_LABELS[s.legalStatus ?? 'none'] ?? s.legalStatus}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="t-label">Équipes</span>
                        <span className="t-mono text-xs">{s.teamCount ?? 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="t-label">Staff</span>
                        <span className="t-mono text-xs">{s.staffCount ?? 0}</span>
                      </div>
                      {s.discordUrl && (
                        <div className="flex justify-between">
                          <span className="t-label">Discord</span>
                          <a href={s.discordUrl} target="_blank" rel="noopener noreferrer"
                            className="t-mono text-xs flex items-center gap-1" style={{ color: '#7289da' }}>
                            Ouvrir <ExternalLink size={10} />
                          </a>
                        </div>
                      )}
                      {s.validatedAt && (
                        <div className="flex justify-between">
                          <span className="t-label">Validé / traité le</span>
                          <span className="t-mono text-xs">{new Date(s.validatedAt).toLocaleString('fr-FR')}</span>
                        </div>
                      )}
                      {s.reviewedBy && (
                        <div className="flex justify-between items-start gap-4">
                          <span className="t-label">Traité par</span>
                          <AdminUserRef uid={s.reviewedBy} name={s.reviewedByName} />
                        </div>
                      )}
                      {s.suspendedBy && (
                        <div className="flex justify-between items-start gap-4">
                          <span className="t-label">Suspendue par</span>
                          <AdminUserRef uid={s.suspendedBy} name={s.suspendedByName} />
                        </div>
                      )}
                      {s.deletionRequestedBy && (
                        <div className="flex justify-between items-start gap-4">
                          <span className="t-label">Suppression demandée par</span>
                          <AdminUserRef uid={s.deletionRequestedBy} name={s.deletionRequestedByName} />
                        </div>
                      )}
                    </div>
                  </div>

                  {s.logoUrl && (
                    <div>
                      <p className="t-label mb-2">Logo</p>
                      <a href={s.logoUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-block p-3" style={{ background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 50%/16px 16px' }}>
                        <div className="w-24 h-24 relative">
                          <Image src={s.logoUrl} alt={s.name} fill className="object-contain" unoptimized />
                        </div>
                      </a>
                    </div>
                  )}

                  {s.message && (
                    <div>
                      <p className="t-label mb-1">Message du fondateur</p>
                      <div className="px-3 py-2" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                        <p className="t-body" style={{ whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>{s.message}</p>
                      </div>
                    </div>
                  )}

                  {s.reviewComment && (
                    <div>
                      <p className="t-label mb-1">Commentaire admin précédent</p>
                      <div className="px-3 py-2" style={{ background: 'rgba(123,47,190,0.05)', border: '1px solid rgba(123,47,190,0.2)' }}>
                        <p className="t-body">{s.reviewComment}</p>
                      </div>
                    </div>
                  )}

                  <div className="divider" />

                  <div className="space-y-3">
                    <div>
                      <label className="t-label block mb-2">Commentaire admin</label>
                      <textarea className="settings-input w-full" rows={2}
                        placeholder="Raison de la décision (visible par le fondateur)..."
                        value={commentMap[s.id] || ''}
                        onChange={e => setCommentMap({ ...commentMap, [s.id]: e.target.value })} />
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {s.status === 'pending_validation' && (
                        <>
                          <button onClick={() => handleAction(s.id, 'approve')}
                            disabled={!!actionLoading}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(0,217,54,0.15)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                            {actionLoading === `${s.id}_approve` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                            <span>Approuver</span>
                          </button>
                          <button onClick={() => handleAction(s.id, 'reject')}
                            disabled={!!actionLoading}
                            className="btn-springs bevel-sm flex items-center gap-2"
                            style={{ background: 'rgba(255,50,50,0.1)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                            {actionLoading === `${s.id}_reject` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                            <span>Refuser</span>
                          </button>
                        </>
                      )}

                      {s.status === 'active' && (
                        <button onClick={() => handleAction(s.id, 'suspend')}
                          disabled={!!actionLoading}
                          className="btn-springs bevel-sm flex items-center gap-2"
                          style={{ background: 'rgba(255,136,0,0.1)', color: '#ff8800', borderColor: 'rgba(255,136,0,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                          {actionLoading === `${s.id}_suspend` ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                          <span>Suspendre</span>
                        </button>
                      )}

                      {s.status === 'suspended' && (
                        <button onClick={() => handleAction(s.id, 'unsuspend')}
                          disabled={!!actionLoading}
                          className="btn-springs bevel-sm flex items-center gap-2"
                          style={{ background: 'rgba(0,217,54,0.1)', color: '#33ff66', borderColor: 'rgba(0,217,54,0.3)', fontSize: '12px', padding: '8px 16px' }}>
                          {actionLoading === `${s.id}_unsuspend` ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          <span>Réactiver</span>
                        </button>
                      )}

                      <button onClick={async () => {
                        const ok = await confirm({
                          title: 'Supprimer la structure',
                          message: `Supprimer définitivement "${s.name}" ? Cette action est irréversible.`,
                          variant: 'danger',
                          confirmLabel: 'Supprimer',
                        });
                        if (ok) handleAction(s.id, 'delete');
                      }}
                        disabled={!!actionLoading}
                        className="btn-springs bevel-sm flex items-center gap-2"
                        style={{ background: 'rgba(255,50,50,0.05)', color: '#ff5555', borderColor: 'rgba(255,50,50,0.2)', fontSize: '12px', padding: '8px 16px' }}>
                        {actionLoading === `${s.id}_delete` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        <span>Supprimer</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
