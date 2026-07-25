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
//  · on ne touche à rien par défaut : tout tient sur le jour 1, et un bouton
//    répartit automatiquement.
//
// UN SEUL point d'écriture (`onChange`) : jours et affectations partent
// ensemble. Deux appels d'état successifs repartaient du même instantané, et
// le second annulait le premier — supprimer un jour ne faisait rien.

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { spreadOverDays, type PlanBlock } from '@/lib/competitions/schedule-plan';

export interface ScheduleDay {
  date: string;
  startsAt: string;
  endsAt?: string;
}

export interface SchedulePlanState {
  days: ScheduleDay[];
  /** Jour (1-based) de chaque bloc, même ordre que `blocks`. */
  dayByPhase: number[];
}

/** Repères visuels des jours : une seule teinte, l'intensité change d'un jour
 *  au suivant. Un arc-en-ciel ferait un sapin de Noël — ici on veut juste voir
 *  où s'arrête un jour. */
const DAY_INTENSITY = [0.95, 0.6, 0.4, 0.28, 0.2];

export default function ScheduleBoard({
  blocks,
  state,
  accentColor = 'var(--s-blue)',
  stageLabel,
  onChange,
}: {
  blocks: PlanBlock[];
  state: SchedulePlanState;
  /** Teinte des repères de jour (couleur du jeu). */
  accentColor?: string;
  /** Nom de l'étape quand le tournoi en compte plusieurs. */
  stageLabel?: string;
  onChange: (next: SchedulePlanState) => void;
}) {
  const { days, dayByPhase } = state;
  const maxMatches = Math.max(1, ...blocks.map(b => b.matchCount));

  const patchDays = (nextDays: ScheduleDay[]) => onChange({ days: nextDays, dayByPhase });

  function moveBlock(index: number, delta: -1 | 1) {
    const target = (dayByPhase[index] ?? 1) + delta;
    if (target < 1 || target > days.length) return;
    // Les blocs se jouent dans l'ordre : déplacer l'un pousse ses voisins pour
    // qu'aucun bloc ne se retrouve programmé avant celui dont il dépend.
    onChange({
      days,
      dayByPhase: dayByPhase.map((day, i) => {
        if (i === index) return target;
        if (delta === 1 && i > index) return Math.max(day, target);
        if (delta === -1 && i < index) return Math.min(day, target);
        return day;
      }),
    });
  }

  function addDay() {
    const last = days[days.length - 1];
    onChange({
      days: [...days, {
        date: last?.date ? addOneDay(last.date) : '',
        startsAt: last?.startsAt ?? '15:00',
        endsAt: last?.endsAt ?? '22:00',
      }],
      dayByPhase,
    });
  }

  function removeDay(dayIndex: number) {
    const removed = dayIndex + 1;
    onChange({
      days: days.filter((_, i) => i !== dayIndex),
      // Les blocs du jour supprimé retombent sur le précédent, ceux d'après
      // remontent d'un cran.
      dayByPhase: dayByPhase.map(day => {
        if (day === removed) return Math.max(1, removed - 1);
        return day > removed ? day - 1 : day;
      }),
    });
  }

  return (
    <div className="space-y-3" style={{ maxWidth: 1080 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-label-soft">
          {stageLabel ? `Déroulé — ${stageLabel}` : 'Déroulé'}
        </span>
        <div className="flex items-center gap-2">
          {days.length > 1 && (
            <button type="button" className="btn-springs btn-ghost text-sm"
              onClick={() => onChange({ days, dayByPhase: spreadOverDays(blocks, days.length) })}>
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
        const intensity = DAY_INTENSITY[dayIndex] ?? 0.16;
        const dayBlocks = blocks
          .map((block, index) => ({ block, index }))
          .filter(({ index }) => (dayByPhase[index] ?? 1) === dayNumber);
        const dayMatches = dayBlocks.reduce((sum, { block }) => sum + block.matchCount, 0);

        return (
          <div key={dayIndex} style={{
            border: '1px solid var(--s-border)',
            // Le repère de jour : c'est lui qui donne la limite entre deux
            // jours sans avoir à lire les en-têtes.
            borderLeft: `3px solid color-mix(in srgb, ${accentColor} ${Math.round(intensity * 100)}%, transparent)`,
          }}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2"
              style={{ background: 'var(--s-elevated)' }}>
              <span className="font-display" style={{ fontSize: 17, letterSpacing: '0.04em', minWidth: 62 }}>
                JOUR {dayNumber}
              </span>
              <input type="date" className="settings-input" style={{ padding: '4px 8px', width: 150 }}
                aria-label={`Date du jour ${dayNumber}`}
                value={day.date}
                onChange={e => patchDays(days.map((d, i) => i === dayIndex ? { ...d, date: e.target.value } : d))} />
              <input type="time" className="settings-input" style={{ padding: '4px 8px', width: 96 }}
                aria-label={`Début du jour ${dayNumber}`}
                value={day.startsAt}
                onChange={e => patchDays(days.map((d, i) => i === dayIndex ? { ...d, startsAt: e.target.value } : d))} />
              <span className="text-sm" style={{ color: 'var(--s-text-muted)' }}>→</span>
              <input type="time" className="settings-input" style={{ padding: '4px 8px', width: 96 }}
                aria-label={`Fin du jour ${dayNumber}`}
                value={day.endsAt ?? ''}
                onChange={e => patchDays(days.map((d, i) => i === dayIndex ? { ...d, endsAt: e.target.value } : d))} />
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
            ) : dayBlocks.map(({ block, index }, position) => (
              <div key={block.phase}>
                {/* Changement d'étape dans la journée : on annonce laquelle,
                    sinon poules et phase finale se confondent. */}
                {block.stageLabel && block.stage !== dayBlocks[position - 1]?.block.stage && (
                  <p className="t-label-soft px-3 pt-2 pb-1" style={{ borderTop: '1px solid var(--s-border)' }}>
                    {block.stageLabel}
                  </p>
                )}
              <div className="flex items-start gap-3 px-3 py-2"
                style={{ borderTop: '1px solid var(--s-border)' }}>
                {/* Volume collé au nom : sur un écran large, renvoyer les
                    chiffres à l'extrême droite laissait un couloir vide. */}
                <span className="flex items-center gap-2" style={{ paddingTop: 3 }}>
                  <span className="hidden sm:block" style={{ width: 64 }} aria-hidden="true">
                    <span style={{
                      display: 'block',
                      height: 6,
                      width: `${Math.max(8, (block.matchCount / maxMatches) * 100)}%`,
                      background: 'var(--s-text-muted)',
                      opacity: 0.5,
                    }} />
                  </span>
                  <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)', width: 62 }}>
                    {block.matchCount} match{block.matchCount > 1 ? 's' : ''}
                  </span>
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--s-text)' }}>{block.label}</p>
                  {block.hint && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--s-text-muted)' }}>{block.hint}</p>
                  )}
                </div>

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
