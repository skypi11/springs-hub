'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ticket, CircleUser } from 'lucide-react';
import { apiPublic } from '@/lib/api-client';
import { MANIA_CUP } from '@/lib/mania-cup';

// Navigation propre à la Springs Mania Cup, collée en haut de toutes ses pages.
//
// Deux raisons d'exister :
//  1. Les liens vers le règlement et les inscrits traînaient en bas de page,
//     invisibles. Une navigation d'événement les remet là où on les cherche.
//  2. Un joueur déjà inscrit n'avait aucune porte d'entrée vers son dossier :
//     la page d'inscription EST son espace (code, pièces, accompagnant), mais
//     rien ne le disait. Le bouton de droite change donc d'intitulé une fois
//     l'inscription déposée.

const TABS = [
  { href: '/mania-cup', label: 'Présentation' },
  { href: '/mania-cup/reglement', label: 'Règlement' },
  { href: '/mania-cup/inscrits', label: 'Inscrits' },
];

type Ctx = { registration?: { registrationCode?: string } | null };

export default function ManiaCupNav() {
  const pathname = usePathname();

  // Partage la même clé que la page d'inscription : React Query déduplique,
  // la barre ne déclenche pas d'appel supplémentaire.
  const { data } = useQuery({
    queryKey: ['mania-cup', 'register'] as const,
    queryFn: () => apiPublic<Ctx>('/api/mania-cup/register'),
    staleTime: 30_000,
  });

  const registered = Boolean(data?.registration);
  const onSpace = pathname === '/mania-cup/inscription';

  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-[#07050b]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/mania-cup" className="hidden shrink-0 sm:block">
          <span className="font-display text-xl leading-none tracking-wide">
            Springs <span className="text-[#00D936]">Mania Cup</span>
          </span>
        </Link>

        <div className="-mx-2 flex min-w-0 flex-1 gap-1 overflow-x-auto px-2">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'border-[#00D936] text-white'
                    : 'border-transparent text-[#8d89a8] hover:text-white'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <Link
          href="/mania-cup/inscription"
          className={`inline-flex shrink-0 items-center gap-2 px-4 py-2 text-sm font-bold transition-transform hover:scale-[1.03] ${
            registered
              ? `border ${onSpace ? 'border-[#00D936] text-[#00D936]' : 'border-white/20 text-white'}`
              : 'bg-[#00D936] text-[#07050b]'
          }`}
        >
          {registered ? (
            <>
              <CircleUser size={16} aria-hidden />
              <span className="hidden sm:inline">Mon inscription</span>
              <span className="sm:hidden">Mon dossier</span>
            </>
          ) : (
            <>
              <Ticket size={16} aria-hidden />
              S’inscrire<span className="hidden sm:inline"> — {MANIA_CUP.priceEuros} €</span>
            </>
          )}
        </Link>
      </div>
    </nav>
  );
}
