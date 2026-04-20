'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  ShieldAlert, Loader2, Ban, Building2, ExternalLink, History, UserX, AlertTriangle,
} from 'lucide-react';

type BannedUser = {
  uid: string;
  displayName: string;
  discordUsername: string;
  avatarUrl: string;
  banReason: string;
  bannedAt: string | null;
  bannedBy: string | null;
  bannedByName: string;
};

type CriticalStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  status: string;
  founderId: string;
  founderName: string;
  suspendedAt: string | null;
  orphanedAt: string | null;
  deletionScheduledAt: string | null;
  requestedAt: string | null;
};

type ModerationLog = {
  id: string;
  action: string;
  adminUid: string;
  actorName: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  targetName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

type ModerationData = {
  summary: {
    bannedUsers: number;
    pendingStructures: number;
    suspendedStructures: number;
    orphanedStructures: number;
    deletionScheduledStructures: number;
    recentModerationActions: number;
  };
  bannedUsers: BannedUser[];
  criticalStructures: CriticalStructure[];
  recentLogs: ModerationLog[];
  truncated: { users: boolean; structures: boolean };
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_validation:  { label: 'En attente',       color: '#FFB800' },
  suspended:           { label: 'Suspendue',        color: '#ff5555' },
  orphaned:            { label: 'Orphelin',         color: '#ff8800' },
  deletion_scheduled:  { label: 'Suppression prog.', color: '#ff5555' },
};

const ACTION_LABELS: Record<string, string> = {
  user_banned: 'Ban utilisateur',
  user_unbanned: 'Déban utilisateur',
  user_deleted: 'Suppression compte',
  structure_rejected: 'Structure rejetée',
  structure_suspended: 'Structure suspendue',
  structure_unsuspended: 'Structure réactivée',
  structure_deletion_scheduled: 'Suppression programmée',
  structure_deletion_cancelled: 'Suppression annulée',
  structure_deleted: 'Structure supprimée',
  structure_orphaned: 'Structure orpheline',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminModerationPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<ModerationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'banned' | 'structures' | 'logs'>('banned');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<ModerationData>('/api/admin/moderation'));
    } catch (err) {
      console.error('[Admin/Moderation] load error:', err);
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

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          MODÉRATION
        </h2>
        {(data.truncated.users || data.truncated.structures) && (
          <span className="tag tag-gold">Scan tronqué</span>
        )}
      </div>

      <div className="panel p-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Tableau de bord des actions de modération. Un système de signalements utilisateurs (reports) sera ajouté plus tard.
        </p>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Ban size={14} />}
          label="Bannis"
          value={data.summary.bannedUsers}
          color={data.summary.bannedUsers > 0 ? '#ff5555' : 'var(--s-text-dim)'}
        />
        <StatCard
          icon={<AlertTriangle size={14} />}
          label="À valider"
          value={data.summary.pendingStructures}
          color={data.summary.pendingStructures > 0 ? '#FFB800' : 'var(--s-text-dim)'}
        />
        <StatCard
          icon={<Building2 size={14} />}
          label="Suspendues"
          value={data.summary.suspendedStructures}
          color={data.summary.suspendedStructures > 0 ? '#ff5555' : 'var(--s-text-dim)'}
        />
        <StatCard
          icon={<UserX size={14} />}
          label="Orphelines"
          value={data.summary.orphanedStructures}
          color={data.summary.orphanedStructures > 0 ? '#ff8800' : 'var(--s-text-dim)'}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {([
          { value: 'banned',     label: `Bannis (${data.bannedUsers.length})` },
          { value: 'structures', label: `Structures critiques (${data.criticalStructures.length})` },
          { value: 'logs',       label: `Actions récentes (${data.recentLogs.length})` },
        ] as const).map(t => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className="tag transition-all duration-150"
            style={{
              background: tab === t.value ? 'rgba(123,47,190,0.15)' : 'transparent',
              color: tab === t.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
              borderColor: tab === t.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
              cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'banned' && (
        <div className="space-y-2">
          {data.bannedUsers.length === 0 && (
            <EmptyState text="Aucun utilisateur banni." />
          )}
          {data.bannedUsers.map(u => (
            <div key={u.uid} className="panel p-3">
              <div className="flex items-start gap-3">
                {u.avatarUrl ? (
                  <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                    <Image src={u.avatarUrl} alt={u.displayName} fill className="object-cover" unoptimized />
                  </div>
                ) : (
                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                    <UserX size={14} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/profile/${u.uid}`} className="text-sm font-semibold hover:underline flex items-center gap-1" style={{ color: 'var(--s-text)' }}>
                      {u.displayName}
                      <ExternalLink size={9} />
                    </Link>
                    <span className="tag" style={{
                      background: 'rgba(255,85,85,0.12)', color: '#ff5555',
                      borderColor: 'rgba(255,85,85,0.4)',
                      fontSize: '9px', padding: '1px 6px',
                    }}>
                      BANNI
                    </span>
                  </div>
                  {u.banReason && (
                    <p className="t-body text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                      <span style={{ color: 'var(--s-text-muted)' }}>Raison :</span> {u.banReason}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    <span>{formatDate(u.bannedAt)}</span>
                    {u.bannedBy && (
                      <span className="flex items-center gap-1.5">
                        <span>par</span>
                        <AdminUserRef uid={u.bannedBy} name={u.bannedByName} layout="inline" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'structures' && (
        <div className="space-y-2">
          {data.criticalStructures.length === 0 && (
            <EmptyState text="Aucune structure en état critique." />
          )}
          {data.criticalStructures.map(s => {
            const meta = STATUS_META[s.status] ?? { label: s.status, color: 'var(--s-text-dim)' };
            const dateStr = s.suspendedAt || s.orphanedAt || s.deletionScheduledAt || s.requestedAt;
            return (
              <div key={s.id} className="panel p-3">
                <div className="flex items-start gap-3">
                  {s.logoUrl ? (
                    <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                      <Image src={s.logoUrl} alt={s.name} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                      <Building2 size={14} style={{ color: 'var(--s-text-muted)' }} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/community/structure/${s.id}`} className="text-sm font-semibold hover:underline flex items-center gap-1" style={{ color: 'var(--s-text)' }}>
                        {s.name || '(sans nom)'}
                        {s.tag && <span style={{ color: 'var(--s-text-muted)' }}>[{s.tag}]</span>}
                        <ExternalLink size={9} />
                      </Link>
                      <span className="tag" style={{
                        background: `${meta.color}15`, color: meta.color,
                        borderColor: `${meta.color}40`,
                        fontSize: '9px', padding: '1px 6px',
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      <span>{formatDate(dateStr)}</span>
                      {s.founderId && (
                        <span className="flex items-center gap-1.5">
                          <span>fondateur</span>
                          <AdminUserRef uid={s.founderId} name={s.founderName} layout="inline" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-2">
          {data.recentLogs.length === 0 && (
            <EmptyState text="Aucune action de modération récente." />
          )}
          {data.recentLogs.map(l => (
            <div key={l.id} className="panel p-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                  <History size={14} style={{ color: 'var(--s-text-muted)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{ACTION_LABELS[l.action] ?? l.action}</span>
                    <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                      {l.action}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    <span>{formatDate(l.createdAt)}</span>
                    <span className="flex items-center gap-1.5">
                      <span>par</span>
                      <AdminUserRef uid={l.adminUid} name={l.actorName} layout="inline" />
                    </span>
                    {l.targetId && (
                      <span className="flex items-center gap-1.5">
                        <span>→</span>
                        <AdminUserRef
                          uid={l.targetId}
                          name={l.targetName ?? l.targetLabel}
                          layout="inline"
                          kind={l.targetType === 'structure' ? 'structure' : 'user'}
                        />
                      </span>
                    )}
                  </div>
                  {typeof l.metadata.reason === 'string' && l.metadata.reason && (
                    <p className="t-body text-xs mt-1" style={{ color: 'var(--s-text-dim)' }}>
                      <span style={{ color: 'var(--s-text-muted)' }}>Raison :</span> {l.metadata.reason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5" style={{ color }}>
        {icon}
        <span className="t-label">{label}</span>
      </div>
      <p className="font-display text-2xl mt-1" style={{ letterSpacing: '0.04em', color }}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="panel p-8 text-center">
      <ShieldAlert size={24} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
      <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>{text}</p>
    </div>
  );
}
