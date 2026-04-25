'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import ImpersonateButton from '@/components/admin/ImpersonateButton';
import {
  UploadCloud, Loader2, FileText, Film, Building2, ExternalLink, Database,
} from 'lucide-react';

type StructureUsage = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  founderId: string;
  founderName: string;
  docsBytes: number;
  docsCount: number;
  replaysBytes: number;
  replaysCount: number;
  totalBytes: number;
  quotaBytes: number;
  quotaPct: number;
};

type UploadsData = {
  global: {
    totalBytes: number;
    docsBytes: number;
    docsCount: number;
    docsPending: number;
    replaysBytes: number;
    replaysCount: number;
    replaysPending: number;
    structuresWithUploads: number;
    perStructureQuotaBytes: number;
  };
  structures: StructureUsage[];
  truncated: { docs: boolean; replays: boolean };
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 10 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

export default function AdminUploadsPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [data, setData] = useState<UploadsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'total' | 'docs' | 'replays' | 'quota'>('total');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setData(await api<UploadsData>('/api/admin/uploads'));
    } catch (err) {
      console.error('[Admin/Uploads] load error:', err);
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

  const structures = [...data.structures].sort((a, b) => {
    if (sortBy === 'total') return b.totalBytes - a.totalBytes;
    if (sortBy === 'docs') return b.docsBytes - a.docsBytes;
    if (sortBy === 'replays') return b.replaysBytes - a.replaysBytes;
    if (sortBy === 'quota') return b.quotaPct - a.quotaPct;
    return 0;
  });

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>
          UPLOADS & STOCKAGE
        </h2>
        {(data.truncated.docs || data.truncated.replays) && (
          <span className="tag tag-gold">Résultats tronqués</span>
        )}
      </div>

      <div className="panel p-3">
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Usage calculé depuis Firestore (sizeBytes à l&apos;upload). N&apos;inclut pas les logos / bannières / avatars (servis directement via R2 public).
          Pour un audit R2 réel (orphelins), utiliser Outils dev.
        </p>
      </div>

      {/* Stats globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Database size={14} />}
          label="Total stocké"
          value={formatBytes(data.global.totalBytes)}
          color="var(--s-gold)"
        />
        <StatCard
          icon={<FileText size={14} />}
          label="Documents staff"
          value={formatBytes(data.global.docsBytes)}
          sub={`${data.global.docsCount} fichiers`}
          color="#0081FF"
        />
        <StatCard
          icon={<Film size={14} />}
          label="Replays"
          value={formatBytes(data.global.replaysBytes)}
          sub={`${data.global.replaysCount} fichiers`}
          color="#FFB800"
        />
        <StatCard
          icon={<Building2 size={14} />}
          label="Structures"
          value={data.global.structuresWithUploads}
          sub="avec uploads"
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<UploadCloud size={14} />}
          label="Uploads pending"
          value={data.global.docsPending + data.global.replaysPending}
          sub={`${data.global.docsPending} docs · ${data.global.replaysPending} replays`}
          color="var(--s-text-dim)"
        />
        <StatCard
          icon={<Database size={14} />}
          label="Quota / structure"
          value={formatBytes(data.global.perStructureQuotaBytes)}
          sub="documents staff"
          color="var(--s-text-dim)"
        />
      </div>

      {/* Filtres tri */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex gap-1">
          {([
            { value: 'total',   label: 'Tri: total' },
            { value: 'docs',    label: 'Tri: docs' },
            { value: 'replays', label: 'Tri: replays' },
            { value: 'quota',   label: 'Tri: % quota docs' },
          ] as const).map(f => (
            <button key={f.value} onClick={() => setSortBy(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: sortBy === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: sortBy === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: sortBy === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Liste structures */}
      <div className="space-y-2">
        {structures.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucune structure n&apos;a uploadé de fichier.
            </p>
          </div>
        )}

        {structures.map(s => {
          const quotaColor = s.quotaPct >= 90
            ? '#ff5555'
            : s.quotaPct >= 70
              ? '#FFB800'
              : 'var(--s-gold)';
          return (
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
                    <span className="tag" style={{
                      background: `${quotaColor}15`, color: quotaColor,
                      borderColor: `${quotaColor}40`,
                      fontSize: '9px', padding: '1px 6px',
                    }}>
                      {s.quotaPct}% quota docs
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-2 flex-wrap text-xs" style={{ color: 'var(--s-text-dim)' }}>
                    <MiniStat label="Total" value={formatBytes(s.totalBytes)} color="var(--s-text)" />
                    <MiniStat label="Docs" value={`${formatBytes(s.docsBytes)} (${s.docsCount})`} color="#0081FF" />
                    <MiniStat label="Replays" value={`${formatBytes(s.replaysBytes)} (${s.replaysCount})`} color="#FFB800" />
                  </div>

                  {/* Barre quota docs */}
                  <div className="mt-2 h-1" style={{ background: 'var(--s-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${Math.min(s.quotaPct, 100)}%`,
                        background: quotaColor,
                      }}
                    />
                  </div>
                </div>

                {s.founderId && (
                  <div className="flex-shrink-0">
                    <ImpersonateButton
                      targetUid={s.founderId}
                      targetName={s.founderName}
                      size="icon"
                      redirectTo="/community/my-structure"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5" style={{ color }}>
        {icon}
        <span className="t-label">{label}</span>
      </div>
      <p className="font-display text-2xl mt-1" style={{ letterSpacing: '0.04em', color }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{sub}</p>
      )}
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
