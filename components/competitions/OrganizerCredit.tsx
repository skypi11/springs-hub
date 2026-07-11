'use client';

import { useState } from 'react';
import AedralLogo from '@/components/brand/AedralLogo';

// Crédit « Organisé par » réutilisable du module compétition. L'organisateur est
// l'entité PROPRIÉTAIRE de la compétition — Aedral n'est que l'hébergeur — donc
// on le met franchement en avant (façon « presented by » d'un tournoi), pas en
// micro-eyebrow.
//
// IMPORTANT : le logo d'un organisateur est le plus souvent un WORDMARK LARGE
// (le logo Springs E-Sport fait ~3.4:1), pas une icône carrée. On l'affiche donc
// à hauteur fixe / largeur auto (jamais dans une boîte carrée qui le rognerait).
// Fallback : le nom en Bebas si pas de logo / image cassée.
//
// Springs E-Sport (partenaire de référence) : accent VIOLET réservé par la DA +
// logo par défaut câblé, pour ne pas dépendre d'une saisie admin. Tout autre
// organisateur reste neutre (scalable).

const SPRINGS_RE = /springs/i;
const SPRINGS_LOGO = '/springs-esport.png';

export default function OrganizerCredit({
  organizer,
  height = 52,
  showHost = false,
  className = '',
}: {
  organizer: { name: string; logoUrl?: string | null } | null;
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

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="min-w-0">
        <p className="t-label mb-2" style={{ color: accent }}>Organisé par</p>
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- wordmark large arbitraire hors remotePatterns
          <img
            src={logoUrl!}
            alt={organizer.name}
            style={{ height, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
            onError={() => setBroken(true)}
          />
        ) : (
          <p className="font-display" style={{ fontSize: Math.round(height * 0.72), color: 'var(--s-text)', letterSpacing: '0.02em', lineHeight: 1 }}>
            {organizer.name.toUpperCase()}
          </p>
        )}
      </div>

      {/* Mention hôte discrète : Aedral = hébergeur */}
      {showHost && (
        <div className="ml-auto hidden sm:flex items-center gap-2 flex-shrink-0" style={{ opacity: 0.7 }}>
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Hébergé sur</span>
          <AedralLogo variant="horizontal" theme="mono-light" height={18} />
        </div>
      )}
    </div>
  );
}
