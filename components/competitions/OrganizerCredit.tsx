'use client';

import { useState } from 'react';
import AedralLogo from '@/components/brand/AedralLogo';

// Crédit « Organisé par » réutilisable du module compétition. L'organisateur est
// la VEDETTE : c'est l'entité qui possède/organise la compétition, Aedral n'est
// que l'hébergeur. Deux niveaux :
//   - variant="teaser"  → masthead centré, wordmark XL + glow violet (hero du
//     circuit : Springs est mise en avant comme un « presented by » de tournoi).
//   - variant="inline"  → crédit gauche compact (cards de liste).
//
// IMPORTANT : le logo d'un organisateur est le plus souvent un WORDMARK LARGE
// (Springs E-Sport ~3.4:1), pas une icône carrée. On l'affiche à taille libre
// bornée par maxHeight/maxWidth (jamais dans une boîte carrée qui le rognerait,
// jamais déformé). Fallback : le nom en Bebas si pas de logo / image cassée.
//
// Springs E-Sport (partenaire de référence) : accent VIOLET réservé par la DA +
// logo par défaut câblé (pas de dépendance à une saisie admin). Tout autre
// organisateur reste neutre (scalable).

const SPRINGS_RE = /springs/i;
const SPRINGS_LOGO = '/springs-esport.png';

export default function OrganizerCredit({
  organizer,
  variant = 'inline',
  height = 52,
  showHost = false,
  className = '',
}: {
  organizer: { name: string; logoUrl?: string | null } | null;
  variant?: 'inline' | 'teaser';
  height?: number;
  showHost?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!organizer?.name) return null;

  const isSprings = SPRINGS_RE.test(organizer.name);
  const logoUrl = organizer.logoUrl || (isSprings ? SPRINGS_LOGO : null);
  const accent = isSprings ? 'var(--s-violet-light)' : 'var(--s-text-muted)';
  const showLogo = !!logoUrl && !broken;

  const logoNode = showLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- wordmark arbitraire hors remotePatterns
    <img
      src={logoUrl!}
      alt={organizer.name}
      style={{ height: 'auto', width: 'auto', maxHeight: height, maxWidth: '100%', objectFit: 'contain', display: 'block' }}
      onError={() => setBroken(true)}
    />
  ) : (
    <p className="font-display" style={{ fontSize: Math.round(height * 0.78), color: 'var(--s-text)', letterSpacing: '0.03em', lineHeight: 1 }}>
      {organizer.name.toUpperCase()}
    </p>
  );

  const hostCredit = showHost ? (
    <div className="flex items-center gap-1.5" style={{ opacity: 0.5 }}>
      <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Hébergé sur</span>
      <AedralLogo variant="horizontal" theme="mono-light" height={14} />
    </div>
  ) : null;

  // ── Teaser : masthead centré, la vedette ──
  if (variant === 'teaser') {
    return (
      <div className={`relative text-center ${className}`}>
        {isSprings && (
          <div aria-hidden className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{ width: 620, height: 240, transform: 'translate(-50%,-50%)', background: 'radial-gradient(ellipse at center, rgba(123,47,190,0.15), transparent 72%)' }} />
        )}
        <div className="relative flex flex-col items-center">
          <p className="t-label mb-3" style={{ color: accent, letterSpacing: '0.32em' }}>Organisé par</p>
          {logoNode}
          {showHost && <div className="mt-3.5">{hostCredit}</div>}
        </div>
      </div>
    );
  }

  // ── Inline : crédit gauche compact ──
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="min-w-0">
        <p className="t-label mb-2" style={{ color: accent }}>Organisé par</p>
        {logoNode}
      </div>
      {showHost && <div className="ml-auto hidden sm:flex flex-shrink-0">{hostCredit}</div>}
    </div>
  );
}
