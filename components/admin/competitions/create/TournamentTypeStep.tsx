'use client';

// Premier écran de la création : le type de tournoi. Un préréglage règle tout
// (format, étapes, éligibilité, journées) — il ne reste que le nom et les
// dates. Tout reste modifiable à l'écran suivant : ce choix n'enferme rien.

import { CREATION_PRESETS, presetFacts, type CreationPreset } from '@/lib/competitions/creation-presets';

export default function TournamentTypeStep({ onPick, onCancel }: {
  onPick: (preset: CreationPreset) => void;
  onCancel: () => void;
}) {
  return (
    <div className="panel bevel">
      <div className="panel-header flex items-center justify-between gap-3">
        <span className="t-sub">Nouveau tournoi</span>
        <button type="button" className="btn-springs btn-ghost text-sm" onClick={onCancel}>
          Annuler
        </button>
      </div>
      <div className="panel-body space-y-4">
        <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
          Choisis un format de départ. Tous les réglages restent modifiables ensuite.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CREATION_PRESETS.map(preset => (
            <PresetCard key={preset.id} preset={preset} onPick={() => onPick(preset)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset, onPick }: { preset: CreationPreset; onPick: () => void }) {
  const facts = presetFacts(preset);
  return (
    <button
      type="button"
      onClick={onPick}
      className="pillar-card bevel-sm text-left p-4 flex flex-col gap-2 h-full"
      style={{ cursor: 'pointer' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-lg" style={{ letterSpacing: '0.03em', lineHeight: 1.1 }}>
          {preset.label.toUpperCase()}
        </span>
        {preset.wantsCircuit && <span className="tag tag-violet flex-shrink-0">Springs</span>}
      </div>

      <p className="text-sm flex-1" style={{ color: 'var(--s-text-dim)' }}>
        {preset.description}
      </p>

      <div className="flex items-center gap-3 t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)' }}>
        <span>{facts.teams} équipes</span>
        <span>{facts.matches} matchs</span>
        <span>{facts.days === 1 ? '1 jour' : `${facts.days} jours`}</span>
      </div>
    </button>
  );
}
