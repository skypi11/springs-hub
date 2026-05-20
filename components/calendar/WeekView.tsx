'use client';

// Vue Semaine du calendrier de structure — grille jours × créneaux 30 min.
//
// Deux couches superposées :
//  1. Événements (toujours) — blocs colorés par jeu, positionnés à l'heure.
//     Clic sur un bloc → détail ; clic sur une case vide → création pré-remplie.
//  2. Dispos + consensus (quand UNE équipe est sélectionnée dans le filtre) —
//     heatmap du nombre de joueurs dispo + blocs consensus encadrés + liste
//     des joueurs avec isolation individuelle.
//
// La couche dispos n'existe que sur la semaine courante + la suivante : c'est
// la fenêtre sur laquelle les joueurs déclarent leurs créneaux.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, Users, Check, CalendarClock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api-client';
import {
  addDays, getMondayYmd, parisYmd, generateWeekGrid, addMinutesToIso,
  formatSlotTime, type MatchBlock,
} from '@/lib/availability';
import type { CalendarEvent, Team } from './CalendarSection';
import { TYPE_INFO } from './CalendarSection';
import { eventGameColor } from './MonthView';

const DAY_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const SLOT_HEIGHT = 22;        // hauteur d'un créneau de 30 min (px)
const SLOT_COUNT = 36;         // 8h → 2h = 36 créneaux

// Axe horaire : 8:00 → 23:30 puis 00:00 → 01:30 (aligné sur DAY_SCHEDULES).
const TIME_AXIS = (() => {
  const out: { h: number; m: number }[] = [];
  for (let h = 8; h < 24; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  for (let h = 0; h < 2; h++) { out.push({ h, m: 0 }); out.push({ h, m: 30 }); }
  return out;
})();

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// Index de créneau (0..35) pour une heure donnée. Les heures 2h–8h (hors grille)
// sont rabattues sur le créneau 0 ; après 2h c'est déjà la nuit du jour suivant.
function slotIndexForTime(h: number, m: number): number {
  const half = m >= 30 ? 1 : 0;
  if (h >= 8) return (h - 8) * 2 + half;
  if (h < 2) return 32 + h * 2 + half;
  return 0;
}

// ─── Types API dispos ───────────────────────────────────────────────────
type AvailMember = {
  uid: string;
  displayName: string;
  discordAvatar: string;
  avatarUrl: string;
  isTitulaire: boolean;
  slotsByWeek: Record<string, string[]>;
  conflictSlots: string[];
};
type AvailResponse = {
  team: { id: string; name: string; game: string; minPlayersForMatch: number; minMatchDurationMinutes: number };
  today: string;
  weeks: { mondayYmd: string; weekId: string; blocks: MatchBlock[] }[];
  members: AvailMember[];
};

type Props = {
  structureId: string;
  events: CalendarEvent[];        // déjà filtrés par le filtre équipe
  teams: Team[];
  teamFilter: string[];
  now: number;
  canCreate: boolean;
  onEventClick: (id: string) => void;
  onSlotCreate: (startsAt: string, endsAt: string) => void;
};

export default function WeekView({
  structureId, events, teams, teamFilter, now, canCreate, onEventClick, onSlotCreate,
}: Props) {
  const { firebaseUser } = useAuth();
  const todayYmd = parisYmd(new Date(now));
  const [weekMonday, setWeekMonday] = useState(() => getMondayYmd(todayYmd));
  // Joueur isolé : si défini, la heatmap n'affiche que ses créneaux à lui.
  const [soloMember, setSoloMember] = useState<string | null>(null);

  const grid = useMemo(() => generateWeekGrid(weekMonday, todayYmd), [weekMonday, todayYmd]);

  // Couche dispos : une seule équipe ciblée. Si la structure n'a qu'une équipe,
  // pas de filtre à régler — on la prend d'office.
  const selectedTeamId = teamFilter.length === 1
    ? teamFilter[0]
    : (teamFilter.length === 0 && teams.length === 1 ? teams[0].id : null);

  const { data: avail, isLoading: availLoading } = useQuery({
    queryKey: ['team-availability', structureId, selectedTeamId],
    queryFn: () => api<AvailResponse>(
      `/api/structures/teams/availability?structureId=${structureId}&teamId=${selectedTeamId}`
    ),
    enabled: !!firebaseUser && !!selectedTeamId,
    retry: false,
  });

  // La semaine affichée fait-elle partie des 2 semaines couvertes par les dispos ?
  const availWeek = avail?.weeks.find(w => w.mondayYmd === weekMonday) ?? null;
  const availActive = !!selectedTeamId && !!availWeek;

  // Heatmap : pour chaque slot iso, qui est dispo (hors conflit d'event).
  const availabilityBySlot = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!avail || !availWeek) return map;
    for (const m of avail.members) {
      const conflicts = new Set(m.conflictSlots);
      for (const s of m.slotsByWeek[weekMonday] ?? []) {
        if (conflicts.has(s)) continue;
        const list = map.get(s);
        if (list) list.push(m.uid);
        else map.set(s, [m.uid]);
      }
    }
    return map;
  }, [avail, availWeek, weekMonday]);

  const memberName = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of avail?.members ?? []) m.set(x.uid, x.displayName);
    return m;
  }, [avail]);

  // Événements groupés par jour grille, avec placement (lane) calculé.
  const eventsByDay = useMemo(() => {
    const gridYmds = new Set(grid.days.map(d => d.gridYmd));
    const byDay = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!ev.startsAt || ev.status === 'cancelled') continue;
      const d = new Date(ev.startsAt);
      // Une soirée qui déborde après minuit reste rattachée au jour précédent.
      const base = d.getHours() < 2 ? new Date(d.getTime() - 86_400_000) : d;
      const ymd = `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
      if (!gridYmds.has(ymd)) continue;
      const list = byDay.get(ymd);
      if (list) list.push(ev);
      else byDay.set(ymd, [ev]);
    }
    return byDay;
  }, [events, grid]);

  const goPrev = () => setWeekMonday(m => addDays(m, -7));
  const goNext = () => setWeekMonday(m => addDays(m, 7));
  const goToday = () => setWeekMonday(getMondayYmd(todayYmd));

  const monday = new Date(weekMonday + 'T12:00:00');
  const sunday = new Date(addDays(weekMonday, 6) + 'T12:00:00');
  const rangeLabel = `${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — ${sunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;

  return (
    <div className="space-y-3">
      {/* Navigation semaine */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={goPrev} aria-label="Semaine précédente"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={goNext} aria-label="Semaine suivante"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronRight size={16} />
        </button>
        <span className="font-display text-lg tracking-wider" style={{ color: 'var(--s-text)' }}>{rangeLabel}</span>
        <button type="button" onClick={goToday}
          className="ml-auto bevel-sm text-xs font-semibold transition-colors hover:bg-[var(--s-hover)]"
          style={{ padding: '5px 12px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          Aujourd&apos;hui
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Grille principale */}
        <div className="flex-1 min-w-0">
          {/* En-têtes des jours */}
          <div className="grid" style={{ gridTemplateColumns: `46px repeat(7, 1fr)` }}>
            <div />
            {grid.days.map((d, i) => {
              const isToday = d.gridYmd === todayYmd;
              const date = new Date(d.gridYmd + 'T12:00:00');
              return (
                <div key={d.gridYmd} className="text-center pb-1.5"
                  style={{ opacity: d.isPast ? 0.5 : 1 }}>
                  <div className="t-label" style={{ color: isToday ? 'var(--s-gold)' : 'var(--s-text-muted)' }}>
                    {DAY_LABELS[i]}
                  </div>
                  <div className="font-display flex items-center justify-center mx-auto"
                    style={{
                      fontSize: 15,
                      width: isToday ? 22 : 'auto', height: isToday ? 22 : 'auto',
                      background: isToday ? 'var(--s-gold)' : 'transparent',
                      color: isToday ? '#0a0a0a' : 'var(--s-text-dim)',
                    }}>
                    {date.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Corps de grille */}
          <div className="grid" style={{ gridTemplateColumns: `46px repeat(7, 1fr)` }}>
            {/* Axe horaire */}
            <div className="relative" style={{ height: SLOT_COUNT * SLOT_HEIGHT }}>
              {TIME_AXIS.map((t, idx) => (
                t.m === 0 ? (
                  <div key={idx} className="t-mono absolute right-1.5"
                    style={{ top: idx * SLOT_HEIGHT - 6, fontSize: 12, color: 'var(--s-text-muted)' }}>
                    {pad2(t.h)}:00
                  </div>
                ) : null
              ))}
            </div>

            {/* Colonnes jours */}
            {grid.days.map(day => {
              const dayEvents = eventsByDay.get(day.gridYmd) ?? [];
              const placements = layoutDayEvents(dayEvents);
              return (
                <div key={day.gridYmd} className="relative"
                  style={{ height: SLOT_COUNT * SLOT_HEIGHT, borderLeft: '1px solid var(--s-border)' }}>
                  {/* Cases de fond (créneaux 30 min) */}
                  {TIME_AXIS.map((t, idx) => {
                    const iso = day.slots[idx];
                    const availUids = availActive ? (availabilityBySlot.get(iso) ?? []) : [];
                    const shown = soloMember
                      ? (availUids.includes(soloMember) ? 1 : 0)
                      : availUids.length;
                    const total = avail?.members.length ?? 0;
                    let bg = 'var(--s-elevated)';
                    if (availActive && shown > 0) {
                      const ratio = soloMember ? 1 : Math.min(1, shown / Math.max(1, total));
                      bg = `rgba(255,184,0,${(0.1 + ratio * 0.42).toFixed(3)})`;
                    }
                    const slotTitle = availActive && availUids.length > 0
                      ? `${formatSlotTime(iso)} — Dispo ${availUids.length}/${total} : ${availUids.map(u => memberName.get(u) ?? '?').join(', ')}`
                      : undefined;
                    return (
                      <div key={idx}
                        onClick={() => {
                          if (canCreate && iso) onSlotCreate(iso, addMinutesToIso(iso, 120));
                        }}
                        title={slotTitle}
                        style={{
                          position: 'absolute', left: 0, right: 0,
                          top: idx * SLOT_HEIGHT, height: SLOT_HEIGHT,
                          background: bg,
                          borderTop: `1px solid ${t.m === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)'}`,
                          cursor: canCreate ? 'pointer' : 'default',
                        }} />
                    );
                  })}

                  {/* Blocs consensus (contour) */}
                  {availActive && availWeek && availWeek.blocks.map((b, bi) => {
                    const range = blockRange(b, day.slots);
                    if (!range) return null;
                    return (
                      <div key={bi} className="pointer-events-none"
                        style={{
                          position: 'absolute', left: 1, right: 1,
                          top: range.start * SLOT_HEIGHT,
                          height: (range.end - range.start + 1) * SLOT_HEIGHT,
                          border: '1.5px solid var(--s-gold)',
                          background: 'rgba(255,184,0,0.06)',
                        }}>
                        <span className="t-label absolute top-0.5 left-1" style={{ color: 'var(--s-gold)', fontSize: 10 }}>
                          ✓ {b.playerIds.length}
                        </span>
                      </div>
                    );
                  })}

                  {/* Blocs événements */}
                  {placements.map(p => {
                    const color = eventGameColor(p.event, teams);
                    const typeInfo = TYPE_INFO[p.event.type] ?? TYPE_INFO.autre;
                    const widthPct = 100 / p.laneCount;
                    return (
                      <button key={p.event.id} type="button"
                        onClick={e => { e.stopPropagation(); onEventClick(p.event.id); }}
                        title={`${p.event.title} — ${typeInfo.label}`}
                        className="text-left overflow-hidden transition-transform hover:z-[3]"
                        style={{
                          position: 'absolute',
                          top: p.startIdx * SLOT_HEIGHT + 1,
                          height: Math.max(SLOT_HEIGHT - 2, (p.endIdx - p.startIdx) * SLOT_HEIGHT - 2),
                          left: `calc(${p.lane * widthPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          background: 'var(--s-surface)',
                          borderLeft: `3px solid ${color}`,
                          border: `1px solid var(--s-border)`,
                          borderLeftWidth: 3,
                          borderLeftColor: color,
                          padding: '1px 4px',
                          zIndex: 2,
                        }}>
                        <span className="block truncate font-semibold" style={{ fontSize: 12, color: 'var(--s-text)' }}>
                          {p.event.title}
                        </span>
                        {(p.endIdx - p.startIdx) >= 3 && (
                          <span className="block truncate t-mono" style={{ fontSize: 12, color: typeInfo.color }}>
                            {typeInfo.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panneau latéral dispos — visible seulement si une équipe est ciblée */}
        {selectedTeamId && (
          <aside className="flex-shrink-0 w-[230px] bevel-sm" style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)' }}>
            <div className="px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--s-border)' }}>
              <CalendarClock size={13} style={{ color: 'var(--s-gold)' }} />
              <span className="t-label">Dispos {avail?.team.name ? `· ${avail.team.name}` : ''}</span>
            </div>

            {availLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={15} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
              </div>
            ) : !availActive ? (
              <p className="px-3 py-4 text-xs" style={{ color: 'var(--s-text-muted)' }}>
                Les disponibilités ne sont déclarées que sur la semaine courante et la suivante.
              </p>
            ) : (
              <div className="p-2 space-y-3">
                {/* Joueurs — clic pour isoler ses dispos dans la grille */}
                <div className="space-y-1">
                  <button type="button" onClick={() => setSoloMember(null)}
                    className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)]"
                    style={{
                      padding: '4px 6px',
                      background: soloMember === null ? 'rgba(255,184,0,0.12)' : 'transparent',
                      border: `1px solid ${soloMember === null ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                    }}>
                    <Users size={12} style={{ color: 'var(--s-gold)' }} />
                    <span style={{ fontSize: 12, color: 'var(--s-text)' }}>Toute l&apos;équipe</span>
                  </button>
                  {(avail?.members ?? []).map(m => {
                    const count = (m.slotsByWeek[weekMonday] ?? [])
                      .filter(s => !m.conflictSlots.includes(s)).length;
                    const active = soloMember === m.uid;
                    return (
                      <button key={m.uid} type="button"
                        onClick={() => setSoloMember(active ? null : m.uid)}
                        className="w-full flex items-center gap-2 transition-colors hover:bg-[var(--s-hover)]"
                        style={{
                          padding: '4px 6px',
                          background: active ? 'rgba(255,184,0,0.12)' : 'transparent',
                          border: `1px solid ${active ? 'rgba(255,184,0,0.35)' : 'var(--s-border)'}`,
                        }}>
                        <span className="flex-shrink-0" style={{
                          width: 6, height: 6,
                          background: m.isTitulaire ? 'var(--s-gold)' : 'var(--s-text-muted)',
                        }} />
                        <span className="truncate flex-1 text-left" style={{ fontSize: 12, color: 'var(--s-text)' }}>
                          {m.displayName}
                        </span>
                        <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                          {count > 0 ? `${count / 2}h` : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Consensus de la semaine */}
                <div>
                  <div className="t-label mb-1.5" style={{ color: 'var(--s-text-muted)' }}>
                    Créneaux consensus
                  </div>
                  {availWeek && availWeek.blocks.length > 0 ? (
                    <div className="space-y-1">
                      {availWeek.blocks.map((b, bi) => (
                        <div key={bi} className="flex items-center gap-1.5"
                          style={{ padding: '3px 6px', background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.25)' }}>
                          <Check size={11} style={{ color: 'var(--s-gold)', flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: 'var(--s-text)' }}>
                            {blockLabel(b)}
                          </span>
                          <span className="t-mono ml-auto" style={{ fontSize: 12, color: 'var(--s-gold)' }}>
                            {b.playerIds.length}j
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
                      Aucun créneau commun cette semaine.
                    </p>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ─── Helpers de placement ───────────────────────────────────────────────

type Placement = {
  event: CalendarEvent;
  startIdx: number;
  endIdx: number;
  lane: number;
  laneCount: number;
};

// Place les événements d'un jour en "lanes" côte à côte quand ils se chevauchent.
function layoutDayEvents(dayEvents: CalendarEvent[]): Placement[] {
  const items = dayEvents
    .map(ev => {
      const start = new Date(ev.startsAt!);
      const end = ev.endsAt ? new Date(ev.endsAt) : new Date(start.getTime() + 3_600_000);
      const startIdx = slotIndexForTime(start.getHours(), start.getMinutes());
      const durSlots = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 1_800_000));
      const endIdx = Math.min(SLOT_COUNT, startIdx + durSlots);
      return { event: ev, startIdx, endIdx };
    })
    .sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

  const laneEnd: number[] = [];
  const placed = items.map(it => {
    let lane = laneEnd.findIndex(e => e <= it.startIdx);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(it.endIdx); }
    else laneEnd[lane] = it.endIdx;
    return { ...it, lane };
  });
  const laneCount = Math.max(1, laneEnd.length);
  return placed.map(p => ({ ...p, laneCount }));
}

// Position d'un bloc consensus dans une colonne jour, ou null s'il n'y est pas.
function blockRange(block: MatchBlock, daySlots: string[]): { start: number; end: number } | null {
  const start = daySlots.indexOf(block.startSlot);
  const end = daySlots.indexOf(block.endSlot);
  if (start === -1 || end === -1) return null;
  return { start, end };
}

// "Mar · 20:00-22:00"
function blockLabel(block: MatchBlock): string {
  const d = new Date(block.startSlot.slice(0, 10) + 'T12:00:00');
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short' });
  const endPlus = addMinutesToIso(block.endSlot, 30);
  return `${day} · ${formatSlotTime(block.startSlot)}-${formatSlotTime(endPlus)}`;
}
