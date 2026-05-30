'use client';

// PostHog provider client-side, monté dans app/layout.tsx.
// Init unique au premier render, identify/reset hookés sur AuthContext,
// pageview manuel sur chaque navigation App Router.
//
// Privacy / RGPD (Matt 2026-05-30) :
//   - person_profiles: 'identified_only' → AUCUN profil créé pour les visiteurs
//     anonymes, on n'a une "person" en base PostHog que pour les users loggés.
//     Réduit drastiquement la quantité de PII stockée + reste dans le free tier.
//   - persistence: 'memory' → PAS de cookie ni localStorage. Pas de bandeau
//     RGPD nécessaire, mais la session est perdue à chaque reload de l'onglet.
//     Pour Aedral c'est OK car l'identité user vient déjà de Firebase Auth
//     (cookie httpOnly), donc PostHog identify() rattrape l'identité au login.
//   - api_host EU Cloud (https://eu.i.posthog.com) → data hébergée à Frankfurt,
//     compatible RGPD France strict.
//   - capture_pageview: false → on capture manuellement sur chaque navigation
//     (App Router ne déclenche pas le pageview auto).

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useAuth } from '@/context/AuthContext';
import { identify, reset, capturePageview, hasOptedOut } from '@/lib/analytics';
import { AnalyticsConsentBanner } from './AnalyticsConsentBanner';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let initialized = false;

function initPostHog() {
  if (initialized) return;
  if (typeof window === 'undefined') return;
  if (!POSTHOG_KEY) {
    // Dev sans clé : on log juste pour rappeler, pas d'erreur bloquante.
    // En prod sans clé, on no-op silencieusement (lib/analytics gère les
    // calls suivants).
    if (process.env.NODE_ENV === 'development') {
      console.info('[PostHog] NEXT_PUBLIC_POSTHOG_KEY missing, analytics disabled');
    }
    return;
  }
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Aucun profil pour les visiteurs anonymes → reste dans le free tier
    // + minimise la PII stockée. Profil créé uniquement à identify() (login).
    person_profiles: 'identified_only',
    // Pas de cookie côté PostHog (le seul localStorage qu'on touche est
    // notre `aedral_analytics_consent` pour persister le choix RGPD).
    // L'identité user vient de Firebase Auth, PostHog re-identify à chaque login.
    persistence: 'memory',
    // On capture les pageviews manuellement depuis le provider (App Router).
    capture_pageview: false,
    // Pageleave est utile (durée session), on garde l'auto.
    capture_pageleave: true,
    // RGPD : anonymise les IPs côté serveur PostHog
    ip: false,
    loaded: (ph) => {
      // Respect du consent stocké en localStorage : si l'user a opt-out
      // précédemment (Settings ou bandeau), on désactive le capture AVANT
      // que le premier pageview/event ne parte. Important : faire ça dans
      // `loaded` garantit que posthog est prêt.
      if (hasOptedOut()) {
        ph.opt_out_capturing();
      }
      if (process.env.NODE_ENV === 'development') {
        ph.debug(false); // mettre true si tu veux voir tous les calls en console
      }
    },
  });
  initialized = true;
}

/**
 * Provider PostHog. Doit être DANS l'AuthProvider pour pouvoir lire le user
 * via useAuth() et faire identify/reset.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, user, isAdmin, loading } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Init au premier mount, une seule fois.
  useEffect(() => {
    initPostHog();
  }, []);

  // Identify / reset sur changement d'auth.
  // user (= Firestore enrichi) peut arriver après firebaseUser (async).
  // On identify dès qu'on a firebaseUser pour ne pas perdre les premiers events,
  // puis on re-identify avec les traits enrichis quand user.displayName arrive.
  useEffect(() => {
    if (loading) return;
    if (firebaseUser) {
      identify(firebaseUser.uid, {
        displayName: user?.displayName ?? firebaseUser.displayName ?? undefined,
        isAdmin: !!isAdmin,
        // games[] est utile pour segmenter "users RL vs Val vs TM"
        games: user?.games?.join(',') ?? undefined,
        // hasStructure : segmente activés vs non-activés (le critère onboarding)
        hasStructure: user?.structurePerGame
          ? Object.keys(user.structurePerGame).length > 0
          : false,
      });
    } else {
      reset();
    }
  }, [firebaseUser, user, isAdmin, loading]);

  // Pageview manuel sur chaque navigation App Router.
  // Le path + searchParams change déclenche un nouveau pageview avec la
  // bonne URL (sinon PostHog ne voit que le 1er chargement).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
    capturePageview(`${window.location.origin}${url}`);
  }, [pathname, searchParams]);

  return (
    <>
      {children}
      <AnalyticsConsentBanner />
    </>
  );
}
