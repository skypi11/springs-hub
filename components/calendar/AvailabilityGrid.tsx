'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Copy, Check } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api-client';
import {
  addDays,
  generateWeekGrid,
  type DayGrid,
  type WeekGrid,
} from '@/lib/availability';

export const AVAILABILITY_QUERY_KEY = ['availability', 'me'] as const;

// Jours affichés en colonnes
const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Plage horaire globale pour l'axe Y : 10h → 02h (16h × 2 = 32 slots)
// Couvre tous les horaires de tous les jours de la semaine.
function buildTimeAxis(): { hh: string; mm: string; label: string }[] {
  const out: { hh: string; mm: string; label: string }[] = [];
  // 10:00 → 23:30
  for (let h = 10; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = h < 10 ? `0${h}` : `${h}`;
      const mm = m === 0 ? '00' : '30';
      out.push({ hh, mm, label: `${hh}:${mm}` });
    }
  }
  // 00:00 → 01:30 (du lendemain)
  for (let h = 0; h < 2; h++) {
    for (const m of [0, 30]) {
      const hh = `0${h}`;
      const mm = m === 0 ? '00' : '30';
      out.push({ hh, mm, label: `${hh}:${mm}` });
    }
  }
  return out;
}

const TIME_AXIS = buildTimeAxis();

// Pour une journée donnée (gridYmd + sa plage horaire), retourne la chaîne de slot
// qui correspond à une heure de l'axe Y, ou null si ce créneau n'est pas valide ce jour-là.
function slotForCell(day: DayGrid, hh: string, mm: string): string | null {
  const timeStr = `${hh}:${mm}`;
  // Les heures après minuit appartiennent à "lendemain" mais sont rattachées visuellement au jour
  const hourNum = parseInt(hh, 10);
  const afterMidnight = hourNum < 6;
  const dateYmd = afterMidnight ? addDays(day.gridYmd, 1) : day.gridYmd;
  const candidate = `${dateYmd}T${timeStr}`;
  return day.slots.includes(candidate) ? candidate : null;
}

// Décale tous les slots d'une semaine de +7 jours (copie vers la semaine suivante).
function shiftSlots(slots: Set<string>, days: number): Set<string> {
  const out = new Set<string>();
  for (const s of slots) {
    const [datePart, timePart] = s.split('T');
    out.add(`${addDays(datePart, days)}T${timePart}`);
  }
  return out;
}

type WeekData = {
  mondayYmd: string;
  weekId: string;
  slots: string[];
};

export type ApiResponse = {
  today: string;
  previous: WeekData;
  current: WeekData;
  next: WeekData;
};

export default function AvailabilityGrid() {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  // Query partagée avec AvailabilityCollapsible
  const { data, isPending: loading } = useQuery({
    queryKey: AVAILABILITY_QUERY_KEY,
    queryFn: () => api<ApiResponse>('/api/availability/me'),
    enabled: !!firebaseUser,
  });

  // État local des slots (Set de strings) par semaine — permet l'édition sans rerequests
  const [currentSet, setCurrentSet] = useState<Set<string>>(new Set());
  const [nextSet, setNextSet] = useState<Set<string>>(new Set());
  const [currentDirty, setCurrentDirty] = useState(false);
  const [nextDirty, setNextDirty] = useState(false);

  // Sync du state local d'édition avec les données serveur (initial + refetch)
  useEffect(() => {
    if (!data) return;
    setCurrentSet(new Set(data.current.slots));
    setNextSet(new Set(data.next.slots));
    setCurrentDirty(false);
    setNextDirty(false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: ({ which, mondayYmd, slots }: { which: 'current' | 'next'; mondayYmd: string; slots: string[] }) =>
      api<{ slots: string[] }>('/api/availability/me', {
        method: 'PUT',
        body: { mondayYmd, slots },
      }).then((d) => ({ which, slots: d.slots ?? [] })),
    onSuccess: ({ which, slots }) => {
      if (which === 'current') {
        setCurrentSet(new Set(slots));
        setCurrentDirty(false);
      } else {
        setNextSet(new Set(slots));
        setNextDirty(false);
      }
      // Synchronise le cache (pour le résumé du collapsible) sans refetch
      qc.setQueryData<ApiResponse>(AVAILABILITY_QUERY_KEY, (prev) => {
        if (!prev) return prev;
        const week = which === 'current' ? { ...prev.current, slots } : prev.current;
        const nextW = which === 'next' ? { ...prev.next, slots } : prev.next;
        return { ...prev, current: week, next: nextW };
      });
      toast.success('Dispos enregistrées');
    },
    onError: (err: Error) => toast.error(err.message || 'Erreur'),
  });

  const saving = saveMutation.isPending ? saveMutation.variables?.which ?? null : null;

  function save(which: 'current' | 'next') {
    if (!data) return;
    const week = which === 'current' ? data.current : data.next;
    const set = which === 'current' ? currentSet : nextSet;
    saveMutation.mutate({ which, mondayYmd: week.mondayYmd, slots: Array.from(set) });
  }

  function copyFromPrevious() {
    if (!data) return;
    const prev = new Set(data.previous.slots);
    // Décaler vers la semaine courante (+7 jours)
    const shifted = shiftSlots(prev, 7);
    // Merger avec les slots past déjà figés (slots dont la date < today) — on ne doit pas les écraser
    // (l'API les réinjecte de toute façon, mais visuellement on veut voir la fusion)
    const next = new Set<string>();
    for (const s of currentSet) {
      const dayYmd = s.slice(0, 10);
      if (data.today && dayYmd < data.today) next.add(s); // garde past
    }
    for (const s of shifted) next.add(s);
    setCurrentSet(next);
    setCurrentDirty(true);
  }

  function copyFromCurrent() {
    if (!data) return;
    const shifted = shiftSlots(currentSet, 7);
    setNextSet(shifted);
    setNextDirty(true);
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--s-text-dim)' }} />
      </div>
    );
  }

  const currentGrid = generateWeekGrid(data.current.mondayYmd, data.today);
  const nextGrid = generateWeekGrid(data.next.mondayYmd, data.today);

  return (
    <div className="space-y-8">
      {/* Intro */}
      <div className="bevel p-5 animate-fade-in" style={{ background: 'var(--s-surface)', border: '1px solid var(--s-border)' }}>
        <p className="text-base" style={{ color: 'var(--s-text-dim)' }}>
          Indique quand tu es dispo pour jouer. Chaque case = 30 minutes. Le staff de ton équipe verra ces créneaux pour proposer des matchs et entraînements.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm" style={{ color: 'var(--s-text-muted)' }}>
          <span className="flex items-center gap-2">
            <span className="inline-block" style={{ width: '16px', height: '14px', background: 'var(--s-violet)', border: '1px solid rgba(163,100,217,0.5)' }} />
            Dispo
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block" style={{ width: '16px', height: '14px', background: 'var(--s-elevated)', border: '1px solid var(--s-bg)' }} />
            Non dispo
          </span>
          <span style={{ color: 'var(--s-text-dim)' }}>
            · Clique ou <strong style={{ color: 'var(--s-text)' }}>glisse</strong> pour sélectionner plusieurs créneaux à la fois
          </span>
        </div>
      </div>

      <WeekPanel
        title="SEMAINE COURANTE"
        weekGrid={currentGrid}
        slots={currentSet}
        onToggle={(slot) => {
          setCurrentSet(prev => {
            const next = new Set(prev);
            if (next.has(slot)) next.delete(slot);
            else next.add(slot);
            return next;
          });
          setCurrentDirty(true);
        }}
        dirty={currentDirty}
        saving={saving === 'current'}
        onSave={() => save('current')}
        copyLabel={data.previous.slots.length > 0 ? 'Copier semaine précédente' : null}
        onCopy={copyFromPrevious}
        today={data.today}
      />

      <WeekPanel
        title="SEMAINE SUIVANTE"
        weekGrid={nextGrid}
        slots={nextSet}
        onToggle={(slot) => {
          setNextSet(prev => {
            const next = new Set(prev);
            if (next.has(slot)) next.delete(slot);
            else next.add(slot);
            return next;
          });
          setNextDirty(true);
        }}
        dirty={nextDirty}
        saving={saving === 'next'}
        onSave={() => save('next')}
        copyLabel={currentSet.size > 0 ? 'Copier semaine courante' : null}
        onCopy={copyFromCurrent}
        today={data.today}
      />
    </div>
  );
}

// ─── Week panel ──────────────────────────────────────────────────────────────

function WeekPanel({
  title,
  weekGrid,
  slots,
  onToggle,
  dirty,
  saving,
  onSave,
  copyLabel,
  onCopy,
  today,
}: {
  title: string;
  weekGrid: WeekGrid;
  slots: Set<string>;
  onToggle: (slot: string) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  copyLabel: string | null;
  onCopy: () => void;
  today: string;
}) {
  // Drag mode : true si on est en train de draguer, intent = add | remove selon premier clic
  const dragModeRef = useRef<'add' | 'remove' | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    function onUp() {
      dragModeRef.current = null;
      setDragActive(false);
    }
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  const monday = new Date(weekGrid.mondayYmd + 'T12:00:00');
  const sunday = new Date(addDays(weekGrid.mondayYmd, 6) + 'T12:00:00');
  const rangeLabel = `${monday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} — ${sunday.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`;

  const countSelected = useMemo(() => {
    let c = 0;
    for (const day of weekGrid.days) for (const s of day.slots) if (slots.has(s)) c++;
    return c;
  }, [slots, weekGrid]);

  const isEmpty = countSelected === 0;

  return (
    <div className="bevel animate-fade-in-d1 relative overflow-hidden" style={{
      background: 'var(--s-surface)',
      border: dirty ? '1px solid rgba(255,184,0,0.35)' : '1px solid var(--s-border)',
      boxShadow: dirty ? '0 0 0 1px rgba(255,184,0,0.15), 0 0 24px rgba(255,184,0,0.08)' : 'none',
      transition: 'border-color 200ms, box-shadow 200ms',
    }}>
      <div className="h-[3px]" style={{
        background: dirty
          ? 'linear-gradient(90deg, var(--s-gold), rgba(255,184,0,0.4), transparent 70%)'
          : 'linear-gradient(90deg, var(--s-violet), rgba(123,47,190,0.4), transparent 70%)',
        transition: 'background 200ms',
      }} />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          <div>
            <h3 className="font-display text-2xl flex items-center gap-2" style={{ letterSpacing: '0.03em' }}>
              {title}
              {dirty && (
                <span className="t-label px-2 py-0.5 bevel-sm animate-pulse" style={{
                  fontSize: '10px',
                  background: 'rgba(255,184,0,0.15)',
                  border: '1px solid rgba(255,184,0,0.4)',
                  color: 'var(--s-gold)',
                }}>
                  NON SAUVEGARDÉ
                </span>
              )}
            </h3>
            <p className="t-mono mt-1.5" style={{ fontSize: '13px', color: 'var(--s-text-dim)' }}>
              {rangeLabel} · {countSelected} créneaux sélectionnés
            </p>
          </div>
          <div className="flex items-center gap-2">
            {copyLabel && (
              <button type="button" onClick={onCopy}
                className="btn-springs bevel-sm flex items-center gap-2 px-4 py-2"
                style={{
                  fontSize: '13px',
                  background: isEmpty ? 'rgba(123,47,190,0.12)' : 'transparent',
                  border: isEmpty ? '1px solid rgba(163,100,217,0.4)' : '1px solid var(--s-border)',
                  color: isEmpty ? 'var(--s-violet-light)' : 'var(--s-text-dim)',
                  cursor: 'pointer',
                  fontWeight: isEmpty ? 600 : 400,
                }}>
                <Copy size={14} /> {copyLabel}
              </button>
            )}
            <button type="button" onClick={onSave}
              disabled={!dirty || saving}
              className="btn-springs bevel-sm flex items-center gap-2 px-5 py-2"
              style={{
                fontSize: '13px',
                background: dirty ? 'var(--s-gold)' : 'transparent',
                border: `1px solid ${dirty ? 'var(--s-gold)' : 'var(--s-border)'}`,
                color: dirty ? '#000' : 'var(--s-text-muted)',
                cursor: dirty && !saving ? 'pointer' : 'not-allowed',
                fontWeight: 600,
              }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <Check size={14} />}
              {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'À jour'}
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{ minWidth: '640px', userSelect: 'none' }}>
            <thead>
              <tr>
                <th style={{ width: '64px' }} />
                {weekGrid.days.map((day, i) => {
                  const date = new Date(day.gridYmd + 'T12:00:00');
                  const dayLabel = DAY_LABELS[i];
                  const dayNum = date.getDate();
                  return (
                    <th key={day.gridYmd} className="t-label pb-3" style={{
                      fontSize: '12px',
                      color: day.isPast ? 'var(--s-text-muted)' : 'var(--s-text-dim)',
                      fontWeight: 600,
                      width: '76px',
                      opacity: day.isPast ? 0.5 : 1,
                    }}>
                      <div>{dayLabel}</div>
                      <div className="font-display text-xl" style={{ letterSpacing: '0.02em' }}>{dayNum}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {TIME_AXIS.map((axis, rowIdx) => {
                const isHourStart = axis.mm === '00';
                const ROW_HEIGHT = 22;
                return (
                <tr key={rowIdx}>
                  {/* Colonne des heures : label "17:00" positionné au niveau du bord
                     supérieur de la case 17:00 → 17:30, avec un offset négatif pour
                     que le milieu du texte soit ALIGNÉ sur la ligne de séparation
                     horaire (visuellement « sur » la frontière entre deux heures). */}
                  <td className="t-mono text-right pr-3" style={{
                    fontSize: '12px',
                    color: 'var(--s-text-dim)',
                    verticalAlign: 'top',
                    lineHeight: 1,
                    fontWeight: 500,
                    position: 'relative',
                    height: `${ROW_HEIGHT}px`,
                  }}>
                    {isHourStart && (
                      <span style={{
                        position: 'absolute',
                        right: '12px',
                        top: 0,
                        transform: 'translateY(-50%)',
                        background: 'var(--s-surface)',
                        padding: '0 4px',
                        whiteSpace: 'nowrap',
                      }}>
                        {axis.label}
                      </span>
                    )}
                  </td>
                  {weekGrid.days.map((day) => {
                    const slot = slotForCell(day, axis.hh, axis.mm);
                    if (!slot) {
                      return <td key={day.gridYmd} style={{ width: '76px', height: `${ROW_HEIGHT}px`, background: 'transparent' }} />;
                    }
                    const isSelected = slots.has(slot);
                    const slotDayYmd = slot.slice(0, 10);
                    const isPast = day.isPast || slotDayYmd < today;

                    return (
                      <td key={day.gridYmd}
                        onMouseDown={(e) => {
                          if (isPast) return;
                          e.preventDefault();
                          const intent = isSelected ? 'remove' : 'add';
                          dragModeRef.current = intent;
                          setDragActive(true);
                          onToggle(slot);
                        }}
                        onMouseEnter={() => {
                          if (isPast) return;
                          const mode = dragModeRef.current;
                          if (!mode) return;
                          const shouldAdd = mode === 'add';
                          if (shouldAdd && !isSelected) onToggle(slot);
                          else if (!shouldAdd && isSelected) onToggle(slot);
                        }}
                        style={{
                          width: '76px',
                          height: `${ROW_HEIGHT}px`,
                          background: isPast
                            ? (isSelected ? 'rgba(123,47,190,0.15)' : 'rgba(255,255,255,0.02)')
                            : isSelected
                              ? 'var(--s-violet)'
                              : 'var(--s-elevated)',
                          borderLeft: '1px solid var(--s-bg)',
                          borderRight: '1px solid var(--s-bg)',
                          borderTop: isHourStart
                            ? '2px solid rgba(255,255,255,0.14)'
                            : '1px solid rgba(255,255,255,0.04)',
                          borderBottom: 'none',
                          cursor: isPast ? 'not-allowed' : dragActive ? 'grabbing' : 'pointer',
                          opacity: isPast ? 0.5 : 1,
                          transition: 'background-color 100ms',
                        }}
                      />
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
