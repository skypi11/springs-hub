'use client';

import { useState } from 'react';
import AedralLogo from '@/components/brand/AedralLogo';

// Crédit « Organisé par » réutilisable du module compétition. L'organisateur est
// l'entité PROPRIÉTAIRE de la compétition — Aedral n'est que l'hébergeur — donc
// on le met clairement en valeur (façon « presented by » d'un tournoi), pas en
// micro-eyebrow. Springs E-Sport bénéficie de l'accent VIOLET réservé au
// partenaire par la DA ; tout autre organisateur reste neutre (scalable). Logo
// avec fallback monogramme Bebas (même parti pris que TeamCrest : un hash
// R2/externe périmé ne laisse jamais un carré vide).

const SPRINGS_RE = /springs/i;

export default function OrganizerCredit({
  organizer,
  size = 'lg',
  showHost = false,
  className = '',
}: {
  organizer: { name: string; logoUrl?: string | null } | null;
  size?: 'lg' | 'sm';
  showHost?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!organizer?.name) return null;

  const isSprings = SPRINGS_RE.test(organizer.name);
  const box = size === 'lg' ? 40 : 34;
  const words = organizer.name.trim().split(/\s+/).filter(Boolean);
  const mono = (words.length >= 2
    ? words.slice(0, 2).map(w => w[0]).join('')
    : organizer.name.trim().slice(0, 2)
  ).toUpperCase();
  const monoFs = Math.max(13, Math.round(box * 0.38));

  // Accent Springs (violet réservé partenaire, DA) sinon neutre.
  const logoBg = isSprings ? 'rgba(123,47,190,0.10)' : 'var(--s-elevated)';
  const logoBorder = isSprings ? '1px solid rgba(123,47,190,0.32)' : '1px solid var(--s-border)';
  const labelColor = isSprings ? 'var(--s-violet-light)' : 'var(--s-text-muted)';
  const monoColor = isSprings ? 'var(--s-violet-light)' : 'var(--s-text-dim)';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Logo organisateur (fallback monogramme Bebas) */}
      <div className="bevel-sm flex items-center justify-center flex-shrink-0"
        style={{ width: box, height: box, background: logoBg, border: logoBorder, overflow: 'hidden' }}>
        {organizer.logoUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo R2/externe arbitraire hors remotePatterns
          <img src={organizer.logoUrl} alt="" width={box} height={box}
            style={{ width: box, height: box, objectFit: 'contain' }} onError={() => setBroken(true)} />
        ) : (
          <span className="font-display" style={{ fontSize: monoFs, color: monoColor, letterSpacing: '0.04em', lineHeight: 1 }}>{mono}</span>
        )}
      </div>

      {/* Crédit texte */}
      <div className="min-w-0">
        <p className="t-label" style={{ color: labelColor }}>Organisé par</p>
        <p className="font-semibold truncate" style={{ fontSize: size === 'lg' ? 15 : 14, color: 'var(--s-text)', lineHeight: 1.2 }}>
          {organizer.name}
        </p>
      </div>

      {/* Mention hôte discrète : Aedral = hébergeur */}
      {showHost && (
        <div className="ml-auto hidden sm:flex items-center gap-1.5 flex-shrink-0" style={{ opacity: 0.6 }}>
          <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>Hébergé sur</span>
          <AedralLogo variant="mark" theme="mono-light" height={16} />
        </div>
      )}
    </div>
  );
}
