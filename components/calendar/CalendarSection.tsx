'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/api-client';
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
  User,
  LayoutGrid,
  List,
  CalendarRange,
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
  normalizeEventType,
} from '@/lib/event-permissions';
import ReplaysPanel from '@/components/replays/ReplaysPanel';
import MonthView from './MonthView';
import WeekView from './WeekView';
import { ALL_GAME_DEFS, getGameColor, getGameColorRgb, getGameLabel, getGameShortLabel } from '@/lib/games-registry';
import StaffAvailabilityView from './StaffAvailabilityView';
import { NewTodoForm, type TeamRef } from './TeamTodosPanel';
import { useTodoTemplates } from './TodoTemplatesManager';
import { ListTodo } from 'lucide-react';

type Presence = {
  id: string;
  userId: string;
  status: PresenceStatus;
  wasStructureMember: boolean;
  respondedAt: string | null;
  updatedBy: string | null;
};

export type CalendarEvent = {
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
  tournoiNom: string | null;
  tournoiFormat: string | null;
  tournoiUrl: string | null;
  tournoiInscriptionUrl: string | null;
  tournoiReglementUrl: string | null;
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

// Item de la liste d'exercices déjà assignés à un event (affiché dans
// EventDetailModal sous le bouton 'Assigner des exercices').
type AssignedTodoItem = {
  id: string;
  assigneeId: string;
  type: string;
  title: string;
  description: string;
  config: Record<string, unknown>;
  eventId: string | null;
  deadline: string | null;
  done: boolean;
};

export type Team = {
  id: string;
  game: string;
  name: string;
  logoUrl?: string;
  label?: string;
  order?: number;
  groupOrder?: number;
  playerIds?: string[];
  subIds?: string[];
  staffIds?: string[];
  staffRoles?: Record<string, 'coach' | 'manager'>;
  captainId?: string | null;
};

// Rôles structure, utilisés pour dériver l'audience staff côté client
// (scope='staff' dans le formulaire). Source : structure doc.
type StructureRoles = {
  founderId: string;
  coFounderIds?: string[];
  managerIds?: string[];
  coachIds?: string[];
};

type Props = {
  structureId: string;
  structureGames: string[];
  structureLogoUrl?: string;
  members: Member[];
  teams: Team[];
  userContext: UserContext;
  structureRoles: StructureRoles;
};

export const TYPE_INFO: Record<EventType, { label: string; color: string }> = {
  training: { label: 'Entraînement', color: 'var(--s-text-dim)' },
  scrim: { label: 'Scrim', color: 'var(--s-blue)' },
  match: { label: 'Match', color: 'var(--s-gold)' },
  tournoi: { label: 'Tournoi', color: '#00D9B5' },
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

// Jetons spéciaux du filtre d'audience, distincts des IDs d'équipe (Firestore).
// Permettent de filtrer aussi les événements staff et structure-wide.
const FILTER_STAFF = '__staff__';
const FILTER_STRUCTURE = '__structure__';

// Un événement passe-t-il le filtre d'audience ? (filtre vide = tout passe)
function eventMatchesAudienceFilter(e: CalendarEvent, filter: string[]): boolean {
  if (filter.length === 0) return true;
  const t = e.target;
  if (t.scope === 'teams') return (t.teamIds ?? []).some(id => filter.includes(id));
  if (t.scope === 'staff') return filter.includes(FILTER_STAFF);
  if (t.scope === 'structure') return filter.includes(FILTER_STRUCTURE);
  return false; // scope 'game' : pas de filtre dédié pour l'instant
}

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
  structureRoles,
}: Props) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const qc = useQueryClient();
  const eventsQueryKey = ['structure', structureId, 'events'] as const;
  const { data: eventsData, isPending: loading } = useQuery({
    queryKey: eventsQueryKey,
    queryFn: () => api<{ events: CalendarEvent[] }>(`/api/structures/${structureId}/events`),
    enabled: !!firebaseUser,
  });
  const events = eventsData?.events ?? [];
  const invalidateEvents = () => qc.invalidateQueries({ queryKey: eventsQueryKey });

  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  // Filtre équipe : si vide → toutes ; sinon → seulement les events avec au moins
  // une équipe ciblée dans la sélection. Les events scope=structure/game sont
  // exclus dès qu'un filtre équipe est actif, pour coller à l'intention utilisateur.
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  // Mode d'affichage : grille mois (vision globale), semaine (créneaux + dispos)
  // ou liste chronologique. Persisté en localStorage entre les sessions.
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list' | 'staff'>('month');
  useEffect(() => {
    const saved = localStorage.getItem('aedral_calendar_view');
    if (saved === 'month' || saved === 'week' || saved === 'list' || saved === 'staff') setViewMode(saved);
}, []);
  const changeView = (v: 'month' | 'week' | 'list' | 'staff') => {
    setViewMode(v);
    try { localStorage.setItem('aedral_calendar_view', v); } catch { /* quota / mode privé */ }
  };
  // Vue Semaine : la grille 7 colonnes × créneaux 30 min est inexploitable en
  // <lg, mais la WeekView a maintenant un mode mobile (1 jour à la fois avec
  // strip de sélection des 7 jours). On laisse donc le bouton accessible partout.
  const effectiveViewMode = viewMode;
  // formPrefill : null = modale fermée ; objet = ouverte (éventuellement pré-remplie
  // avec une date quand on a cliqué sur une case du calendrier).
  const [formPrefill, setFormPrefill] = useState<{ startsAt?: string; endsAt?: string } | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadEvents = invalidateEvents;

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
    const filtered = events.filter(e => {
      if (filter !== 'all') {
        const end = e.endsAt ? new Date(e.endsAt).getTime() : 0;
        if (filter === 'upcoming' && !(end >= now && e.status !== 'cancelled')) return false;
        if (filter === 'past' && !(end < now || e.status === 'cancelled' || e.status === 'done')) return false;
      }
      if (!eventMatchesAudienceFilter(e, teamFilter)) return false;
      return true;
    });
    // "À venir" → ordre ascendant (le plus proche en haut). "Passés"/"Tous" → descendant (plus récent en haut).
    const asc = filter === 'upcoming';
    return filtered.sort((a, b) => {
      const aMs = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bMs = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return asc ? aMs - bMs : bMs - aMs;
    });
  }, [events, filter, now, teamFilter]);

  // Événements pour la vue Mois : filtrés uniquement par le filtre équipe
  // (la grille gère elle-même le périmètre temporel via la navigation des mois).
  const monthEvents = useMemo(() => {
    if (teamFilter.length === 0) return events;
    return events.filter(e => eventMatchesAudienceFilter(e, teamFilter));
  }, [events, teamFilter]);

  // Prochain événement (toutes équipes confondues), sert au bandeau récap.
  const nextEvent = useMemo(() => {
    return events
      .filter(e => e.startsAt && e.status !== 'cancelled'
        && new Date(e.endsAt ?? e.startsAt).getTime() >= now)
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))[0] ?? null;
  }, [events, now]);

  const respondMutation = useMutation({
    mutationFn: ({ eventId, status }: { eventId: string; status: PresenceStatus }) =>
      api(`/api/structures/${structureId}/events/${eventId}/presence`, {
        method: 'POST', body: { status },
      }),
    onSuccess: () => { toast.success('Réponse enregistrée'); invalidateEvents(); },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const handleRespond = (eventId: string, status: PresenceStatus) =>
    respondMutation.mutate({ eventId, status });

  const statusMutation = useMutation({
    mutationFn: ({ eventId, action }: { eventId: string; action: 'terminate' | 'reopen' | 'cancel' }) =>
      api(`/api/structures/${structureId}/events/${eventId}/status`, {
        method: 'POST', body: { action },
      }),
    onSuccess: () => { toast.success('OK'); invalidateEvents(); },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const handleStatusAction = (eventId: string, action: 'terminate' | 'reopen' | 'cancel') =>
    statusMutation.mutate({ eventId, action });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) =>
      api(`/api/structures/${structureId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Événement supprimé'); setOpenEventId(null); invalidateEvents(); },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  async function handleDelete(eventId: string, title: string) {
    const ok = await confirm({
      title: 'Supprimer cet événement ?',
      message: `"${title}" sera supprimé avec toutes les présences. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    deleteMutation.mutate(eventId);
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
      <div className="relative z-[1] px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 flex items-center justify-center" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)' }}>
            <CalendarIcon size={13} style={{ color: 'var(--s-gold)' }} />
          </div>
          <span className="font-display text-sm tracking-wider">CALENDRIER</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Bascule de vue : grille mois / semaine / liste / staff (responsable+) */}
          <div className="flex bevel-sm overflow-hidden" style={{ border: '1px solid var(--s-border)' }}>
            {([
              { v: 'month' as const, label: 'Mois', icon: <LayoutGrid size={12} />, gated: false },
              { v: 'week' as const, label: 'Semaine', icon: <CalendarRange size={12} />, gated: false },
              { v: 'list' as const, label: 'Liste', icon: <List size={12} />, gated: false },
              // Onglet STAFF : nouveau (Matt 2026-05-25), affiche les dispos du
              // pool staff (dirigeants + responsable + coach structure + staff
              // d'équipes + capitaines). Visible uniquement pour le responsable +
              // dirigeants (= ceux qui organisent des réunions staff).
              { v: 'staff' as const, label: 'Staff', icon: <Users size={12} />, gated: !(isDirigeant(userContext) || userContext.isManager) },
            ]).filter(opt => !opt.gated).map(opt => (
              <button key={opt.v} type="button" onClick={() => changeView(opt.v)}
                className="flex items-center gap-1.5 text-xs font-semibold transition-colors duration-150"
                style={{
                  padding: '5px 10px',
                  background: effectiveViewMode === opt.v ? 'rgba(255,184,0,0.15)' : 'var(--s-elevated)',
                  color: effectiveViewMode === opt.v ? 'var(--s-gold)' : 'var(--s-text-dim)',
                }}>
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          {canCreateAnything && (
            <button type="button" onClick={() => setFormPrefill({})}
              className="flex items-center gap-1.5 text-xs font-bold transition-colors duration-150" style={{ color: 'var(--s-gold)' }}>
              <Plus size={11} />
              Nouvel événement
            </button>
          )}
        </div>
      </div>

      {/* Bandeau récap, accès direct au prochain événement */}
      {nextEvent && (
        <button type="button" onClick={() => setOpenEventId(nextEvent.id)}
          className="relative z-[1] w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--s-hover)]"
          style={{ borderBottom: '1px solid var(--s-border)', background: 'var(--s-elevated)' }}>
          <span className="t-label flex-shrink-0" style={{ color: 'var(--s-gold)' }}>Prochain</span>
          <span className="flex-shrink-0" style={{ width: 1, height: 14, background: 'var(--s-border)' }} />
          <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
            {fmtDateTime(nextEvent.startsAt)}
          </span>
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{nextEvent.title}</span>
          {(() => {
            const ti = TYPE_INFO[normalizeEventType(nextEvent.type)] ?? TYPE_INFO.autre;
            return (
              <span className="tag flex-shrink-0 ml-auto" style={{ background: `${ti.color}15`, color: ti.color, borderColor: `${ti.color}35`, fontSize: 12, padding: '1px 6px' }}>
                {ti.label}
              </span>
            );
          })()}
          <ChevronRight size={13} className="flex-shrink-0" style={{ color: 'var(--s-text-muted)' }} />
        </button>
      )}

      {/* Filtres temporels, pertinents uniquement en vue Liste
          (en vue Mois, le périmètre est donné par la navigation des mois). */}
      {effectiveViewMode === 'list' && (
        <div className="relative z-[1] px-4 sm:px-5 pt-4 flex flex-wrap gap-2">
          {(['upcoming', 'past', 'all'] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className="tag transition-all duration-150"
              style={{
                background: filter === f ? 'rgba(255,184,0,0.15)' : 'transparent',
                color: filter === f ? 'var(--s-gold)' : 'var(--s-text-dim)',
                borderColor: filter === f ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
              }}>
              {f === 'upcoming' ? 'À venir' : f === 'past' ? 'Passés' : 'Tous'}
            </button>
          ))}
        </div>
      )}

      {/* Filtre d'audience, équipes + staff + structure, multi-select scalable */}
      <TeamFilterDropdown teams={teams} value={teamFilter} onChange={setTeamFilter} />

      {/* Body */}
      <div className="relative z-[1] p-4 sm:p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : effectiveViewMode === 'month' ? (
          <MonthView
            events={monthEvents}
            teams={teams}
            now={now}
            canCreate={canCreateAnything}
            onEventClick={id => setOpenEventId(id)}
            onDayCreate={ymd => setFormPrefill({ startsAt: `${ymd}T20:00`, endsAt: `${ymd}T22:00` })}
          />
        ) : effectiveViewMode === 'week' ? (
          <WeekView
            structureId={structureId}
            events={monthEvents}
            teams={teams}
            teamFilter={teamFilter}
            now={now}
            canCreate={canCreateAnything}
            userContext={userContext}
            onEventClick={id => setOpenEventId(id)}
            onSlotCreate={(startsAt, endsAt) => setFormPrefill({ startsAt, endsAt })}
          />
        ) : effectiveViewMode === 'staff' ? (
          <StaffAvailabilityView
            structureId={structureId}
            members={members}
            teams={teams}
            structureRoles={structureRoles}
            canEditConfig={isDirigeant(userContext)}
          />
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

      {formPrefill !== null && (
        <EventFormModal
          structureId={structureId}
          structureGames={structureGames}
          teams={teams}
          members={members}
          userContext={userContext}
          structureRoles={structureRoles}
          initialStartsAt={formPrefill.startsAt}
          initialEndsAt={formPrefill.endsAt}
          onClose={() => setFormPrefill(null)}
          onCreated={() => {
            setFormPrefill(null);
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

  // Fermeture au clic dehors : on garde le listener mousedown (compat existante)
  // MAIS on ajoute aussi un overlay invisible plein écran (z lower que le panel)
  // qui intercepte les clics, plus fiable quand des handlers stoppent la
  // propagation (ex: bouton "Réinitialiser" en dehors du root).

  const query = q.trim().toLowerCase();
  // Même ordre que l'onglet Équipes : par groupe (groupOrder, label) puis order, nom.
  const filtered = (query
    ? teams.filter(t => t.name.toLowerCase().includes(query))
    : teams.slice()
  ).sort((a, b) => {
    const ga = a.groupOrder ?? 0, gb = b.groupOrder ?? 0;
    if (ga !== gb) return ga - gb;
    const lc = (a.label ?? '').localeCompare(b.label ?? '');
    if (lc !== 0) return lc;
    const oa = a.order ?? 0, ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    return a.name.localeCompare(b.name);
  });

  // Audiences spéciales, au-dessus de la liste des équipes.
  const SPECIALS = [
    { id: FILTER_STRUCTURE, label: 'Toute la structure' },
    { id: FILTER_STAFF, label: 'Staff' },
  ];
  const nameOf = (id: string): string => {
    const sp = SPECIALS.find(s => s.id === id);
    if (sp) return sp.label;
    return teams.find(t => t.id === id)?.name ?? '?';
  };
  const label = value.length === 0
    ? 'Tous'
    : value.length === 1
      ? nameOf(value[0])
      : `${value.length} sélectionnés`;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  return (
    <div className={`relative ${open ? 'z-40' : 'z-[1]'} px-5 pt-3 flex items-center gap-2`} data-team-filter-root>
      <span className="t-label" style={{ color: 'var(--s-text-muted)' }}>Afficher :</span>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 transition-all duration-150"
        style={{
          background: value.length > 0 ? 'rgba(255,184,0,0.12)' : 'transparent',
          color: value.length > 0 ? 'var(--s-gold)' : 'var(--s-text-dim)',
          border: `1px solid ${value.length > 0 ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
          cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
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
        <div className="fixed inset-0 z-[25]" onClick={() => setOpen(false)} />
      )}
      {open && (
        <div className="absolute left-5 top-full mt-1 z-30 w-[min(280px,calc(100vw-2.5rem))] max-h-[320px] overflow-hidden flex flex-col bevel-sm"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {teams.length > 6 && (
            <div className="p-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <input type="text" value={q} onChange={e => setQ(e.target.value)} autoFocus
                placeholder="Rechercher une équipe..."
                className="settings-input w-full text-xs" />
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            {/* Audiences spéciales : staff, structure entière */}
            <div style={{ borderBottom: '1px solid var(--s-border)' }}>
              {SPECIALS.map(sp => {
                const selected = value.includes(sp.id);
                return (
                  <button key={sp.id} type="button" onClick={() => toggle(sp.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--s-hover)]">
                    <span className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                      style={{ border: `1px solid ${selected ? 'var(--s-gold)' : 'var(--s-border)'}`, background: selected ? 'rgba(255,184,0,0.15)' : 'transparent' }}>
                      {selected && <Check size={10} style={{ color: 'var(--s-gold)' }} />}
                    </span>
                    <span className="w-1.5 h-1.5 flex-shrink-0" style={{ background: 'var(--s-gold)' }} />
                    <span className="text-xs flex-1 truncate" style={{ color: selected ? 'var(--s-text)' : 'var(--s-text-dim)' }}>{sp.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Équipes */}
            {teams.length === 0 ? null : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe.</span>
              </div>
            ) : filtered.map(t => {
              const selected = value.includes(t.id);
              const color = getGameColor(t.game);
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
  const typeInfo = TYPE_INFO[normalizeEventType(event.type)] ?? TYPE_INFO.autre;
  const statusInfo = STATUS_INFO[event.status] ?? STATUS_INFO.scheduled;
  const myPresence = event.presences.find(p => p.userId === currentUid);
  const counts = {
    present: event.presences.filter(p => p.status === 'present').length,
    absent: event.presences.filter(p => p.status === 'absent').length,
    maybe: event.presences.filter(p => p.status === 'maybe').length,
    pending: event.presences.filter(p => p.status === 'pending').length,
  };

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return getGameLabel(event.target.game);
    if (event.target.scope === 'staff') return 'Staff';
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
            <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '12px', padding: '1px 6px' }}>
              {typeInfo.label}
            </span>
            {event.status !== 'scheduled' && (
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '1px 6px' }}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{event.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="t-mono flex items-center gap-1" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
              <Target size={9} /> {targetLabel}
            </span>
            {event.location && (
              <span className="t-mono flex items-center gap-1" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
                <MapPin size={9} /> {event.location}
              </span>
            )}
            {event.type === 'scrim' && event.adversaire && (
              <span className="t-mono" style={{ fontSize: '12px', color: 'var(--s-text-dim)' }}>
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
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
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
                      style={{ width: '28px', height: '28px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', fontSize: '12px', color: 'var(--s-text-dim)' }}>
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
            <span className="tag" style={{ background: 'rgba(51,255,102,0.1)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.3)', fontSize: '12px', padding: '1px 5px' }}>
              {counts.present}
            </span>
            <span className="tag" style={{ background: 'rgba(255,184,0,0.1)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.3)', fontSize: '12px', padding: '1px 5px' }}>
              {counts.maybe}
            </span>
            <span className="tag" style={{ background: 'rgba(255,85,85,0.1)', color: '#ff5555', borderColor: 'rgba(255,85,85,0.3)', fontSize: '12px', padding: '1px 5px' }}>
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
                    fontSize: '12px',
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
  structureRoles,
  initialStartsAt,
  initialEndsAt,
  onClose,
  onCreated,
}: {
  structureId: string;
  structureGames: string[];
  teams: Team[];
  members: Member[];
  userContext: UserContext;
  structureRoles: StructureRoles;
  // Date/heure pré-remplies, passées quand on a cliqué sur une case du calendrier.
  // Format "YYYY-MM-DDTHH:mm" (heure locale), contrat de DateTimePicker.
  initialStartsAt?: string;
  initialEndsAt?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('training');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState(initialStartsAt ?? '');
  const [endsAt, setEndsAt] = useState(initialEndsAt ?? '');
  const [scope, setScope] = useState<EventScope>(
    isDirigeant(userContext) ? 'structure' : 'teams'
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [game, setGame] = useState<string>('');
  const [adversaire, setAdversaire] = useState('');
  const [adversaireLogoUrl, setAdversaireLogoUrl] = useState('');
  const [resultat, setResultat] = useState('');
  const [tournoiNom, setTournoiNom] = useState('');
  const [tournoiFormat, setTournoiFormat] = useState('');
  const [tournoiUrl, setTournoiUrl] = useState('');
  const [tournoiInscriptionUrl, setTournoiInscriptionUrl] = useState('');
  const [tournoiReglementUrl, setTournoiReglementUrl] = useState('');
  const [markDone, setMarkDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sélection fine des joueurs ("feuille de match"), seulement quand UNE équipe
  // est ciblée. Clé = uid ; true = invité + pingé, false = exclu.
  const [playerSelection, setPlayerSelection] = useState<Record<string, boolean>>({});

  // Sélection fine du staff (scope='staff'). Clé = uid ; obligatoire au moins un coché.
  const [staffSelection, setStaffSelection] = useState<Record<string, boolean>>({});

  // Qui peut créer un événement scope='staff' : dirigeants + managers (pas les coachs).
  const canCreateStaffEvent = isDirigeant(userContext) || userContext.isManager;

  // Audience staff dérivée côté client : 4 groupes (dirigeants/managers/coachs/capitaines).
  // Fusion rôles structure + staff d'équipe via sub_teams.staffRoles + capitaines.
  const staffAudienceGroups = useMemo(() => {
    const dir = new Set<string>();
    if (structureRoles.founderId) dir.add(structureRoles.founderId);
    for (const id of structureRoles.coFounderIds ?? []) if (id) dir.add(id);

    const mgr = new Set<string>();
    for (const id of structureRoles.managerIds ?? []) if (id) mgr.add(id);
    const coach = new Set<string>();
    for (const id of structureRoles.coachIds ?? []) if (id) coach.add(id);
    const captain = new Set<string>();

    for (const t of teams) {
      const staffIds = t.staffIds ?? [];
      const staffRoles = t.staffRoles ?? {};
      for (const uid of staffIds) {
        if (!uid) continue;
        const r = staffRoles[uid] ?? 'coach';
        if (r === 'manager') mgr.add(uid);
        else coach.add(uid);
      }
      if (t.captainId) captain.add(t.captainId);
    }

    // Dédupe inter-groupes : on privilégie le rôle le plus haut.
    // Hiérarchie : dirigeant > manager > coach > capitaine.
    for (const id of dir) { mgr.delete(id); coach.delete(id); captain.delete(id); }
    for (const id of mgr) { coach.delete(id); captain.delete(id); }
    for (const id of coach) captain.delete(id);

    return {
      dirigeants: Array.from(dir),
      managers: Array.from(mgr),
      coaches: Array.from(coach),
      captains: Array.from(captain),
    };
  }, [structureRoles, teams]);

  // Helper : résout un uid → {displayName, avatarUrl} via la liste members.
  function memberInfo(uid: string): { displayName: string; avatarUrl: string } {
    const m = members.find(m => m.userId === uid);
    return {
      displayName: m?.displayName || uid.replace(/^discord_/, ''),
      avatarUrl: m?.avatarUrl || m?.discordAvatar || '',
    };
  }

  // Roster de l'équipe unique sélectionnée (si applicable), titulaires + remplaçants + staff
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

  // Quand on passe en scope='staff', pré-cocher tout le monde par défaut.
  useEffect(() => {
    if (scope !== 'staff') {
      setStaffSelection({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const uid of staffAudienceGroups.dirigeants) next[uid] = true;
    for (const uid of staffAudienceGroups.managers) next[uid] = true;
    for (const uid of staffAudienceGroups.coaches) next[uid] = true;
    setStaffSelection(next);
  }, [scope, staffAudienceGroups]);

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

    // scope='staff' : sélection user-par-user obligatoire, au moins un coché.
    let staffUserIds: string[] = [];
    if (scope === 'staff') {
      const pool = [
        ...staffAudienceGroups.dirigeants,
        ...staffAudienceGroups.managers,
        ...staffAudienceGroups.coaches,
        ...staffAudienceGroups.captains,
      ];
      staffUserIds = pool.filter(uid => staffSelection[uid]);
      if (staffUserIds.length === 0) {
        return toast.error('Coche au moins un membre du staff.');
      }
    }

    const target: EventTarget = scope === 'structure'
      ? { scope: 'structure' }
      : scope === 'game'
        ? { scope: 'game', game }
        : scope === 'staff'
          ? { scope: 'staff', userIds: staffUserIds }
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
      await api(`/api/structures/${structureId}/events`, {
        method: 'POST',
        body: {
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
          tournoiNom: type === 'tournoi' ? (tournoiNom || undefined) : undefined,
          tournoiFormat: type === 'tournoi' ? (tournoiFormat || undefined) : undefined,
          tournoiUrl: type === 'tournoi' ? (tournoiUrl || undefined) : undefined,
          tournoiInscriptionUrl: type === 'tournoi' ? (tournoiInscriptionUrl || undefined) : undefined,
          tournoiReglementUrl: type === 'tournoi' ? (tournoiReglementUrl || undefined) : undefined,
          markDoneImmediately: markDone,
        },
      });
      toast.success('Événement créé');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
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
                <option value="tournoi">Tournoi</option>
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
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
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
                  cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
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
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                  }}>
                  Un jeu
                </button>
              )}
              {canCreateStaffEvent && (
                <button type="button" onClick={() => setScope('staff')}
                  className="tag transition-all duration-150"
                  style={{
                    background: scope === 'staff' ? 'rgba(255,184,0,0.15)' : 'transparent',
                    color: scope === 'staff' ? 'var(--s-gold)' : 'var(--s-text-dim)',
                    borderColor: scope === 'staff' ? 'rgba(255,184,0,0.4)' : 'var(--s-border)',
                    cursor: 'pointer', padding: '6px 12px', fontSize: '12px',
                  }}>
                  Staff
                </button>
              )}
            </div>

            {scope === 'teams' && (
              <div className="flex flex-wrap gap-2 p-3" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                {selectableTeams.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucune équipe disponible.</p>
                ) : selectableTeams.map(t => {
                  const isSelected = selectedTeamIds.includes(t.id);
                  const rgb = getGameColorRgb(t.game);
                  const fg = getGameColor(t.game);
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTeam(t.id)}
                      className="tag transition-all duration-150"
                      style={{
                        background: isSelected ? `rgba(${rgb}, 0.15)` : 'transparent',
                        color: isSelected ? fg : 'var(--s-text-dim)',
                        borderColor: isSelected ? `rgba(${rgb}, 0.4)` : 'var(--s-border)',
                        cursor: 'pointer', padding: '4px 10px', fontSize: '12px',
                      }}>
                      {t.name} · {getGameShortLabel(t.game)}
                    </button>
                  );
                })}
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
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = true;
                        setPlayerSelection(next);
                      }}>
                      Tous
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const e of singleTeamRoster.entries) next[e.uid] = e.role === 'titulaire';
                        setPlayerSelection(next);
                      }}>
                      Titulaires
                    </button>
                    <button type="button"
                      className="tag tag-neutral"
                      style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
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
                        : 'var(--s-gold)';
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
                        <span className="t-label" style={{ color: roleColor, fontSize: '12px' }}>
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
                {ALL_GAME_DEFS.filter(g => structureGames.includes(g.id)).map(g => {
                  const isSelected = game === g.id;
                  return (
                    <button key={g.id} type="button" onClick={() => setGame(g.id)}
                      className="tag"
                      style={{
                        cursor: 'pointer',
                        padding: '4px 10px',
                        fontSize: '12px',
                        background: isSelected ? `rgba(${g.colorRgb}, 0.1)` : 'rgba(255,255,255,0.04)',
                        color: isSelected ? g.colorLight : 'var(--s-text-dim)',
                        borderColor: isSelected ? `rgba(${g.colorRgb}, 0.25)` : 'var(--s-border)',
                      }}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
            )}

            {scope === 'staff' && (() => {
              const groups: Array<{
                key: 'dirigeants' | 'managers' | 'coaches' | 'captains';
                label: string;
                color: string;
                uids: string[];
              }> = [
                { key: 'dirigeants', label: 'Dirigeants', color: 'var(--s-gold)', uids: staffAudienceGroups.dirigeants },
                { key: 'managers', label: 'Responsables / Managers', color: 'var(--s-gold)', uids: staffAudienceGroups.managers },
                { key: 'coaches', label: 'Coachs', color: 'var(--s-blue)', uids: staffAudienceGroups.coaches },
                { key: 'captains', label: 'Capitaines', color: 'var(--s-green)', uids: staffAudienceGroups.captains },
              ];
              const allUids = [
                ...staffAudienceGroups.dirigeants,
                ...staffAudienceGroups.managers,
                ...staffAudienceGroups.coaches,
                ...staffAudienceGroups.captains,
              ];
              const total = allUids.length;
              const checkedCount = allUids.filter(uid => staffSelection[uid]).length;
              return (
                <div className="mt-0 p-3 bevel-sm space-y-3"
                  style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users size={12} style={{ color: 'var(--s-text-dim)' }} />
                      <span className="t-label">Invités staff</span>
                      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                        {checkedCount}/{total}
                      </span>
                    </div>
                    {total > 0 && (
                      <div className="flex gap-1">
                        <button type="button"
                          className="tag tag-neutral"
                          style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                          onClick={() => {
                            const next: Record<string, boolean> = {};
                            for (const g of groups) for (const uid of g.uids) next[uid] = true;
                            setStaffSelection(next);
                          }}>
                          Tout
                        </button>
                        <button type="button"
                          className="tag tag-neutral"
                          style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                          onClick={() => setStaffSelection({})}>
                          Aucun
                        </button>
                      </div>
                    )}
                  </div>

                  {total === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Aucun membre staff (dirigeants/responsables/coachs/capitaines) dans cette structure.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {groups.map(g => {
                        if (g.uids.length === 0) return null;
                        const groupChecked = g.uids.filter(uid => staffSelection[uid]).length;
                        const allChecked = groupChecked === g.uids.length;
                        return (
                          <div key={g.key} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="t-label" style={{ color: g.color, fontSize: '12px' }}>
                                  {g.label}
                                </span>
                                <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                                  {groupChecked}/{g.uids.length}
                                </span>
                              </div>
                              <button type="button"
                                className="tag tag-neutral"
                                style={{ cursor: 'pointer', padding: '3px 8px', fontSize: '12px' }}
                                onClick={() => {
                                  setStaffSelection(prev => {
                                    const next = { ...prev };
                                    if (allChecked) for (const uid of g.uids) next[uid] = false;
                                    else for (const uid of g.uids) next[uid] = true;
                                    return next;
                                  });
                                }}>
                                {allChecked ? 'Décocher' : 'Tout cocher'}
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {g.uids.map(uid => {
                                const checked = !!staffSelection[uid];
                                const info = memberInfo(uid);
                                return (
                                  <label key={uid}
                                    className="flex items-center gap-2 p-2 cursor-pointer transition-colors duration-150"
                                    style={{
                                      background: checked ? 'rgba(255,184,0,0.08)' : 'transparent',
                                      border: `1px solid ${checked ? 'rgba(255,184,0,0.3)' : 'var(--s-border)'}`,
                                    }}>
                                    <input type="checkbox" checked={checked}
                                      onChange={e => setStaffSelection(prev => ({ ...prev, [uid]: e.target.checked }))} />
                                    <span className="text-xs flex-1 truncate"
                                      style={{ color: checked ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
                                      {info.displayName}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                    Événement privé, seuls les invités cochés le voient et sont notifiés. Invisible pour les joueurs.
                  </p>
                </div>
              );
            })()}
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
                  style={{ background: 'rgba(255,184,0,0.15)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.4)', fontSize: '12px', padding: '2px 8px' }}>
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

          {type === 'tournoi' && (
            <div className="bevel-sm p-3 space-y-3"
              style={{ background: 'rgba(0,217,181,0.05)', border: '1px solid rgba(0,217,181,0.3)' }}>
              <div className="flex items-center gap-2">
                <span className="tag"
                  style={{ background: 'rgba(0,217,181,0.15)', color: '#00D9B5', borderColor: 'rgba(0,217,181,0.4)', fontSize: '12px', padding: '2px 8px' }}>
                  🏆 TOURNOI
                </span>
                <span className="text-xs" style={{ color: 'var(--s-text-dim)' }}>
                  Compétition externe ou interne, détails optionnels.
                </span>
              </div>
              <div>
                <label className="t-label block mb-1.5">Nom du tournoi</label>
                <input type="text" className="settings-input w-full" value={tournoiNom}
                  onChange={e => setTournoiNom(e.target.value)}
                  placeholder="Nom du tournoi" maxLength={200} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Format (optionnel)</label>
                <input type="text" className="settings-input w-full" value={tournoiFormat}
                  onChange={e => setTournoiFormat(e.target.value)}
                  placeholder="ex: BO3 single elim" maxLength={200} />
              </div>
              <div>
                <label className="t-label block mb-1.5">Lien du tournoi (optionnel)</label>
                <input type="url" className="settings-input w-full" value={tournoiUrl}
                  onChange={e => setTournoiUrl(e.target.value)}
                  placeholder="https://..." maxLength={500} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="t-label block mb-1.5">Lien d&apos;inscription (optionnel)</label>
                  <input type="url" className="settings-input w-full" value={tournoiInscriptionUrl}
                    onChange={e => setTournoiInscriptionUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
                <div>
                  <label className="t-label block mb-1.5">Lien du règlement (optionnel)</label>
                  <input type="url" className="settings-input w-full" value={tournoiReglementUrl}
                    onChange={e => setTournoiReglementUrl(e.target.value)}
                    placeholder="https://..." maxLength={500} />
                </div>
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
  const toast = useToast();
  const typeInfo = TYPE_INFO[normalizeEventType(event.type)] ?? TYPE_INFO.autre;
  const statusInfo = STATUS_INFO[event.status] ?? STATUS_INFO.scheduled;
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
  // État pour le formulaire d'assignation d'exercices (étape 2 refonte UX) :
  // remplace l'ancien textarea 'À travailler' par des structure_todos ciblés
  // par joueur, liés à l'event courant via lockedEventId.
  const [showTodoForm, setShowTodoForm] = useState(false);
  const [todoTeamId, setTodoTeamId] = useState<string>(() => {
    // Pré-sélection : si l'event cible 1 seule équipe, on prend celle-là.
    if (event.target.scope === 'teams' && (event.target.teamIds ?? []).length === 1) {
      return event.target.teamIds![0];
    }
    return '';
  });
  const todoTemplates = useTodoTemplates(structureId);

  // Liste des exercices déjà assignés liés à cet event (filtré par eventId
  // côté client après fetch par subTeamId). Re-fetch quand la team change.
  const qc = useQueryClient();
  const assignedTodosQuery = useQuery({
    queryKey: ['team-todos', structureId, todoTeamId, event.id] as const,
    queryFn: () => api<{ todos: AssignedTodoItem[] }>(`/api/structures/${structureId}/todos?subTeamId=${encodeURIComponent(todoTeamId)}`),
    enabled: !!todoTeamId && canEdit,
    staleTime: 30_000,
  });
  const assignedTodos = (assignedTodosQuery.data?.todos ?? []).filter(t => t.eventId === event.id);
  const reloadAssignedTodos = () => qc.invalidateQueries({ queryKey: ['team-todos', structureId, todoTeamId, event.id] });

  // Supprime un exercice avec confirmation. Erreur silencieuse côté UI
  // (toast pour feedback). DELETE est autorisé pour le staff de la team.
  const deleteAssignedTodo = async (todoId: string) => {
    if (!confirm('Supprimer cet exercice assigné ?')) return;
    try {
      await api(`/api/structures/${structureId}/todos/${todoId}`, { method: 'DELETE' });
      toast.success('Exercice supprimé');
      reloadAssignedTodos();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
    }
  };

  async function saveNotes() {
    setSaving(true);
    try {
      await api(`/api/structures/${structureId}/events/${event.id}`, {
        method: 'PATCH',
        body: {
          compteRendu,
          aTravailler,
          adversaire,
          resultat,
          ...(event.type === 'match' ? { adversaireLogoUrl } : {}),
        },
      });
      toast.success('Enregistré');
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur réseau');
    }
    setSaving(false);
  }

  const targetLabel = (() => {
    if (event.target.scope === 'structure') return 'Toute la structure';
    if (event.target.scope === 'game') return getGameLabel(event.target.game);
    if (event.target.scope === 'staff') return 'Staff';
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
                  style={{ background: 'rgba(255,184,0,0.18)', color: 'var(--s-gold)', borderColor: 'rgba(255,184,0,0.5)', fontSize: '12px', padding: '2px 8px' }}>
                  ⚔ MATCH OFFICIEL
                </span>
              )}
              <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                {typeInfo.label}
              </span>
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '12px', padding: '2px 8px' }}>
                {statusInfo.label}
              </span>
            </div>

            {/* Bannière VS pour les matchs officiels, logos + noms en grand */}
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
              {/* Créé par : utile pour savoir qui a posé l'event (qui contacter
                  en cas de question, qui a l'historique de la demande). Fallback
                  sur l'uid court si le créateur n'est plus membre de la structure. */}
              {event.createdBy && (() => {
                const creator = membersById.get(event.createdBy);
                const name = creator?.displayName?.trim()
                  || `${event.createdBy.replace(/^discord_/, '').slice(0, 8)}…`;
                return (
                  <span className="t-mono text-xs flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                    <User size={11} /> Créé par {name}
                  </span>
                );
              })()}
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
                      cursor: 'pointer', padding: '6px 14px', fontSize: '12px',
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

          {/* ── À TRAVAILLER ──
              Refonte UX : on n'écrit plus dans le champ aTravailler de l'event
              (texte commun à toute l'équipe, pas actionnable). À la place, on
              crée des exercices (structure_todos) assignés par joueur, liés à
              cet event via lockedEventId. Les exercices apparaissent ensuite
              dans 'MES EXERCICES' du calendar de chaque joueur, cochables.

              Pour la rétrocompat : si l'event a déjà un aTravailler legacy non
              vide, on l'affiche en lecture seule (note du coach historique). */}
          <div>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
              <label className="t-label">EXERCICES À TRAVAILLER</label>
              {canEdit && (() => {
                // Le bouton "Assigner" n'a de sens que si l'event cible une
                // ou plusieurs équipes précises, pour les scopes structure/
                // game/staff, on ne peut pas savoir à quelle équipe rattacher
                // le todo (sub_teams sont au niveau équipe, pas structure).
                const teamIds = event.target.scope === 'teams' ? (event.target.teamIds ?? []) : [];
                if (teamIds.length === 0) {
                  return (
                    <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Disponible uniquement pour les events ciblant une équipe
                    </span>
                  );
                }
                return (
                  <button type="button"
                    onClick={() => setShowTodoForm(v => !v)}
                    className="btn-springs btn-secondary bevel-sm text-xs flex items-center gap-1.5">
                    <ListTodo size={11} />
                    {showTodoForm ? 'Fermer' : 'Assigner des exercices'}
                  </button>
                );
              })()}
            </div>

            {/* Sélecteur d'équipe si l'event cible plusieurs équipes */}
            {showTodoForm && event.target.scope === 'teams' && (event.target.teamIds ?? []).length > 1 && (
              <div className="mb-3">
                <label className="t-label block mb-1" style={{ fontSize: '12px' }}>Équipe à qui assigner</label>
                <select className="settings-input w-full text-sm"
                  value={todoTeamId}
                  onChange={e => setTodoTeamId(e.target.value)}>
                  <option value="">Choisis une équipe</option>
                  {(event.target.teamIds ?? []).map(tid => {
                    const t = teams.find(x => x.id === tid);
                    return <option key={tid} value={tid}>{t?.name ?? tid}</option>;
                  })}
                </select>
              </div>
            )}

            {/* Form embarqué, réutilise NewTodoForm de TeamTodosPanel avec
                eventId verrouillé. Construit un TeamRef depuis Team + membersById. */}
            {showTodoForm && todoTeamId && (() => {
              const team = teams.find(t => t.id === todoTeamId);
              if (!team) return (
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Équipe introuvable.</p>
              );
              const toMembers = (ids: string[] | undefined) =>
                (ids ?? [])
                  .map(uid => {
                    const m = membersById.get(uid);
                    if (!m) return null;
                    return {
                      uid,
                      displayName: m.displayName,
                      avatarUrl: m.avatarUrl ?? '',
                      discordAvatar: m.discordAvatar ?? '',
                    };
                  })
                  .filter((m): m is NonNullable<typeof m> => m !== null);
              const teamRef: TeamRef = {
                id: team.id,
                name: team.name,
                players: toMembers(team.playerIds),
                subs: toMembers(team.subIds),
                staff: toMembers(team.staffIds),
                game: team.game,
              };
              return (
                <div className="p-3 bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
                  <NewTodoForm
                    structureId={structureId}
                    team={teamRef}
                    events={[{ id: event.id, title: event.title, startsAt: event.startsAt }]}
                    templates={todoTemplates.templates}
                    lockedEventId={event.id}
                    onCancel={() => setShowTodoForm(false)}
                    onCreated={() => { setShowTodoForm(false); reloadAssignedTodos(); onReload(); }}
                    onTemplateSaved={() => todoTemplates.reload()}
                  />
                </div>
              );
            })()}

            {/* Liste des exercices déjà assignés à cet event (lecture seule,
                avec bouton supprimer). Re-fetched à chaque modif via
                reloadAssignedTodos. Affichée même si le form n'est pas ouvert
                pour que le coach ait toujours la visibilité. */}
            {canEdit && todoTeamId && (
              <div className="mt-3 space-y-1.5">
                <div className="t-label text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Exercices assignés sur ce scrim{assignedTodos.length > 0 ? ` (${assignedTodos.length})` : ''}
                </div>
                {assignedTodosQuery.isPending ? (
                  <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Chargement…</p>
                ) : assignedTodos.length === 0 ? (
                  <p className="text-xs px-3 py-2 bevel-sm"
                    style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)', color: 'var(--s-text-muted)' }}>
                    Aucun exercice assigné pour l&apos;instant.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {assignedTodos.map(todo => {
                      const member = membersById.get(todo.assigneeId);
                      const assigneeName = member?.displayName ?? todo.assigneeId.slice(0, 8);
                      return (
                        <li key={todo.id} className="px-3 py-2 bevel-sm flex items-center gap-3"
                          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
                                {todo.title}
                              </span>
                              <span className="tag tag-neutral" style={{ fontSize: '10px', padding: '1px 5px' }}>
                                {todo.type}
                              </span>
                              {todo.done && (
                                <span className="tag" style={{ background: 'rgba(51,255,102,0.10)', color: '#33ff66', borderColor: 'rgba(51,255,102,0.30)', fontSize: '10px', padding: '1px 5px' }}>
                                  Fait
                                </span>
                              )}
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>
                              Assigné à <strong style={{ color: 'var(--s-text)' }}>{assigneeName}</strong>
                              {todo.deadline ? <> · Deadline {todo.deadline}</> : null}
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => deleteAssignedTodo(todo.id)}
                            title="Supprimer cet exercice"
                            className="flex items-center justify-center transition-colors hover:bg-[var(--s-hover)] flex-shrink-0"
                            style={{ width: 28, height: 28, border: '1px solid var(--s-border)', color: '#ef4444' }}>
                            <Trash2 size={12} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Affichage legacy, uniquement si l'event a déjà un aTravailler
                rempli (créé avant la refonte). En lecture seule. */}
            {aTravailler && (
              <div className="mt-3 p-3 bevel-sm space-y-1"
                style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
                <div className="t-label text-xs" style={{ color: 'var(--s-text-muted)' }}>
                  Note du coach (legacy, créée avant la migration vers les exercices)
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                  {aTravailler}
                </p>
                {canEdit && (
                  <button type="button"
                    onClick={() => setATravailler('')}
                    className="text-xs"
                    style={{ color: 'var(--s-text-muted)', textDecoration: 'underline' }}>
                    Effacer cette note (les exercices remplaceront la suite)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Replays, uniquement pour scrim/match ciblant une seule équipe */}
          {(event.type === 'scrim' || event.type === 'match') && event.target.scope === 'teams' && (event.target.teamIds ?? []).length === 1 && (
            <div className="pt-2" style={{ borderTop: '1px solid var(--s-border)' }}>
              <div className="pt-3">
                <ReplaysPanel
                  structureId={structureId}
                  teamId={(event.target.teamIds ?? [])[0]}
                  eventId={event.id}
                  mode="event"
                  userContext={userContext}
                />
              </div>
            </div>
          )}

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
