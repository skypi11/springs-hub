// Helpers purs pour les templates de exercices (v2 — étape 2).
// Un template = recette pré-remplie pour créer un exercice rapidement.
// Portée : personnelle (perso coach) OU structure (partagée avec tout le staff).

import {
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_TYPES,
  TRAINING_PACKS_MAX,
  validateSteps,
  type TodoType,
  type TrainingPackItem,
  type ExerciseStep,
} from '@/lib/todos';

export const TEMPLATE_NAME_MAX = 60;
export const TEMPLATE_MAX_PER_SCOPE = 50; // hard cap par scope (perso ou structure)

export type TemplateScope = 'personal' | 'structure';
export const TEMPLATE_SCOPES: readonly TemplateScope[] = ['personal', 'structure'];

export interface TodoTemplate {
  id: string;
  structureId: string;
  ownerId: string;        // créateur — reste propriétaire même après partage (scope=A)
  scope: TemplateScope;
  name: string;           // ex : "Scouting 3v3", "Étirements pré-match"
  type: TodoType;          // legacy : type du 1er step (proxy pour rétrocompat)
  titleTemplate: string;
  descriptionTemplate: string;
  config: Record<string, unknown>; // legacy : config du 1er step (proxy)
  steps?: ExerciseStep[];  // v3 — source de vérité multi-step (absent = template legacy 1-step)
  createdAt: number;      // ms epoch
  updatedAt: number;      // ms epoch
}

export interface CreateTemplateInput {
  scope: unknown;
  name: unknown;
  // v3 — nouvelle source de vérité (steps[]). Si fourni, prend le pas sur type+config.
  steps?: unknown;
  // legacy (rétrocompat clients pas encore migrés)
  type?: unknown;
  titleTemplate?: unknown;
  descriptionTemplate?: unknown;
  config?: unknown;
}

export interface ValidatedTemplateInput {
  scope: TemplateScope;
  name: string;
  // legacy fields maintenus (= 1er step) pour les lecteurs pas encore migrés
  type: TodoType;
  titleTemplate: string;
  descriptionTemplate: string;
  config: Record<string, unknown>;
  // v3 source de vérité
  steps: ExerciseStep[];
}

function s(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

// Clean superficiel d'une config de template — pas de validation stricte des champs requis
// (ex : un template scouting peut être sauvegardé sans adversaire ; il sera complété à l'instanciation).
// On applique les mêmes caps textuels que validateTodoConfig.
export function cleanTemplateConfig(type: TodoType, raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (type) {
    case 'free':
      return {};
    case 'watch_party':
      return { location: s(r.location, 200) };
    case 'replay_review':
      return {
        replayId: typeof r.replayId === 'string' && r.replayId.trim() ? r.replayId.trim() : null,
        replayNote: s(r.replayNote, 500),
      };
    case 'training_pack': {
      // Accepte forme canonique { packs: [{code, objective}] } + compat { packCode, objective }.
      // Pas d'exigence de code non vide (template = recette ; code rempli à l'instanciation).
      const rawPacks: unknown[] = Array.isArray(r.packs)
        ? (r.packs as unknown[])
        : (r.packCode !== undefined || r.objective !== undefined ? [{ code: r.packCode, objective: r.objective }] : []);
      const packs: TrainingPackItem[] = [];
      for (const p of rawPacks) {
        if (!p || typeof p !== 'object') continue;
        const pr = p as Record<string, unknown>;
        packs.push({
          code: s(pr.code ?? pr.packCode, 50),
          objective: s(pr.objective, 500),
        });
        if (packs.length >= TRAINING_PACKS_MAX) break;
      }
      return { packs };
    }
    case 'vod_review':
      return { url: s(r.url, 500), focus: s(r.focus, 500) };
    case 'scouting':
      return { opponent: s(r.opponent, 120) };
    case 'mental_checkin': {
      let prompts: string[] = [];
      if (Array.isArray(r.prompts)) {
        prompts = r.prompts
          .map(p => (typeof p === 'string' ? p.trim().slice(0, 60) : ''))
          .filter(p => p.length > 0)
          .slice(0, 6);
      }
      return { prompts };
    }
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return {};
    }
  }
}

export function validateCreateTemplate(
  input: CreateTemplateInput
): { ok: true; value: ValidatedTemplateInput } | { ok: false; error: string } {
  if (typeof input.scope !== 'string' || !(TEMPLATE_SCOPES as readonly string[]).includes(input.scope)) {
    return { ok: false, error: 'Portée invalide (personal ou structure).' };
  }
  const scope = input.scope as TemplateScope;

  if (typeof input.name !== 'string' || !input.name.trim()) {
    return { ok: false, error: 'Le nom du template est obligatoire.' };
  }
  const name = input.name.trim().slice(0, TEMPLATE_NAME_MAX);

  const titleTemplate = s(input.titleTemplate, TODO_TITLE_MAX);
  const descriptionTemplate = s(input.descriptionTemplate, TODO_DESCRIPTION_MAX);

  // Résolution steps : v3 si fourni, sinon fallback wrap legacy single-type.
  let steps: ExerciseStep[];
  if (input.steps !== undefined && input.steps !== null) {
    const stepsResult = validateSteps(input.steps);
    if (!stepsResult.ok) return { ok: false, error: stepsResult.error };
    steps = stepsResult.value;
  } else {
    let legacyType: TodoType = 'free';
    if (typeof input.type === 'string' && (TODO_TYPES as readonly string[]).includes(input.type)) {
      legacyType = input.type as TodoType;
    }
    const config = cleanTemplateConfig(legacyType, input.config);
    steps = [{
      id: `step-${Math.random().toString(36).slice(2, 10)}`,
      type: legacyType,
      config,
      completed: false,
    }];
  }

  // Champs legacy maintenus = ceux du 1er step (proxy pour lecteurs pas encore migrés)
  const type: TodoType = steps[0].type;
  const config: Record<string, unknown> = steps[0].config;

  return {
    ok: true,
    value: { scope, name, type, titleTemplate, descriptionTemplate, config, steps },
  };
}

// Patch partiel pour éditer un template existant. Seuls les champs fournis sont validés.
// Pour les templates multi-step (v3), on peut fournir `steps` qui remplace toute
// la liste. Si `steps` fourni, on resynchronise aussi type/config legacy (= 1er step).
export interface UpdateTemplateInput {
  name?: unknown;
  titleTemplate?: unknown;
  descriptionTemplate?: unknown;
  config?: unknown;
  steps?: unknown;
}

export function validateUpdateTemplate(
  existingType: TodoType,
  input: UpdateTemplateInput
): { ok: true; value: Partial<ValidatedTemplateInput> } | { ok: false; error: string } {
  const patch: Partial<ValidatedTemplateInput> = {};

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      return { ok: false, error: 'Le nom du template est obligatoire.' };
    }
    patch.name = input.name.trim().slice(0, TEMPLATE_NAME_MAX);
  }

  if (input.titleTemplate !== undefined) {
    patch.titleTemplate = s(input.titleTemplate, TODO_TITLE_MAX);
  }

  if (input.descriptionTemplate !== undefined) {
    patch.descriptionTemplate = s(input.descriptionTemplate, TODO_DESCRIPTION_MAX);
  }

  // v3 : édition de la liste de steps. Resynchronise legacy type/config = 1er step.
  if (input.steps !== undefined) {
    const stepsRes = validateSteps(input.steps);
    if (!stepsRes.ok) return { ok: false, error: stepsRes.error };
    patch.steps = stepsRes.value;
    patch.type = stepsRes.value[0].type;
    patch.config = stepsRes.value[0].config;
  } else if (input.config !== undefined) {
    // Legacy : édition de config sans changer steps (compat anciens clients)
    patch.config = cleanTemplateConfig(existingType, input.config);
  }

  return { ok: true, value: patch };
}

// Tri : les templates les plus récemment mis à jour en premier.
export function compareTemplates(a: TodoTemplate, b: TodoTemplate): number {
  return b.updatedAt - a.updatedAt;
}
