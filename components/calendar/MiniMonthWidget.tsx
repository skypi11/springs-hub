'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as ChevronRightSmall, X } from 'lucide-react';
import type { EventType } from '@/lib/event-permissions';
import { normalizeEventType } from '@/lib/event-permissions';

const TYPE_COLOR: Record<EventType, string> = {
  training: 'var(--s-text-dim)',
  scrim: 'var(--s-blue)',
  match: 'var(--s-gold)',
  tournoi: '#00D9B5',
  autre: 'var(--s-text-dim)',
};

const TYPE_LABEL: Record<EventType, string> = {
  training: 'Training',
  scrim: 'Scrim',
  match: 'Match',
  tournoi: 'Tournoi',
  autre: 'Autre',
};

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export type MiniEvent = {
  id: string;
  startsAt: string | null;
  type: EventType;
  title: string;
  structureLabel?: string;
};

function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtFullDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date
    .toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })
    .toUpperCase();
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function MiniMonthWidget({
  events,
  onEventClick,
}: {
  events: MiniEvent[];
  onEventClick: (eventId: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);

  const todayYmd = ymdOf(today);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, MiniEvent[]>();
    for (const e of events) {
      if (!e.startsAt) continue;
      const k = ymdOf(new Date(e.startsAt));
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    // Sort each day by startsAt
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.startsAt ? new Date(a.startsAt).getTime() : 0;
        const tb = b.startsAt ? new Date(b.startsAt).getTime() : 0;
        return ta - tb;
      });
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const firstDay = new Date(cursor.year, cursor.month, 1);
    // Décale pour commencer le lundi (getDay : 0=Dim → 6, 1=Lun → 0…)
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    const startDate = new Date(cursor.year, cursor.month, 1 - dayOfWeek);
    const out: { date: Date; ymd: string; inMonth: boolean; isToday: boolean; events: MiniEvent[] }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const k = ymdOf(d);
      out.push({
        date: d,
        ymd: k,
        inMonth: d.getMonth() === cursor.month,
        isToday: k === todayYmd,
        events: eventsByDay.get(k) ?? [],
      });
    }
    // Trim la dernière rangée si elle est entièrement hors mois (mois sur 5 lignes au lieu de 6)
    const lastRow = out.slice(35, 42);
    if (lastRow.every(c => !c.inMonth)) return out.slice(0, 35);
    return out;
  }, [cursor, eventsByDay, todayYmd]);

  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();
  const selectedEvents = selectedYmd ? eventsByDay.get(selectedYmd) ?? [] : [];

  function handleDayClick(ymd: string, hasEvents: boolean) {
    if (!hasEvents) return;
    setSelectedYmd((prev) => (prev === ymd ? null : ymd));
  }

  function goPrevMonth() {
    setCursor(c => {
      const m = c.month - 1;
      return m < 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: m };
    });
    setSelectedYmd(null);
  }

  function goNextMonth() {
    setCursor(c => {
      const m = c.month + 1;
      return m > 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: m };
    });
    setSelectedYmd(null);
  }

  function goToday() {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelectedYmd(null);
  }

  return (
    <div
      className="bevel p-4 sm:p-5 animate-fade-in"
      style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}
    >
      {/* Header navigation */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <button
          type="button"
          onClick={goPrevMonth}
          className="w-7 h-7 flex items-center justify-center bevel-sm flex-shrink-0"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)', cursor: 'pointer' }}
          aria-label="Mois précédent"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 justify-center">
          <h3 className="font-display text-base sm:text-lg truncate" style={{ letterSpacing: '0.04em' }}>
            {MONTH_LABELS[cursor.month].toUpperCase()} {cursor.year}
          </h3>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={goToday}
              className="t-mono px-2 py-0.5 flex-shrink-0"
              style={{
                fontSize: '11px',
                color: 'var(--s-text-dim)',
                background: 'var(--s-elevated)',
                border: '1px solid var(--s-border)',
                cursor: 'pointer',
              }}
            >
              AUJOURD&apos;HUI
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={goNextMonth}
          className="w-7 h-7 flex items-center justify-center bevel-sm flex-shrink-0"
          style={{ background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)', cursor: 'pointer' }}
          aria-label="Mois suivant"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Grille */}
      <div className="grid grid-cols-7 gap-1">
        {DAY_LABELS.map((d, i) => (
          <div key={i} className="t-label text-center pb-1" style={{ fontSize: '11px', color: 'var(--s-text-muted)' }}>
            {d}
          </div>
        ))}
        {cells.map((cell, i) => {
          const hasEvents = cell.events.length > 0;
          const canClick = hasEvents;
          const isSelected = selectedYmd === cell.ymd;
          const colors: string[] = [];
          const seen = new Set<string>();
          for (const e of cell.events) {
            const c = TYPE_COLOR[normalizeEventType(e.type)];
            if (!seen.has(c)) {
              seen.add(c);
              colors.push(c);
              if (colors.length === 3) break;
            }
          }

          // Background / border priorité : sélectionné > aujourd'hui > avec events > vide
          const bg = isSelected
            ? 'rgba(255,184,0,0.18)'
            : cell.isToday
              ? 'rgba(255,184,0,0.10)'
              : hasEvents
                ? 'var(--s-elevated)'
                : 'rgba(255,255,255,0.015)';
          const border = isSelected
            ? '1px solid rgba(255,184,0,0.75)'
            : cell.isToday
              ? '1px solid rgba(255,184,0,0.45)'
              : hasEvents
                ? '1px solid var(--s-border)'
                : '1px solid rgba(255,255,255,0.03)';
          const textColor = cell.inMonth
            ? (isSelected || cell.isToday ? 'var(--s-gold)' : 'var(--s-text)')
            : 'var(--s-text-muted)';

          return (
            <button
              key={i}
              type="button"
              disabled={!canClick}
              onClick={() => handleDayClick(cell.ymd, hasEvents)}
              className="flex flex-col items-center justify-start transition-all"
              style={{
                background: bg,
                border,
                color: textColor,
                opacity: cell.inMonth ? 1 : 0.4,
                cursor: canClick ? 'pointer' : 'default',
                fontSize: '13px',
                fontWeight: cell.isToday || isSelected ? 700 : 500,
                padding: '6px 2px 5px',
                minHeight: '42px',
                lineHeight: 1,
              }}
              onMouseEnter={(e) => {
                if (canClick && !isSelected && !cell.isToday) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (canClick && !isSelected && !cell.isToday) {
                  e.currentTarget.style.background = 'var(--s-elevated)';
                }
              }}
            >
              <span>{cell.date.getDate()}</span>
              <div className="flex gap-0.5 mt-1.5" style={{ minHeight: '5px' }}>
                {colors.map((c, j) => (
                  <span key={j} className="block" style={{ width: '5px', height: '5px', borderRadius: '50%', background: c }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Légende */}
      <div
        className="mt-3 pt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5"
        style={{ borderTop: '1px solid var(--s-border)', fontSize: '11px', color: 'var(--s-text-muted)' }}
      >
        <Legend color="var(--s-gold)" label="Match" />
        <Legend color="var(--s-blue)" label="Scrim" />
        <Legend color="#00D9B5" label="Tournoi" />
        <Legend color="var(--s-text-dim)" label="Training" />
      </div>

      {/* Panel events du jour sélectionné */}
      {selectedYmd && selectedEvents.length > 0 && (
        <div
          className="mt-4 bevel-sm animate-fade-in overflow-hidden"
          style={{ background: 'var(--s-elevated)', border: '1px solid rgba(255,184,0,0.35)' }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: '1px solid var(--s-border)', background: 'rgba(255,184,0,0.06)' }}
          >
            <span className="font-display" style={{ fontSize: '13px', letterSpacing: '0.06em', color: 'var(--s-gold)' }}>
              {fmtFullDate(selectedYmd)} · {selectedEvents.length} EVENT{selectedEvents.length > 1 ? 'S' : ''}
            </span>
            <button
              type="button"
              onClick={() => setSelectedYmd(null)}
              className="w-6 h-6 flex items-center justify-center"
              style={{ color: 'var(--s-text-dim)', cursor: 'pointer' }}
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--s-border)' }}>
            {selectedEvents.map((ev) => {
              const t = normalizeEventType(ev.type);
              const color = TYPE_COLOR[t];
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => onEventClick(ev.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span
                      className="t-mono flex-shrink-0"
                      style={{ fontSize: '12px', color: 'var(--s-text-dim)', minWidth: '38px' }}
                    >
                      {fmtTime(ev.startsAt)}
                    </span>
                    <span
                      className="flex-shrink-0"
                      style={{
                        width: '3px',
                        height: '24px',
                        background: color,
                        borderRadius: '1px',
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="t-label"
                          style={{
                            fontSize: '10px',
                            color,
                            background: `${color}15`,
                            border: `1px solid ${color}35`,
                            padding: '1px 5px',
                          }}
                        >
                          {TYPE_LABEL[t]}
                        </span>
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--s-text)' }}>
                          {ev.title}
                        </span>
                      </div>
                      {ev.structureLabel && (
                        <p className="t-mono mt-0.5 truncate" style={{ fontSize: '11px', color: 'var(--s-text-muted)' }}>
                          {ev.structureLabel}
                        </p>
                      )}
                    </div>
                    <ChevronRightSmall size={14} style={{ color: 'var(--s-text-muted)', flexShrink: 0 }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span>{label}</span>
    </span>
  );
}
