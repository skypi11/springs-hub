'use client';

// Les étapes du tournoi et leurs réglages. Un tournoi est TOUJOURS une liste
// d'étapes ici (une seule le plus souvent) : le multi-étapes n'est pas un mode
// à part, ce qui garantit au passage l'invariant « étape 1 = format de la
// compétition » — il n'y a qu'une seule source.
//
// Les champs affichés viennent de la registry (`configFields`) : ce composant
// ne connaît aucun format en particulier. Ajouter un format à la plateforme
// reste « ajouter une fiche ».

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { FORMAT_DEFS, FORMAT_KINDS, type ConfigField } from '@/lib/competitions/formats';
import {
  configFieldsByLevel,
  defaultFormatFor,
  getConfigValue,
  setConfigValue,
  switchFormatKind,
} from '@/lib/competitions/format-config';
import type { CompetitionFormat, FormatKind, SeedingStrategy, TournamentStage } from '@/types/competitions';

const MAX_STAGES = 4;
const MIN_ADVANCE = 4;

const RESEED_LABELS: Array<{ value: SeedingStrategy; label: string; help: string }> = [
  { value: 'standings', label: 'Classement de l’étape', help: 'Le premier de l’étape précédente est tête de série.' },
  { value: 'mmr', label: 'MMR des équipes', help: 'Tête de série à la compo la plus forte, calculée à l’inscription.' },
  { value: 'circuit', label: 'Classement du circuit', help: 'Réservé aux compétitions rattachées à un circuit.' },
  { value: 'random', label: 'Tirage au sort', help: 'Aucune tête de série.' },
];

export default function StagesEditor({ stages, hasCircuit, onChange }: {
  stages: TournamentStage[];
  hasCircuit: boolean;
  onChange: (next: TournamentStage[]) => void;
}) {
  const multi = stages.length > 1;

  function patchStage(index: number, patch: Partial<TournamentStage>) {
    onChange(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function setFormat(index: number, format: CompetitionFormat) {
    const next = stages.map((s, i) => (i === index ? { ...s, kind: format.kind, format } : s));
    // Le nombre de qualifiées ne peut pas dépasser l'effectif de son étape.
    const transfer = next[index].transfer;
    if (transfer && transfer.advanceCount > format.maxTeams) {
      next[index] = { ...next[index], transfer: { ...transfer, advanceCount: format.maxTeams } };
      next[index + 1] = withTeamCount(next[index + 1], format.maxTeams);
    }
    onChange(next);
  }

  function setAdvanceCount(index: number, rawCount: number) {
    const max = stages[index].format.maxTeams;
    const advanceCount = Math.min(max, Math.max(MIN_ADVANCE, Math.round(rawCount) || MIN_ADVANCE));
    const next = [...stages];
    next[index] = { ...next[index], transfer: { ...next[index].transfer!, advanceCount } };
    // L'étape suivante accueille EXACTEMENT les qualifiées : son effectif est
    // dicté ici, jamais saisi deux fois.
    next[index + 1] = withTeamCount(next[index + 1], advanceCount);
    onChange(next);
  }

  function addStage() {
    if (stages.length >= MAX_STAGES) return;
    const previous = stages[stages.length - 1];
    const advanceCount = Math.min(previous.format.maxTeams, 8);
    const next = [...stages];
    next[next.length - 1] = {
      ...previous,
      name: previous.name ?? 'Poules',
      transfer: { advanceCount: Math.max(MIN_ADVANCE, advanceCount), reseed: 'standings' },
    };
    const finalFormat = withTeamCount(
      { kind: 'single_elim', format: defaultFormatFor('single_elim'), name: 'Phase finale' },
      Math.max(MIN_ADVANCE, advanceCount),
    );
    onChange([...next, finalFormat]);
  }

  function removeStage(index: number) {
    const next = stages.filter((_, i) => i !== index);
    // La dernière étape ne transfère vers personne.
    next[next.length - 1] = { ...next[next.length - 1], transfer: undefined };
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {stages.map((stage, index) => (
        <div key={index} style={{ border: '1px solid var(--s-border)' }}>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ background: 'var(--s-elevated)' }}>
            {multi && <span className="t-label-soft" style={{ minWidth: 58 }}>Étape {index + 1}</span>}
            {multi ? (
              <input
                className="settings-input" style={{ padding: '4px 8px', maxWidth: 200 }}
                aria-label={`Nom de l’étape ${index + 1}`}
                value={stage.name ?? ''}
                placeholder={FORMAT_DEFS[stage.kind].label}
                maxLength={40}
                onChange={e => patchStage(index, { name: e.target.value })}
              />
            ) : (
              <span className="t-sub">Format</span>
            )}
            <span className="flex-1" />
            {multi && stages.length > 1 && index > 0 && (
              <button type="button" className="quiet-link" aria-label={`Supprimer l’étape ${index + 1}`}
                onClick={() => removeStage(index)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <div className="p-3 space-y-3">
            <StageFields
              stage={stage}
              lockedTeamCount={index > 0 ? stage.format.maxTeams : null}
              onFormat={format => setFormat(index, format)}
            />

            {stage.transfer && (
              <div className="pt-3" style={{ borderTop: '1px solid var(--s-border)' }}>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>
                      Équipes qualifiées pour l’étape suivante
                    </label>
                    <input type="number" className="settings-input" style={{ width: 96 }}
                      min={MIN_ADVANCE} max={stage.format.maxTeams}
                      value={stage.transfer.advanceCount}
                      onChange={e => setAdvanceCount(index, Number(e.target.value))} />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>
                      Têtes de série de l’étape suivante
                    </label>
                    <select className="settings-input w-full"
                      value={stage.transfer.reseed}
                      onChange={e => patchStage(index, {
                        transfer: { ...stage.transfer!, reseed: e.target.value as SeedingStrategy },
                      })}>
                      {RESEED_LABELS
                        .filter(r => r.value !== 'circuit' || hasCircuit)
                        .map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--s-text-muted)' }}>
                  {RESEED_LABELS.find(r => r.value === stage.transfer!.reseed)?.help}
                  {' '}Une équipe retirée en cours de route ne se qualifie pas : la suivante au classement est repêchée.
                </p>
              </div>
            )}
          </div>
        </div>
      ))}

      {stages.length < MAX_STAGES && (
        <button type="button" className="btn-springs btn-ghost text-sm flex items-center gap-1" onClick={addStage}>
          <Plus size={13} /> Ajouter une étape
        </button>
      )}
    </div>
  );
}

// ── Réglages d'une étape ────────────────────────────────────────────────────

function StageFields({ stage, lockedTeamCount, onFormat }: {
  stage: TournamentStage;
  /** Effectif imposé par le transfert de l'étape précédente (étapes ≥ 2). */
  lockedTeamCount: number | null;
  onFormat: (format: CompetitionFormat) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const def = FORMAT_DEFS[stage.kind];
  const { essential, advanced } = configFieldsByLevel(stage.kind);
  // L'effectif d'une étape suivante est dicté par le nombre de qualifiées : il
  // se règle à un seul endroit, jamais deux.
  const visible = (fields: ConfigField[]) =>
    lockedTeamCount === null ? fields : fields.filter(f => f.key !== 'maxTeams');

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Format</label>
          <select className="settings-input w-full" value={stage.kind}
            onChange={e => onFormat(switchFormatKind(stage.format, e.target.value as FormatKind))}>
            {FORMAT_KINDS.map(kind => (
              <option key={kind} value={kind}>{FORMAT_DEFS[kind].label}</option>
            ))}
          </select>
        </div>
        {lockedTeamCount !== null && (
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>Équipes</label>
            <p className="text-sm" style={{ paddingTop: 7, color: 'var(--s-text-muted)' }}>
              {lockedTeamCount} — les qualifiées de l’étape précédente
            </p>
          </div>
        )}
        {visible(essential).map(field => (
          <FieldInput key={field.key} field={field} format={stage.format} onFormat={onFormat} />
        ))}
      </div>

      <p className="text-sm" style={{ color: 'var(--s-text-dim)' }}>
        {def.summarize(stage.format, stage.format.maxTeams)}
      </p>

      {visible(advanced).length > 0 && (
        <div>
          <button type="button" className="quiet-link text-sm" onClick={() => setShowAdvanced(v => !v)}>
            {showAdvanced ? 'Masquer les réglages avancés' : 'Réglages avancés'}
          </button>
          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              {visible(advanced).map(field => (
                <FieldInput key={field.key} field={field} format={stage.format} onFormat={onFormat} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function FieldInput({ field, format, onFormat }: {
  field: ConfigField;
  format: CompetitionFormat;
  onFormat: (format: CompetitionFormat) => void;
}) {
  const value = getConfigValue(format, field.key);

  if (field.type === 'boolean') {
    return (
      <div className="flex flex-col justify-end pb-1">
        <Switch
          label={field.label}
          value={value === true}
          onChange={next => onFormat(setConfigValue(format, field.key, next))}
        />
        {field.help && (
          <p className="text-xs mt-1 px-2" style={{ color: 'var(--s-text-muted)' }}>{field.help}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>{field.label}</label>
      <input
        type="number" className="settings-input w-full"
        min={field.min} max={field.max}
        value={typeof value === 'number' ? value : field.default}
        onChange={e => {
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          onFormat(setConfigValue(format, field.key, Math.min(field.max, Math.max(field.min, Math.round(raw)))));
        }}
      />
      {field.help && (
        <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{field.help}</p>
      )}
    </div>
  );
}

/** Impose l'effectif d'une étape (dicté par les qualifiées de la précédente).
 *  Les poules et les rondes suivent — `setConfigValue` normalise. */
function withTeamCount(stage: TournamentStage, teamCount: number): TournamentStage {
  const format = setConfigValue(stage.format, 'maxTeams', teamCount);
  return { ...stage, kind: format.kind, format };
}
