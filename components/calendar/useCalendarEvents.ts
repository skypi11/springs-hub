'use client';

/**
 * useCalendarEvents — Hook qui regroupe le fetch + tick "now" du calendrier.
 *
 * Extrait de CalendarSection.tsx (Phase 3.2 refonte technique 29/05).
 *
 * Gère :
 * - useQuery sur /api/structures/{id}/events (cache React Query partagé)
 * - `now` : timestamp rafraîchi toutes les 60 s. Sert aux memos `filteredEvents`
 *   (filtre upcoming/past par rapport à maintenant) et `nextEvent`. 60 s suffit
 *   largement pour un calendar — pas la peine de re-render chaque seconde.
 * - `invalidateEvents` : helper exposé pour que les mutations puissent
 *   forcer un re-fetch après écriture.
 *
 * Le hook ne fait PAS les memos `filteredEvents/monthEvents/nextEvent` car
 * ils dépendent des filtres UI (filter/teamFilter de useEventFilters). Les
 * memos restent dans le composant qui combine les 2 hooks.
 *
 * Param `enabled` : passé depuis le composant (typiquement `!!firebaseUser`)
 * pour ne pas avoir à importer useAuth dans le hook (séparation des concerns).
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { CalendarEvent } from './CalendarSection';

export interface UseCalendarEventsReturn {
  events: CalendarEvent[];
  loading: boolean;
  /** Timestamp ms rafraîchi toutes les 60 s — pour les memos qui filtrent upcoming/past. */
  now: number;
  /** Force un re-fetch de la query events (utilisé par les mutations + actions UI). */
  invalidateEvents: () => void;
}

export function useCalendarEvents(
  structureId: string,
  enabled: boolean,
): UseCalendarEventsReturn {
  const qc = useQueryClient();
  const eventsQueryKey = ['structure', structureId, 'events'] as const;

  const { data: eventsData, isPending: loading } = useQuery({
    queryKey: eventsQueryKey,
    queryFn: () => api<{ events: CalendarEvent[] }>(`/api/structures/${structureId}/events`),
    enabled,
  });
  const events = eventsData?.events ?? [];

  const invalidateEvents = () => qc.invalidateQueries({ queryKey: eventsQueryKey });

  // Tick toutes les 60s pour réévaluer "upcoming/past" sans avoir à re-fetch
  // les events (le filtre est temporel côté client).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return { events, loading, now, invalidateEvents };
}
