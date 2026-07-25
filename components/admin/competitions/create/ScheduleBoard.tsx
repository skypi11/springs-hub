'use client';

// Le déroulé du tournoi : quelles rencontres se jouent, dans quel ordre, quel
// jour. Remplace l'éditeur de plan de phases en jargon de bracket
// (« P2 — WR2 + LR1 »), que même son auteur ne relisait pas sans avoir l'arbre
// sous les yeux.
//
// Trois partis pris :
//  · chaque bloc porte son nom d'usage, son volume et la phrase qui explique
//    d'où sortent les équipes ;
//  · la barre de volume donne la forme du tournoi d'un coup d'œil (l'entonnoir
//    16 → 8 → 4 → 2 → 1 se voit sans lire un chiffre) ;
//  · on ne touche à rien par défaut : tout tient sur la journée 1, et un
//    bouton répartit automatiquement.

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { PlanBlock } from '@/lib/competitions/schedule-plan';

export interface ScheduleDay {
  date: string;
  startsAt: string;
  endsAt?: string;
}

export default function ScheduleBoard({
  blocks,
  dayByPhase,
  days,
  onDayByPhaseChange,
  onDaysChange,
  onAutoSpread,
}: {
  blocks: PlanBlock[];
  /** Journée (1-based) de chaque bloc, même ordre que `blocks`. */
  dayByPhase: number[];
  days: ScheduleDay[];
  onDayByPhaseChange: (next: number[]) => void;
  onDaysChange: (next: ScheduleDay[]) => void;
  onAutoSpread: () => void;
}) {
  const maxMatches = Math.max(1, ...blocks.map(b => b.matchCount));

  function moveBlock(index: number, delta: -1 | 1) {
    const target = (dayByPhase[index] ?? 1) + delta;
    if (target < 1 || target > days.length) return;
    // Les blocs se jouent dans l'ordre : déplacer l'un pousse ses voisins pour
    // qu'aucun bloc ne se retrouve programmé avant celui dont il dépend.
    const next = dayByPhase.map((day, i) => {
      if (i === index) return target;
      if (delta === 1 && i > index) return Math.max(day, target);
      if (delta === -1 && i < index) return Math.min(day, target);
      return day;
    });
    onDayByPhaseChange(next);
  }

  function addDay() {
    const last = days[days.length - 1];
    const nextDate = last?.date ? addOneDay(last.date) : '';
    onDaysChange([...days, { date: nextDate, startsAt: last?.startsAt ?? '15:00', endsAt: last?.endsAt ?? '22:00' }]);
  }

  function removeDay(dayIndex: number) {
    const removed = dayIndex + 1;
    const nextDays = days.filter((_, i) => i !== dayIndex);
    onDaysChange(nextDays);
    // Les blocs de la journée supprimée retombent sur la précédente (ou la
    // première), et ceux d'après remontent d'un cran.
    onDayByPhaseChange(dayByPhase.map(day => {
      if (day === removed) return Math.max(1, removed - 1);
      return day > removed ? day - 1 : day;
    }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-label-soft">Déroulé</span>
        <div className="flex items-center gap-2">
          {days.length > 1 && (
            <button type="button" className="btn-springs btn-ghost text-sm" onClick={onAutoSpread}>
              Répartir sur les jours
            </button>
          )}
          <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1" onClick={addDay}>
            <Plus size={13} /> Ajouter un jour
          </button>
        </div>
      </div>

      {days.map((day, dayIndex) => {
        const dayNumber = dayIndex + 1;
        // « Jour » et non « journée » : en round robin les BLOCS s'appellent
        // « Journée 1, 2, 3 » (journées de championnat) — sans cette
        // distinction, un jour de compétition nommé « Journée 1 » contenait
        // « Journée 1 » et « Journée 2 », illisible.
        const dayBlocks = blocks
          .map((block, index) => ({ block, index }))
          .filter(({ index }) => (dayByPhase[index] ?? 1) === dayNumber);
        const dayMatches = dayBlocks.reduce((sum, { block }) => sum + block.matchCount, 0);

        return (
          <div key={dayIndex} style={{ border: '1px solid var(--s-border)' }}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2"
              style={{ background: 'var(--s-elevated)' }}>
              <span className="text-sm font-semibold" style={{ minWidth: 56 }}>
                Jour {dayNumber}
              </span>
              <input type="date" className="settings-input" style={{ padding: '4px 8px', width: 150 }}
                aria-label={`Date du jour ${dayNumber}`}
                value={day.date}
                onChange={e => onDaysChange(days.map((d, i) => i === dayIndex ? { ...d, date: e.target.value } : d))} />
              <input type="time" className="settings-input" style={{ padding: '4px 8px', width: 96 }}
                aria-label={`Début du jour ${dayNumber}`}
                value={day.startsAt}
                onChange={e => onDaysChange(days.map((d, i) => i === dayIndex ? { ...d, startsAt: e.target.value } : d))} />
              <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>→</span>
              <input type="time" className="settings-input" style={{ padding: '4px 8px', width: 96 }}
                aria-label={`Fin du jour ${dayNumber}`}
                value={day.endsAt ?? ''}
                onChange={e => onDaysChange(days.map((d, i) => i === dayIndex ? { ...d, endsAt: e.target.value } : d))} />
              <span className="flex-1" />
              <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
                {dayMatches} match{dayMatches > 1 ? 's' : ''}
              </span>
              {days.length > 1 && (
                <button type="button" className="quiet-link" aria-label={`Supprimer le jour ${dayNumber}`}
                  onClick={() => removeDay(dayIndex)}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            {dayBlocks.length === 0 ? (
              <p className="text-sm px-3 py-3" style={{ color: 'var(--s-text-muted)' }}>
                Rien de programmé ce jour-là.
              </p>
            ) : dayBlocks.map(({ block, index }) => (
              <div key={block.phase} className="flex items-start gap-3 px-3 py-2"
                style={{ borderTop: '1px solid var(--s-border)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--s-text)' }}>{block.label}</p>
                  {block.hint && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{block.hint}</p>
                  )}
                </div>

                {/* Volume : la barre donne la forme du tournoi sans lire les
                    chiffres — l'entonnoir d'un bracket, le plateau d'une poule. */}
                <span className="hidden sm:block" style={{ width: 88, paddingTop: 5 }} aria-hidden="true">
                  <span style={{
                    display: 'block',
                    height: 6,
                    width: `${Math.max(8, (block.matchCount / maxMatches) * 100)}%`,
                    background: 'var(--s-text-muted)',
                    opacity: 0.5,
                  }} />
                </span>
                <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)', width: 62, textAlign: 'right', paddingTop: 2 }}>
                  {block.matchCount} match{block.matchCount > 1 ? 's' : ''}
                </span>

                <span className="flex items-center gap-1" style={{ paddingTop: 1 }}>
                  <button type="button" className="quiet-link"
                    aria-label={`Avancer « ${block.label} » au jour précédent`}
                    disabled={dayNumber === 1}
                    onClick={() => moveBlock(index, -1)}>
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" className="quiet-link"
                    aria-label={`Repousser « ${block.label} » au jour suivant`}
                    disabled={dayNumber === days.length}
                    onClick={() => moveBlock(index, 1)}>
                    <ChevronDown size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
