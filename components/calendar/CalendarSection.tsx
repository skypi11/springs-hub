'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import {
  Calendar as CalendarIcon,
  Plus,
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  MapPin,
  Target,
  ChevronRight,
  ChevronDown,
  Trash2,
  Check,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import Portal from '@/components/ui/Portal';
import DateTimePicker from '@/components/ui/DateTimePicker';
import type {
  UserContext,
  EventType,
  EventScope,
  EventStatus,
  PresenceStatus,
  EventTarget,
} from '@/lib/event-permissions';
import {
  canEditEvent,
  canDeleteEvent,
  canMarkTerminated,
  isDirigeant,
} from '@/lib/event-permissions';

type Presence = {
  id: string;
  userId: string;
  status: PresenceStatus;
  wasStructureMember: boolean;
  respondedAt: string | null;
  updatedBy: string | null;
};

type CalendarEvent = {
  id: string;
  structureId: string;
  createdBy: string;
  createdAt: string | null;
  title: string;
  type: EventType;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  target: EventTarget;
  status: EventStatus;
  completedAt: string | null;
  completedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  compteRendu: string;
  aTravailler: string;
  adversaire: string | null;
  adversaireLogoUrl: string | null;
  resultat: string | null;
  presences: Presence[];
};

type Member = {
  id: string;
  userId: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  role: string;
};

type Team = {
  id: string;
  game: string;
  name: string;
  logoUrl?: string;
  playerIds?: string[];
  subIds?: string[];
  staffIds?: string[];
};

type Props = {
  structureId: string;
  structureGames: string[];
  structureLogoUrl?: string;
  members: Member[];
  teams: Team[];
  userContext: UserContext;
};

const TYPE_INFO: Record<EventType, { label: string; color: string }> = {
  training: { label: 'Entraînement', color: 'var(--s-violet-light)' },
  scrim: { label: 'Scrim', color: 'var(--s-blue)' },
  match: { label: 'Match', color: 'var(--s-gold)' },
  springs: { label: 'Springs', color: 'var(--s-violet)' },
  autre: { label: 'Autre', color: 'var(--s-text-dim)' },
};

const STATUS_INFO: Record<EventStatus, { label: string; color: string }> = {
  scheduled: { label: 'Programmé', color: 'var(--s-gold)' },
  done: { label: 'Terminé', color: '#33ff66' },
  cancelled: { label: 'Annulé', color: '#ff5555' },
};

const PRESENCE_INFO: Record<PresenceStatus, { label: string; color: string }> = {
  present: { label: 'Présent', color: '#33ff66' },
  absent: { label: 'Absent', color: '#ff5555' },
  maybe: { label: 'Peut-être', color: 'var(--s-gold)' },
  pending: { label: 'En attente', color: 'var(--s-text-muted)' },
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarSection({
  structureId,
  structureGames,
  structureLogoUrl,
  members,
  teams,
  userContext,
}: Props) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  // Filtre équipe : si vide → toutes ; sinon → seulement les events avec au moins
  // une équipe ciblée dans la sélection. Les events scope=structure/game sont
  // exclus dès qu'un filtre équipe est actif, pour coller à l'intention utilisateur.
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch (err) {
      console.error('[CalendarSection] load error:', err);
    }
    setLoading(false);
  }, [firebaseUser, structureId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Deep-link depuis Discord / lien embed : ?event=ID ouvre directement la
  // modale de détail de l'événement. On le fait une seule fois après chargement,
  // et on retire le param de l'URL pour ne pas le ré-ouvrir à chaque re-render.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || events.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const eventParam = params.get('event');
    if (eventParam && events.some(e => e.id === eventParam)) {
      setOpenEventId(eventParam);
      deepLinkHandled.current = true;
      const url = new URL(window.location.href);
      url.searchParams.delete('event');
      window.history.replaceState({}, '', url.toString());
    }
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (filter !== 'all') {
        const end = e.endsAt ? new Date(e.endsAt).getTime() : 0;
        if (filter === 'upcoming' && !(end >= now && e.status !== 'cancelled')) return false;
        if (filter === 'past' && !(end < now || e.status === 'cancelled' || e.status === 'done')) return false;
      }
      if (teamFilter.length > 0) {
        if (e.target.scope !== 'teams') return false;
        const ids = e.target.teamIds ?? [];
        if (!ids.some(id => teamFilter.includes(id))) return false;
      }
      return true;
    });
  }, [events, filter, now, teamFilter]);

  async function handleRespond(eventId: string, status: PresenceStatus) {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events/${eventId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success('Réponse enregistrée');
        loadEvents();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
  }

  async function handleStatusAction(eventId: string, action: 'terminate' | 'reopen' | 'cancel') {
    if (!firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events/${eventId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success('OK');
        loadEvents();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
  }

  async function handleDelete(eventId: string, title: string) {
    const ok = await confirm({
      title: 'Supprimer cet événement ?',
      message: `"${title}" sera supprimé avec toutes les présences. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok || !firebaseUser) return;
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events/${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        toast.success('Événement supprimé');
        setOpenEventId(null);
        loadEvents();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
  }

  const canCreateAnything = isDirigeant(userContext)
    || userContext.staffedTeamIds.length > 0
    || (userContext.captainOfTeamIds?.length ?? 0) > 0;
  const openEvent = events.find(e => e.id === openEventId) ?? null;
  const membersById = new Map(members.map(m => [m.userId, m]));

  return (
    <div className="bevel relative transition-all duration-200"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 70%)' }} />
      <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.08), transparent 70%)' }} />

      {/* Header */}
      <div className="relative z-[1] px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
            <CalendarIcon size={13} style={{ color: 'var(--s-gold)' }} />
          </div>
          <span className="font-display text-sm tracking-wider">CALENDRIER</span>
        </div>
        {canCreateAnything && (
          <button type="button" onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-gold)' }}>
            <Plus size={11} />
            Nouvel événement
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="relative z-[1] px-5 pt-4 flex gap-2">
        {(['upcoming', 'past', 'all'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className="tag transition-all duration-150"
            style={{
              background: filter === f ? 'rgba(255,184,0,0.15)' : 'transparent',
              color: filter === f ? 'var(--s-gold)' : 'var(--s-text-dim)',
              borderColor: filter === f ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
              cursor: 'pointer', padding: '4px 10px', fontSize: '10px',
            }}>
            {f === 'upcoming' ? 'À venir' : f === 'past' ? 'Passés' : 'Tous'}
          </button>
        ))}
      </div>

      {/* Team filter — dropdown multi-select, scalable jusqu'à 20+ équipes */}
      {teams.length > 1 && (
        <TeamFilterDropdown teams={teams} value={teamFilter} onChange={setTeamFilter} />
      )}

      {/* Body */}
      <div className="relative z-[1] p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-10">
            <CalendarIcon size={24} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
            <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
              Aucun événement {filter === 'upcoming' ? 'à venir' : filter === 'past' ? 'passé' : ''}.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map(ev => (
              <EventCard
                key={ev.id}
                event={ev}
                currentUid={firebaseUser?.uid ?? ''}
                teams={teams}
                structureLogoUrl={structureLogoUrl}
                onClick={() => setOpenEventId(ev.id)}
                onRespond={handleRespond}
              />
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <EventFormModal
          structureId={structureId}
          structureGames={structureGames}
          teams={teams}
          members={members}
          userContext={userContext}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            loadEvents();
          }}
        />
      )}

      {openEvent && (
        <EventDetailModal
          event={openEvent}
          currentUid={firebaseUser?.uid ?? ''}
          userContext={userContext}
          structureId={structureId}
          teams={teams}
          structureLogoUrl={structureLogoUrl}
          membersById={membersById}
          onClose={() => setOpenEventId(null)}
          onRespond={handleRespond}
          onStatusAction={handleStatusAction}
          onDelete={handleDelete}
          onReload={loadEvents}
        />
      )}
    </div>
  );
}

// ─── Team filter dropdown (scalable) ───────────────────────────────────

function TeamFilterDropdown({
  teams,
  value,
  onChange,
}: {
  teams: Team[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-team-filter-root]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const query = q.trim().toLowerCase();
  const filtered = query
    ? teams.filter(t => t.name.toLowerCase().includes(query))
    : teams;

  const label = value.length === 0
    ? 'Toutes'
    : value.length === 1
      ? (teams.find(t => t.id === value[0])?.name ?? `${value.length}/${teams.length}`)
      : `${value.length}/${teams.length}`;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  return (
    <div className={`relative ${open ? 'z-40' : 'z-[1]'} px-5 pt-3 flex items-center gap-2`} data-team-filter-root>
      <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Équipes :</span>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 transition-all duration-150"
        style={{
          background: value.length > 0 ? 'rgba(255,184,0,0.12)' : 'transparent',
          color: value.length > 0 ? 'var(--s-gold)' : 'var(--s-text-dim)',
          border: `1px solid ${value.length > 0 ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
          cursor: 'pointer', padding: '4px 10px', fontSize: '11px',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
        <Users size={11} />
        <span>{label}</span>
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])}
          className="text-xs transition-colors duration-150"
          style={{ color: 'var(--s-text-muted)', padding: '2px 6px' }}>
          Réinitialiser
        </button>
      )}
      {open && (
        <div className="absolute left-5 top-full mt-1 z-30 w-[280px] max-h-[320px] overflow-hidden flex flex-col bevel-sm"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {teams.length > 6 && (
            <div className="p-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
                placeholder="Rechercher une équipe..."
                className="settings-input w-full text-xs" />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe.</span>
              </div>
            ) : filtered.map(t => {
              const selected = value.includes(t.id);
              const color = t.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)';
              return (
                <button key={t.id} type="button" onClick={() => toggle(t.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--s-hover)]">
                  <span className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                    style={{ border: `1px solid ${selected ? 'var(--s-gold)' : 'var(--s-border)'}`, background: selected ? 'rgba(255,184,0,0.15)' : 'transparent' }}>
                    {selected && <Check size={10} style={{ color: 'var(--s-gold)' }} />}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs flex-1 truncate" style={{ color: selected ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Event card ─────────────────────────────────────────────────────────

function EventCard({
  event,
  currentUid,
  teams,
  structureLogoUrl,
  onClick,
  onRespond,
}: {
  event: CalendarEvent;
  currentUid: string;
  teams: Team[];
  structureLogoUrl?: string;
  onClick: () => void;
  onRespond: (eventId: string, status: PresenceStatus) => void;
}) {
  const typeInfo = TYPE_INFO[event.type];
  const statusInfo = STATUS_INFO[event.status];
  const myPresence = event.presences.find(p => p.userId === currentUid);
  const counts = {
    present: event.presences.filter(p => p.status === 'present').length,
    absent: event.presences.filter(p => p.status === 'absent').length,
    maybe: event.presences.filter(p => p.status === 'maybe').length,
    pending: event.presences.filter(p => p.status === 'pending').length,
  };

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return event.target.game === 'rocket_league' ? 'Rocket League' : event.target.game === 'trackmania' ? 'Trackmania' : 'Jeu';
    const names = (event.target.teamIds ?? [])
      .map(id => teams.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : 'Équipes';
  })();

  return (
    <div
      onClick={onClick}
      className="bevel-sm relative overflow-hidden cursor-pointer transition-all duration-150 hover:border-white/20"
      style={{ background: 'var(--s-elevated)', border: `1px solid var(--s-border)` }}>
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />

      <div className="p-4 flex gap-4">
        {/* Date block */}
        <div className="flex-shrink-0 text-center" style={{ minWidth: '56px' }}>
          <p className="font-display text-xl leading-none" style={{ color: typeInfo.color }}>
            {event.startsAt ? new Date(event.startsAt).getDate() : '–'}
          </p>
          <p className="t-label mt-1">
            {event.startsAt
              ? new Date(event.startsAt).toLocaleDateString('fr-FR', { month: 'short' }).toUpperCase()
              : ''}
          </p>
          <p className="t-mono mt-1" style={{ color: 'var(--s-text-dim)' }}>
            {fmtTime(event.startsAt)}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '9px', padding: '1px 6px' }}>
              {typeInfo.label}
            </span>
            {event.status !== 'scheduled' && (
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '1px 6px' }}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{event.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="t-mono flex items-center gap-1" style={{ fontSize: '10px', color: 'var(--s-text-dim)' }}>
              <Target size={9} /> {targetLabel}
            </span>
            {event.location && (
              <span className="t-mono flex items-center gap-1" style={{ fontSize: '10px', color: 'var(--s-text-dim)' }}>
                <MapPin size={9} /> {event.location}
              </span>
            )}
            {event.type === 'scrim' && event.adversaire && (
              <span className="t-mono" style={{ fontSize: '10px', color: 'var(--s-text-dim)' }}>
                vs {event.adversaire}
              </span>
            )}
          </div>
          {event.type === 'match' && event.adversaire && (() => {
            const firstTeam = event.target.scope === 'teams'
              ? teams.find(t => (event.target.teamIds ?? []).includes(t.id))
              : null;
            const teamLogo = firstTeam?.logoUrl || structureLogoUrl;
            const teamLabel = firstTeam?.name || 'Équipe';
            const teamInitials = teamLabel.slice(0, 3).toUpperCase();
            const advInitials = event.adversaire.slice(0, 3).toUpperCase();
            return (
              <div className="mt-2 inline-flex items-center gap-3 px-3 py-2 max-w-full"
                style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.3)' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {teamLogo ? (
                    <div className="flex-shrink-0" style={{ width: '28px', height: '28px', position: 'relative' }}>
                      <Image src={teamLogo} alt={teamLabel} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 flex items-center justify-center font-display"
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '10px', color: 'var(--s-text-dim)' }}>
                      {teamInitials}
                    </div>
                  )}
                  <span className="font-display tracking-wider truncate" style={{ fontSize: '13px', color: 'var(--s-text)' }}>
                    {teamLabel.toUpperCase()}
                  </span>
                </div>
                <span className="font-display flex-shrink-0" style={{ fontSize: '12px', color: 'var(--s-gold)', letterSpacing: '0.1em' }}>VS</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-display tracking-wider truncate" style={{ fontSize: '13px', color: 'var(--s-text)' }}>
                    {event.adversaire.toUpperCase()}
                  </span>
                  {event.adversaireLogoUrl ? (
                    <div className="flex-shrink-0" style={{ width: '28px', height: '28px', position: 'relative' }}>
                      <Image src={event.adversaireLogoUrl} alt={event.adversaire} fill className="object-contain" unoptimized />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 flex items-center justify-center font-display"
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '10px', color: 'var(--s-text-dim)' }}>
                      {advInitials}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* Presence counts + my response */}
        <div className="flex-shrink-0 flex flex-col items-end gap-2" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1.5">
            <span className="tag" style={{ background: 'rgba(51,255,102,0.1)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.3)', fontSize: '9px', padding: '1px 5px' }}>
              {counts.present}
            </span>
            <span className="tag" style={{ background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.3)', fontSize: '9px', padding: '1px 5px' }}>
              {counts.maybe}
            </span>
            <span className="tag" style={{ background: 'rgba(255,85,85,0.1)', color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)', fontSize: '9px', padding: '1px 5px' }}>
              {counts.absent}
            </span>
          </div>
          {myPresence && event.status === 'scheduled' && (
            <div className="flex gap-1">
              {(['present', 'maybe', 'absent'] as const).map(s => (
                <button key={s} type="button"
                  onClick={() => onRespond(event.id, s)}
                  title={PRESENCE_INFO[s].label}
                  className="transition-all duration-150"
                  style={{
                    width: '20px', height: '20px',
                    background: myPresence.status === s ? `${PRESENCE_INFO[s].color}20` : 'transparent',
                    border: `1px solid ${myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-border)'}`,
                    color: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-text-muted)',
                    fontSize: '9px',
                    cursor: 'pointer',
                  }}>
                  {s === 'present' ? '✓' : s === 'maybe' ? '?' : '✗'}
                </button>
              ))}
            </div>
          )}
          <ChevronRight size={12} style={{ color: 'var(--s-text-muted)' }} />
        </div>
      </div>
    </div>
  );
}

// ─── Event form modal ──────────────────────────────────────────────────

function EventFormModal({
  structureId,
  structureGames,
  teams,
  members,
  userContext,
  onClose,
  onCreated,
}: {
  structureId: string;
  structureGames: string[];
  teams: Team[];
  members: Member[];
  userContext: UserContext;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('training');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [scope, setScope] = useState<EventScope>(
    isDirigeant(userContext) ? 'structure' : 'teams'
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [game, setGame] = useState<string>('');
  const [adversaire, setAdversaire] = useState('');
  const [adversaireLogoUrl, setAdversaireLogoUrl] = useState('');
  const [resultat, setResultat] = useState('');
  const [markDone, setMarkDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sélection fine des joueurs ("feuille de match") — seulement quand UNE équipe
  // est ciblée. Clé = uid ; true = invité + pingé, false = exclu.
  const [playerSelection, setPlayerSelection] = useState<Record<string, boolean>>({});

  // Roster de l'équipe unique sélectionnée (si applicable) — titulaires + remplaçants + staff
  const singleTeamRoster = useMemo(() => {
    if (scope !== 'teams' || selectedTeamIds.length !== 1) return null;
    const team = teams.find(t => t.id === selectedTeamIds[0]);
    if (!team) return null;
    const titulaires = team.playerIds ?? [];
    const remplacants = team.subIds ?? [];
    const staff = team.staffIds ?? [];
    // Dédupe en préservant l'ordre (un staff qui est aussi joueur apparaît en joueur)
    const seen = new Set<string>();
    const order: Array<{ uid: string; role: 'titulaire' | 'remplacant' | 'staff' }> = [];
    for (const uid of titulaires) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'titulaire' }); }
    for (const uid of remplacants) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'remplacant' }); }
    for (const uid of staff) if (uid && !seen.has(uid)) { seen.add(uid); order.push({ uid, role: 'staff' }); }
    return { team, entries: order };
  }, [scope, selectedTeamIds, teams]);

  // Quand le roster change, tout pré-cocher par défaut.
  useEffect(() => {
    if (!singleTeamRoster) {
      setPlayerSelection({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const e of singleTeamRoster.entries) next[e.uid] = true;
    setPlayerSelection(next);
  }, [singleTeamRoster]);

  // Les équipes dispos au ciblage :
  //   - dirigeant → toutes
  //   - sinon → uniquement celles dont l'user est staff
  const selectableTeams = isDirigeant(userContext)
    ? teams
    : teams.filter(t =>
        userContext.staffedTeamIds.includes(t.id) ||
        (userContext.captainOfTeamIds ?? []).includes(t.id)
      );

  function toggleTeam(id: string) {
    setSelectedTeamIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!firebaseUser) return;
    if (!title.trim()) return toast.error('Titre obligatoire');
    if (!startsAt || !endsAt) return toast.error('Dates obligatoires');

    // Si feuille de match active (1 équipe) : si certains joueurs sont décochés,
    // on envoie userIds avec la sous-sélection. Si tout est coché, on omet le
    // champ pour garder le comportement par défaut côté back.
    let userIdsOverride: string[] | undefined = undefined;
    if (scope === 'teams' && singleTeamRoster && singleTeamRoster.entries.length > 0) {
      const keep = singleTeamRoster.entries
        .map(e => e.uid)
        .filter(uid => playerSelection[uid]);
      if (keep.length === 0) {
        return toast.error('Coche au moins un joueur.');
      }
      if (keep.length < singleTeamRoster.entries.length) {
        userIdsOverride = keep;
      }
    }

    const target: EventTarget = scope === 'structure'
      ? { scope: 'structure' }
      : scope === 'game'
        ? { scope: 'game', game }
        : { scope: 'teams', teamIds: selectedTeamIds, ...(userIdsOverride ? { userIds: userIdsOverride } : {}) };

    if (scope === 'teams' && selectedTeamIds.length === 0) {
      return toast.error('Choisis au moins une équipe');
    }
    if (scope === 'game' && !game) {
      return toast.error('Choisis un jeu');
    }

    const startIso = new Date(startsAt).toISOString();
    const endIso = new Date(endsAt).toISOString();

    setSubmitting(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          title: title.trim(),
          type,
          description,
          location,
          startsAt: startIso,
          endsAt: endIso,
          target,
          adversaire: adversaire || undefined,
          adversaireLogoUrl: type === 'match' && adversaireLogoUrl ? adversaireLogoUrl : undefined,
          resultat: resultat || undefined,
          markDoneImmediately: markDone,
        }),
      });
      if (res.ok) {
        toast.success('Événement créé');
        onCreated();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSubmitting(false);
  }

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="bevel relative w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 70%)' }} />
        <div className="p-6 space-y-4">
          <h2 className="font-display text-2xl">NOUVEL ÉVÉNEMENT</h2>

          <div>
            <label className="t-label block mb-1.5">Titre *</label>
            <input type="text" className="settings-input w-full" value={title} onChange={e => setTitle(e.target.value)} placeholder="Entraînement mardi soir" maxLength={120} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="t-label block mb-1.5">Type</label>
              <select className="settings-input w-full" value={type} onChange={e => setType(e.target.value as EventType)}>
                <option value="training">Entraînement</option>
                <option value="scrim">Scrim</option>
                <option value="match">Match</option>
                <option value="springs">Springs</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            <div>
              <label className="t-label block mb-1.5">Lieu (optionnel)</label>
              <input type="text" className="settings-input w-full" value={location} onChange={e => setLocation(e.target.value)} placeholder="Discord, IRL..." maxLength={200} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="t-label block mb-1.5">Début *</label>
              <DateTimePicker
                value={startsAt}
                onChange={setStartsAt}
                placeholder="Choisir début..."
                presetMode="start"
              />
            </div>
            <div>
              <label className="t-label block mb-1.5">Fin *</label>
              <DateTimePicker
                value={endsAt}
                onChange={setEndsAt}
                placeholder="Choisir fin..."
                presetMode="end"
                anchorIso={startsAt}
                min={startsAt}
              />
            </div>
          </div>

          {/* Cible */}
          <div>
            <label className="t-label block mb-1.5">Cible *</label>
            <div className="flex gap-2 mb-2">
              {isDirigeant(userContext) && (
                <button type="button" onClick={() => setScope('structure')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'structure' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'structure' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'structure' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '10px',
                  }}>
                  Toute la structure
                </button>
              )}
              <button type="button" onClick={() => setScope('teams')}
                className="tag transition-all duration-150"
                style={{
                  background: scope === 'teams' ? 'rgba(255,184,0,0.15)' : 'transparent',
                  color: scope === 'teams' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                  borderColor: scope === 'teams' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                  cursor: 'pointer', padding: '6px 12px', fontSize: '10px',
                }}>
                Équipes
              </button>
              {isDirigeant(userContext) && (
                <button type="button" onClick={() => setScope('game')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'game' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'game' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'game' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '10px',
                  }}>
                  Un jeu
                </button>
              )}
            </div>

            {scope === 'teams' && (
              <div className="flex flex-wrap gap-2 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                {selectableTeams.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe disponible.</p>
                ) : selectableTeams.map(t => (
                  <button key={t.id} type="button" onClick={() => toggleTeam(t.id)}
                    className="tag transition-all duration-150"
                    style={{
                      background: selectedTeamIds.includes(t.id) ? (t.game === 'rocket_league' ? 'rgba(0,129,255,0.15)' : 'rgba(0,217,54,0.15)') : 'transparent',
                      color: selectedTeamIds.includes(t.id) ? (t.game === 'rocket_league' ? 'var(--s-blue)' : 'var(--s-green)') : 'var(--s-text-dim)',
                      borderColor: selectedTeamIds.includes(t.id) ? (t.game === 'rocket_league' ? 'rgba(0,129,255,0.4)' : 'rgba(0,217,54,0.4)') : 'var(--s-border)',
                      cursor: 'pointer', padding: '4px 10px', fontSize: '10px',
                    }}>
                    {t.name} · {t.game === 'rocket_league' ? 'RL' : 'TM'}
                  </button>
                ))}
              </div>
            )}

            {/* Feuille de match : sous-sélection de joueurs quand UNE seule équipe ciblée */}
            {scope === 'teams' && singleTeamRoster && singleTeamRoster.entries.length > 0 && (
              <div className="mt-3 p-3 bevel-sm space-y-3"
                style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users size={12} style={{ color: 'var(--s-text-dim)' }} />
                    <span className="t-label">Feuille de match</span>
                    <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      {singleTeamRoster.entries.filter(e => playerSelection[e.uid]).length}/{singleTeamRoster.entries.length}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '9px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = true;
                        setPlayerSelection(next);
                      }}>
                      Tous
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '9px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = e.role === 'titulaire';
                        setPlayerSelection(next);
                      }}>
                      Titulaires
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '9px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = false;
                        setPlayerSelection(next);
                      }}>
                      Aucun
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {singleTeamRoster.entries.map(entry => {
                    const m = members.find(x => x.userId === entry.uid);
                    const name = m?.displayName || entry.uid;
                    const checked = !!playerSelection[entry.uid];
                    const roleLabel = entry.role === 'titulaire' ? 'TIT' : entry.role === 'remplacant' ? 'SUB' : 'STAFF';
                    const roleColor = entry.role === 'titulaire'
                      ? 'var(--s-gold)'
                      : entry.role === 'remplacant'
                        ? 'var(--s-text-dim)'
                        : 'var(--s-violet-light)';
                    return (
                      <label key={entry.uid}
                        className="flex items-center gap-2 p-2 cursor-pointer transition-colors duration-150"
                        style={{
                          background: checked ? 'rgba(255,184,0,0.08)' : 'transparent',
                          border: `1px solid ${checked ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                        }}>
                        <input type="checkbox" checked={checked}
                          onChange={e => setPlayerSelection(prev => ({ ...prev, [entry.uid]: e.target.checked }))} />
                        <span className="text-xs flex-1 truncate" style={{ color: checked ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
                          {name}
                        </span>
                        <span className="t-label" style={{ color: roleColor, fontSize: '9px' }}>
                          {roleLabel}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Seuls les joueurs cochés seront invités et pingés dans Discord.
                </p>
              </div>
            )}

            {scope === 'game' && (
              <div className="flex gap-2">
                {structureGames.includes('rocket_league') && (
                  <button type="button" onClick={() => setGame('rocket_league')}
                    className={`tag ${game === 'rocket_league' ? 'tag-blue' : 'tag-neutral'}`}
                    style={{ cursor: 'pointer', padding: '4px 10px', fontSize: '10px' }}>
                    Rocket League
                  </button>
                )}
                {structureGames.includes('trackmania') && (
                  <button type="button" onClick={() => setGame('trackmania')}
                    className={`tag ${game === 'trackmania' ? 'tag-green' : 'tag-neutral'}`}
                    style={{ cursor: 'pointer', padding: '4px 10px', fontSize: '10px' }}>
                    Trackmania
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="t-label block mb-1.5">Description (optionnel)</label>
            <textarea className="settings-input w-full" rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} />
          </div>

          {type === 'match' && (
            <div className="bevel-sm p-3 space-y-3"
              style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.3)' }}>
              <div className="flex items-center gap-2">
                <span className="tag"
                  style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '9px', padding: '2px 8px' }}>
                  ⚔ MATCH OFFICIEL
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Affiché avec mise en avant côté site et Discord.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Adversaire</label>
                  <input type="text" className="settings-input w-full" value={adversaire}
                    onChange={e => setAdversaire(e.target.value)} placeholder="Nom de l'équipe adverse" />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Résultat (optionnel)</label>
                  <input type="text" className="settings-input w-full" value={resultat}
                    onChange={e => setResultat(e.target.value)} placeholder="3-2, WIN..." />
                </div>
              </div>
              <div>
                <label className="t-label block mb-1.5">Logo adversaire (URL HTTPS, optionnel)</label>
                <input type="url" className="settings-input w-full" value={adversaireLogoUrl}
                  onChange={e => setAdversaireLogoUrl(e.target.value)}
                  placeholder="https://..." maxLength={500} />
                <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
                  Affiché dans la card et dans l&apos;embed Discord. HTTPS uniquement.
                </p>
              </div>
            </div>
          )}

          {type === 'scrim' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="t-label block mb-1.5">Adversaire (optionnel)</label>
                <input type="text" className="settings-input w-full" value={adversaire}
                  onChange={e => setAdversaire(e.target.value)} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Résultat (optionnel)</label>
                <input type="text" className="settings-input w-full" value={resultat}
                  onChange={e => setResultat(e.target.value)} placeholder="3-2, WIN..." />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input type="checkbox" id="markDone" checked={markDone} onChange={e => setMarkDone(e.target.checked)} />
            <label htmlFor="markDone" className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
              Créer directement comme terminé (rétroactif)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-springs btn-secondary bevel-sm">
              Annuler
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="btn-springs btn-primary bevel-sm">
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              <span>Créer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ─── Event detail modal ────────────────────────────────────────────────

function EventDetailModal({
  event,
  currentUid,
  userContext,
  structureId,
  teams,
  structureLogoUrl,
  membersById,
  onClose,
  onRespond,
  onStatusAction,
  onDelete,
  onReload,
}: {
  event: CalendarEvent;
  currentUid: string;
  userContext: UserContext;
  structureId: string;
  teams: Team[];
  structureLogoUrl?: string;
  membersById: Map<string, Member>;
  onClose: () => void;
  onRespond: (eventId: string, status: PresenceStatus) => void;
  onStatusAction: (eventId: string, action: 'terminate' | 'reopen' | 'cancel') => void;
  onDelete: (eventId: string, title: string) => void;
  onReload: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const typeInfo = TYPE_INFO[event.type];
  const statusInfo = STATUS_INFO[event.status];
  const myPresence = event.presences.find(p => p.userId === currentUid);

  const permEvent = {
    createdBy: event.createdBy,
    target: event.target,
    status: event.status,
  };
  const canEdit = canEditEvent(userContext, permEvent);
  const canDelete = canDeleteEvent(userContext, permEvent);
  const canTerminate = canMarkTerminated(userContext, permEvent);

  const [compteRendu, setCompteRendu] = useState(event.compteRendu);
  const [aTravailler, setATravailler] = useState(event.aTravailler);
  const [adversaire, setAdversaire] = useState(event.adversaire ?? '');
  const [adversaireLogoUrl, setAdversaireLogoUrl] = useState(event.adversaireLogoUrl ?? '');
  const [resultat, setResultat] = useState(event.resultat ?? '');
  const [saving, setSaving] = useState(false);

  async function saveNotes() {
    if (!firebaseUser) return;
    setSaving(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await fetch(`/api/structures/${structureId}/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          compteRendu,
          aTravailler,
          adversaire,
          resultat,
          ...(event.type === 'match' ? { adversaireLogoUrl } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Enregistré');
        onReload();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erreur');
      }
    } catch {
      toast.error('Erreur réseau');
    }
    setSaving(false);
  }

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return event.target.game === 'rocket_league' ? 'Rocket League' : 'Trackmania';
    const names = (event.target.teamIds ?? [])
      .map(id => teams.find(t => t.id === id)?.name)
      .filter(Boolean);
    return names.length ? names.join(', ') : 'Équipes';
  })();

  const presenceGroups = {
    present: event.presences.filter(p => p.status === 'present'),
    maybe: event.presences.filter(p => p.status === 'maybe'),
    absent: event.presences.filter(p => p.status === 'absent'),
    pending: event.presences.filter(p => p.status === 'pending'),
  };

  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="bevel relative w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />

        <div className="p-6 space-y-5">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              {event.type === 'match' && event.adversaire && (
                <span className="tag"
                  style={{ background: 'rgba(255,184,0,0.18)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.5)', fontSize: '9px', padding: '2px 8px' }}>
                  ⚔ MATCH OFFICIEL
                </span>
              )}
              <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '9px', padding: '2px 8px' }}>
                {typeInfo.label}
              </span>
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '2px 8px' }}>
                {statusInfo.label}
              </span>
            </div>

            {/* Bannière VS pour les matchs officiels — logos + noms en grand */}
            {event.type === 'match' && event.adversaire && (() => {
              const firstTeam = event.target.scope === 'teams'
                ? teams.find(t => (event.target.teamIds ?? []).includes(t.id))
                : null;
              const teamLogo = firstTeam?.logoUrl || structureLogoUrl;
              const teamLabel = firstTeam?.name || 'Équipe';
              const teamInitials = teamLabel.slice(0, 3).toUpperCase();
              const advInitials = event.adversaire.slice(0, 3).toUpperCase();
              return (
                <div className="mb-3 p-4 bevel-sm flex items-center justify-center gap-4"
                  style={{ background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.35)' }}>
                  <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <span className="font-display text-xl tracking-wider truncate" style={{ color: 'var(--s-text)' }}>
                      {teamLabel.toUpperCase()}
                    </span>
                    {teamLogo ? (
                      <div className="flex-shrink-0" style={{ width: '40px', height: '40px', position: 'relative' }}>
                        <Image src={teamLogo} alt={teamLabel} fill className="object-contain" unoptimized />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 flex items-center justify-center font-display"
                        style={{ width: '40px', height: '40px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                        {teamInitials}
                      </div>
                    )}
                  </div>
                  <span className="font-display text-2xl flex-shrink-0" style={{ color: 'var(--s-gold)' }}>VS</span>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {event.adversaireLogoUrl ? (
                      <div className="flex-shrink-0" style={{ width: '40px', height: '40px', position: 'relative' }}>
                        <Image src={event.adversaireLogoUrl} alt={event.adversaire} fill className="object-contain" unoptimized />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 flex items-center justify-center font-display"
                        style={{ width: '40px', height: '40px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
                        {advInitials}
                      </div>
                    )}
                    <span className="font-display text-xl tracking-wider truncate" style={{ color: 'var(--s-text)' }}>
                      {event.adversaire.toUpperCase()}
                    </span>
                  </div>
                </div>
              );
            })()}

            <h2 className="font-display text-3xl mb-2">{event.title}</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <Clock size={11} /> {fmtDateTime(event.startsAt)} → {fmtTime(event.endsAt)}
              </span>
              <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <Target size={11} /> {targetLabel}
              </span>
              {event.location && (
                <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                  <MapPin size={11} /> {event.location}
                </span>
              )}
            </div>
          </div>

          {event.description && (
            <div>
              <p className="t-label mb-1.5">DESCRIPTION</p>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>{event.description}</p>
            </div>
          )}

          {/* Ma réponse */}
          {myPresence && event.status === 'scheduled' && (
            <div>
              <p className="t-label mb-1.5">MA PRÉSENCE</p>
              <div className="flex gap-2">
                {(['present', 'maybe', 'absent'] as const).map(s => (
                  <button key={s} type="button" onClick={() => onRespond(event.id, s)}
                    className="tag transition-all duration-150"
                    style={{
                      background: myPresence.status === s ? `${PRESENCE_INFO[s].color}20` : 'transparent',
                      color: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-text-dim)',
                      borderColor: myPresence.status === s ? PRESENCE_INFO[s].color : 'var(--s-border)',
                      cursor: 'pointer', padding: '6px 14px', fontSize: '10px',
                    }}>
                    {PRESENCE_INFO[s].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Présences */}
          <div>
            <p className="t-label mb-2">PRÉSENCES ({event.presences.length})</p>
            <div className="grid grid-cols-2 gap-3">
              {(['present', 'maybe', 'absent', 'pending'] as const).map(status => (
                <div key={status} className="p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <p className="t-label mb-2" style={{ color: PRESENCE_INFO[status].color }}>
                    {PRESENCE_INFO[status].label} ({presenceGroups[status].length})
                  </p>
                  <div className="space-y-1">
                    {presenceGroups[status].length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>–</p>
                    ) : presenceGroups[status].map(p => {
                      const m = membersById.get(p.userId);
                      const displayName = m?.displayName || p.userId.slice(0, 8);
                      const avatar = m?.avatarUrl || m?.discordAvatar;
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          {avatar ? (
                            <Image src={avatar} alt={displayName} width={16} height={16} unoptimized />
                          ) : (
                            <div className="w-4 h-4" style={{ background: 'var(--s-surface)' }} />
                          )}
                          <span className="text-xs truncate" style={{ color: m ? 'var(--s-text)' : 'var(--s-text-muted)' }}>
                            {displayName}
                            {!p.wasStructureMember && <span className="ml-1" style={{ fontSize: '8px', color: 'var(--s-text-muted)' }}>(ancien)</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Match/scrim : adversaire + résultat (+ logo adversaire pour match) */}
          {(event.type === 'match' || event.type === 'scrim') && canEdit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Adversaire</label>
                  <input type="text" className="settings-input w-full" value={adversaire} onChange={e => setAdversaire(e.target.value)} />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Résultat</label>
                  <input type="text" className="settings-input w-full" value={resultat} onChange={e => setResultat(e.target.value)} />
                </div>
              </div>
              {event.type === 'match' && (
                <div>
                  <label className="t-label block mb-1.5">Logo adversaire (URL HTTPS, optionnel)</label>
                  <input type="url" className="settings-input w-full"
                    value={adversaireLogoUrl}
                    onChange={e => setAdversaireLogoUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
              )}
            </div>
          )}

          {/* Compte rendu / à travailler : visibles pour tous, éditables pour staff */}
          <div>
            <label className="t-label block mb-1.5">COMPTE RENDU</label>
            {canEdit ? (
              <textarea className="settings-input w-full" rows={4} value={compteRendu} onChange={e => setCompteRendu(e.target.value)} maxLength={10000} />
            ) : (
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                {compteRendu || <em style={{ color: 'var(--s-text-muted)' }}>Aucun compte rendu.</em>}
              </p>
            )}
          </div>

          <div>
            <label className="t-label block mb-1.5">À TRAVAILLER</label>
            {canEdit ? (
              <textarea className="settings-input w-full" rows={3} value={aTravailler} onChange={e => setATravailler(e.target.value)} maxLength={10000} />
            ) : (
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                {aTravailler || <em style={{ color: 'var(--s-text-muted)' }}>–</em>}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap justify-between gap-2 pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
            <div className="flex gap-2 flex-wrap pt-3">
              {canEdit && (
                <button type="button" onClick={saveNotes} disabled={saving}
                  className="btn-springs btn-primary bevel-sm text-xs">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  <span>Enregistrer</span>
                </button>
              )}
              {canTerminate && event.status === 'scheduled' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'terminate')}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#33ff66', borderColor: 'rgba(51,255,102,0.3)' }}>
                  <CheckCircle size={11} /> <span>Marquer terminé</span>
                </button>
              )}
              {canTerminate && event.status === 'done' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'reopen')}
                  className="btn-springs btn-secondary bevel-sm text-xs">
                  <span>Rouvrir</span>
                </button>
              )}
              {canTerminate && event.status === 'scheduled' && (
                <button type="button" onClick={() => onStatusAction(event.id, 'cancel')}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#ff8888', borderColor: 'rgba(255,85,85,0.3)' }}>
                  <XCircle size={11} /> <span>Annuler</span>
                </button>
              )}
            </div>
            <div className="flex gap-2 pt-3">
              {canDelete && (
                <button type="button" onClick={() => onDelete(event.id, event.title)}
                  className="btn-springs btn-secondary bevel-sm text-xs" style={{ color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)' }}>
                  <Trash2 size={11} /> <span>Supprimer</span>
                </button>
              )}
              <button type="button" onClick={onClose}
                className="btn-springs btn-secondary bevel-sm text-xs">
                Fermer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
