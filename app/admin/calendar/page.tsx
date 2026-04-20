'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import AdminUserRef from '@/components/admin/AdminUserRef';
import {
  CalendarDays, Loader2, MapPin, Clock, Search, ExternalLink,
  CheckCircle2, XCircle, Calendar as CalendarIcon,
} from 'lucide-react';

type AdminEvent = {
  id: string;
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  title: string;
  type: string;
  status: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  target: { scope?: string; teamIds?: string[] } | null;
  createdBy: string | null;
  createdByName: string;
  createdAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

const TYPE_META: Record<string, { label: string; color: string }> = {
  training:  { label: 'Entraînement', color: '#0081FF' },
  scrim:     { label: 'Scrim',        color: '#a364d9' },
  match:     { label: 'Match',        color: '#FFB800' },
  springs:   { label: 'Springs',      color: '#7B2FBE' },
  autre:     { label: 'Autre',        color: '#7a7a95' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Prévu',     color: 'var(--s-text-dim)', bg: 'transparent' },
  completed: { label: 'Terminé',   color: '#33ff66',           bg: 'rgba(0,217,54,0.1)' },
  cancelled: { label: 'Annulé',    color: '#ff5555',           bg: 'rgba(255,50,50,0.1)' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminCalendarPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);

  const [when, setWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  async function load() {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('when', when);
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const data = await api<{ events?: AdminEvent[]; truncated?: boolean }>(`/api/admin/calendar?${params.toString()}`);
      setEvents(data.events ?? []);
      setTruncated(!!data.truncated);
    } catch (err) {
      console.error('[Admin/Calendar] load error:', err);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (firebaseUser && isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, isAdmin, when, typeFilter, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.structureName.toLowerCase().includes(q) ||
      e.structureTag.toLowerCase().includes(q) ||
      e.location.toLowerCase().includes(q)
    );
  }, [events, search]);

  if (loading) {
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
          CALENDRIER ({events.length})
        </h2>
        {truncated && <span className="tag tag-gold">Résultats tronqués (max 500)</span>}
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex gap-1">
          {([
            { value: 'upcoming', label: 'À venir' },
            { value: 'past',     label: 'Passés' },
            { value: 'all',      label: 'Tous' },
          ] as const).map(f => (
            <button key={f.value} onClick={() => setWhen(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: when === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: when === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: when === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="divider" style={{ width: '1px', height: '20px' }} />
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setTypeFilter('')}
            className="tag transition-all duration-150"
            style={{
              background: !typeFilter ? 'rgba(123,47,190,0.15)' : 'transparent',
              color: !typeFilter ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
              borderColor: !typeFilter ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
              cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
            }}>
            Tous types
          </button>
          {Object.entries(TYPE_META).map(([k, meta]) => (
            <button key={k} onClick={() => setTypeFilter(k)}
              className="tag transition-all duration-150"
              style={{
                background: typeFilter === k ? `${meta.color}20` : 'transparent',
                color: typeFilter === k ? meta.color : 'var(--s-text-dim)',
                borderColor: typeFilter === k ? `${meta.color}60` : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
              }}>
              {meta.label}
            </button>
          ))}
        </div>
        <div className="divider" style={{ width: '1px', height: '20px' }} />
        <div className="flex gap-1">
          {[
            { value: '',          label: 'Tous' },
            { value: 'scheduled', label: 'Prévus' },
            { value: 'completed', label: 'Terminés' },
            { value: 'cancelled', label: 'Annulés' },
          ].map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className="tag transition-all duration-150"
              style={{
                background: statusFilter === f.value ? 'rgba(123,47,190,0.15)' : 'transparent',
                color: statusFilter === f.value ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                borderColor: statusFilter === f.value ? 'rgba(123,47,190,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '11px',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--s-text-muted)' }} />
          <input
            type="text"
            placeholder="Rechercher titre, structure, lieu…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="settings-input w-full"
            style={{ paddingLeft: '32px', fontSize: '12px' }}
          />
        </div>
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="t-body" style={{ color: 'var(--s-text-muted)' }}>
              Aucun événement trouvé avec ces filtres.
            </p>
          </div>
        )}

        {filtered.map(event => {
          const typeMeta = TYPE_META[event.type] ?? TYPE_META.autre;
          const statusMeta = STATUS_META[event.status] ?? STATUS_META.scheduled;
          const StatusIcon = event.status === 'completed'
            ? CheckCircle2
            : event.status === 'cancelled'
              ? XCircle
              : CalendarIcon;

          return (
            <div key={event.id} className="panel p-3">
              <div className="flex items-start gap-3">
                {event.structureLogoUrl ? (
                  <div className="w-10 h-10 relative flex-shrink-0 overflow-hidden" style={{ background: 'var(--s-elevated)' }}>
                    <Image src={event.structureLogoUrl} alt={event.structureName} fill className="object-contain" unoptimized />
                  </div>
                ) : (
                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center" style={{ background: 'var(--s-elevated)' }}>
                    <CalendarDays size={14} style={{ color: 'var(--s-text-muted)' }} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{event.title}</span>
                    <span className="tag" style={{
                      background: `${typeMeta.color}15`, color: typeMeta.color,
                      borderColor: `${typeMeta.color}40`,
                      fontSize: '9px', padding: '1px 6px',
                    }}>
                      {typeMeta.label}
                    </span>
                    <span className="tag flex items-center gap-1" style={{
                      background: statusMeta.bg, color: statusMeta.color,
                      borderColor: statusMeta.color === 'var(--s-text-dim)' ? 'var(--s-border)' : `${statusMeta.color}40`,
                      fontSize: '9px', padding: '1px 6px',
                    }}>
                      <StatusIcon size={9} />
                      {statusMeta.label}
                    </span>
                    {event.target?.scope && event.target.scope !== 'all' && (
                      <span className="tag tag-neutral" style={{ fontSize: '9px', padding: '1px 6px' }}>
                        {event.target.scope}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1 flex-wrap text-xs" style={{ color: 'var(--s-text-dim)' }}>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {formatDate(event.startsAt)} {formatTime(event.startsAt)}
                      {event.endsAt && ` – ${formatTime(event.endsAt)}`}
                    </span>
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin size={10} />
                        {event.location}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <Link href={`/community/structure/${event.structureId}`}
                      className="flex items-center gap-1 text-xs hover:underline"
                      style={{ color: 'var(--s-violet-light)' }}>
                      <span>{event.structureName}</span>
                      {event.structureTag && (
                        <span style={{ color: 'var(--s-text-muted)' }}>[{event.structureTag}]</span>
                      )}
                      <ExternalLink size={9} />
                    </Link>
                    {event.createdBy && (
                      <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        <span>par</span>
                        <AdminUserRef uid={event.createdBy} name={event.createdByName} layout="inline" />
                      </span>
                    )}
                  </div>

                  {event.description && (
                    <p className="t-body text-xs mt-2" style={{ color: 'var(--s-text-dim)', whiteSpace: 'pre-wrap' }}>
                      {event.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
