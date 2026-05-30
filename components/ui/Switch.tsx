// Toggle switch réutilisable, aligné DA Aedral (biseaux clip-path, pas de
// border-radius). Couleur d'accent paramétrable pour matcher le contexte
// (vert "actif", or "premium", etc.).
//
// Extrait depuis app/community/players/page.tsx (audit 30/05 polish #9).
// Usage typique : filtres listings (Recrute, Disponible, etc.), settings.

interface SwitchProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  /** Couleur du switch quand activé. Default = vert "actif". */
  accent?: string;
}

export function Switch({ label, value, onChange, accent = '#33ff66' }: SwitchProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className="flex items-center justify-between w-full gap-3 text-left transition-colors px-2 py-1.5 hover:bg-[var(--s-elevated)]"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
    >
      <span className="text-sm" style={{ color: value ? 'var(--s-text)' : 'var(--s-text-dim)' }}>
        {label}
      </span>
      <span
        className="flex-shrink-0 relative transition-all"
        style={{
          width: 34,
          height: 18,
          background: value ? accent : 'var(--s-elevated)',
          border: `1px solid ${value ? accent : 'var(--s-border)'}`,
        }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 transition-all"
          style={{
            left: value ? 18 : 2,
            width: 12,
            height: 12,
            background: value ? '#000' : 'var(--s-text-dim)',
          }}
        />
      </span>
    </button>
  );
}
