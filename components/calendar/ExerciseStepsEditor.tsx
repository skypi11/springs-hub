'use client';

// Éditeur de la liste de steps d'un exercice (v3, 2026-05-26).
//
// Permet de composer un exercice à partir de N blocs typés (replay_review,
// training_pack, vod_review, etc.) avec drag&drop pour réorganiser, label
// custom optionnel, et suppression. Limité à TODO_MAX_STEPS par exo.
//
// Réutilisé dans :
//   - NewTodoForm (création d'exercice)
//   - TodoTemplatesManager (édition de template)
//
// Pas d'état local : tout passe par les props `steps` / `onChange` pour que
// le parent garde la source de vérité (et puisse réinitialiser via applyTemplate).

import { useId } from 'react';
import { ChevronUp, ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  TODO_TYPES, TODO_TYPE_META, TODO_MAX_STEPS, TODO_TITLE_MAX,
  DEFAULT_MENTAL_PROMPTS,
  type ExerciseStep, type TodoType,
} from '@/lib/todos';
import { TodoConfigFields, type ReplayPickerItem } from './TodoConfigFields';

interface ExerciseStepsEditorProps {
  steps: ExerciseStep[];
  onChange: (steps: ExerciseStep[]) => void;
  /** Liste de replays pour le picker du type replay_review (passe à chaque StepEditor). */
  availableReplays?: ReplayPickerItem[];
  maxSteps?: number;
  /** Filtre les types d'exo affichés dans le picker (depuis games-registry par jeu de l'équipe).
   *  Si non fourni → tous TODO_TYPES. Si fourni, on garantit que le type actuel du
   *  step reste sélectionnable même s'il n'est pas dans la liste (cas template legacy
   *  ou exo importé d'un autre jeu). */
  availableTypes?: TodoType[];
}

function newStepId(): string {
  return `step-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultConfigFor(type: TodoType): Record<string, unknown> {
  // Pour mental_checkin on prefill avec les prompts par défaut (sinon valid échoue à la création)
  if (type === 'mental_checkin') return { prompts: [...DEFAULT_MENTAL_PROMPTS] };
  return {};
}

export function ExerciseStepsEditor({
  steps,
  onChange,
  availableReplays,
  maxSteps = TODO_MAX_STEPS,
  availableTypes,
}: ExerciseStepsEditorProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function addStep() {
    if (steps.length >= maxSteps) return;
    const newStep: ExerciseStep = {
      id: newStepId(),
      type: 'free',
      config: defaultConfigFor('free'),
      completed: false,
    };
    onChange([...steps, newStep]);
  }

  function removeStep(id: string) {
    if (steps.length <= 1) return; // toujours au moins 1 step
    onChange(steps.filter(s => s.id !== id));
  }

  function updateStep(id: string, patch: Partial<ExerciseStep>) {
    onChange(steps.map(s => s.id === id ? { ...s, ...patch } : s));
  }

  function changeStepType(id: string, nextType: TodoType) {
    // Changer de type reset la config (les clés d'un type ne matchent pas un autre)
    updateStep(id, { type: nextType, config: defaultConfigFor(nextType) });
  }

  function updateStepConfig(id: string, patch: Record<string, unknown>) {
    const current = steps.find(s => s.id === id);
    if (!current) return;
    updateStep(id, { config: { ...current.config, ...patch } });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = steps.findIndex(s => s.id === active.id);
    const newIdx = steps.findIndex(s => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(steps, oldIdx, newIdx));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="t-label" style={{ fontSize: '12px' }}>
          Étapes ({steps.length}/{maxSteps})
        </label>
        <span className="text-xs" style={{ color: 'var(--s-text-muted)' }}>
          Glisse pour réorganiser
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {steps.map((step, index) => (
              <SortableStepItem
                key={step.id}
                step={step}
                index={index}
                canDelete={steps.length > 1}
                onChangeType={t => changeStepType(step.id, t)}
                onChangeLabel={lbl => updateStep(step.id, { label: lbl })}
                onChangeConfig={patch => updateStepConfig(step.id, patch)}
                onDelete={() => removeStep(step.id)}
                onMoveUp={index > 0 ? () => onChange(arrayMove(steps, index, index - 1)) : undefined}
                onMoveDown={index < steps.length - 1 ? () => onChange(arrayMove(steps, index, index + 1)) : undefined}
                availableReplays={availableReplays}
                availableTypes={availableTypes}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {steps.length < maxSteps && (
        <button
          type="button"
          onClick={addStep}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold transition-all duration-150 bevel-sm"
          style={{
            background: 'var(--s-surface)',
            border: '1px dashed var(--s-border)',
            color: 'var(--s-gold)',
            cursor: 'pointer',
          }}
        >
          <Plus size={13} /> Ajouter une étape
        </button>
      )}
    </div>
  );
}

// ─── Item sortable individuel ─────────────────────────────────────────────

interface SortableStepItemProps {
  step: ExerciseStep;
  index: number;
  canDelete: boolean;
  onChangeType: (t: TodoType) => void;
  onChangeLabel: (label: string) => void;
  onChangeConfig: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  availableReplays?: ReplayPickerItem[];
  availableTypes?: TodoType[];
}

function SortableStepItem({
  step, index, canDelete,
  onChangeType, onChangeLabel, onChangeConfig, onDelete, onMoveUp, onMoveDown,
  availableReplays,
  availableTypes,
}: SortableStepItemProps) {
  const labelId = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...dragStyle,
        background: 'var(--s-elevated)',
        border: '1px solid var(--s-border)',
      }}
      className="p-3 space-y-2.5"
    >
      {/* Header : drag handle + numéro + label + flèches mobile + delete */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex-shrink-0 p-1 -ml-1 transition-colors"
          style={{ color: 'var(--s-text-muted)', cursor: 'grab', touchAction: 'none' }}
          aria-label="Glisser pour réorganiser"
          title="Glisser pour réorganiser"
        >
          <GripVertical size={14} />
        </button>

        <span
          className="flex-shrink-0 flex items-center justify-center text-xs font-bold"
          style={{
            width: '22px', height: '22px',
            background: 'rgba(255,184,0,0.12)',
            color: 'var(--s-gold)',
            border: '1px solid rgba(255,184,0,0.3)',
          }}
        >
          {index + 1}
        </span>

        <input
          id={labelId}
          type="text"
          className="settings-input flex-1 text-sm"
          placeholder={`Étape ${index + 1}, libellé optionnel`}
          maxLength={TODO_TITLE_MAX}
          value={step.label ?? ''}
          onChange={e => onChangeLabel(e.target.value)}
        />

        {/* Flèches up/down, accessibles clavier sur mobile/desktop sans drag */}
        <div className="flex flex-col flex-shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            className="p-0.5 transition-opacity"
            style={{
              color: 'var(--s-text-muted)',
              opacity: onMoveUp ? 0.6 : 0.15,
              cursor: onMoveUp ? 'pointer' : 'not-allowed',
            }}
            aria-label="Monter cette étape"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            className="p-0.5 transition-opacity"
            style={{
              color: 'var(--s-text-muted)',
              opacity: onMoveDown ? 0.6 : 0.15,
              cursor: onMoveDown ? 'pointer' : 'not-allowed',
            }}
            aria-label="Descendre cette étape"
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-shrink-0 p-1 transition-colors"
            style={{ color: '#ff5555', opacity: 0.6, cursor: 'pointer' }}
            aria-label="Supprimer cette étape"
            title="Supprimer cette étape"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Sélecteur de type, chips horizontales compactes.
          Filtré par jeu via availableTypes (registry des jeux). On garantit
          que le type actuel reste affiché même s'il n'est pas dans la liste
          filtrée (cas template d'un autre jeu ou exo importé). */}
      <div className="flex flex-wrap gap-1">
        {(availableTypes
          ? Array.from(new Set<TodoType>([step.type, ...availableTypes]))
          : TODO_TYPES
        ).map(t => {
          const active = step.type === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChangeType(t)}
              className="px-2 py-0.5 transition-all duration-150"
              style={{
                fontSize: '12px',
                fontWeight: 700,
                background: active ? 'var(--s-surface)' : 'transparent',
                border: `1px solid ${active ? 'var(--s-gold)' : 'var(--s-border)'}`,
                color: active ? 'var(--s-gold)' : 'var(--s-text-dim)',
                cursor: 'pointer',
              }}
            >
              {TODO_TYPE_META[t].short.toUpperCase()}
            </button>
          );
        })}
      </div>

      {/* Config spécifique au type, réutilise le composant existant */}
      <TodoConfigFields
        type={step.type}
        config={step.config}
        onChange={onChangeConfig}
        availableReplays={availableReplays}
      />
    </div>
  );
}
