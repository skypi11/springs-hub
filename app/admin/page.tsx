'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, Users2, CalendarDays, AlertCircle, ArrowRight, Loader2,
  ShieldAlert, ClipboardList, UploadCloud, FileText, Megaphone, Check,
  UserPlus, CheckCircle2, Eye, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api-client';

type DashboardData = {
  lastSeenAt: string | null;
  cappedAt: number;
  radar: {
    newUsers: number;
    newStructureRequests: number;
    newValidatedStructures: number;
    newTeams: number;
    newEvents: number;
  };
  toHandle: {
    pendingStructures: number;
    suspendedStructures: number;
    deletionScheduledStructures: number;
    orphanedStructures: number;
  };
  totals: { activeStructures: number; totalUsers: number };
  activity: {
    type: 'user' | 'structure_request' | 'structure_validated' | 'team' | 'event';
    id: string;
    label: string;
    sublabel: string;
    ts: number;
    href: string;
  }[];
};

// Temps relatif court et lisible — "il y a 3 j", "à l'instant"…
function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "à l'instant";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  const mo = Math.floor(d / 30);
  return `il y a ${mo} mois`;
}

// Catégories du radar de nouveauté — ordre = priorité d'attention.
const RADAR_ITEMS: {
  key: keyof DashboardData['radar'];
  label: string;
  icon: LucideIcon;
  href: string;
}[] = [
  { key: 'newStructureRequests', label: 'Demandes de structure', icon: Building2, href: '/admin/structures' },
  { key: 'newUsers', label: 'Nouveaux inscrits', icon: UserPlus, href: '/admin/users' },
  { key: 'newTeams', label: 'Nouvelles équipes', icon: Users2, href: '/admin/teams' },
  { key: 'newValidatedStructures', label: 'Structures validées', icon: CheckCircle2, href: '/admin/structures' },
  { key: 'newEvents', label: 'Nouveaux événements', icon: CalendarDays, href: '/admin/calendar' },
];

const ACTIVITY_ICON: Record<DashboardData['activity'][number]['type'], LucideIcon> = {
  user: UserPlus,
  structure_request: Building2,
  structure_validated: CheckCircle2,
  team: Users2,
  event: CalendarDays,
};

const ACTIVITY_COLOR: Record<DashboardData['activity'][number]['type'], string> = {
  user: '#FFB800',
  structure_request: '#FFB800',
  structure_validated: '#33ff66',
  team: '#0081FF',
  event: 'var(--s-text-dim)',
};

export default function AdminDashboardPage() {
  const qc = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'dashboard'] as const,
    queryFn: () => api<DashboardData>('/api/admin/dashboard'),
  });

  const markSeen = useMutation({
    mutationFn: () => api('/api/admin/dashboard', { method: 'POST', body: { action: 'mark_seen' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] }),
  });

  if (isPending || !data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const { radar, toHandle, totals, activity } = data;
  const totalNew =
    radar.newUsers + radar.newStructureRequests + radar.newValidatedStructures
    + radar.newTeams + radar.newEvents;
  const cap = (n: number) => (n >= data.cappedAt ? `${data.cappedAt}+` : String(n));

  const toHandleItems = [
    { n: toHandle.pendingStructures, label: 'demande(s) de structure en attente', href: '/admin/structures', urgent: true },
    { n: toHandle.suspendedStructures, label: 'structure(s) suspendue(s)', href: '/admin/moderation', urgent: false },
    { n: toHandle.deletionScheduledStructures, label: 'suppression(s) programmée(s)', href: '/admin/moderation', urgent: false },
    { n: toHandle.orphanedStructures, label: 'structure(s) sans fondateur', href: '/admin/moderation', urgent: true },
  ].filter(x => x.n > 0);

  return (
    <>
      {/* ═══ RADAR — depuis la dernière visite ═══ */}
      <section
        className="bevel animate-fade-in relative overflow-hidden"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.3), transparent 70%)' }} />
        <div className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div>
              <h2 className="font-display text-lg tracking-wider" style={{ color: 'var(--s-text)' }}>
                DEPUIS TA DERNIÈRE VISITE
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                {data.lastSeenAt
                  ? `Marqué comme vu ${timeAgo(Date.parse(data.lastSeenAt))}`
                  : 'Première visite — radar des 7 derniers jours'}
              </p>
            </div>
            {totalNew > 0 && (
              <button
                type="button"
                onClick={() => markSeen.mutate()}
                disabled={markSeen.isPending}
                className="btn-springs btn-secondary bevel-sm flex items-center gap-2 flex-shrink-0"
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                {markSeen.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Check size={13} />}
                Tout marquer comme vu
              </button>
            )}
          </div>

          {totalNew === 0 ? (
            <div
              className="flex items-center gap-3 p-4 bevel-sm"
              style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
            >
              <CheckCircle2 size={18} style={{ color: '#33ff66', flexShrink: 0 }} />
              <span className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
                Rien de nouveau depuis ta dernière visite. Tout est à jour.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {RADAR_ITEMS.map(({ key, label, icon: Icon, href }) => {
                const n = radar[key];
                const has = n > 0;
                return (
                  <Link
                    key={key}
                    href={href}
                    className="bevel-sm p-3 flex flex-col gap-2 transition-all duration-150"
                    style={{
                      background: has ? 'rgba(255,184,0,0.06)' : 'var(--s-elevated)',
                      border: `1px solid ${has ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                      opacity: has ? 1 : 0.55,
                    }}
                  >
                    <Icon size={15} style={{ color: has ? 'var(--s-gold)' : 'var(--s-text-muted)' }} />
                    <div>
                      <p
                        className="font-display text-3xl leading-none"
                        style={{ color: has ? 'var(--s-text)' : 'var(--s-text-muted)' }}
                      >
                        {cap(n)}
                      </p>
                      <p className="text-xs mt-1.5" style={{ color: 'var(--s-text-dim)' }}>{label}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══ À TRAITER ═══ */}
      {toHandleItems.length > 0 && (
        <section className="space-y-2 animate-fade-in-d1">
          <div className="section-label">
            <span>À traiter maintenant</span>
          </div>
          {toHandleItems.map((item, i) => (
            <Link
              key={i}
              href={item.href}
              className="bevel-sm block relative overflow-hidden transition-all duration-150"
              style={{
                background: item.urgent
                  ? 'linear-gradient(135deg, rgba(255,184,0,0.12), rgba(255,184,0,0.04))'
                  : 'var(--s-surface)',
                border: `1px solid ${item.urgent ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                padding: '12px 16px',
              }}
            >
              <div className="flex items-center gap-3">
                <AlertCircle size={16} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
                <span className="text-sm flex-1" style={{ color: 'var(--s-text)' }}>
                  <strong style={{ color: 'var(--s-gold)' }}>{item.n}</strong> {item.label}
                </span>
                <ArrowRight size={14} style={{ color: 'var(--s-text-muted)' }} />
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* ═══ Stats globales ═══ */}
      <div className="grid grid-cols-3 gap-3 animate-fade-in-d1">
        <StatPill icon={Building2} label="Structures actives" value={totals.activeStructures} />
        <StatPill icon={Users} label="Utilisateurs" value={totals.totalUsers} />
        <StatPill icon={AlertCircle} label="En attente" value={toHandle.pendingStructures} emphasis={toHandle.pendingStructures > 0} />
      </div>

      {/* ═══ Activité récente + Accès rapides ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activité récente */}
        <div className="lg:col-span-2 space-y-3">
          <div className="section-label">
            <span>Activité récente</span>
          </div>
          <div
            className="bevel-sm overflow-hidden"
            style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
          >
            {activity.length === 0 ? (
              <div className="p-6 text-center">
                <Eye size={22} className="mx-auto mb-2" style={{ color: 'var(--s-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Aucune activité depuis ta dernière visite.
                </p>
              </div>
            ) : (
              activity.map((item, i) => {
                const Icon = ACTIVITY_ICON[item.type];
                const color = ACTIVITY_COLOR[item.type];
                return (
                  <Link
                    key={`${item.type}-${item.id}-${i}`}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
                    style={{ borderTop: i > 0 ? '1px solid var(--s-border)' : 'none' }}
                  >
                    <div
                      className="w-7 h-7 flex-shrink-0 flex items-center justify-center"
                      style={{ background: `${color}15`, border: `1px solid ${color}35` }}
                    >
                      <Icon size={13} style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
                        {item.label}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>
                        {item.sublabel}
                      </p>
                    </div>
                    <span className="t-mono flex-shrink-0" style={{ fontSize: '12px', color: 'var(--s-text-muted)' }}>
                      {timeAgo(item.ts)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Accès rapides */}
        <div className="space-y-3">
          <div className="section-label">
            <span>Accès rapides</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            <QuickLink href="/admin/structures" icon={Building2} label="Structures" accent="#FFB800" />
            <QuickLink href="/admin/users" icon={Users} label="Utilisateurs" accent="#FFB800" />
            <QuickLink href="/admin/moderation" icon={ShieldAlert} label="Modération" accent="#ff5555" />
            <QuickLink href="/admin/calendar" icon={CalendarDays} label="Calendrier" accent="#FFB800" />
            <QuickLink href="/admin/exercices" icon={ClipboardList} label="Exercices" accent="#FFB800" />
            <QuickLink href="/admin/audit" icon={FileText} label="Audit log" accent="var(--s-gold)" />
            <QuickLink href="/admin/uploads" icon={UploadCloud} label="Uploads" accent="#33ff66" />
            <QuickLink href="/admin/announce" icon={Megaphone} label="Annonces Discord" accent="#7B2FBE" />
          </div>
        </div>
      </div>
    </>
  );
}

function StatPill({
  icon: Icon, label, value, emphasis,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  const accent = emphasis ? '#FFB800' : 'var(--s-text-dim)';
  return (
    <div
      className="bevel-sm p-3"
      style={{
        background: 'var(--s-surface)',
        border: `1px solid ${emphasis ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={12} style={{ color: accent }} />
        <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>{label}</span>
      </div>
      <p className="font-display text-2xl" style={{ color: 'var(--s-text)' }}>{value}</p>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label, accent }: { href: string; icon: LucideIcon; label: string; accent: string }) {
  return (
    <Link
      href={href}
      className="pillar-card panel relative overflow-hidden transition-all duration-150 block"
    >
      <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${accent}, transparent 80%)` }} />
      <div className="p-3 flex items-center gap-3">
        <div className="p-1.5" style={{ background: `${accent}15`, border: `1px solid ${accent}35` }}>
          <Icon size={13} style={{ color: accent }} />
        </div>
        <span className="font-display text-sm tracking-wider" style={{ color: 'var(--s-text)' }}>{label}</span>
        <ArrowRight size={12} className="ml-auto" style={{ color: 'var(--s-text-muted)' }} />
      </div>
    </Link>
  );
}
