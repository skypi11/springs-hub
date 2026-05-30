'use client';

// Vue Mois du calendrier de structure, grille 6×7 façon calendrier classique.
// Donne au fondateur la vision globale réclamée : tous les événements de toutes
// les équipes d'un coup d'œil, sans ouvrir chaque équipe une par une.
//
// - Puces colorées par jeu (RL bleu / TM vert / structure-staff or)
// - "+N" si plus de 3 événements un jour → popover listant la journée
// - Clic sur une puce → modale détail ; clic sur une case → création pré-remplie

import { useMemo, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import Portal from '@/components/ui/Portal';
import type { CalendarEvent, Team } from './CalendarSection';
import { TYPE_INFO } from './CalendarSection';
import { getGameColor, getGameLabel } from '@/lib/games-registry';

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const MAX_VISIBLE = 2;

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function ymdOf(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function timeOf(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Couleur d'un événement par jeu, RL bleu, TM vert, structure/staff/multi-jeux → or.
// On colore par jeu (et pas par équipe) car une structure peut avoir 15+ équipes :
// 15 couleurs distinctes seraient illisibles. Le nom de l'équipe reste sur la puce.
export function eventGameColor(ev: CalendarEvent, teams: Team[]): string {
  // Fallback or pour les events non rattachés à un jeu (structure-wide, staff).
  const colorForGame = (g?: string) => g ? getGameColor(g) : 'var(--s-gold)';
  const t = ev.target;
  if (t.scope === 'game') return colorForGame(t.game);
  if (t.scope === 'teams') {
    const games = new Set(
      (t.teamIds ?? [])
        .map(id => teams.find(tm => tm.id === id)?.game)
        .filter(Boolean) as string[]
    );
    return games.size === 1 ? colorForGame([...games][0]) : 'var(--s-gold)';
  }
  return 'var(--s-gold)';
}

// Libellé "pour qui" d'un événement : nom(s) d'équipe, jeu, staff ou structure.
export function eventTargetLabel(ev: CalendarEvent, teams: Team[]): string {
  const t = ev.target;
  if (t.scope === 'structure') return 'Toute la structure';
  if (t.scope === 'game') {
    return getGameLabel(t.game);
  }
  if (t.scope === 'staff') return 'Staff';
  const names = (t.teamIds ?? [])
    .map(id => teams.find(tm => tm.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'Équipes';
}

type Props = {
  // Événements déjà filtrés par le filtre équipe de CalendarSection.
  events: CalendarEvent[];
  teams: Team[];
  now: number;
  canCreate: boolean;
  onEventClick: (id: string) => void;
  onDayCreate: (ymd: string) => void;
};

export default function MonthView({ events, teams, now, canCreate, onEventClick, onDayCreate }: Props) {
  const today = useMemo(() => new Date(now), [now]);
  const todayYmd = ymdOf(today);
  const [anchor, setAnchor] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [dayPopover, setDayPopover] = useState<{ ymd: string; top: number; left: number } | null>(null);
  // Mobile (< sm) : cases compactes, points colorés au lieu des puces texte,
  // illisibles dans une colonne de ~46px. Le tap sur la case ouvre le panneau du jour.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Grille : 42 cases (6 semaines), démarrage au lundi de la semaine du 1er.
  const cells = useMemo(() => {
    const first = new Date(anchor.y, anchor.m, 1);
    const firstDow = (first.getDay() + 6) % 7; // 0 = lundi
    const out: { date: Date; ymd: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(anchor.y, anchor.m, 1 - firstDow + i);
      out.push({ date: d, ymd: ymdOf(d), inMonth: d.getMonth() === anchor.m });
    }
    return out;
  }, [anchor]);

  // Événements groupés par jour calendaire (clé YMD), triés par heure.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!ev.startsAt) continue;
      const key = ymdOf(new Date(ev.startsAt));
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));
    }
    return map;
  }, [events]);

  const goPrev = () => setAnchor(a => {
    const d = new Date(a.y, a.m - 1, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const goNext = () => setAnchor(a => {
    const d = new Date(a.y, a.m + 1, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const goToday = () => setAnchor({ y: today.getFullYear(), m: today.getMonth() });

  const monthEventCount = cells.reduce(
    (sum, c) => sum + (c.inMonth ? (eventsByDay.get(c.ymd)?.length ?? 0) : 0), 0
  );
  const popoverEvents = dayPopover ? (eventsByDay.get(dayPopover.ymd) ?? []) : [];

  return (
    <div className="space-y-3">
      {/* Barre de navigation du mois */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={goPrev} aria-label="Mois précédent"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" onClick={goNext} aria-label="Mois suivant"
          className="flex items-center justify-center bevel-sm transition-colors hover:bg-[var(--s-hover)]"
          style={{ width: 30, height: 30, background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          <ChevronRight size={16} />
        </button>
        <span className="font-display text-lg tracking-wider" style={{ color: 'var(--s-text)' }}>
          {MONTHS[anchor.m].toUpperCase()} {anchor.y}
        </span>
        <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          · {monthEventCount} événement{monthEventCount > 1 ? 's' : ''}
        </span>
        <button type="button" onClick={goToday}
          className="ml-auto bevel-sm text-xs font-semibold transition-colors hover:bg-[var(--s-hover)]"
          style={{ padding: '5px 12px', background: 'var(--s-elevated)', border: '1px solid var(--s-border)', color: 'var(--s-text-dim)' }}>
          Aujourd&apos;hui
        </button>
      </div>

      {/* En-têtes jours de semaine */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="t-label text-center py-1" style={{ color: 'var(--s-text-muted)' }}>{d}</div>
        ))}
      </div>

      {/* Grille des jours, un clic sur une case ouvre le panneau du jour */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map(cell => {
          const dayEvents = eventsByDay.get(cell.ymd) ?? [];
          const isToday = cell.ymd === todayYmd;
          const visible = dayEvents.slice(0, MAX_VISIBLE);
          const overflow = dayEvents.length - visible.length;
          return (
            <div key={cell.ymd}
              onClick={e => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDayPopover({ ymd: cell.ymd, top: r.top, left: r.left });
              }}
              className={`bevel-sm ${isNarrow ? 'p-1' : 'p-1.5'} flex flex-col gap-1 cursor-pointer transition-colors overflow-hidden ${
                cell.inMonth ? 'bg-[var(--s-elevated)] hover:bg-[var(--s-hover)]' : 'bg-[var(--s-bg)]'
              }`}
              style={{
                // Hauteur fixe → toutes les lignes de la grille sont identiques.
                // Desktop : 2 puces (2 lignes) + en-tête + "+N". Mobile : compacte (points).
                height: isNarrow ? 64 : 148,
                border: `1px solid ${isToday ? 'rgba(255,184,0,0.4)' : 'var(--s-border)'}`,
                opacity: cell.inMonth ? 1 : 0.45,
              }}>
              {/* Numéro du jour */}
              <div className="flex items-center justify-between">
                <span className="font-display leading-none flex items-center justify-center"
                  style={{
                    fontSize: 14,
                    width: isToday ? 22 : 'auto',
                    height: isToday ? 22 : 'auto',
                    background: isToday ? 'var(--s-gold)' : 'transparent',
                    color: isToday ? '#0a0a0a' : 'var(--s-text-dim)',
                  }}>
                  {cell.date.getDate()}
                </span>
              </div>

              {isNarrow ? (
                /* Mobile : rangée de points colorés, le tap sur la case ouvre le jour */
                dayEvents.length > 0 && (
                  <div className="flex flex-wrap gap-[3px] mt-auto">
                    {dayEvents.slice(0, 10).map(ev => (
                      <span key={ev.id} style={{
                        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                        background: ev.status === 'cancelled' ? 'var(--s-text-muted)' : eventGameColor(ev, teams),
                        opacity: ev.status === 'cancelled' ? 0.5 : 1,
                      }} />
                    ))}
                    {dayEvents.length > 10 && (
                      <span style={{ fontSize: 11, lineHeight: 1, color: 'var(--s-text-muted)' }}>
                        +{dayEvents.length - 10}
                      </span>
                    )}
                  </div>
                )
              ) : (
                <>
                  {/* Puces événements, 2 lignes : titre + pour qui */}
                  {visible.map(ev => {
                    const color = eventGameColor(ev, teams);
                    const cancelled = ev.status === 'cancelled';
                    return (
                      <button key={ev.id} type="button"
                        onClick={e => { e.stopPropagation(); onEventClick(ev.id); }}
                        title={`${timeOf(ev.startsAt)} · ${ev.title}, ${eventTargetLabel(ev, teams)}`}
                        className="block w-full text-left transition-colors hover:bg-[var(--s-hover)]"
                        style={{
                          padding: '2px 5px',
                          background: 'var(--s-surface)',
                          borderLeft: `3px solid ${cancelled ? 'var(--s-text-muted)' : color}`,
                          opacity: cancelled ? 0.5 : 1,
                        }}>
                        <span className="flex items-center gap-1">
                          <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                            {timeOf(ev.startsAt)}
                          </span>
                          <span className="truncate" style={{
                            fontSize: 12,
                            color: 'var(--s-text)',
                            textDecoration: cancelled ? 'line-through' : 'none',
                          }}>
                            {ev.title}
                          </span>
                        </span>
                        <span className="block truncate" style={{ fontSize: 12, lineHeight: 1.2, color: 'var(--s-text-muted)' }}>
                          {eventTargetLabel(ev, teams)}
                        </span>
                      </button>
                    );
                  })}

                  {/* Débordement, le clic sur la case ouvre le panneau complet */}
                  {overflow > 0 && (
                    <span style={{ fontSize: 12, color: 'var(--s-text-muted)', padding: '0 5px' }}>
                      +{overflow} autre{overflow > 1 ? 's' : ''}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Panneau du jour, ouvert au clic sur n'importe quelle case */}
      {dayPopover && (
        <Portal>
          <div className="fixed inset-0 z-[60]" onClick={() => setDayPopover(null)} />
          <div className="fixed z-[61] flex flex-col bevel-sm animate-fade-in"
            style={{
              width: 'min(300px, calc(100vw - 1rem))',
              top: Math.max(8, Math.min(dayPopover.top, window.innerHeight - 420)),
              left: Math.max(8, Math.min(dayPopover.left, window.innerWidth - Math.min(300, window.innerWidth - 16) - 8)),
              maxHeight: 420,
              background: 'var(--s-surface)',
              border: '1px solid var(--s-border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            }}>
            {/* En-tête */}
            <div className="px-3 py-2.5 flex items-center justify-between flex-shrink-0"
              style={{ borderBottom: '1px solid var(--s-border)' }}>
              <span className="t-sub" style={{ color: 'var(--s-text)' }}>
                {(() => {
                  const [y, m, d] = dayPopover.ymd.split('-').map(Number);
                  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
                })()}
              </span>
              <button type="button" onClick={() => setDayPopover(null)} aria-label="Fermer"
                className="flex items-center justify-center transition-colors hover:text-[var(--s-text)]"
                style={{ color: 'var(--s-text-dim)' }}>
                <X size={14} />
              </button>
            </div>

            {/* Liste des événements du jour */}
            <div className="p-1.5 space-y-1 overflow-y-auto flex-1">
              {popoverEvents.length === 0 ? (
                <p className="text-xs text-center py-5" style={{ color: 'var(--s-text-muted)' }}>
                  Aucun événement ce jour.
                </p>
              ) : popoverEvents.map(ev => {
                const color = eventGameColor(ev, teams);
                const cancelled = ev.status === 'cancelled';
                const typeInfo = TYPE_INFO[ev.type] ?? TYPE_INFO.autre;
                return (
                  <button key={ev.id} type="button"
                    onClick={() => { setDayPopover(null); onEventClick(ev.id); }}
                    className="w-full flex items-start gap-2 text-left transition-colors hover:bg-[var(--s-hover)]"
                    style={{
                      padding: '5px 7px',
                      background: 'var(--s-elevated)',
                      borderLeft: `3px solid ${cancelled ? 'var(--s-text-muted)' : color}`,
                      opacity: cancelled ? 0.55 : 1,
                    }}>
                    <span className="t-mono flex-shrink-0" style={{ fontSize: 12, color: 'var(--s-text-dim)', marginTop: 1 }}>
                      {timeOf(ev.startsAt)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate" style={{
                        fontSize: 12, color: 'var(--s-text)',
                        textDecoration: cancelled ? 'line-through' : 'none',
                      }}>
                        {ev.title}
                      </span>
                      <span className="block truncate" style={{ fontSize: 12, color: 'var(--s-text-dim)' }}>
                        {eventTargetLabel(ev, teams)}
                      </span>
                    </span>
                    <span className="flex-shrink-0" style={{ fontSize: 12, color: typeInfo.color, marginTop: 1 }}>
                      {typeInfo.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Créer un événement ce jour */}
            {canCreate && (
              <button type="button"
                onClick={() => { const ymd = dayPopover.ymd; setDayPopover(null); onDayCreate(ymd); }}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 flex-shrink-0 text-xs font-semibold transition-colors hover:bg-[var(--s-hover)]"
                style={{ borderTop: '1px solid var(--s-border)', color: 'var(--s-gold)' }}>
                <Plus size={13} /> Nouvel événement ce jour
              </button>
            )}
          </div>
        </Portal>
      )}
    </div>
  );
}
