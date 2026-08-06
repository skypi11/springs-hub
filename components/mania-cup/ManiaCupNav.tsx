'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ticket, CircleUser, Globe } from 'lucide-react';
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
  { href: '/mania-cup/faq', label: 'FAQ' },
  { href: '/mania-cup/inscrits', label: 'Inscrits' },
  // Une vraie page, pas une ancre : l'ancre ne défilait pas quand on était déjà
  // sur la présentation (clic sans effet), et surtout un spectateur n'a pas le
  // même besoin qu'un joueur — il veut savoir ce qu'il va voir et combien ça
  // coûte, pas remplir un dossier.
  { href: '/mania-cup/spectateurs', label: 'Spectateurs' },
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

  // Sur la page anglaise, le bouton d'action passe en anglais — c'est le CTA
  // principal, le laisser en français sur une page anglaise donne l'impression
  // d'une traduction abandonnée en route. Les ONGLETS, eux, restent en
  // français : ils mènent à des pages françaises, et les renommer promettrait
  // un contenu traduit qui n'existe pas.
  const en = pathname === '/mania-cup/en';

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

        {/* Le site est en français ; seule la présentation existe en anglais,
            pour les joueurs européens visés par l'annonce internationale. Le
            lien bascule d'une version à l'autre plutôt que d'afficher un
            sélecteur de langue, qui promettrait un site bilingue. */}
        <Link
          href={pathname === '/mania-cup/en' ? '/mania-cup' : '/mania-cup/en'}
          className="hidden shrink-0 items-center gap-1.5 px-2 py-2 text-sm text-[#8d89a8] transition-colors hover:text-white sm:inline-flex"
          hrefLang={pathname === '/mania-cup/en' ? 'fr' : 'en'}
        >
          <Globe size={15} aria-hidden />
          {pathname === '/mania-cup/en' ? 'FR' : 'EN'}
        </Link>

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
              <span className="hidden sm:inline">{en ? 'My registration' : 'Mon inscription'}</span>
              <span className="sm:hidden">{en ? 'My entry' : 'Mon dossier'}</span>
            </>
          ) : (
            <>
              <Ticket size={16} aria-hidden />
              {en ? 'Register' : 'S’inscrire'}
              <span className="hidden sm:inline">
                {en ? ` — €${MANIA_CUP.priceEuros}` : ` — ${MANIA_CUP.priceEuros} €`}
              </span>
            </>
          )}
        </Link>
      </div>
    </nav>
  );
}
