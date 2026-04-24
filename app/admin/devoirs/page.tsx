'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import ImpersonateButton from '@/components/admin/ImpersonateButton';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  ClipboardList, Loader2, AlertTriangle, Clock, CheckCircle2,
  CalendarDays, ExternalLink, Building2, ChevronDown, ChevronUp,
} from 'lucide-react';

type StructureStats = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  founderId: string;
  founderName: string;
  total: number;
  pending: number;
  done: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  doneLast7d: number;
  completionRate: number;
  byType: Record<string, number>;
};

type TypeBreakdown = { type: string; count: number; label: string };

type DevoirsData = {
  global: {
    total: number;
    pending: number;
    done: number;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
    doneLast7d: number;
    completionRate: number;
  };
  typeBreakdown: TypeBreakdown[];
  structures: StructureStats[];
  truncated: boolean;
};

type TodoDetail = {
  id: string;
  type: string;
  title: string;
  done: boolean;
  doneAt: number | null;
  deadline: string | null;
  deadlineAt: number | null;
  urgency: 'overdue' | 'today' | 'future' | 'none';
  assigneeId: string;
  assigneeName: string;
  createdBy: string;
  createdAt: number | null;
  hasResponse: boolean;
};

type StructureDetail = {
  structureId: string;
  todos: TodoDetail[];
  truncated: boolean;
};

export default function AdminDevoirsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<DevoirsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'overdue' | 'pending' | 'done' | 'rate'>('overdue');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [expandedStructureId, setExpandedStructureId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, StructureDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  async function toggleDetail(structureId: string) {
    if (expandedStructureId === structureId) {
      setExpandedStructureId(null);
      return;
    }
    setExpandedStructureId(structureId);
    if (detailById[structureId]) return; // déjà chargé
    setDetailLoadingId(structureId);
    try {
      const detail = await api<StructureDetail>(`/api/admin/devoirs?structureId=${encodeURIComponent(structureId)}`);
      setDetailById(prev => ({ ...prev, [structureId]: detail }));
    } catch (err) {
      console.error('[Admin/Devoirs] detail error:', err);
    }
    setDetailLoadingId(null);
  }

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<DevoirsData>('/api/admin/devoirs'));
    } catch (err) {
      console.error('[Admin/Devoirs] load error:', err);
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

  const structures = [...data.structures]
    .filter(s => !hideEmpty || s.total > 0)
    .sort((a, b) => {
      if (sortBy === 'overdue') return b.overdue - a.overdue || b.pending - a.pending;
      if (sortBy === 'pending') return b.pending - a.pending;
      if (sortBy === 'done') return b.doneLast7d - a.doneLast7d;
      if (sortBy === 'rate') return b.completionRate - a.completionRate;
      return 0;
    });

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          DEVOIRS ({data.global.total})
        </h2>
        {data.truncated && <span className="tag tag-gold">Résultats tronqués (max 5000)</span>}
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<ClipboardList size={14} />}
          label="En cours"
          value={data.global.pending}
          color="var(--s-text)"
        />
        <StatCard
          icon={<AlertTriangle size={14} />}
          label="En retard"
          value={data.global.overdue}
          color="#ff5555"
        />
        <StatCard
          icon={<Clock size={14} />}
          label="Pour aujourd'hui"
          value={data.global.dueToday}
          color="#FFB800"
        />
        <StatCard
          icon={<CalendarDays size={14} />}
          label="Cette semaine"
          value={data.global.dueThisWeek}
          color="#a364d9"
        />
        <StatCard
          icon={<CheckCircle2 size={14} />}
          label="Terminés (7j)"
          value={data.global.doneLast7d}
          color="#33ff66"
        />
        <StatCard
          icon={<CheckCircle2 size={14} />}
          label="Taux complétion"
          value={`${data.global.completionRate}%`}
          color="var(--s-violet-light)"
        />
        <StatCard
          icon={<ClipboardList size={14} />}
          label="Total (cumulé)"
          value={data.global.total}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<Building2 size={14} />}
          label="Structures actives"
          value={data.structures.filter(s => s.total > 0).length}
          color="var(--s-text-dim)"
        />
      </div>

      {/* Répartition par type */}
      {data.typeBreakdown.length > 0 && (
        <div className="panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="t-label">Répartition par type</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.typeBreakdown.map(t => (
              <span key={t.type} className="tag tag-neutral" style={{ fontSize: '11px', padding: '3px 8px' }}>
                {t.label}
                <span style={{ color: 'var(--s-text-muted)', marginLeft: '6px' }}>{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filtres tri */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex gap-1">
          {([
            { value: 'overdue', label: 'Tri: en retard' },
            { value: 'pending', label: 'Tri: en cours' },
            { value: 'done',    label: 'Tri: terminés 7j' },
            { value: 'rate',    label: 'Tri: taux %' },
          ] as const).map(f => (
            <button key={f.value} onClick={() => setSortBy(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: sortBy === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: sortBy === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: sortBy === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="divider" style={{ width: '1px', height: '20px' }} />
        <button onClick={() => setHideEmpty(v => !v)}
          className="tag transition-all duration-150"
          style={{
            background: !hideEmpty ? 'rgba(123,47,190,0.15)' : 'transparent',
            color: !hideEmpty ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
            borderColor: !hideEmpty ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
            cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
          }}>
          {hideEmpty ? 'Inclure structures vides' : 'Masquer structures vides'}
        </button>
      </div>

      {/* Liste structures */}
      <div className="space-y-2">
        {structures.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucune structure à afficher.
            </p>
          </div>
        )}

        {structures.map(s => {
          const isOpen = expandedStructureId === s.structureId;
          const detail = detailById[s.structureId];
          const canExpand = s.total > 0;
          return (
          <div key={s.structureId} className="panel">
            <div
              onClick={() => canExpand && toggleDetail(s.structureId)}
              role={canExpand ? 'button' : undefined}
              tabIndex={canExpand ? 0 : undefined}
              onKeyDown={e => {
                if (!canExpand) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleDetail(s.structureId);
                }
              }}
              className="p-3 flex items-start gap-3"
              style={{ cursor: canExpand ? 'pointer' : 'default' }}
            >
              {s.structureLogoUrl ? (
                <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                  <Image src={s.structureLogoUrl} alt={s.structureName} fill className="object-contain" unoptimized />
                </div>
              ) : (
                <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                  <Building2 size={14} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/community/structure/${s.structureId}`}
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-sm font-semibold hover:underline"
                    style={{ color: 'var(--s-text)' }}
                  >
                    <span>{s.structureName || '(sans nom)'}</span>
                    {s.structureTag && (
                      <span style={{ color: 'var(--s-text-muted)' }}>[{s.structureTag}]</span>
                    )}
                    <ExternalLink size={9} />
                  </Link>
                  {s.overdue > 0 && (
                    <span className="tag" style={{
                      background: 'rgba(255,85,85,0.12)', color: '#ff5555',
                      borderColor: 'rgba(255,85,85,0.4)',
                      fontSize: '9px', padding: '1px 6px',
                    }}>
                      {s.overdue} en retard
                    </span>
                  )}
                  {s.total === 0 && (
                    <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                      aucun devoir
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 mt-2 flex-wrap text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  <MiniStat label="En cours" value={s.pending} />
                  <MiniStat label="Aujourd'hui" value={s.dueToday} color={s.dueToday > 0 ? '#FFB800' : undefined} />
                  <MiniStat label="Semaine" value={s.dueThisWeek} />
                  <MiniStat label="Terminés 7j" value={s.doneLast7d} color={s.doneLast7d > 0 ? '#33ff66' : undefined} />
                  <MiniStat label="Taux" value={`${s.completionRate}%`} />
                  <MiniStat label="Total" value={s.total} />
                </div>

                {s.total > 0 && (
                  <div className="mt-2 h-1" style={{ background: 'var(--s-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${s.completionRate}%`,
                        background: s.completionRate >= 70
                          ? 'linear-gradient(90deg, #33ff66, #00D936)'
                          : s.completionRate >= 40
                            ? 'linear-gradient(90deg, #FFB800, #a364d9)'
                            : 'linear-gradient(90deg, #ff5555, #FFB800)',
                      }}
                    />
                  </div>
                )}
              </div>

              {s.founderId && s.pending > 0 && (
                <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <ImpersonateButton
                    targetUid={s.founderId}
                    targetName={s.founderName}
                    size="icon"
                    redirectTo="/community/my-structure"
                  />
                </div>
              )}

              {canExpand && (
                <div className="flex-shrink-0 flex items-center" style={{ color: 'var(--s-text-dim)' }}>
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              )}
            </div>

            {isOpen && (
              <div style={{ borderTop: '1px solid var(--s-border)' }}>
                {detailLoadingId === s.structureId && !detail ? (
                  <div className="p-4 flex items-center justify-center">
                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
                  </div>
                ) : detail ? (
                  <div className="p-3 space-y-1.5">
                    {detail.todos.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun devoir.</p>
                    ) : detail.todos.map(t => (
                      <TodoRow key={t.id} todo={t} />
                    ))}
                    {detail.truncated && (
                      <p className="text-xs pt-1" style={{ color: 'var(--s-text-muted)' }}>
                        Limité à 500 devoirs.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          );
        })}
      </div>
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

function MiniStat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span style={{ color: 'var(--s-text-muted)' }}>{label}:</span>
      <span className="font-semibold" style={{ color: color ?? 'var(--s-text)' }}>{value}</span>
    </span>
  );
}

function TodoRow({ todo }: { todo: TodoDetail }) {
  const urgencyColor =
    todo.urgency === 'overdue' ? '#ff5555' :
    todo.urgency === 'today'   ? '#FFB800' :
    todo.urgency === 'future'  ? 'var(--s-text-dim)' :
                                 'var(--s-text-muted)';
  const urgencyLabel =
    todo.urgency === 'overdue' ? 'retard' :
    todo.urgency === 'today'   ? "aujourd'hui" :
    todo.urgency === 'future'  ? 'à venir' :
                                 null;
  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5"
      style={{
        background: 'var(--s-elevated)',
        borderLeft: `2px solid ${todo.done ? '#33ff66' : urgencyColor}`,
      }}
    >
      <div className="flex-shrink-0 mt-0.5">
        {todo.done ? (
          <CheckCircle2 size={12} style={{ color: '#33ff66' }} />
        ) : (
          <ClipboardList size={12} style={{ color: urgencyColor }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{
            color: todo.done ? 'var(--s-text-dim)' : 'var(--s-text)',
            textDecoration: todo.done ? 'line-through' : 'none',
          }}>
            {todo.title || '(sans titre)'}
          </span>
          {!todo.done && urgencyLabel && (
            <span className="tag" style={{
              background: `${urgencyColor}18`,
              color: urgencyColor,
              borderColor: `${urgencyColor}40`,
              fontSize: '9px',
              padding: '1px 5px',
            }}>
              {urgencyLabel}
            </span>
          )}
          {todo.hasResponse && (
            <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 5px' }}>
              réponse
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--s-text-muted)' }}>
          {todo.assigneeId ? (
            <AdminUserRef uid={todo.assigneeId} name={todo.assigneeName} />
          ) : (
            <span>non assigné</span>
          )}
          {todo.deadline && (
            <span>échéance: {todo.deadline}</span>
          )}
          {todo.done && todo.doneAt && (
            <span style={{ color: '#33ff66' }}>terminé</span>
          )}
        </div>
      </div>
    </div>
  );
}
