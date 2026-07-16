import type { ReactNode } from 'react';

// Scorecard primitive du module compétition : LA donnée qui décide, en gros
// (Bebas ou mono tabulaire), au-dessus d'un libellé discret. Contraste typo 3
// crans. `color` porte l'accent (near-white par défaut, #ffb46b attention,
// #ff8a8a grave, couleur du jeu). Aligne à droite via `align`.
export default function GlanceStat({
  value, label, color = 'var(--s-text)', mono = false, align = 'left', size = 26,
}: {
  value: ReactNode;
  label: string;
  color?: string;
  mono?: boolean;
  align?: 'left' | 'right';
  size?: number;
}) {
  return (
    <div className="flex flex-col" style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span
        className={mono ? 't-mono' : 'font-display'}
        style={{
          fontSize: size,
          fontWeight: mono ? 600 : undefined,
          letterSpacing: mono ? undefined : '0.02em',
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span className="t-label-soft" style={{ marginTop: 4 }}>{label}</span>
    </div>
  );
}
