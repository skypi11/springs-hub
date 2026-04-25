'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import {
  History, Loader2, ChevronDown, ChevronUp, Search, RefreshCw, Download,
  CheckCircle, XCircle, Ban, Shield, Trash2, Pencil, UserMinus, LogOut,
  Building2, User as UserIcon, Calendar,
} from 'lucide-react';
import AdminUserRef from '@/components/admin/AdminUserRef';

type AuditLog = {
  id: string;
  source: 'admin' | 'structure';
  action: string;
  actorUid: string;
  actorLabel: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  structureId: string | null;
  structureLabel: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

// Libellés humains des actions — clé = action, valeur = {label, icon, color}
const ACTION_META: Record<string, { label: string; color: string }> = {
  // Admin actions
  structure_approved: { label: 'Structure validée', color: '#33ff66' },
  structure_rejected: { label: 'Structure refusée', color: '#ff5555' },
  structure_suspended: { label: 'Structure suspendue', color: '#ff8800' },
  structure_unsuspended: { label: 'Structure réactivée', color: '#33ff66' },
  structure_deletion_scheduled: { label: 'Suppression programmée', color: '#ff8800' },
  structure_deletion_cancelled: { label: 'Suppression annulée', color: '#33ff66' },
  structure_deleted: { label: 'Structure supprimée', color: '#ff5555' },
  user_banned: { label: 'Utilisateur banni', color: '#ff5555' },
  user_unbanned: { label: 'Utilisateur débanni', color: '#33ff66' },
  user_force_disconnected: { label: 'Déconnexion forcée', color: '#FFB800' },
  user_admin_granted: { label: 'Admin accordé', color: '#FFB800' },
  user_admin_revoked: { label: 'Admin retiré', color: '#FFB800' },
  user_edited: { label: 'Profil modifié', color: '#0081FF' },
  user_removed_from_structure: { label: 'Retiré d\'une structure', color: '#FFB800' },
  user_deleted: { label: 'Compte supprimé', color: '#ff5555' },
  user_impersonation_started: { label: 'Impersonation démarrée', color: '#FFB800' },
  user_impersonation_stopped: { label: 'Impersonation arrêtée', color: '#7a7a95' },
  self_delete_account: { label: 'Auto-suppression (RGPD)', color: '#ff5555' },
  notification_broadcast: { label: 'Notification broadcast', color: '#0081FF' },
  // Structure-internal (sample des plus visibles — la valeur fallback gère le reste)
  transfer_initiated: { label: 'Transfert initié', color: '#FFB800' },
  transfer_confirmed: { label: 'Transfert confirmé', color: '#33ff66' },
  transfer_cancelled: { label: 'Transfert annulé', color: '#ff5555' },
  cofounder_promoted: { label: 'Co-fondateur promu', color: '#FFB800' },
  cofounder_demoted: { label: 'Co-fondateur rétrogradé', color: '#FFB800' },
  manager_added: { label: 'Manager ajouté', color: '#0081FF' },
  manager_removed: { label: 'Manager retiré', color: '#0081FF' },
  coach_added: { label: 'Coach ajouté', color: '#0081FF' },
  coach_removed: { label: 'Coach retiré', color: '#0081FF' },
  member_joined: { label: 'Membre a rejoint', color: '#33ff66' },
  member_removed: { label: 'Membre retiré', color: '#ff5555' },
  member_left: { label: 'Membre est parti', color: '#7a7a95' },
  team_created: { label: 'Équipe créée', color: '#33ff66' },
  team_archived: { label: 'Équipe archivée', color: '#7a7a95' },
  team_deleted: { label: 'Équipe supprimée', color: '#ff5555' },
};

function getActionIcon(action: string) {
  if (action.startsWith('structure_approved') || action.startsWith('structure_unsuspended')) return CheckCircle;
  if (action.startsWith('structure_rejected') || action.startsWith('structure_deleted')) return XCircle;
  if (action.includes('banned') && !action.includes('unban')) return Ban;
  if (action === 'user_unbanned') return CheckCircle;
  if (action.startsWith('user_admin')) return Shield;
  if (action === 'user_deleted') return Trash2;
  if (action === 'user_edited') return Pencil;
  if (action === 'user_removed_from_structure' || action.includes('member_removed')) return UserMinus;
  if (action === 'user_force_disconnected') return LogOut;
  if (action.startsWith('structure_')) return Building2;
  return History;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminAuditPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'admin' | 'structure'>('all');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadLogs() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (actionFilter) params.set('action', actionFilter);
      const data = await api<{ logs?: AuditLog[] }>(`/api/admin/audit?${params.toString()}`);
      setLogs(data.logs ?? []);
    } catch (err) {
      console.error('[Admin/Audit] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin, sourceFilter, actionFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l =>
      (l.actorLabel ?? '').toLowerCase().includes(q) ||
      (l.targetLabel ?? '').toLowerCase().includes(q) ||
      (l.structureLabel ?? '').toLowerCase().includes(q) ||
      l.action.toLowerCase().includes(q)
    );
  }, [logs, search]);

  const actionOptions = useMemo(() => {
    const set = new Set(logs.map(l => l.action));
    return Array.from(set).sort();
  }, [logs]);

  function exportCsv() {
    // Export du résultat filtré courant (pas toute la base) — l'admin voit ce qu'il
    // télécharge. Métadata stringifié en JSON compact pour rester lisible dans Excel.
    const headers = ['createdAt', 'source', 'action', 'actorUid', 'actorLabel',
      'targetType', 'targetId', 'targetLabel', 'structureId', 'structureLabel', 'metadata'];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map(l => [
      l.createdAt ?? '',
      l.source,
      l.action,
      l.actorUid,
      l.actorLabel ?? '',
      l.targetType ?? '',
      l.targetId ?? '',
      l.targetLabel ?? '',
      l.structureId ?? '',
      l.structureLabel ?? '',
      Object.keys(l.metadata ?? {}).length > 0 ? JSON.stringify(l.metadata) : '',
    ].map(escape).join(','));
    const csv = '\ufeff' + [headers.join(','), ...rows].join('\n'); // BOM pour Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `springs-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <History size={20} style={{ color: 'var(--s-gold)' }} />
          <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
            AUDIT LOG ({filtered.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          className="tag tag-neutral"
          style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={12} />
          Rafraîchir
        </button>
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="tag"
          style={{
            cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
            opacity: filtered.length === 0 ? 0.5 : 1,
            padding: '6px 12px', fontSize: '11px',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,184,0,0.1)',
            color: 'var(--s-gold)',
            borderColor: 'rgba(255,184,0,0.3)',
          }}
          title={`Exporter ${filtered.length} ligne(s) affichée(s)`}
        >
          <Download size={12} />
          Export CSV
        </button>
      </div>

      <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
        Flux chronologique de toutes les actions admin sensibles (validations, bans, promotions, suppressions…) et des actions critiques au sein des structures.
      </p>

      {/* Filtres */}
      <div className="panel p-4 space-y-3">
        {/* Source */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-label" style={{ minWidth: 60 }}>Source</span>
          {([
            { value: 'all' as const, label: 'Toutes' },
            { value: 'admin' as const, label: 'Actions admin' },
            { value: 'structure' as const, label: 'Actions structure' },
          ]).map(f => (
            <button
              key={f.value}
              onClick={() => setSourceFilter(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: sourceFilter === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: sourceFilter === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: sourceFilter === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: '11px',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Recherche + action */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search size={14} style={{ color: 'var(--s-text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par acteur, cible ou structure…"
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--s-text)', borderBottom: '1px solid var(--s-border)', paddingBottom: 4 }}
            />
          </div>
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="text-sm px-3 py-1.5 bevel-sm"
            style={{
              background: 'var(--s-elevated)',
              border: '1px solid var(--s-border)',
              color: 'var(--s-text)',
              minWidth: 200,
            }}
          >
            <option value="">Toutes les actions</option>
            {actionOptions.map(a => (
              <option key={a} value={a}>{ACTION_META[a]?.label ?? a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucune action enregistrée — le journal est vide pour ce filtre.
            </p>
          </div>
        )}

        {filtered.map(log => {
          const isExpanded = expandedId === log.id;
          const meta = ACTION_META[log.action] ?? { label: log.action, color: '#7a7a95' };
          const Icon = getActionIcon(log.action);

          return (
            <div key={log.id} className="panel">
              <button
                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                className="w-full panel-header text-left"
                style={{ cursor: 'pointer' }}
              >
                <div className="flex items-start gap-3 flex-1">
                  {/* Icône colorée */}
                  <div
                    className="w-9 h-9 flex-shrink-0 flex items-center justify-center bevel-sm"
                    style={{
                      background: `${meta.color}15`,
                      border: `1px solid ${meta.color}35`,
                      color: meta.color,
                    }}
                  >
                    <Icon size={16} />
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>
                        {meta.label}
                      </span>
                      <span
                        className="tag"
                        style={{
                          fontSize: '9px',
                          padding: '1px 6px',
                          background: log.source === 'admin' ? 'rgba(255,184,0,0.15)' : 'rgba(0,129,255,0.15)',
                          color: log.source === 'admin' ? 'var(--s-gold)' : '#4da6ff',
                          border: `1px solid ${log.source === 'admin' ? 'rgba(255,184,0,0.35)' : 'rgba(0,129,255,0.35)'}`,
                        }}
                      >
                        {log.source === 'admin' ? 'ADMIN' : 'STRUCTURE'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap mt-1 text-xs" style={{ color: 'var(--s-text-dim)' }}>
                      <span className="flex items-center gap-1">
                        <UserIcon size={11} />
                        {log.actorLabel || log.actorUid}
                      </span>
                      {log.targetLabel && (
                        <>
                          <span style={{ color: 'var(--s-text-muted)' }}>→</span>
                          <span className="flex items-center gap-1">
                            {log.targetType === 'structure' ? <Building2 size={11} /> : <UserIcon size={11} />}
                            {log.targetLabel}
                          </span>
                        </>
                      )}
                      {log.structureLabel && log.source === 'structure' && (
                        <span className="flex items-center gap-1">
                          <Building2 size={11} />
                          {log.structureLabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date + chevron */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-muted)' }}>
                      <Calendar size={11} />
                      {formatDate(log.createdAt)}
                    </span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>
              </button>

              {/* Détails */}
              {isExpanded && (
                <div className="panel-body space-y-2 text-xs" style={{ borderTop: '1px solid var(--s-border)' }}>
                  <div className="flex justify-between items-start gap-4">
                    <span className="t-label flex-shrink-0 mt-0.5">Acteur</span>
                    <AdminUserRef uid={log.actorUid} name={log.actorLabel} kind="user" />
                  </div>
                  {log.targetId && (
                    <div className="flex justify-between items-start gap-4">
                      <span className="t-label flex-shrink-0 mt-0.5">Cible</span>
                      <AdminUserRef
                        uid={log.targetId}
                        name={log.targetLabel}
                        kind={log.targetType === 'structure' ? 'structure' : 'user'}
                      />
                    </div>
                  )}
                  {log.structureId && log.source === 'structure' && (
                    <div className="flex justify-between items-start gap-4">
                      <span className="t-label flex-shrink-0 mt-0.5">Structure</span>
                      <AdminUserRef uid={log.structureId} name={log.structureLabel} kind="structure" />
                    </div>
                  )}
                  <div className="flex justify-between gap-4" style={{ color: 'var(--s-text-muted)' }}>
                    <span className="t-label">Action</span>
                    <span className="t-mono">{log.action}</span>
                  </div>
                  <div className="flex justify-between gap-4" style={{ color: 'var(--s-text-muted)' }}>
                    <span className="t-label">ID log</span>
                    <span className="t-mono">{log.id}</span>
                  </div>
                  {Object.keys(log.metadata).length > 0 && (
                    <div>
                      <div className="t-label mb-1">Métadonnées</div>
                      <pre
                        className="t-mono text-xs p-2 overflow-x-auto"
                        style={{
                          background: 'var(--s-bg)',
                          border: '1px solid var(--s-border)',
                          color: 'var(--s-text-dim)',
                          maxHeight: 200,
                        }}
                      >
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {logs.length >= 200 && (
        <p className="t-body text-center" style={{ color: 'var(--s-text-muted)', fontSize: 11 }}>
          Affichage limité aux 200 entrées les plus récentes. Les plus anciennes existent toujours mais ne sont pas chargées ici.
        </p>
      )}
    </>
  );
}
