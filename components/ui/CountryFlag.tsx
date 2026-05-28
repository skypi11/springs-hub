'use client';

import Image from 'next/image';
import { Globe } from 'lucide-react';

// Drapeau pays via flagcdn.com, vraie image PNG, rend identiquement sur
// Windows / macOS / Linux / Android (les emojis drapeaux ne sont pas
// supportés par Segoe UI Emoji sur Windows = affichage "FR" textuel moche).
//
// Tailles standard supportées par flagcdn :
// 16x12, 20x15, 24x18, 28x21, 32x24, 36x27, 40x30, 48x36, 56x42, 60x45, 64x48, 72x54, 84x63, 96x72, 108x81, 120x90, 144x108, 160x120, 192x144, 224x168, 256x192
//
// `code` : ISO 2 lettres ('FR', 'BE', 'OTHER'…). Si 'OTHER' ou invalide,
// affiche une icône globe générique.
export default function CountryFlag({
  code,
  size = 16,
  title,
  className,
}: {
  code: string | undefined | null;
  size?: 16 | 20 | 24 | 28 | 32;
  title?: string;
  className?: string;
}) {
  const upper = (code ?? '').toUpperCase();
  if (!upper || upper === 'OTHER') {
    return (
      <Globe
        size={size}
        className={className}
        style={{ color: 'var(--s-text-muted)' }}
        aria-label={title ?? 'Pays non spécifié'}
      />
    );
  }
  // flagcdn utilise les codes en minuscules.
  const slug = upper.toLowerCase();
  const height = Math.round(size * 0.75);
  return (
    <Image
      src={`https://flagcdn.com/${size}x${height}/${slug}.png`}
      alt={title ?? upper}
      title={title ?? upper}
      width={size}
      height={height}
      unoptimized
      className={className}
      style={{ flexShrink: 0, display: 'inline-block' }}
    />
  );
}
