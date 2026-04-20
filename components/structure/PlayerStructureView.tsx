'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Users, ExternalLink, MessageSquare, Loader2, CheckCircle,
  Clock, MapPin, Target, Star, UserCheck, UserX, HelpCircle, Crown,
  Headphones, BookOpen, Calendar as CalendarIcon, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api-client';
import AvailabilityCollapsible from '@/components/calendar/AvailabilityCollapsible';
import type { EventType, EventStatus, PresenceStatus } from '@/lib/event-permissions';

// Layout dédié à un joueur qui est membre d'une structure (pas dirigeant, pas manager, pas coach).
// Il ne voit ni la configuration, ni le recrutement, ni le palmarès — que ce qui le concerne directement :
// son/ses équipes, ses coéquipiers, son éditeur de dispos, ses prochains événements (/api/calendar/me
// filtré sur la structure), et les contacts de son encadrement.

type PublicUser = {
  uid: string;
  displayName: string;
  discordUsername: string;
  discordAvatar: string;
  avatarUrl: string;
  country: string;
};

type MyTeam = {
  id: string;
  name: string;
  game: string;
  isTitulaire: boolean;
  isSub: boolean;
  titulaires: PublicUser[];
  subs: PublicUser[];
  staff: PublicUser[];
};

export type PlayerStructure = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string;
  coverUrl: string;
  description: string;
  games: string[];
  discordUrl: string;
  socials: Record<string, string>;
  status: string;
  recruiting: { active: boolean; positions: unknown[] };
  memberCount: number;
  myMemberRole: string;
  myTeams: MyTeam[];
  founder: PublicUser;
  coFounders: PublicUser[];
  managers: PublicUser[];
  coaches: PublicUser[];
  createdAt: string | null;
};

type MyEvent = {
  id: string;
  structureId: string;
  title: string;
  type: EventType;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  target: { scope: string; teamIds?: string[]; game?: string };
  status: EventStatus;
  adversaire: string | null;
  myPresence: { id: string; status: PresenceStatus; respondedAt: string | null } | null;
};

const GAME_INFO: Record<string, { label: string; color: string; short: string }> = {
  rocket_league: { label: 'Rocket League', color: 'var(--s-blue)', short: 'RL' },
  trackmania: { label: 'Trackmania', color: 'var(--s-green)', short: 'TM' },
};

const TYPE_INFO: Record<EventType, { label: string; color: string }> = {
  training: { label: 'Entraînement', color: 'var(--s-text-dim)' },
  scrim: { label: 'Scrim', color: 'var(--s-blue)' },
  match: { label: 'Match', color: 'var(--s-gold)' },
  springs: { label: 'Springs', color: 'var(--s-violet)' },
  autre: { label: 'Autre', color: 'var(--s-text-dim)' },
};

const PRESENCE_INFO: Record<PresenceStatus, { label: string; color: string; icon: typeof UserCheck }> = {
  present: { label: 'Présent', color: '#33ff66', icon: UserCheck },
  absent: { label: 'Absent', color: '#ff5555', icon: UserX },
  maybe: { label: 'Peut-être', color: 'var(--s-gold)', icon: HelpCircle },
  pending: { label: 'En attente', color: 'var(--s-text-muted)', icon: HelpCircle },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
}
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ user, size = 44 }: { user: PublicUser; size?: number }) {
  if (user.discordAvatar || user.avatarUrl) {
    return (
      <Image
        src={user.discordAvatar || user.avatarUrl}
        alt={user.displayName}
        width={size}
        height={size}
        className="flex-shrink-0"
        style={{ border: '2px solid rgba(255,255,255,0.10)', objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      className="flex-shrink-0 flex items-center justify-center font-bold"
      style={{
        width: size, height: size,
        background: 'var(--s-elevated)',
        border: '2px solid var(--s-border)',
        color: 'var(--s-text-dim)',
        fontSize: size * 0.42,
      }}
    >
      {user.displayName?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

export default function PlayerStructureView({ structure }: { structure: PlayerStructure }) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const calendarQueryKey = ['calendar', 'me'] as const;
  const { data: eventsData, isPending: eventsLoading } = useQuery({
    queryKey: calendarQueryKey,
    queryFn: () => api<{ events: MyEvent[] }>('/api/calendar/me'),
    enabled: !!firebaseUser,
  });
  const events = useMemo(
    () => (eventsData?.events ?? []).filter(e => e.structureId === structure.id),
    [eventsData, structure.id]
  );

  const presenceMutation = useMutation({
    mutationFn: ({ event, status }: { event: MyEvent; status: PresenceStatus }) =>
      api(`/api/structures/${structure.id}/events/${event.id}/presence`, {
        method: 'POST',
        body: { status },
      }).then(() => ({ event, status })),
    onSuccess: () => {
      toast.success('Réponse enregistrée');
      qc.invalidateQueries({ queryKey: calendarQueryKey });
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });
  const presenceBusy = presenceMutation.isPending ? presenceMutation.variables?.event.id ?? null : null;
  const respondPresence = (event: MyEvent, status: PresenceStatus) => {
    presenceMutation.mutate({ event, status });
  };

  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    return events
      .filter(e => e.status !== 'cancelled')
      .filter(e => e.endsAt && new Date(e.endsAt).getTime() >= now)
      .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
      .slice(0, 6);
  }, [events]);

  const hasTeam = structure.myTeams.length > 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ─── HERO ─── */}
      <section
        className="bevel relative overflow-hidden"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div
          className="h-[3px]"
          style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.35), transparent 70%)' }}
        />
        <div
          className="absolute top-0 right-0 w-96 h-96 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.08), transparent 60%)' }}
        />
        <div className="relative z-[1] p-6 flex flex-wrap items-center gap-6">
          <div
            className="w-24 h-24 flex-shrink-0 bevel-sm flex items-center justify-center overflow-hidden"
            style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
          >
            {structure.logoUrl ? (
              <Image src={structure.logoUrl} alt={structure.name} width={96} height={96} className="object-cover" />
            ) : (
              <Shield size={44} style={{ color: 'var(--s-text-muted)' }} />
            )}
          </div>

          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-3xl md:text-4xl" style={{ color: 'var(--s-text)', letterSpacing: '0.02em' }}>
                {structure.name}
              </h1>
              {structure.tag && (
                <span
                  className="font-display text-sm px-2 py-1"
                  style={{
                    background: 'rgba(255,184,0,0.10)',
                    border: '1px solid rgba(255,184,0,0.30)',
                    color: 'var(--s-gold)',
                    letterSpacing: '0.08em',
                  }}
                >
                  {structure.tag}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap text-sm" style={{ color: 'var(--s-text-dim)' }}>
              <div className="flex items-center gap-1.5">
                <CheckCircle size={14} style={{ color: '#33ff66' }} />
                <span>Active</span>
              </div>
              <span style={{ color: 'var(--s-text-muted)' }}>·</span>
              <div className="flex items-center gap-1.5">
                <Users size={14} />
                <span>{structure.memberCount} membre{structure.memberCount > 1 ? 's' : ''}</span>
              </div>
              {structure.games.length > 0 && (
                <>
                  <span style={{ color: 'var(--s-text-muted)' }}>·</span>
                  <div className="flex items-center gap-1.5">
                    {structure.games.map(g => {
                      const info = GAME_INFO[g];
                      return (
                        <span
                          key={g}
                          className="font-display text-xs px-1.5 py-0.5"
                          style={{
                            background: `${info?.color ?? 'var(--s-violet)'}15`,
                            border: `1px solid ${info?.color ?? 'var(--s-violet)'}40`,
                            color: info?.color ?? 'var(--s-violet-light)',
                            letterSpacing: '0.06em',
                          }}
                        >
                          {info?.short ?? g.toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/community/structure/${structure.id}`}
              className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
            >
              <ExternalLink size={14} />
              Page publique
            </Link>
            {structure.discordUrl && (
              <a
                href={structure.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-2"
                style={{ borderColor: 'rgba(88,101,242,0.5)', color: '#8b9bff' }}
              >
                <MessageSquare size={14} />
                Discord
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ─── MON ÉQUIPE ─── */}
      {hasTeam ? (
        structure.myTeams.map(team => <TeamCard key={team.id} team={team} currentUid={firebaseUser?.uid} />)
      ) : (
        <section
          className="bevel relative overflow-hidden"
          style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
        >
          <div
            className="h-[3px]"
            style={{ background: 'linear-gradient(90deg, var(--s-violet-light), rgba(163,100,217,0.35), transparent 70%)' }}
          />
          <div className="p-8 text-center">
            <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--s-text-muted)' }} />
            <h3 className="font-display text-xl mb-2" style={{ color: 'var(--s-text)' }}>AUCUNE ÉQUIPE ASSIGNÉE</h3>
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Tu fais partie de la structure mais tu n&apos;es rattaché à aucune sous-équipe pour le moment.
              Contacte ton fondateur ou ton manager pour être intégré à un roster.
            </p>
          </div>
        </section>
      )}

      {/* ─── MES DISPOS ─── */}
      <AvailabilityCollapsible />

      {/* ─── MES PROCHAINS ÉVÉNEMENTS ─── */}
      <section
        className="bevel relative overflow-hidden"
        style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
      >
        <div
          className="h-[3px]"
          style={{ background: 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.35), transparent 70%)' }}
        />
        <div
          className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 60%)' }}
        />
        <div className="relative z-[1] p-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--s-border)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 flex items-center justify-center bevel-sm"
              style={{ background: 'rgba(255,184,0,0.10)', border: '1px solid rgba(255,184,0,0.30)' }}
            >
              <CalendarIcon size={16} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div>
              <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>MES PROCHAINS ÉVÉNEMENTS</h2>
              <p className="text-sm mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
                {eventsLoading
                  ? 'Chargement…'
                  : upcomingEvents.length === 0
                    ? 'Aucun événement à venir'
                    : `${upcomingEvents.length} événement${upcomingEvents.length > 1 ? 's' : ''} à venir`}
              </p>
            </div>
          </div>
          <Link
            href="/calendar"
            className="text-sm flex items-center gap-1 transition-colors duration-150"
            style={{ color: 'var(--s-text-dim)' }}
          >
            Voir tout <ChevronRight size={14} />
          </Link>
        </div>

        {eventsLoading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : upcomingEvents.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
              Tu n&apos;as aucun événement à venir dans cette structure.
            </p>
          </div>
        ) : (
          <ul className="relative z-[1] divide-y" style={{ borderColor: 'var(--s-border)' }}>
            {upcomingEvents.map(ev => (
              <EventRow
                key={ev.id}
                event={ev}
                busy={presenceBusy === ev.id}
                onRespond={s => respondPresence(ev, s)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ─── CONTACTS STAFF ─── */}
      <StaffContactsSection structure={structure} />
    </div>
  );
}

// ─── Sous-composants ───

function TeamCard({ team, currentUid }: { team: MyTeam; currentUid: string | undefined }) {
  const gameInfo = GAME_INFO[team.game] ?? { label: team.game, color: 'var(--s-violet)', short: team.game.toUpperCase() };
  const myBadge = team.isTitulaire ? 'TITULAIRE' : team.isSub ? 'REMPLAÇANT' : null;

  return (
    <section
      className="bevel relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      <div
        className="h-[3px]"
        style={{ background: `linear-gradient(90deg, ${gameInfo.color}, ${gameInfo.color}50, transparent 70%)` }}
      />
      <div
        className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
        style={{ background: `radial-gradient(circle at 100% 0%, ${gameInfo.color}10, transparent 60%)` }}
      />
      <div className="relative z-[1] p-5 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center bevel-sm"
            style={{ background: `${gameInfo.color}15`, border: `1px solid ${gameInfo.color}35` }}
          >
            <Users size={16} style={{ color: gameInfo.color }} />
          </div>
          <div>
            <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>{team.name.toUpperCase()}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--s-text-dim)' }}>{gameInfo.label}</p>
          </div>
        </div>
        {myBadge && (
          <span
            className="font-display text-xs px-2 py-1"
            style={{
              background: team.isTitulaire ? 'rgba(255,184,0,0.12)' : 'rgba(163,100,217,0.12)',
              border: `1px solid ${team.isTitulaire ? 'rgba(255,184,0,0.35)' : 'rgba(163,100,217,0.35)'}`,
              color: team.isTitulaire ? 'var(--s-gold)' : 'var(--s-violet-light)',
              letterSpacing: '0.08em',
            }}
          >
            <Star size={11} className="inline mr-1" style={{ verticalAlign: '-1px' }} />
            {myBadge}
          </span>
        )}
      </div>

      <div className="relative z-[1] p-5 space-y-5">
        {/* Titulaires */}
        <div>
          <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Titulaires</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {team.titulaires.map(u => (
              <TeammateCard key={u.uid} user={u} isMe={u.uid === currentUid} badgeColor="var(--s-gold)" badgeLabel="Titulaire" />
            ))}
          </div>
        </div>

        {/* Remplaçants */}
        {team.subs.length > 0 && (
          <div>
            <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Remplaçants</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {team.subs.map(u => (
                <TeammateCard key={u.uid} user={u} isMe={u.uid === currentUid} badgeColor="var(--s-violet-light)" badgeLabel="Remplaçant" />
              ))}
            </div>
          </div>
        )}

        {/* Staff d'équipe */}
        {team.staff.length > 0 && (
          <div>
            <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>Encadrement</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {team.staff.map(u => (
                <TeammateCard key={u.uid} user={u} isMe={u.uid === currentUid} badgeColor="#4da6ff" badgeLabel="Staff" />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TeammateCard({ user, isMe, badgeColor, badgeLabel }: {
  user: PublicUser;
  isMe: boolean;
  badgeColor: string;
  badgeLabel: string;
}) {
  return (
    <Link
      href={`/profile/${user.uid}`}
      className="bevel-sm flex items-center gap-3 px-3 py-2.5 transition-all duration-150"
      style={{
        background: isMe ? 'rgba(255,184,0,0.05)' : 'var(--s-elevated)',
        border: `1px solid ${isMe ? 'rgba(255,184,0,0.25)' : 'var(--s-border)'}`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--s-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = isMe ? 'rgba(255,184,0,0.05)' : 'var(--s-elevated)'; }}
    >
      <Avatar user={user} size={38} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
          {user.displayName || user.discordUsername || '—'}
          {isMe && <span className="ml-1.5 text-xs" style={{ color: 'var(--s-gold)' }}>(toi)</span>}
        </p>
        <p className="text-xs truncate" style={{ color: badgeColor }}>{badgeLabel}</p>
      </div>
    </Link>
  );
}

function EventRow({ event, busy, onRespond }: {
  event: MyEvent;
  busy: boolean;
  onRespond: (s: PresenceStatus) => void;
}) {
  const typeInfo = TYPE_INFO[event.type] ?? TYPE_INFO.autre;
  const myStatus: PresenceStatus = event.myPresence?.status ?? 'pending';

  return (
    <li className="px-5 py-4 flex items-start gap-4 flex-wrap" style={{ borderColor: 'var(--s-border)' }}>
      <div className="flex-shrink-0 w-16 text-center">
        <p className="font-display text-xs" style={{ color: 'var(--s-text-muted)', letterSpacing: '0.06em' }}>
          {fmtDate(event.startsAt).toUpperCase()}
        </p>
        <p className="font-display text-lg" style={{ color: 'var(--s-text)' }}>
          {fmtTime(event.startsAt)}
        </p>
      </div>

      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-display text-xs px-1.5 py-0.5"
            style={{
              background: `${typeInfo.color}15`,
              border: `1px solid ${typeInfo.color}35`,
              color: typeInfo.color,
              letterSpacing: '0.06em',
            }}
          >
            {typeInfo.label.toUpperCase()}
          </span>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--s-text)' }}>{event.title}</h4>
        </div>
        {(event.description || event.adversaire || event.location) && (
          <div className="mt-1.5 flex items-center gap-3 flex-wrap text-xs" style={{ color: 'var(--s-text-dim)' }}>
            {event.adversaire && (
              <div className="flex items-center gap-1">
                <Target size={11} />
                <span>vs {event.adversaire}</span>
              </div>
            )}
            {event.location && (
              <div className="flex items-center gap-1">
                <MapPin size={11} />
                <span>{event.location}</span>
              </div>
            )}
            {event.description && (
              <span className="truncate max-w-sm">{event.description}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {(['present', 'maybe', 'absent'] as PresenceStatus[]).map(st => {
          const info = PRESENCE_INFO[st];
          const Icon = info.icon;
          const active = myStatus === st;
          return (
            <button
              key={st}
              type="button"
              disabled={busy}
              onClick={() => onRespond(st)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-all duration-150 disabled:opacity-50"
              style={{
                background: active ? `${info.color}20` : 'var(--s-elevated)',
                border: `1px solid ${active ? info.color : 'var(--s-border)'}`,
                color: active ? info.color : 'var(--s-text-dim)',
                letterSpacing: '0.04em',
              }}
            >
              {busy && active ? <Loader2 size={11} className="animate-spin" /> : <Icon size={11} />}
              {info.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

function StaffContactsSection({ structure }: { structure: PlayerStructure }) {
  const groups: { label: string; icon: typeof Crown; color: string; users: PublicUser[] }[] = [
    { label: 'Fondateur', icon: Crown, color: 'var(--s-gold)', users: [structure.founder] },
  ];
  if (structure.coFounders.length > 0) {
    groups.push({ label: 'Co-fondateur', icon: Crown, color: 'var(--s-gold)', users: structure.coFounders });
  }
  if (structure.managers.length > 0) {
    groups.push({ label: 'Manager', icon: BookOpen, color: 'var(--s-violet-light)', users: structure.managers });
  }
  if (structure.coaches.length > 0) {
    groups.push({ label: 'Coach', icon: Headphones, color: '#4da6ff', users: structure.coaches });
  }

  return (
    <section
      className="bevel relative overflow-hidden"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      <div
        className="h-[3px]"
        style={{ background: 'linear-gradient(90deg, var(--s-violet-light), rgba(163,100,217,0.35), transparent 70%)' }}
      />
      <div
        className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(163,100,217,0.06), transparent 60%)' }}
      />
      <div className="relative z-[1] p-5" style={{ borderBottom: '1px solid var(--s-border)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center bevel-sm"
            style={{ background: 'rgba(163,100,217,0.10)', border: '1px solid rgba(163,100,217,0.30)' }}
          >
            <Shield size={16} style={{ color: 'var(--s-violet-light)' }} />
          </div>
          <div>
            <h2 className="font-display text-xl" style={{ letterSpacing: '0.04em' }}>ENCADREMENT</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--s-text-dim)' }}>
              Qui contacter pour quoi
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-[1] p-5 space-y-5">
        {groups.map(g => (
          <div key={g.label}>
            <p className="t-label mb-3" style={{ color: 'var(--s-text-muted)' }}>
              {g.label}{g.users.length > 1 ? 's' : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {g.users.map(u => (
                <StaffCard key={u.uid} user={u} label={g.label} icon={g.icon} color={g.color} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StaffCard({ user, label, icon: Icon, color }: {
  user: PublicUser;
  label: string;
  icon: typeof Crown;
  color: string;
}) {
  return (
    <Link
      href={`/profile/${user.uid}`}
      className="bevel-sm flex items-center gap-3 px-3 py-3 transition-all duration-150"
      style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--s-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--s-elevated)'; }}
    >
      <Avatar user={user} size={42} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>
          {user.displayName || user.discordUsername || '—'}
        </p>
        <p className="text-xs truncate flex items-center gap-1" style={{ color }}>
          <Icon size={11} />
          {label}
        </p>
      </div>
    </Link>
  );
}
