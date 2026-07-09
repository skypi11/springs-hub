'use client';

import { useState } from 'react';

// Ancre d'identité réutilisable de tout le module compétition : rend le logo
// d'une entité (équipe / structure) et tombe sur un monogramme Bebas si l'URL
// est absente OU 404 (hash R2/Discord périmé — bug connu). Tue d'un coup les
// carrés gris vides. <img> natif (pas next/image : logos R2/externes arbitraires
// hors remotePatterns). Extrait du TeamLogo local du panel « Le Dossier ».
export default function TeamCrest({
  url, tag, name, size = 40,
}: {
  url?: string | null;
  tag?: string | null;
  name?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const mono = ((tag || name || '?').slice(0, 3)).toUpperCase();
  const fontSize = Math.max(12, Math.round(size * 0.4));
  return (
    <div className="bevel-sm flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, background: 'var(--s-elevated)', overflow: 'hidden' }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} onError={() => setBroken(true)} />
      ) : (
        <span className="font-display" style={{ fontSize, color: 'var(--s-text-dim)', letterSpacing: '0.04em', lineHeight: 1 }}>{mono}</span>
      )}
    </div>
  );
}
