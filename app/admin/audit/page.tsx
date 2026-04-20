'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import {
  History, Loader2, ChevronDown, ChevronUp, Search, RefreshCw,
  CheckCircle, XCircle, Ban, Shield, Trash2, Pencil, UserMinus, LogOut,
  Building2, User as UserIcon, Calendar, ExternalLink,
} from 'lucide-react';

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
  user_admin_granted: { label: 'Admin accordé', color: '#a364d9' },
  user_admin_revoked: { label: 'Admin retiré', color: '#a364d9' },
  user_edited: { label: 'Profil modifié', color: '#0081FF' },
  user_removed_from_structure: { label: 'Retiré d\'une structure', color: '#FFB800' },
  user_deleted: { label: 'Compte supprimé', color: '#ff5555' },
  // Structure-internal (sample des plus visibles — la valeur fallback gère le reste)
  transfer_initiated: { label: 'Transfert initié', color: '#FFB800' },
  transfer_confirmed: { label: 'Transfert confirmé', color: '#33ff66' },
  transfer_cancelled: { label: 'Transfert annulé', color: '#ff5555' },
  cofounder_promoted: { label: 'Co-fondateur promu', color: '#a364d9' },
  cofounder_demoted: { label: 'Co-fondateur rétrogradé', color: '#a364d9' },
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

// Ligne "Acteur / Cible / Structure" dans le détail d'un log : affiche le NOM
// lisible + un lien vers le profil/structure + un bouton pour copier l'UID brut.
function EntityRow({
  label, name, id, href, icon: Icon,
}: {
  label: string;
  name: string;
  id: string;
  href: string;
  icon: typeof UserIcon;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="t-label flex-shrink-0 mt-0.5">{label}</span>
      <div className="flex flex-col items-end gap-1 min-w-0">
        <Link
          href={href}
          className="flex items-center gap-1.5 text-sm hover:underline"
          style={{ color: 'var(--s-violet-light)' }}
        >
          <Icon size={12} />
          <span className="truncate">{name}</span>
          <ExternalLink size={10} style={{ opacity: 0.6 }} />
        </Link>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(id);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch { /* ignore */ }
          }}
          className="t-mono text-xs hover:opacity-100 transition-opacity"
          style={{
            color: 'var(--s-text-muted)',
            opacity: 0.7,
            wordBreak: 'break-all',
            textAlign: 'right',
            cursor: 'pointer',
          }}
          title="Cliquer pour copier l'UID"
        >
          {copied ? '✓ copié' : id}
        </button>
      </div>
    </div>
  );
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
      const idToken = await firebaseUser.getIdToken();
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/admin/audit?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
      }
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
          <History size={20} style={{ color: 'var(--s-violet-light)' }} />
          <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
            AUDIT LOG ({filtered.length})
          </h2>
        </div>
        <button
          onClick={loadLogs}
          className="tag tag-neutral"
          style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={12} />
          Rafraîchir
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
                background: sourceFilter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: sourceFilter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: sourceFilter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
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
                          background: log.source === 'admin' ? 'rgba(163,100,217,0.15)' : 'rgba(0,129,255,0.15)',
                          color: log.source === 'admin' ? 'var(--s-violet-light)' : '#4da6ff',
                          border: `1px solid ${log.source === 'admin' ? 'rgba(163,100,217,0.35)' : 'rgba(0,129,255,0.35)'}`,
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
                  <EntityRow
                    label="Acteur"
                    name={log.actorLabel || log.actorUid}
                    id={log.actorUid}
                    href={`/profile/${log.actorUid}`}
                    icon={UserIcon}
                  />
                  {log.targetId && (
                    <EntityRow
                      label="Cible"
                      name={log.targetLabel || log.targetId}
                      id={log.targetId}
                      href={
                        log.targetType === 'structure'
                          ? `/community/structure/${log.targetId}`
                          : `/profile/${log.targetId}`
                      }
                      icon={log.targetType === 'structure' ? Building2 : UserIcon}
                    />
                  )}
                  {log.structureId && log.source === 'structure' && (
                    <EntityRow
                      label="Structure"
                      name={log.structureLabel || log.structureId}
                      id={log.structureId}
                      href={`/community/structure/${log.structureId}`}
                      icon={Building2}
                    />
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
