'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Users, Users2, CalendarDays, AlertCircle, ArrowRight, Loader2,
  ShieldAlert, ClipboardList, UploadCloud, FileText, Megaphone, Check,
  UserPlus, CheckCircle2, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api-client';

type NewItem = {
  type: 'user' | 'structure_request' | 'structure_validated' | 'team' | 'event';
  id: string;
  label: string;
  sublabel: string;
  avatar: string;
  ts: number;
  href: string;
};

type DashboardGroups = {
  structureRequests: NewItem[];
  users: NewItem[];
  teams: NewItem[];
  validatedStructures: NewItem[];
  events: NewItem[];
};

// Tout est optionnel côté type : on tolère une réponse partielle de l'API
// (ex. mismatch de version pendant un déploiement) sans faire planter la page.
type DashboardData = {
  lastSeenAt?: string | null;
  cappedAt?: number;
  groups?: {
    structureRequests?: NewItem[];
    users?: NewItem[];
    teams?: NewItem[];
    validatedStructures?: NewItem[];
    events?: NewItem[];
  };
  toHandle?: {
    pendingStructures?: number;
    suspendedStructures?: number;
    deletionScheduledStructures?: number;
    orphanedStructures?: number;
  };
  totals?: { activeStructures?: number; totalUsers?: number };
};

// Temps relatif court et lisible, "il y a 3 j", "à l'instant"…
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

const TYPE_ICON: Record<NewItem['type'], LucideIcon> = {
  user: UserPlus,
  structure_request: Building2,
  structure_validated: CheckCircle2,
  team: Users2,
  event: CalendarDays,
};

const TYPE_COLOR: Record<NewItem['type'], string> = {
  user: '#FFB800',
  structure_request: '#FFB800',
  structure_validated: '#33ff66',
  team: '#0081FF',
  event: 'var(--s-text-dim)',
};

// Catégories du radar, ordre = priorité d'attention.
const GROUPS: { key: keyof DashboardGroups; label: string }[] = [
  { key: 'structureRequests', label: 'Demandes de structure' },
  { key: 'users', label: 'Nouveaux inscrits' },
  { key: 'teams', label: 'Nouvelles équipes' },
  { key: 'validatedStructures', label: 'Structures validées' },
  { key: 'events', label: 'Nouveaux événements' },
];

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

  // Normalisation défensive, l'API peut renvoyer une réponse partielle.
  const groups = {
    structureRequests: data.groups?.structureRequests ?? [],
    users: data.groups?.users ?? [],
    teams: data.groups?.teams ?? [],
    validatedStructures: data.groups?.validatedStructures ?? [],
    events: data.groups?.events ?? [],
  };
  const toHandle = {
    pendingStructures: data.toHandle?.pendingStructures ?? 0,
    suspendedStructures: data.toHandle?.suspendedStructures ?? 0,
    deletionScheduledStructures: data.toHandle?.deletionScheduledStructures ?? 0,
    orphanedStructures: data.toHandle?.orphanedStructures ?? 0,
  };
  const totals = {
    activeStructures: data.totals?.activeStructures ?? 0,
    totalUsers: data.totals?.totalUsers ?? 0,
  };
  const cappedAt = data.cappedAt ?? 60;
  const totalNew =
    groups.structureRequests.length + groups.users.length + groups.teams.length
    + groups.validatedStructures.length + groups.events.length;

  const toHandleItems = [
    { n: toHandle.pendingStructures, label: 'demande(s) de structure en attente', href: '/admin/structures', urgent: true },
    { n: toHandle.suspendedStructures, label: 'structure(s) suspendue(s)', href: '/admin/moderation', urgent: false },
    { n: toHandle.deletionScheduledStructures, label: 'suppression(s) programmée(s)', href: '/admin/moderation', urgent: false },
    { n: toHandle.orphanedStructures, label: 'structure(s) sans fondateur', href: '/admin/moderation', urgent: true },
  ].filter(x => x.n > 0);

  return (
    <>
      {/* ═══ RADAR, depuis la dernière visite ═══ */}
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
                  : 'Première visite, radar des 7 derniers jours'}
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
            <div className="space-y-5">
              {GROUPS.map(({ key, label }) => {
                const items = groups[key];
                if (items.length === 0) return null;
                return (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="t-label" style={{ color: 'var(--s-text-dim)' }}>{label}</span>
                      <span className="tag tag-gold" style={{ fontSize: '9px', padding: '1px 6px' }}>
                        {items.length >= cappedAt ? `${cappedAt}+` : items.length}
                      </span>
                    </div>
                    <div
                      className="bevel-sm overflow-hidden"
                      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
                    >
                      {items.map((item, i) => (
                        <NewItemRow key={`${item.type}-${item.id}`} item={item} first={i === 0} />
                      ))}
                    </div>
                  </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in-d1">
        <StatPill icon={Building2} label="Structures actives" value={totals.activeStructures} />
        <StatPill icon={Users} label="Utilisateurs" value={totals.totalUsers} />
        <StatPill icon={AlertCircle} label="En attente" value={toHandle.pendingStructures} emphasis={toHandle.pendingStructures > 0} />
      </div>

      {/* ═══ Accès rapides ═══ */}
      <div>
        <div className="section-label mb-3">
          <span>Accès rapides</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <QuickLink href="/admin/structures" icon={Building2} label="Structures" accent="#FFB800" />
          <QuickLink href="/admin/users" icon={Users} label="Utilisateurs" accent="#FFB800" />
          <QuickLink href="/admin/moderation" icon={ShieldAlert} label="Modération" accent="#ff5555" />
          <QuickLink href="/admin/calendar" icon={CalendarDays} label="Calendrier" accent="#FFB800" />
          <QuickLink href="/admin/exercices" icon={ClipboardList} label="Exercices" accent="#FFB800" />
          <QuickLink href="/admin/teams" icon={Users2} label="Équipes" accent="#0081FF" />
          <QuickLink href="/admin/uploads" icon={UploadCloud} label="Uploads" accent="#33ff66" />
          <QuickLink href="/admin/audit" icon={FileText} label="Audit log" accent="var(--s-gold)" />
          <QuickLink href="/admin/announce" icon={Megaphone} label="Annonces Discord" accent="#7B2FBE" />
        </div>
      </div>
    </>
  );
}

function NewItemRow({ item, first }: { item: NewItem; first: boolean }) {
  const Icon = TYPE_ICON[item.type];
  const color = TYPE_COLOR[item.type];
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-[var(--s-hover)]"
      style={{ borderTop: first ? 'none' : '1px solid var(--s-border)' }}
    >
      {item.avatar ? (
        <div className="w-8 h-8 relative flex-shrink-0 overflow-hidden" style={{ border: '1px solid var(--s-border)' }}>
          <Image src={item.avatar} alt="" fill className="object-cover" unoptimized />
        </div>
      ) : (
        <div
          className="w-8 h-8 flex-shrink-0 flex items-center justify-center"
          style={{ background: `${color}15`, border: `1px solid ${color}35` }}
        >
          <Icon size={14} style={{ color }} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{item.label}</p>
        <p className="text-xs truncate" style={{ color: 'var(--s-text-muted)' }}>{item.sublabel}</p>
      </div>
      <span className="t-mono flex-shrink-0" style={{ fontSize: '12px', color: 'var(--s-text-muted)' }}>
        {timeAgo(item.ts)}
      </span>
      <ArrowRight size={12} className="flex-shrink-0" style={{ color: 'var(--s-text-muted)' }} />
    </Link>
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
