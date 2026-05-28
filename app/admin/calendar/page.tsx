'use client';

import AdminContentSkeleton from '@/components/admin/AdminContentSkeleton';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { api, ApiError } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import AdminUserRef from '@/components/admin/AdminUserRef';
import { normalizeEventType } from '@/lib/event-permissions';
import {
  CalendarDays, Loader2, MapPin, Clock, Search, ExternalLink,
  CheckCircle2, XCircle, Calendar as CalendarIcon, Ban, RotateCcw, Trash2,
  ChevronDown, ChevronUp, Users, HelpCircle, Minus, Pencil, Check,
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
  targetLabel: string;
  targetTeams: { id: string; name: string }[];
  adversaire: string;
  adversaireLogoUrl: string;
  resultat: string;
  compteRendu: string;
  aTravailler: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

type PresenceStatus = 'present' | 'absent' | 'maybe' | 'pending';

type PresenceRef = {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  status: PresenceStatus;
  respondedAt: string | null;
};

type EventDetail = {
  eventId: string;
  presences: PresenceRef[];
  counts: { present: number; absent: number; maybe: number; pending: number; total: number };
  truncated: boolean;
};

const TYPE_META: Record<string, { label: string; color: string }> = {
  training:  { label: 'Entraînement', color: '#0081FF' },
  scrim:     { label: 'Scrim',        color: '#FFB800' },
  match:     { label: 'Match',        color: '#FFB800' },
  tournoi:   { label: 'Tournoi',      color: '#00D9B5' },
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
// ISO (UTC) → valeur d'un <input type="datetime-local"> en heure locale du
// navigateur. Au save on refait new Date(value).toISOString() pour repartir en UTC.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type EventEditState = {
  id: string;
  title: string;
  type: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  adversaire: string;
  resultat: string;
};

export default function AdminCalendarPage() {
  const { firebaseUser, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [when, setWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, EventDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  // Édition directe d'un événement, null = aucun formulaire ouvert.
  const [editEvent, setEditEvent] = useState<EventEditState | null>(null);

  async function toggleDetail(eventId: string) {
    if (expandedEventId === eventId) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(eventId);
    if (detailById[eventId]) return;
    setDetailLoadingId(eventId);
    try {
      const detail = await api<EventDetail>(`/api/admin/calendar?eventId=${encodeURIComponent(eventId)}`);
      setDetailById(prev => ({ ...prev, [eventId]: detail }));
    } catch (err) {
      console.error('[Admin/Calendar] detail error:', err);
    }
    setDetailLoadingId(null);
  }

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

  async function handleStatusAction(eventId: string, action: 'cancel' | 'terminate' | 'reopen', title: string) {
    const LABELS: Record<string, { title: string; message: string; confirmLabel: string; success: string; variant?: 'danger' }> = {
      cancel:    { title: 'Annuler cet événement ?',   message: `"${title}" passera en statut annulé.`,                     confirmLabel: 'Annuler l\'événement', success: 'Événement annulé',  variant: 'danger' },
      terminate: { title: 'Marquer comme terminé ?',   message: `"${title}" passera en statut terminé.`,                    confirmLabel: 'Terminer',             success: 'Événement terminé' },
      reopen:    { title: 'Rouvrir cet événement ?',   message: `"${title}" repassera en statut programmé.`,                confirmLabel: 'Rouvrir',              success: 'Événement rouvert' },
    };
    const conf = LABELS[action];
    const ok = await confirm({ ...conf });
    if (!ok) return;
    setActionLoading(`${action}_${eventId}`);
    try {
      await api('/api/admin/calendar', { method: 'POST', body: { eventId, action } });
      toast.success(conf.success);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setActionLoading(null);
  }

  async function handleEventEditSave() {
    if (!editEvent) return;
    if (!editEvent.title.trim()) {
      toast.error('Le titre est obligatoire.');
      return;
    }
    if (!editEvent.startsAt) {
      toast.error('La date de début est obligatoire.');
      return;
    }
    setActionLoading(`edit_${editEvent.id}`);
    const isMatch = editEvent.type === 'match' || editEvent.type === 'scrim';
    try {
      await api('/api/admin/calendar', {
        method: 'POST',
        body: {
          eventId: editEvent.id,
          action: 'edit',
          title: editEvent.title,
          type: editEvent.type,
          description: editEvent.description,
          location: editEvent.location,
          startsAt: new Date(editEvent.startsAt).toISOString(),
          endsAt: editEvent.endsAt ? new Date(editEvent.endsAt).toISOString() : null,
          // adversaire / résultat : seulement pour les matchs et scrims
          ...(isMatch ? { adversaire: editEvent.adversaire, resultat: editEvent.resultat } : {}),
        },
      });
      toast.success('Événement modifié');
      setEditEvent(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setActionLoading(null);
  }

  async function handleDelete(eventId: string, title: string) {
    const ok = await confirm({
      title: 'Supprimer définitivement ?',
      message: `"${title}" et toutes ses présences (réponses des joueurs) seront supprimés définitivement. Action irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setActionLoading(`delete_${eventId}`);
    try {
      await api(`/api/admin/calendar?eventId=${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      toast.success('Événement supprimé');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur réseau');
    }
    setActionLoading(null);
  }

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
      <AdminContentSkeleton />
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
                background: when === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: when === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: when === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
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
              background: !typeFilter ? 'rgba(255,184,0,0.15)' : 'transparent',
              color: !typeFilter ? 'var(--s-gold)' : 'var(--s-text-dim)',
              borderColor: !typeFilter ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
              cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
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
                cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
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
                background: statusFilter === f.value ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: statusFilter === f.value ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: statusFilter === f.value ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
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
          const typeMeta = TYPE_META[normalizeEventType(event.type)] ?? TYPE_META.autre;
          const statusMeta = STATUS_META[event.status] ?? STATUS_META.scheduled;
          const StatusIcon = event.status === 'completed'
            ? CheckCircle2
            : event.status === 'cancelled'
              ? XCircle
              : CalendarIcon;

          const isOpen = expandedEventId === event.id;
          const detail = detailById[event.id];
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
                      fontSize: '12px', padding: '1px 6px',
                    }}>
                      {typeMeta.label}
                    </span>
                    <span className="tag flex items-center gap-1" style={{
                      background: statusMeta.bg, color: statusMeta.color,
                      borderColor: statusMeta.color === 'var(--s-text-dim)' ? 'var(--s-border)' : `${statusMeta.color}40`,
                      fontSize: '12px', padding: '1px 6px',
                    }}>
                      <StatusIcon size={9} />
                      {statusMeta.label}
                    </span>
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

                  {/* Concerne (équipes ciblées) + adversaire */}
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-xs" style={{ color: 'var(--s-text-dim)' }}>
                    {event.targetLabel && (
                      <span className="flex items-center gap-1.5">
                        <Users size={10} style={{ color: 'var(--s-text-muted)' }} />
                        <span style={{ color: 'var(--s-text-muted)' }}>Concerne :</span>
                        <span style={{ color: 'var(--s-text)' }}>{event.targetLabel}</span>
                      </span>
                    )}
                    {(normalizeEventType(event.type) === 'match' || normalizeEventType(event.type) === 'scrim') && event.adversaire && (
                      <span className="flex items-center gap-1.5">
                        <span style={{ color: 'var(--s-text-muted)' }}>vs</span>
                        {event.adversaireLogoUrl ? (
                          <Image src={event.adversaireLogoUrl} alt="" width={14} height={14} unoptimized className="flex-shrink-0" />
                        ) : (
                          <span className="tag tag-neutral" style={{ fontSize: '12px', padding: '0 5px' }}>sans logo</span>
                        )}
                        <span style={{ color: 'var(--s-text)' }}>{event.adversaire}</span>
                        {event.resultat && (
                          <span className="tag" style={{ fontSize: '12px', padding: '0 5px', background: 'rgba(255,184,0,0.12)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.3)' }}>
                            {event.resultat}
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <Link href={`/community/structure/${event.structureId}`}
                      className="flex items-center gap-1 text-xs hover:underline"
                      style={{ color: 'var(--s-gold)' }}>
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

                  {(event.compteRendu || event.aTravailler) && (
                    <div className="mt-2 space-y-1.5">
                      {event.compteRendu && (
                        <div className="px-2.5 py-1.5 text-xs" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Compte-rendu</span>
                          <p className="mt-0.5" style={{ color: 'var(--s-text-dim)', whiteSpace: 'pre-wrap' }}>{event.compteRendu}</p>
                        </div>
                      )}
                      {event.aTravailler && (
                        <div className="px-2.5 py-1.5 text-xs" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                          <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>À travailler</span>
                          <p className="mt-0.5" style={{ color: 'var(--s-text-dim)', whiteSpace: 'pre-wrap' }}>{event.aTravailler}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => toggleDetail(event.id)}
                      className="btn-springs bevel-sm flex items-center gap-1.5"
                      style={{
                        fontSize: '12px', padding: '5px 10px',
                        background: isOpen ? 'rgba(255,184,0,0.15)' : 'transparent',
                        color: isOpen ? 'var(--s-gold)' : 'var(--s-text-dim)',
                        borderColor: isOpen ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                      }}>
                      <Users size={11} />
                      <span>Présences</span>
                      {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditEvent(editEvent?.id === event.id ? null : {
                        id: event.id,
                        title: event.title,
                        type: normalizeEventType(event.type),
                        description: event.description,
                        location: event.location,
                        startsAt: isoToLocalInput(event.startsAt),
                        endsAt: isoToLocalInput(event.endsAt),
                        adversaire: event.adversaire,
                        resultat: event.resultat,
                      })}
                      className="btn-springs bevel-sm flex items-center gap-1.5"
                      style={{
                        fontSize: '12px', padding: '5px 10px',
                        background: editEvent?.id === event.id ? 'rgba(255,184,0,0.15)' : 'transparent',
                        color: editEvent?.id === event.id ? 'var(--s-gold)' : 'var(--s-text-dim)',
                        borderColor: editEvent?.id === event.id ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                      }}>
                      <Pencil size={11} />
                      <span>Modifier</span>
                    </button>
                    {event.status === 'scheduled' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStatusAction(event.id, 'terminate', event.title)}
                          disabled={actionLoading === `terminate_${event.id}`}
                          className="btn-springs bevel-sm flex items-center gap-1.5"
                          style={{
                            fontSize: '12px', padding: '5px 10px',
                            background: 'rgba(51,255,102,0.1)', color: '#33ff66',
                            borderColor: 'rgba(51,255,102,0.4)',
                            opacity: actionLoading === `terminate_${event.id}` ? 0.5 : 1,
                          }}>
                          {actionLoading === `terminate_${event.id}` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                          <span>Terminer</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusAction(event.id, 'cancel', event.title)}
                          disabled={actionLoading === `cancel_${event.id}`}
                          className="btn-springs bevel-sm flex items-center gap-1.5"
                          style={{
                            fontSize: '12px', padding: '5px 10px',
                            background: 'rgba(255,136,0,0.1)', color: '#ff8800',
                            borderColor: 'rgba(255,136,0,0.4)',
                            opacity: actionLoading === `cancel_${event.id}` ? 0.5 : 1,
                          }}>
                          {actionLoading === `cancel_${event.id}` ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />}
                          <span>Annuler</span>
                        </button>
                      </>
                    )}
                    {(event.status === 'cancelled' || event.status === 'done' || event.status === 'completed') && (
                      <button
                        type="button"
                        onClick={() => handleStatusAction(event.id, 'reopen', event.title)}
                        disabled={actionLoading === `reopen_${event.id}`}
                        className="btn-springs bevel-sm flex items-center gap-1.5"
                        style={{
                          fontSize: '12px', padding: '5px 10px',
                          background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)',
                          borderColor: 'rgba(255,184,0,0.4)',
                          opacity: actionLoading === `reopen_${event.id}` ? 0.5 : 1,
                        }}>
                        {actionLoading === `reopen_${event.id}` ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                        <span>Rouvrir</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(event.id, event.title)}
                      disabled={actionLoading === `delete_${event.id}`}
                      className="btn-springs bevel-sm flex items-center gap-1.5"
                      style={{
                        fontSize: '12px', padding: '5px 10px',
                        background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                        borderColor: 'rgba(239,68,68,0.4)',
                        opacity: actionLoading === `delete_${event.id}` ? 0.5 : 1,
                      }}>
                      {actionLoading === `delete_${event.id}` ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      <span>Supprimer</span>
                    </button>
                  </div>
                </div>
              </div>

              {editEvent?.id === event.id && (
                <EventEditForm
                  value={editEvent}
                  onChange={setEditEvent}
                  onSave={handleEventEditSave}
                  onCancel={() => setEditEvent(null)}
                  saving={actionLoading === `edit_${event.id}`}
                />
              )}

              {isOpen && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
                  {detailLoadingId === event.id && !detail ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 size={14} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
                    </div>
                  ) : detail ? (
                    <PresencePanel detail={detail} />
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

function EventEditForm({
  value, onChange, onSave, onCancel, saving,
}: {
  value: EventEditState;
  onChange: (v: EventEditState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="mt-3 pt-3 space-y-3"
      style={{ borderTop: '1px solid var(--s-border)' }}
    >
      <p className="t-label" style={{ color: 'var(--s-gold)' }}>MODIFIER L&apos;ÉVÉNEMENT</p>
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="t-label block mb-1">Titre</label>
          <input
            type="text"
            className="settings-input w-full"
            maxLength={120}
            value={value.title}
            onChange={e => onChange({ ...value, title: e.target.value })}
          />
        </div>
        <div>
          <label className="t-label block mb-1">Type</label>
          <select
            className="settings-input"
            value={value.type}
            onChange={e => onChange({ ...value, type: e.target.value })}
          >
            {Object.entries(TYPE_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <label className="t-label block mb-1">Début</label>
          <input
            type="datetime-local"
            className="settings-input w-full"
            value={value.startsAt}
            onChange={e => onChange({ ...value, startsAt: e.target.value })}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="t-label block mb-1">Fin (optionnel)</label>
          <input
            type="datetime-local"
            className="settings-input w-full"
            value={value.endsAt}
            onChange={e => onChange({ ...value, endsAt: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="t-label block mb-1">Lieu (optionnel)</label>
        <input
          type="text"
          className="settings-input w-full"
          maxLength={200}
          value={value.location}
          onChange={e => onChange({ ...value, location: e.target.value })}
        />
      </div>
      <div>
        <label className="t-label block mb-1">Description</label>
        <textarea
          className="settings-input w-full"
          rows={3}
          value={value.description}
          onChange={e => onChange({ ...value, description: e.target.value })}
        />
      </div>
      {(value.type === 'match' || value.type === 'scrim') && (
        <div className="space-y-2">
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="t-label block mb-1">Adversaire</label>
              <input
                type="text"
                className="settings-input w-full"
                maxLength={80}
                value={value.adversaire}
                onChange={e => onChange({ ...value, adversaire: e.target.value })}
              />
            </div>
            <div className="min-w-[110px]">
              <label className="t-label block mb-1">Résultat</label>
              <input
                type="text"
                className="settings-input w-full"
                maxLength={40}
                placeholder="ex : 3-1"
                value={value.resultat}
                onChange={e => onChange({ ...value, resultat: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
            Le logo de l&apos;adversaire n&apos;est pas modifiable ici (il est défini par la structure).
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-springs btn-primary bevel-sm flex items-center gap-2"
          style={{ fontSize: '12px', padding: '7px 14px' }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          <span>Enregistrer</span>
        </button>
        <button onClick={onCancel} disabled={saving} className="btn-springs btn-ghost text-xs">
          Annuler
        </button>
      </div>
    </div>
  );
}

const PRESENCE_META: Record<PresenceStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  present: { label: 'Présent',  color: '#33ff66',           icon: CheckCircle2 },
  maybe:   { label: 'Peut-être', color: '#FFB800',          icon: HelpCircle },
  pending: { label: 'Pas de réponse', color: 'var(--s-text-dim)', icon: Minus },
  absent:  { label: 'Absent',   color: '#ff5555',           icon: XCircle },
};

function PresencePanel({ detail }: { detail: EventDetail }) {
  if (detail.counts.total === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
        Aucune présence pour cet événement.
      </p>
    );
  }

  const groups: PresenceStatus[] = ['present', 'maybe', 'pending', 'absent'];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        {groups.map(g => {
          const meta = PRESENCE_META[g];
          const Icon = meta.icon;
          return (
            <span key={g} className="flex items-center gap-1" style={{ color: meta.color }}>
              <Icon size={11} />
              <span className="font-semibold">{detail.counts[g]}</span>
              <span style={{ color: 'var(--s-text-muted)' }}>{meta.label.toLowerCase()}</span>
            </span>
          );
        })}
        <span style={{ color: 'var(--s-text-muted)' }}>/ {detail.counts.total} invités</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {detail.presences.map(p => {
          const meta = PRESENCE_META[p.status];
          const Icon = meta.icon;
          return (
            <Link
              key={p.id}
              href={`/profile/${p.userId}`}
              className="flex items-center gap-2 px-2 py-1.5 transition-all duration-150 hover:underline"
              style={{
                background: 'var(--s-elevated)',
                borderLeft: `2px solid ${meta.color}`,
              }}
            >
              {p.avatar ? (
                <div className="w-5 h-5 relative flex-shrink-0 overflow-hidden rounded-full">
                  <Image src={p.avatar} alt={p.name} fill className="object-cover" unoptimized />
                </div>
              ) : (
                <div className="w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center" style={{ background: 'var(--s-hover)' }}>
                  <Users size={10} style={{ color: 'var(--s-text-muted)' }} />
                </div>
              )}
              <span className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--s-text)' }}>
                {p.name}
              </span>
              <span className="flex items-center gap-1 text-xs" style={{ color: meta.color }}>
                <Icon size={10} />
              </span>
            </Link>
          );
        })}
      </div>

      {detail.truncated && (
        <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Limité à 200 présences.
        </p>
      )}
    </div>
  );
}
