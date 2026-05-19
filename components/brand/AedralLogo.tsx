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
      <path
        d="M80.5 89L119.5 89L119.5 102L94.8 102L94.8 126.05L114.43 126.05L114.43 139.05L94.8 139.05L94.8 167L119.5 167L119.5 180L80.5 180Z"
        fill={eColor}
      />
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

  // Lockup horizontal — coordonnées IDENTIQUES au SVG standalone
  // public/aedral/logo-horizontal.svg, y compris le wordmark "AEDRAL"
  // qui utilise les paths Bebas Neue générés par scripts/bebas-to-svg-paths.mjs.
  // Pourquoi pas <text> ? Parce que la position visuelle d'un <text> dépend
  // du LSB de la font et peut différer de la version path (~14 px ici).
  // Les paths assurent un rendu pixel-perfect identique site / standalone / WebP.
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
      {/* Divider : rect rempli (pas <line>) pour éviter les artefacts
          d'antialiasing de stroke à petite taille de rendu. */}
      <rect
        x="208.5"
        y="50"
        width="3"
        height="100"
        fill={c.divider}
        fillOpacity={c.dividerOpacity}
      />
      {/* Wordmark "AE" — paths Bebas Neue */}
      <path
        fill={c.e}
        d="M268.86 61L285.25 61L297.79 138L285.69 138L283.49 122.71L283.49 122.93L269.74 122.93L267.54 138L256.32 138ZM282.06 112.48L276.67 74.42L276.45 74.42L271.17 112.48Z M321.62 61L354.62 61L354.62 72L333.72 72L333.72 92.35L350.33 92.35L350.33 103.35L333.72 103.35L333.72 127L354.62 127L354.62 138L321.62 138Z"
      />
      {/* Wordmark "DRAL" — paths Bebas Neue */}
      <path
        fill={c.dral}
        d="M379.55 61L398.03 61Q407.05 61 411.56 65.84Q416.07 70.68 416.07 80.03L416.07 118.97Q416.07 128.32 411.56 133.16Q407.05 138 398.03 138L379.55 138ZM397.81 127Q400.78 127 402.38 125.24Q403.97 123.48 403.97 119.52L403.97 79.48Q403.97 75.52 402.38 73.76Q400.78 72 397.81 72L391.65 72L391.65 127Z M442.21 61L460.14 61Q469.49 61 473.78 65.35Q478.07 69.69 478.07 78.71L478.07 83.44Q478.07 95.43 470.15 98.62L470.15 98.84Q474.55 100.16 476.37 104.23Q478.18 108.3 478.18 115.12L478.18 128.65Q478.18 131.95 478.4 133.99Q478.62 136.02 479.5 138L467.18 138Q466.52 136.13 466.3 134.48Q466.08 132.83 466.08 128.54L466.08 114.46Q466.08 109.18 464.38 107.09Q462.67 105 458.49 105L454.31 105L454.31 138L442.21 138ZM458.71 94Q462.34 94 464.16 92.13Q465.97 90.26 465.97 85.86L465.97 79.92Q465.97 75.74 464.49 73.87Q463 72 459.81 72L454.31 72L454.31 94Z M513.89 61L530.28 61L542.82 138L530.72 138L528.52 122.71L528.52 122.93L514.77 122.93L512.57 138L501.35 138ZM527.09 112.48L521.7 74.42L521.48 74.42L516.2 112.48Z M566.65 61L578.75 61L578.75 127L598.66 127L598.66 138L566.65 138Z"
      />
    </svg>
  );
}
