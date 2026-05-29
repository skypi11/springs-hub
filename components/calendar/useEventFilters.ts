'use client';

/**
 * useEventFilters — Hook qui regroupe les filtres UI du calendrier.
 *
 * Extrait de CalendarSection.tsx (Phase 3.1 refonte technique 29/05).
 * Self-contained, zéro dépendance externe à part React + localStorage.
 *
 * Gère 3 morceaux d'état UI :
 * - `filter` : période ('upcoming' | 'past' | 'all'). Default 'upcoming'.
 * - `teamFilter` : array d'IDs d'équipes (+ tokens FILTER_STAFF/STRUCTURE).
 *   Vide = toutes les audiences.
 * - `viewMode` : mode d'affichage du calendar ('month' | 'week' | 'list' | 'staff').
 *   Persisté en localStorage entre les sessions sous la clé 'aedral_calendar_view'.
 *
 * Note : `viewMode` est seul à être persisté (les autres filtres sont reset à
 * chaque mount). Si on voulait persister teamFilter aussi, l'ajouter ici.
 */

import { useState, useEffect, useCallback } from 'react';

export type EventListFilter = 'upcoming' | 'past' | 'all';
export type CalendarViewMode = 'month' | 'week' | 'list' | 'staff';

const VIEW_MODE_KEY = 'aedral_calendar_view';
const VALID_VIEW_MODES: ReadonlyArray<CalendarViewMode> = ['month', 'week', 'list', 'staff'];

function isValidViewMode(v: unknown): v is CalendarViewMode {
  return typeof v === 'string' && (VALID_VIEW_MODES as ReadonlyArray<string>).includes(v);
}

export interface UseEventFiltersReturn {
  filter: EventListFilter;
  setFilter: (f: EventListFilter) => void;
  teamFilter: string[];
  setTeamFilter: (ids: string[]) => void;
  viewMode: CalendarViewMode;
  changeView: (v: CalendarViewMode) => void;
}

export function useEventFilters(): UseEventFiltersReturn {
  const [filter, setFilter] = useState<EventListFilter>('upcoming');
  const [teamFilter, setTeamFilter] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  // Restore viewMode depuis localStorage au mount. SSR-safe (useEffect ne run
  // que côté client). Si la valeur stockée n'est pas valide → on garde 'month'.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (isValidViewMode(saved)) setViewMode(saved);
    } catch {
      /* localStorage indisponible (mode privé strict) → fallback default 'month' */
    }
  }, []);

  const changeView = useCallback((v: CalendarViewMode) => {
    setViewMode(v);
    try {
      localStorage.setItem(VIEW_MODE_KEY, v);
    } catch {
      /* quota localStorage atteint ou mode privé → on ignore silencieusement,
         l'utilisateur garde sa vue pour la session courante */
    }
  }, []);

  return { filter, setFilter, teamFilter, setTeamFilter, viewMode, changeView };
}
