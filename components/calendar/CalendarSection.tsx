'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
  User,
  LayoutGrid,
  List,
  CalendarRange,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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
import EventFormModal from './EventFormModal';
import EventDetailModal from './EventDetailModal';
import TeamFilterDropdown from './TeamFilterDropdown';
import EventCard from './EventCard';
import { useEventFilters } from './useEventFilters';
import { useCalendarEvents } from './useCalendarEvents';
import { useEventMutations } from './useEventMutations';
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

export type Member = {
  id: string;
  userId: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  role: string;
};

// Item de la liste d'exercices déjà assignés à un event (affiché dans
// EventDetailModal sous le bouton 'Assigner des exercices').
export type AssignedTodoItem = {
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
export type StructureRoles = {
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

export const STATUS_INFO: Record<EventStatus, { label: string; color: string }> = {
  scheduled: { label: 'Programmé', color: 'var(--s-gold)' },
  done: { label: 'Terminé', color: '#33ff66' },
  cancelled: { label: 'Annulé', color: '#ff5555' },
};

export const PRESENCE_INFO: Record<PresenceStatus, { label: string; color: string }> = {
  present: { label: 'Présent', color: '#33ff66' },
  absent: { label: 'Absent', color: '#ff5555' },
  maybe: { label: 'Peut-être', color: 'var(--s-gold)' },
  pending: { label: 'En attente', color: 'var(--s-text-muted)' },
};

// Jetons spéciaux du filtre d'audience, distincts des IDs d'équipe (Firestore).
// Permettent de filtrer aussi les événements staff et structure-wide.
export const FILTER_STAFF = '__staff__';
export const FILTER_STRUCTURE = '__structure__';

// Un événement passe-t-il le filtre d'audience ? (filtre vide = tout passe)
function eventMatchesAudienceFilter(e: CalendarEvent, filter: string[]): boolean {
  if (filter.length === 0) return true;
  const t = e.target;
  if (t.scope === 'teams') return (t.teamIds ?? []).some(id => filter.includes(id));
  if (t.scope === 'staff') return filter.includes(FILTER_STAFF);
  if (t.scope === 'structure') return filter.includes(FILTER_STRUCTURE);
  return false; // scope 'game' : pas de filtre dédié pour l'instant
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtTime(iso: string | null): string {
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

  // Events fetch + now tick extraits dans useCalendarEvents (Phase 3.2).
  // Le hook gère useQuery, invalidate helper, et le tick now 60s.
  const { events, loading, now, invalidateEvents } = useCalendarEvents(structureId, !!firebaseUser);

  // Filtres UI extraits dans useEventFilters (Phase 3.1) : filter (période),
  // teamFilter (équipes/audiences), viewMode (mois/semaine/liste/staff +
  // localStorage). Cf. useEventFilters.ts pour la sémantique.
  const { filter, setFilter, teamFilter, setTeamFilter, viewMode, changeView } = useEventFilters();
  // Alias historique conservé pour minimiser les changements dans le rendu JSX.
  const effectiveViewMode = viewMode;
  // formPrefill : null = modale fermée ; objet = ouverte (éventuellement pré-remplie
  // avec une date quand on a cliqué sur une case du calendrier).
  const [formPrefill, setFormPrefill] = useState<{ startsAt?: string; endsAt?: string } | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);

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

  // Mutations events (respond/status/delete) extraites dans useEventMutations
  // (Phase 3.3). Toast success/error + confirm dialog pour DELETE gérés dedans.
  // onDeleted ferme la modal de détail si l'event affiché vient d'être supprimé.
  const { handleRespond, handleStatusAction, handleDelete } = useEventMutations({
    structureId,
    invalidateEvents,
    onDeleted: () => setOpenEventId(null),
  });

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
          structureGames={structureGames}
          teams={teams}
          members={members}
          structureRoles={structureRoles}
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

