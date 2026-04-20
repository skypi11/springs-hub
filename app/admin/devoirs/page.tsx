'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import {
  ClipboardList, Loader2, AlertTriangle, Clock, CheckCircle2,
  CalendarDays, ExternalLink, Building2,
} from 'lucide-react';

type StructureStats = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
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

export default function AdminDevoirsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<DevoirsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'overdue' | 'pending' | 'done' | 'rate'>('overdue');
  const [hideEmpty, setHideEmpty] = useState(true);

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/devoirs', {
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      if (res.ok) setData(await res.json());
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

        {structures.map(s => (
          <div key={s.structureId} className="panel p-3">
            <div className="flex items-start gap-3">
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
            </div>
          </div>
        ))}
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
