'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, CalendarClock } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';

// Places restantes et compte à rebours, affichés dans le hero.
//
// Le nombre de places n'existait que sur la page des inscrits — c'est-à-dire là
// où va quelqu'un de déjà convaincu. Le remonter dans le hero, à côté du compte
// à rebours, c'est ce qui transforme un « intéressant » en inscription : une
// jauge qui se remplit et une date qui approche se lisent en une seconde.

type Ctx = { seats?: { remaining: number; max: number } };

function daysUntilEvent(): number {
  const start = new Date(`${MANIA_CUP.startDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((start.getTime() - today.getTime()) / 86_400_000);
}

export default function HeroStatus() {
  // Le compte à rebours dépend de la date du jour : calculé au rendu serveur, il
  // produirait une valeur différente de celle du client (à cheval sur minuit, ou
  // dans un autre fuseau) et React signalerait une divergence d'hydratation.
  // useSyncExternalStore est fait pour ça : rien côté serveur, la vraie valeur
  // côté client. Pas d'abonnement, la valeur ne change pas en cours de session.
  const days = useSyncExternalStore(
    () => () => {},
    () => daysUntilEvent(),
    () => null
  );

  const { data } = useQuery({
    queryKey: ['mania-cup', 'register'] as const,
    queryFn: () => apiPublic<Ctx>('/api/mania-cup/register'),
    staleTime: 30_000,
  });

  const seats = data?.seats;
  const remaining = seats?.remaining;
  const almostFull = typeof remaining === 'number' && remaining <= 10;

  if (!seats && days === null) return null;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
      {typeof remaining === 'number' && (
        <span className="flex items-center gap-2">
          <Users size={18} className="text-[#8d89a8]" aria-hidden />
          {remaining === 0 ? (
            <strong className="text-[#FFB800]">Complet</strong>
          ) : (
            <>
              <strong className={almostFull ? 'text-[#FFB800]' : 'text-[#00D936]'}>
                {remaining}
              </strong>
              <span className="text-[#c9c5d8]">
                place{remaining > 1 ? 's' : ''} restante{remaining > 1 ? 's' : ''} sur{' '}
                {seats?.max}
              </span>
            </>
          )}
        </span>
      )}

      {days !== null && days > 0 && (
        <span className="flex items-center gap-2 text-[#c9c5d8]">
          <CalendarClock size={18} className="text-[#8d89a8]" aria-hidden />
          <strong className="text-white">J−{days}</strong>
        </span>
      )}
    </div>
  );
}
