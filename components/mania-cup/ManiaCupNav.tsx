'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ticket, CircleUser, Globe, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
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
  { href: '/mania-cup/covoiturage', label: 'Covoiturage' },
  // Une vraie page, pas une ancre : l'ancre ne défilait pas quand on était déjà
  // sur la présentation (clic sans effet), et surtout un spectateur n'a pas le
  // même besoin qu'un joueur — il veut savoir ce qu'il va voir et combien ça
  // coûte, pas remplir un dossier.
  { href: '/mania-cup/spectateurs', label: 'Spectateurs' },
];

type Ctx = { registration?: { registrationCode?: string } | null };

export default function ManiaCupNav() {
  const pathname = usePathname();
  const [menuOuvert, setMenuOuvert] = useState(false);

  // Changer de page ferme le menu : sans ça il reste ouvert par-dessus la page
  // d'arrivée, et il faut appuyer une seconde fois pour voir où l'on a atterri.
  //
  // Réinitialisé PENDANT LE RENDU, pas dans un effet. Un effet qui appelle
  // setState déclenche un second rendu en cascade, et le compilateur React le
  // refuse — le faire taire par un `eslint-disable` sortirait tout ce composant
  // du compilateur, en silence (voir la mémoire du projet sur le sujet). Ce
  // motif est celui que recommande React pour remettre un état à zéro quand
  // une valeur d'entrée change.
  const [cheminPrecedent, setCheminPrecedent] = useState(pathname);
  if (cheminPrecedent !== pathname) {
    setCheminPrecedent(pathname);
    setMenuOuvert(false);
  }

  // ATTENDRE que l'authentification soit résolue avant d'interroger l'API.
  //
  // Sans ce garde-fou, la barre partait en course avec Firebase : si le jeton
  // n'était pas encore prêt, la route répondait « non authentifié », donc
  // « aucune inscription », et le bouton affichait « S'inscrire » à quelqu'un
  // qui l'était déjà. Aléatoire par nature — ça dépendait de qui gagnait la
  // course — donc invisible la moitié du temps.
  //
  // L'uid entre dans la clé : deux comptes sur le même navigateur ne doivent
  // pas se partager une réponse en cache. (Un commentaire affirmait ici que la
  // page d'inscription partageait cette requête via React Query — elle ne
  // l'utilise pas : elle appelle l'API à la main dans un effet.)
  const { firebaseUser, loading: authLoading } = useAuth();

  const { data } = useQuery({
    queryKey: ['mania-cup', 'register', firebaseUser?.uid ?? 'anon'] as const,
    queryFn: () => apiPublic<Ctx>('/api/mania-cup/register'),
    enabled: !authLoading,
    staleTime: 30_000,
  });

  const registered = Boolean(data?.registration);
  /** Le nom de la page où l'on se trouve — c'est lui que porte le bouton. */
  const ongletCourant =
    TABS.find((t) => t.href === pathname)?.label ?? 'Springs Mania Cup';
  const onSpace = pathname === '/mania-cup/inscription';

  // Sur la page anglaise, le bouton d'action passe en anglais — c'est le CTA
  // principal, le laisser en français sur une page anglaise donne l'impression
  // d'une traduction abandonnée en route. Les ONGLETS, eux, restent en
  // français : ils mènent à des pages françaises, et les renommer promettrait
  // un contenu traduit qui n'existe pas.
  const en = pathname === '/mania-cup/en';

  return (
    // SUR MOBILE la barre est FIXE, pas collante, et c'est une correction.
    //
    // La coquille du site réserve 56 px en haut pour le bouton de menu, mais
    // ce n'est qu'une marge intérieure : le contenu DÉFILE par-dessous, et la
    // barre collante se calait sous cette bande. Résultat, un carré sombre
    // flottait au-dessus des titres — « SAMEDI 3 OCTOBRE » s'affichait
    // « AMEDI 3 OCTOBRE » — et une bande de texte défilait au-dessus de la
    // navigation, sans rien pour l'arrêter.
    //
    // Fixée en haut de l'écran, elle masque cette bande. Sa marge à gauche
    // dégage le bouton de menu, qui reste au-dessus d'elle (z 60 contre 30).
    <nav className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-[#07050b]/95 backdrop-blur-md lg:sticky">
      <div className="mx-auto flex max-w-6xl items-center gap-3 py-2.5 pr-3 pl-16 sm:gap-6 lg:py-3 lg:pr-6 lg:pl-6">
        <Link href="/mania-cup" className="hidden shrink-0 sm:block">
          <span className="font-display text-xl leading-none tracking-wide">
            Springs <span className="text-[#00D936]">Mania Cup</span>
          </span>
        </Link>

        {/* SUR MOBILE : un menu, pas une piste qui défile.
            Cinq onglets dans 130 px laissaient « Spectateurs » hors de l'écran,
            et un défilement latéral ne se devine pas — il faut d'abord soupçonner
            qu'il y a une suite pour aller la chercher. Le bouton porte le nom de
            la page courante : on sait où on est, et tout le reste tient en un
            appui. */}
        <div className="relative min-w-0 flex-1 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOuvert((o) => !o)}
            aria-expanded={menuOuvert}
            className="flex w-full items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="truncate font-semibold text-white">{ongletCourant}</span>
            <ChevronDown
              size={15}
              className={`shrink-0 transition-transform ${menuOuvert ? 'rotate-180' : ''}`}
              style={{ color: 'var(--s-text-dim)' }}
              aria-hidden
            />
          </button>

          {menuOuvert && (
            <>
              {/* Le voile ferme le menu et empêche d'appuyer à travers. */}
              <button
                type="button"
                aria-label="Fermer le menu"
                onClick={() => setMenuOuvert(false)}
                className="fixed inset-0 top-[52px] z-10 cursor-default bg-black/50"
              />
              <div className="absolute top-full left-0 z-20 mt-2 w-56 border border-white/15 bg-[#0d0a14] shadow-2xl">
                {TABS.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    onClick={() => setMenuOuvert(false)}
                    className={`block border-l-2 px-4 py-3 text-sm transition-colors ${
                      pathname === t.href
                        ? 'border-[#00D936] bg-white/[0.04] text-white'
                        : 'border-transparent text-[#c9c5d8] hover:bg-white/[0.04]'
                    }`}
                  >
                    {t.label}
                  </Link>
                ))}
                {/* La bascule de langue vivait dans une case masquée sous 640 px :
                    elle n'existait donc pas pour les joueurs européens visés par
                    l'annonce internationale, c'est-à-dire ceux à qui elle sert. */}
                <Link
                  href={en ? '/mania-cup' : '/mania-cup/en'}
                  hrefLang={en ? 'fr' : 'en'}
                  onClick={() => setMenuOuvert(false)}
                  className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-sm text-[#8d89a8]"
                >
                  <Globe size={14} aria-hidden />
                  {en ? 'Voir en français' : 'Read in English'}
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="mc-onglets -mx-2 hidden min-w-0 flex-1 gap-1 overflow-x-auto px-2 lg:flex">
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
          className={`inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-bold transition-transform hover:scale-[1.03] sm:gap-2 sm:px-4 ${
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
      <style jsx global>{`
        .mc-onglets {
          scrollbar-width: none;
          -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 28px), transparent 100%);
                  mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 28px), transparent 100%);
        }
        .mc-onglets::-webkit-scrollbar { display: none; }
        @media (min-width: 1024px) {
          .mc-onglets { -webkit-mask-image: none; mask-image: none; }
        }
      `}</style>
    </nav>
  );
}
