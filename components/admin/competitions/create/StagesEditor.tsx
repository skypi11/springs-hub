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
  MIN_ADVANCE_COUNT as MIN_ADVANCE,
  reconcileStages,
  setBoForRound,
  setConfigValue,
  switchFormatKind,
} from '@/lib/competitions/format-config';
import { listBoRounds } from '@/lib/competitions/schedule-plan';

const BO_CHOICES = [1, 3, 5, 7, 9];
import type { CompetitionFormat, FormatKind, SeedingStrategy, TournamentStage } from '@/types/competitions';

const MAX_STAGES = 4;

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

  // Toute modification repasse par `reconcileStages` : les effectifs se
  // propagent sur TOUTE la suite (et pas seulement sur l'étape voisine), et la
  // dernière étape perd son transfert. Sans cette cascade, réduire un effectif
  // sur un tournoi à trois étapes — ou retirer une étape du milieu — laissait
  // une séquence que le serveur refusait, sans explication à l'écran.
  const apply = (next: TournamentStage[]) => onChange(reconcileStages(next));

  function patchStage(index: number, patch: Partial<TournamentStage>) {
    apply(stages.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function setFormat(index: number, format: CompetitionFormat) {
    apply(stages.map((s, i) => (i === index ? { ...s, kind: format.kind, format } : s)));
  }

  function setAdvanceCount(index: number, advanceCount: number) {
    apply(stages.map((s, i) => (
      i === index ? { ...s, transfer: { ...s.transfer!, advanceCount } } : s
    )));
  }

  function addStage() {
    if (stages.length >= MAX_STAGES) return;
    const last = stages[stages.length - 1];
    apply([
      ...stages.slice(0, -1),
      // L'étape qui devient avant-dernière garde le nom choisi par
      // l'organisateur, sinon celui de SON format — jamais « Poules » sur un
      // bracket, comme c'était le cas.
      { ...last, name: last.name ?? FORMAT_DEFS[last.kind].label },
      { kind: 'single_elim' as const, format: defaultFormatFor('single_elim'), name: 'Phase finale' },
    ]);
  }

  function removeStage(index: number) {
    apply(stages.filter((_, i) => i !== index));
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
                  <div style={{ width: 200 }}>
                    <NumberField
                      label="Équipes qualifiées"
                      help={`Entre ${MIN_ADVANCE} et ${stage.format.maxTeams} — elles composent l’étape suivante.`}
                      min={MIN_ADVANCE}
                      max={stage.format.maxTeams}
                      value={stage.transfer.advanceCount}
                      onCommit={next => setAdvanceCount(index, next)}
                    />
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
  const boRounds = listBoRounds(stage.format);
  // Le BO de finale a sa ligne dans « BO par tour » : le laisser aussi en
  // champ libre donnerait deux endroits pour la même valeur.
  const advancedFields = visible(advanced).filter(f => boRounds.length === 0 || f.key !== 'bo.grandFinal');

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

      {(advancedFields.length > 0 || boRounds.length > 0) && (
        <div>
          <button type="button" className="quiet-link text-sm" onClick={() => setShowAdvanced(v => !v)}>
            {showAdvanced ? 'Masquer les réglages avancés' : 'Réglages avancés'}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-4">
              {advancedFields.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {advancedFields.map(field => (
                    <FieldInput key={field.key} field={field} format={stage.format} onFormat={onFormat} />
                  ))}
                </div>
              )}
              {boRounds.length > 0 && (
                <div>
                  <p className="t-label-soft mb-2">BO par tour</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                    {boRounds.map(ref => (
                      <div key={`${ref.bracket}-${ref.round}`}
                        className="flex items-center justify-between gap-3 py-1.5"
                        style={{ borderBottom: '1px solid var(--s-border)' }}>
                        <span className="text-sm truncate" style={{ color: 'var(--s-text-dim)' }}>{ref.label}</span>
                        {ref.editable ? (
                          <select className="settings-input" style={{ padding: '3px 8px', width: 82 }}
                            aria-label={`BO — ${ref.label}`}
                            value={ref.bo}
                            onChange={e => onFormat(setBoForRound(stage.format, ref, Number(e.target.value)))}>
                            {BO_CHOICES.map(n => <option key={n} value={n}>BO{n}</option>)}
                          </select>
                        ) : (
                          <span className="t-mono" style={{ fontSize: 12, color: 'var(--s-text-muted)', width: 82, textAlign: 'right' }}>
                            BO{ref.bo}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

  if (field.type === 'choice') {
    return (
      <div>
        <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>{field.label}</label>
        <select className="settings-input w-full"
          value={typeof value === 'number' ? value : field.default}
          onChange={e => onFormat(setConfigValue(format, field.key, Number(e.target.value)))}>
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.help && (
          <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>{field.help}</p>
        )}
      </div>
    );
  }

  return (
    <NumberField
      label={field.label}
      help={field.help}
      min={field.min}
      max={field.max}
      value={typeof value === 'number' ? value : field.default}
      onCommit={next => onFormat(setConfigValue(format, field.key, next))}
    />
  );
}

/**
 * Champ numérique qui laisse TAPER avant de borner.
 *
 * Borner à chaque frappe rendait la saisie impossible : dans un champ dont le
 * minimum est 4, taper « 16 » transformait le « 1 » en « 4 » avant même le
 * « 6 ». La valeur n'est recadrée qu'à la sortie du champ (ou sur Entrée).
 */
function NumberField({ label, help, min, max, value, onCommit }: {
  label: string;
  help?: string;
  min: number;
  max: number;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const raw = Number(draft);
    setDraft(null);
    if (!Number.isFinite(raw)) return;              // saisie vide ou illisible : on garde la valeur
    const clamped = Math.min(max, Math.max(min, Math.round(raw)));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div>
      <label className="block text-sm mb-1" style={{ color: 'var(--s-text-dim)' }}>{label}</label>
      <input
        type="number" className="settings-input w-full"
        min={min} max={max}
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      <p className="text-xs mt-1" style={{ color: 'var(--s-text-muted)' }}>
        {help ?? `Entre ${min} et ${max}.`}
      </p>
    </div>
  );
}

