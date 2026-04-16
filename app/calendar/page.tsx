'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import {
  Calendar as CalendarIcon,
  Loader2,
  Clock,
  MapPin,
  Target,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import CompactStickyHeader from '@/components/ui/CompactStickyHeader';
import AvailabilityCollapsible from '@/components/calendar/AvailabilityCollapsible';
import MyTodosSection from '@/components/calendar/MyTodosSection';
import type { EventType, EventStatus, PresenceStatus } from '@/lib/event-permissions';

type MyPresence = {
  id: string;
  status: PresenceStatus;
  respondedAt: string | null;
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
  resultat: string | null;
  compteRendu: string;
  aTravailler: string;
  myPresence: MyPresence | null;
};

type StructureInfo = { name: string; tag: string; logoUrl: string };

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

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function MyCalendarPage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [events, setEvents] = useState<MyEvent[]>([]);
  const [structures, setStructures] = useState<Record<string, StructureInfo>>({});
  const [loading, setLoading] = useState(true);
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
      const res = await fetch('/api/calendar/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setStructures(data.structures ?? {});
      }
    } catch (err) {
      console.error('[MyCalendar] load error:', err);
    }
    setLoading(false);
  }, [firebaseUser]);

  useEffect(() => {
    if (!authLoading && !firebaseUser) {
      router.push('/');
      return;
    }
    if (firebaseUser) loadEvents();
  }, [authLoading, firebaseUser, router, loadEvents]);

  async function respond(structureId: string, eventId: string, status: PresenceStatus) {
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

  const { upcomingGroups, past } = useMemo(() => {
    const upcomingList: MyEvent[] = [];
    const pastList: MyEvent[] = [];
    for (const e of events) {
      const end = e.endsAt ? new Date(e.endsAt).getTime() : 0;
      if (end >= now && e.status === 'scheduled') upcomingList.push(e);
      else pastList.push(e);
    }
    upcomingList.sort((a, b) => {
      const ta = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const tb = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return ta - tb;
    });

    // Grouper par jour (YYYY-MM-DD)
    const groupsMap = new Map<string, { ymd: string; label: string; events: MyEvent[] }>();
    for (const ev of upcomingList) {
      if (!ev.startsAt) continue;
      const d = new Date(ev.startsAt);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groupsMap.has(ymd)) {
        const todayD = new Date(now);
        const todayYmd = `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, '0')}-${String(todayD.getDate()).padStart(2, '0')}`;
        const diffDays = Math.round((d.setHours(0, 0, 0, 0) - new Date(todayYmd).setHours(0, 0, 0, 0)) / 86_400_000);
        let label: string;
        if (diffDays === 0) label = "AUJOURD'HUI";
        else if (diffDays === 1) label = 'DEMAIN';
        else if (diffDays < 7) label = new Date(ev.startsAt).toLocaleDateString('fr-FR', { weekday: 'long' }).toUpperCase();
        else label = new Date(ev.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase();
        groupsMap.set(ymd, { ymd, label, events: [] });
      }
      groupsMap.get(ymd)!.events.push(ev);
    }

    return { upcomingGroups: [...groupsMap.values()], past: pastList };
  }, [events, now]);

  if (authLoading || !firebaseUser) {
    return (
      <div className="min-h-screen hex-bg flex items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen hex-bg px-8 py-8 space-y-8">
      <CompactStickyHeader
        icon={CalendarIcon}
        title="Mon calendrier"
        accent="var(--s-gold)"
      />
      <div className="relative z-[1] space-y-8">
        <Breadcrumbs items={[{ label: 'Mon calendrier' }]} />
        {/* Header */}
        <header className="bevel animate-fade-in relative overflow-hidden" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
          <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)50, transparent 80%)' }} />
          <div className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,184,0,0.06), transparent 60%)' }} />
          <div className="relative z-[1] p-8 flex items-center gap-4">
            <div className="w-12 h-12 flex items-center justify-center bevel-sm" style={{ background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
              <CalendarIcon size={22} style={{ color: 'var(--s-gold)' }} />
            </div>
            <div>
              <h1 className="font-display text-4xl" style={{ letterSpacing: '0.04em' }}>MON CALENDRIER</h1>
              <p className="t-body mt-1" style={{ color: 'var(--s-text-dim)' }}>
                Tous les événements où tu es invité, toutes structures confondues.
              </p>
            </div>
          </div>
        </header>

        {/* Dispos collapsible */}
        <AvailabilityCollapsible />

        {/* Mes devoirs */}
        <MyTodosSection />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
          </div>
        ) : events.length === 0 ? (
          <div className="bevel p-10 text-center animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
            <CalendarIcon size={32} className="mx-auto mb-4" style={{ color: 'var(--s-text-muted)' }} />
            <h2 className="font-display text-xl mb-2">Aucun événement</h2>
            <p className="t-body" style={{ color: 'var(--s-text-dim)' }}>
              Tu n&apos;es invité à aucun événement pour l&apos;instant.
            </p>
          </div>
        ) : (
          <>
            {/* À venir — timeline groupée par jour */}
            <section className="animate-fade-in-d1 space-y-4">
              <div className="section-label">
                <span className="font-display text-sm tracking-wider">
                  À VENIR ({upcomingGroups.reduce((n, g) => n + g.events.length, 0)})
                </span>
              </div>

              {/* Trait MAINTENANT */}
              {upcomingGroups.length > 0 && <NowMarker />}

              {upcomingGroups.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Aucun événement à venir.</p>
              ) : (
                <div className="space-y-6">
                  {upcomingGroups.map((g) => (
                    <div key={g.ymd} className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span
                          className="font-display"
                          style={{
                            fontSize: '13px',
                            letterSpacing: '0.08em',
                            color: g.label === "AUJOURD'HUI" ? 'var(--s-gold)' : 'var(--s-text)',
                          }}
                        >
                          {g.label}
                        </span>
                        <div
                          className="flex-1 h-px"
                          style={{
                            background: g.label === "AUJOURD'HUI"
                              ? 'linear-gradient(90deg, rgba(255,184,0,0.3), transparent)'
                              : 'var(--s-border)',
                          }}
                        />
                        <span
                          className="t-mono"
                          style={{ fontSize: '10px', color: 'var(--s-text-muted)' }}
                        >
                          {g.events.length} event{g.events.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {g.events.map((ev) => (
                          <MyEventCard key={ev.id} event={ev} structure={structures[ev.structureId]} onRespond={respond} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Passés */}
            {past.length > 0 && (
              <section className="animate-fade-in-d2 space-y-4">
                <div className="section-label">
                  <span className="font-display text-sm tracking-wider">PASSÉS ({past.length})</span>
                </div>
                <div className="space-y-3">
                  {past.map(ev => (
                    <MyEventCard key={ev.id} event={ev} structure={structures[ev.structureId]} onRespond={respond} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NowMarker() {
  const timeLabel = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex items-center gap-3 py-1">
      <span
        className="w-2 h-2 flex-shrink-0"
        style={{ background: 'var(--s-gold)', borderRadius: '50%', boxShadow: '0 0 8px rgba(255,184,0,0.6)' }}
      />
      <span
        className="font-display"
        style={{ fontSize: '11px', letterSpacing: '0.1em', color: 'var(--s-gold)' }}
      >
        MAINTENANT · {timeLabel}
      </span>
      <div
        className="flex-1 h-px"
        style={{ background: 'linear-gradient(90deg, rgba(255,184,0,0.5), transparent)' }}
      />
    </div>
  );
}

function MyEventCard({
  event,
  structure,
  onRespond,
}: {
  event: MyEvent;
  structure: StructureInfo | undefined;
  onRespond: (structureId: string, eventId: string, status: PresenceStatus) => void;
}) {
  const typeInfo = TYPE_INFO[event.type];
  const statusInfo = STATUS_INFO[event.status];
  const my = event.myPresence;

  const dateStr = event.startsAt
    ? new Date(event.startsAt).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })
    : '';

  return (
    <div className="bevel-sm relative overflow-hidden transition-all duration-150 hover:border-white/20"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${typeInfo.color}, ${typeInfo.color}50, transparent 70%)` }} />
      <div className="p-4 flex gap-4 items-center">
        {/* Date block */}
        <div className="flex-shrink-0 text-center" style={{ minWidth: '64px' }}>
          <p className="font-display text-3xl leading-none" style={{ color: typeInfo.color }}>
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
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="tag" style={{ background: `${typeInfo.color}15`, color: typeInfo.color, borderColor: `${typeInfo.color}35`, fontSize: '9px', padding: '2px 6px' }}>
              {typeInfo.label}
            </span>
            {event.status !== 'scheduled' && (
              <span className="tag" style={{ background: `${statusInfo.color}15`, color: statusInfo.color, borderColor: `${statusInfo.color}35`, fontSize: '9px', padding: '2px 6px' }}>
                {statusInfo.label}
              </span>
            )}
          </div>
          <Link href={`/community/structure/${event.structureId}`}
            className="flex items-center gap-2 mb-1 group">
            {structure?.logoUrl ? (
              <Image src={structure.logoUrl} alt={structure.name} width={14} height={14} unoptimized className="flex-shrink-0" />
            ) : (
              <Shield size={12} style={{ color: 'var(--s-text-muted)' }} />
            )}
            <span className="t-mono text-xs group-hover:text-white transition-colors" style={{ color: 'var(--s-text-dim)' }}>
              {structure?.name ?? 'Structure'}
            </span>
          </Link>
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--s-text)' }}>{event.title}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="t-mono flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
              <Clock size={9} /> {dateStr}
            </span>
            {event.location && (
              <span className="t-mono flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <MapPin size={9} /> {event.location}
              </span>
            )}
            {(event.type === 'match' || event.type === 'scrim') && event.adversaire && (
              <span className="t-mono flex items-center gap-1" style={{ color: 'var(--s-text-dim)' }}>
                <Target size={9} /> vs {event.adversaire}
              </span>
            )}
          </div>
          {(event.compteRendu || event.aTravailler) && event.status === 'done' && (
            <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--s-border)' }}>
              {event.compteRendu && (
                <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                  <span className="t-label mr-1">CR :</span>
                  {event.compteRendu}
                </p>
              )}
              {event.aTravailler && (
                <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--s-text-dim)' }}>
                  <span className="t-label mr-1">À TRAVAILLER :</span>
                  {event.aTravailler}
                </p>
              )}
            </div>
          )}
        </div>

        {/* My response */}
        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {my && event.status === 'scheduled' && (
            <div className="flex gap-1">
              {(['present', 'maybe', 'absent'] as const).map(s => (
                <button key={s} type="button"
                  onClick={() => onRespond(event.structureId, event.id, s)}
                  title={PRESENCE_INFO[s].label}
                  className="transition-all duration-150"
                  style={{
                    width: '28px', height: '28px',
                    background: my.status === s ? `${PRESENCE_INFO[s].color}20` : 'transparent',
                    border: `1px solid ${my.status === s ? PRESENCE_INFO[s].color : 'var(--s-border)'}`,
                    color: my.status === s ? PRESENCE_INFO[s].color : 'var(--s-text-muted)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}>
                  {s === 'present' ? '✓' : s === 'maybe' ? '?' : '✗'}
                </button>
              ))}
            </div>
          )}
          {my && event.status !== 'scheduled' && (
            <span className="tag" style={{
              background: `${PRESENCE_INFO[my.status].color}15`,
              color: PRESENCE_INFO[my.status].color,
              borderColor: `${PRESENCE_INFO[my.status].color}35`,
              fontSize: '9px', padding: '2px 8px',
            }}>
              {PRESENCE_INFO[my.status].label}
            </span>
          )}
          <ChevronRight size={12} style={{ color: 'var(--s-text-muted)' }} />
        </div>
      </div>
    </div>
  );
}
