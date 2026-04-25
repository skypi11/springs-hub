// Logo AEDRAL — composant React qui rend le logo dans le site.
//
// Pour le lockup HORIZONTAL : on utilise directement les SVG standalones
// dans public/aedral/ (logo-horizontal.svg / logo-horizontal-light.svg).
// Single source of truth — si le SVG s'affiche bien en standalone (dans
// le browser, sur Discord, en print), il s'affichera bien partout.
//
// Pour le mark seul : SVG inline avec props de thème (4 variantes), pour
// usages où on a besoin de varier la couleur dynamiquement (mono noir,
// mono blanc, etc. — non utilisés dans la sidebar mais dispos pour
// d'autres contextes).

import Image from 'next/image';

interface AedralLogoProps {
  variant?: 'horizontal' | 'mark';
  theme?: 'dark' | 'light' | 'mono-dark' | 'mono-light';
  height?: number;
  className?: string;
}

const MARK_THEMES = {
  dark:         { a: '#EAEAF0', e: '#FFB800' },
  light:        { a: '#08080F', e: '#C8941D' },
  'mono-dark':  { a: '#08080F', e: '#08080F' },
  'mono-light': { a: '#EAEAF0', e: '#EAEAF0' },
} as const;

// Aspect ratio du lockup horizontal (viewBox 820:200)
const HORIZONTAL_ASPECT = 820 / 200;

export default function AedralLogo({
  variant = 'horizontal',
  theme = 'dark',
  height = 44,
  className = '',
}: AedralLogoProps) {
  if (variant === 'mark') {
    const c = MARK_THEMES[theme];
    return (
      <svg
        viewBox="0 0 200 200"
        height={height}
        width={height}
        role="img"
        aria-label="Aedral"
        className={className}
      >
        <title>Aedral</title>
        {/* A — jambe gauche */}
        <path d="M 98 10 L 30 190 L 16 190 Z" fill={c.a} />
        {/* A — jambe droite */}
        <path d="M 102 10 L 184 190 L 170 190 Z" fill={c.a} />
        {/* E — stem vertical */}
        <rect x="76" y="120" width="10" height="60" fill={c.e} />
        {/* E — top bar */}
        <rect x="76" y="120" width="48" height="8" fill={c.e} />
        {/* E — middle bar */}
        <rect x="86" y="147" width="36" height="6" fill={c.e} />
        {/* E — bottom bar */}
        <rect x="76" y="172" width="48" height="8" fill={c.e} />
      </svg>
    );
  }

  // Horizontal lockup — utilise le SVG standalone comme source de vérité
  const src = theme === 'light' || theme === 'mono-dark'
    ? '/aedral/logo-horizontal-light.svg'
    : '/aedral/logo-horizontal.svg';
  const width = Math.round(height * HORIZONTAL_ASPECT);

  return (
    <Image
      src={src}
      alt="Aedral"
      width={width}
      height={height}
      priority
      unoptimized
      className={className}
    />
  );
}
