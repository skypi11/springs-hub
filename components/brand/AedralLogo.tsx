// Logo AEDRAL — composant React qui rend le logo dans le site.
//
// SVG inline avec coordonnées EXACTEMENT identiques au fichier
// public/aedral/logo-horizontal.svg (single source of truth visuelle).
//
// Pour la fonte Bebas Neue dans le wordmark : on utilise la classe
// .font-display (définie dans globals.css) qui résout vers la CSS
// variable --font-bebas chargée par next/font dans app/layout.tsx.
//
// 4 thèmes :
//  - dark      : A blanc cassé, E or  (sur fond sombre, défaut site)
//  - light     : A noir, E or-deep    (sur fond clair, documents print)
//  - mono-dark : tout noir            (impression N&B, gravure)
//  - mono-light: tout blanc           (sur photos, vidéo, watermark)

interface AedralLogoProps {
  variant?: 'horizontal' | 'mark';
  theme?: 'dark' | 'light' | 'mono-dark' | 'mono-light';
  height?: number;
  className?: string;
}

const THEMES = {
  dark:         { a: '#EAEAF0', e: '#FFB800', dral: '#EAEAF0', divider: '#EAEAF0', dividerOpacity: 0.18 },
  light:        { a: '#08080F', e: '#C8941D', dral: '#08080F', divider: '#08080F', dividerOpacity: 0.18 },
  'mono-dark':  { a: '#08080F', e: '#08080F', dral: '#08080F', divider: '#08080F', dividerOpacity: 0.4 },
  'mono-light': { a: '#EAEAF0', e: '#EAEAF0', dral: '#EAEAF0', divider: '#EAEAF0', dividerOpacity: 0.4 },
} as const;

function MarkPaths({ aColor, eColor }: { aColor: string; eColor: string }) {
  return (
    <>
      <path d="M 98 10 L 30 190 L 16 190 Z" fill={aColor} />
      <path d="M 102 10 L 184 190 L 170 190 Z" fill={aColor} />
      <rect x="76" y="120" width="10" height="60" fill={eColor} />
      <rect x="76" y="120" width="48" height="8" fill={eColor} />
      <rect x="86" y="147" width="36" height="6" fill={eColor} />
      <rect x="76" y="172" width="48" height="8" fill={eColor} />
    </>
  );
}

export default function AedralLogo({
  variant = 'horizontal',
  theme = 'dark',
  height = 44,
  className = '',
}: AedralLogoProps) {
  const c = THEMES[theme];

  if (variant === 'mark') {
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
        <MarkPaths aColor={c.a} eColor={c.e} />
      </svg>
    );
  }

  // Lockup horizontal — coordonnées identiques au SVG standalone
  // public/aedral/logo-horizontal.svg pour cohérence parfaite.
  return (
    <svg
      viewBox="0 0 820 200"
      height={height}
      role="img"
      aria-label="Aedral"
      className={className}
      style={{ display: 'block' }}
    >
      <title>Aedral</title>
      <MarkPaths aColor={c.a} eColor={c.e} />
      <line
        x1="235"
        y1="50"
        x2="235"
        y2="150"
        stroke={c.divider}
        strokeOpacity={c.dividerOpacity}
        strokeWidth="3"
      />
      <text
        x="270"
        y="100"
        className="font-display"
        fontWeight="400"
        fontSize="110"
        letterSpacing="18"
        dominantBaseline="central"
      >
        <tspan fill={c.e}>AE</tspan>
        <tspan fill={c.dral}>DRAL</tspan>
      </text>
    </svg>
  );
}
