// Logo AEDRAL — composant React qui rend le mark + wordmark inline en SVG.
//
// Le mark est un Æ ligature custom (A en aplats de couleur + E intégré en or
// avec barre top, middle, bottom et stem vertical). Wordmark en Bebas Neue
// (police chargée via next/font dans app/layout.tsx, accessible via la classe
// .font-display ou la variable --font-bebas).
//
// 4 thèmes pour couvrir tous les contextes d'usage :
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
  dark:         { a: '#EAEAF0', e: '#FFB800', dral: '#EAEAF0', divider: 'rgba(234,234,240,0.18)' },
  light:        { a: '#08080F', e: '#C8941D', dral: '#08080F', divider: 'rgba(8,8,15,0.18)' },
  'mono-dark':  { a: '#08080F', e: '#08080F', dral: '#08080F', divider: 'rgba(8,8,15,0.4)' },
  'mono-light': { a: '#EAEAF0', e: '#EAEAF0', dral: '#EAEAF0', divider: 'rgba(234,234,240,0.4)' },
} as const;

function MarkPaths({ aColor, eColor }: { aColor: string; eColor: string }) {
  return (
    <>
      {/* A — jambe gauche (apex légèrement tronqué à 4px pour cohérence typographique) */}
      <path d="M 98 10 L 30 190 L 16 190 Z" fill={aColor} />
      {/* A — jambe droite */}
      <path d="M 102 10 L 184 190 L 170 190 Z" fill={aColor} />
      {/* E — stem vertical (60px tall, démarre au top du E) */}
      <rect x="76" y="120" width="10" height="60" fill={eColor} />
      {/* E — top bar (48px, proportions classiques typographiques) */}
      <rect x="76" y="120" width="48" height="8" fill={eColor} />
      {/* E — middle bar (36px, ~75% du top/bottom comme un E classique) */}
      <rect x="86" y="147" width="36" height="6" fill={eColor} />
      {/* E — bottom bar */}
      <rect x="76" y="172" width="48" height="8" fill={eColor} />
    </>
  );
}

export default function AedralLogo({
  variant = 'horizontal',
  theme = 'dark',
  height = 36,
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

  // Horizontal lockup : mark + divider + wordmark
  const fontSize = Math.round(height * 0.7);
  const dividerHeight = Math.round(height * 0.6);
  const gap = Math.round(height * 0.35);

  return (
    <div
      className={`inline-flex items-center ${className}`}
      style={{ height, gap }}
      role="img"
      aria-label="Aedral"
    >
      <svg viewBox="0 0 200 200" height={height} width={height} aria-hidden="true">
        <MarkPaths aColor={c.a} eColor={c.e} />
      </svg>
      <div
        aria-hidden="true"
        style={{
          width: 1.5,
          height: dividerHeight,
          background: c.divider,
          flexShrink: 0,
        }}
      />
      <span
        className="font-display"
        style={{
          fontSize,
          letterSpacing: '0.18em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: c.e }}>AE</span>
        <span style={{ color: c.dral }}>DRAL</span>
      </span>
    </div>
  );
}
