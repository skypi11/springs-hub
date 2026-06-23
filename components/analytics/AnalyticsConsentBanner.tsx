'use client';

// Mini-bandeau "vie privée" affiché au premier visit pour expliquer qu'on
// utilise PostHog et offrir un opt-out immédiat. Volontairement DISCRET
// (pas un modal bloquant) — la page reste utilisable derrière.
//
// Design (Matt 2026-05-31, niveau 3 transparence) :
//   - Posé en bas à droite, sticky, n'empiète pas sur le contenu principal
//   - Disparaît après "OK" ou "Désactiver", choix persisté en localStorage
//   - Disparaît aussi après auto-dismiss 12s (le user peut "ignorer", le
//     tracking continue par défaut, conforme à la stratégie trust-by-default)
//   - DA Aedral : panel + bevel + accent or, fontSize >= 12px
//
// Logique d'affichage :
//   - Visible UNIQUEMENT si getConsent() === null (jamais choisi)
//   - Une fois choix fait, ne réapparaît pas (sauf si user vide son localStorage)
//   - Le toggle Settings → Confidentialité permet de re-changer le choix
//     à tout moment.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, Check, X } from 'lucide-react';
import { getConsent, optIn, optOut } from '@/lib/analytics';

const AUTO_DISMISS_MS = 12_000;

export function AnalyticsConsentBanner() {
  // Démarre à false pour éviter le flash côté SSR/hydration. On bascule à
  // true uniquement dans le useEffect (= client only, après hydration).
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  function close() {
    setClosing(true);
    setTimeout(() => setVisible(false), 200);
  }

  useEffect(() => {
    // Attend que le SSR/hydration soit fini avant d'évaluer le localStorage.
    if (getConsent() === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount guard volontaire : getConsent() lit localStorage (indispo en SSR), on l'évalue une seule fois après hydration pour éviter un flash
      setVisible(true);
      // Auto-dismiss après N secondes si l'user ne clique rien.
      // Pas d'opt-in/opt-out implicite : le tracking continue (trust-by-default),
      // le bandeau s'efface juste pour ne pas polluer l'écran indéfiniment.
      const t = setTimeout(() => close(), AUTO_DISMISS_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  function handleAccept() {
    optIn();
    close();
  }

  function handleOptOut() {
    optOut();
    close();
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Préférences analytics"
      className="fixed z-40 max-w-md w-[calc(100vw-32px)] sm:w-auto sm:max-w-lg"
      style={{
        bottom: 16,
        right: 16,
        left: 'auto',
        transition: 'opacity 200ms ease, transform 200ms ease',
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateY(8px)' : 'translateY(0)',
      }}
    >
      <div
        className="panel bevel p-4 sm:p-5 space-y-3"
        style={{
          background: 'var(--s-surface)',
          border: '1px solid var(--s-border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        {/* Accent or en haut, cohérent avec les cards Aedral */}
        <div
          className="h-[2px] -mt-4 sm:-mt-5 -mx-4 sm:-mx-5 mb-3"
          style={{
            background: 'linear-gradient(90deg, var(--s-gold), var(--s-gold)55, transparent 70%)',
            opacity: 0.5,
          }}
        />

        <div className="flex items-start gap-3">
          <div
            className="w-8 h-8 flex items-center justify-center bevel-sm flex-shrink-0"
            style={{
              background: 'rgba(255,184,0,0.08)',
              border: '1px solid rgba(255,184,0,0.25)',
            }}
          >
            <Shield size={14} style={{ color: 'var(--s-gold)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="t-sub mb-1" style={{ color: 'var(--s-text)' }}>
              Vie privée
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--s-text-dim)' }}>
              On utilise <strong style={{ color: 'var(--s-text)' }}>PostHog</strong> pour
              mesurer l&apos;usage et améliorer Aedral. Pas de pub, pas de cookies, hébergé en
              Europe.{' '}
              <Link
                href="/legal/confidentialite"
                className="hover:underline"
                style={{ color: 'var(--s-gold)' }}
              >
                En savoir plus
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fermer (continuer avec les paramètres actuels)"
            className="flex-shrink-0 p-1 hover:opacity-100 opacity-60 transition-opacity"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--s-text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleAccept}
            className="btn-springs btn-primary bevel-sm inline-flex items-center gap-1.5 flex-1 sm:flex-initial justify-center"
            style={{ fontSize: '12px', padding: '7px 14px' }}
          >
            <Check size={13} /> OK
          </button>
          <button
            type="button"
            onClick={handleOptOut}
            className="btn-springs btn-secondary bevel-sm inline-flex items-center gap-1.5 flex-1 sm:flex-initial justify-center"
            style={{ fontSize: '12px', padding: '7px 14px' }}
          >
            Désactiver
          </button>
        </div>
      </div>
    </div>
  );
}
