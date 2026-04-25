// Logo AEDRAL — composant React qui rend le mark + wordmark inline en SVG.
//
// Le mark est un Æ ligature custom (A en aplats de couleur + E intégré en or
// avec barre top, middle, bottom et stem vertical). Wordmark en Bebas Neue.
//
// Architecture : tout dans UN seul SVG (mark + divider + wordmark) pour un
// alignement vertical mathématiquement parfait. Le wordmark utilise <text>
// avec dominantBaseline="central" → centrage pixel-perfect, pas de
// décalage typographique cap-height.
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
      {/* A — jambe gauche (apex tronqué 4px pour cohérence typographique) */}
      <path d="M 98 10 L 30 190 L 16 190 Z" fill={aColor} />
      {/* A — jambe droite */}
      <path d="M 102 10 L 184 190 L 170 190 Z" fill={aColor} />
      {/* E — stem vertical */}
      <rect x="76" y="120" width="10" height="60" fill={eColor} />
      {/* E — top bar */}
      <rect x="76" y="120" width="48" height="8" fill={eColor} />
      {/* E — middle bar (~75% de top/bottom) */}
      <rect x="86" y="147" width="36" height="6" fill={eColor} />
      {/* E — bottom bar */}
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

  // Horizontal lockup — TOUT en un SVG pour alignement parfait
  // ViewBox : 820w × 200h (ratio 4.1:1)
  //  - Mark : 0..200 horizontal × 0..200 vertical (le mark original 200×200 inchangé)
  //  - Divider : x=235, y=50..150 (50% de la hauteur, centré)
  //  - Wordmark : x=270, y=100 (centré vertical via dominantBaseline)
  // Le wordmark "AEDRAL" en Bebas Neue à fontSize 110 + letter-spacing 18
  // mesure ~490 viewBox units → fin à x≈760, marge droite ~60 unités
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
      {/* Mark à gauche dans son viewBox 0..200 natif */}
      <MarkPaths aColor={c.a} eColor={c.e} />
      {/* Divider vertical centré, 50% de la hauteur */}
      <line
        x1="235"
        y1="50"
        x2="235"
        y2="150"
        stroke={c.divider}
        strokeOpacity={c.dividerOpacity}
        strokeWidth="3"
      />
      {/* Wordmark en Bebas Neue, centrage vertical pixel-perfect via dominantBaseline */}
      <text
        x="270"
        y="100"
        className="font-display"
        fontFamily='"Bebas Neue", sans-serif'
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
