import { describe, it, expect } from 'vitest';
import {
  validateCreateTemplate,
  validateUpdateTemplate,
  cleanTemplateConfig,
  compareTemplates,
  TEMPLATE_NAME_MAX,
  type TodoTemplate,
} from '@/lib/todo-templates';
import { TODO_TITLE_MAX, TODO_DESCRIPTION_MAX, DEFAULT_MENTAL_PROMPTS } from '@/lib/todos';

const base = { scope: 'personal', name: 'Test', type: 'free' } as const;

function template(overrides: Partial<TodoTemplate> = {}): TodoTemplate {
  return {
    id: 't1',
    structureId: 's1',
    ownerId: 'u1',
    scope: 'personal',
    name: 'Default',
    type: 'free',
    titleTemplate: '',
    descriptionTemplate: '',
    config: {},
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('validateCreateTemplate', () => {
  it('rejette scope invalide', () => {
    const r = validateCreateTemplate({ ...base, scope: 'global' });
    expect(r.ok).toBe(false);
  });

  it('rejette nom vide', () => {
    const r = validateCreateTemplate({ ...base, name: '   ' });
    expect(r.ok).toBe(false);
  });

  it('accepte minimum valide', () => {
    const r = validateCreateTemplate({ ...base });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.scope).toBe('personal');
      expect(r.value.name).toBe('Test');
      expect(r.value.type).toBe('free');
      expect(r.value.config).toEqual({});
    }
  });

  it('fallback type=free si inconnu', () => {
    const r = validateCreateTemplate({ ...base, type: 'nuclear_launch' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe('free');
  });

  it('cap name à TEMPLATE_NAME_MAX', () => {
    const long = 'a'.repeat(TEMPLATE_NAME_MAX + 50);
    const r = validateCreateTemplate({ ...base, name: long });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name.length).toBe(TEMPLATE_NAME_MAX);
  });

  it('cap titleTemplate / descriptionTemplate', () => {
    const r = validateCreateTemplate({
      ...base,
      titleTemplate: 'a'.repeat(TODO_TITLE_MAX + 100),
      descriptionTemplate: 'b'.repeat(TODO_DESCRIPTION_MAX + 100),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.titleTemplate.length).toBe(TODO_TITLE_MAX);
      expect(r.value.descriptionTemplate.length).toBe(TODO_DESCRIPTION_MAX);
    }
  });

  it('accepte config scouting SANS opponent (mode template, validation assouplie)', () => {
    const r = validateCreateTemplate({
      ...base,
      type: 'scouting',
      config: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config).toEqual({ opponent: '' });
  });

  it('accepte config training_pack SANS packCode (mode template)', () => {
    const r = validateCreateTemplate({
      ...base,
      type: 'training_pack',
      config: { objective: 'Maîtriser les resets' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.config).toEqual({ packCode: '', objective: 'Maîtriser les resets' });
    }
  });

  it('accepte config vod_review SANS url (mode template)', () => {
    const r = validateCreateTemplate({
      ...base,
      type: 'vod_review',
      config: { focus: 'Positionnement défensif' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.config).toEqual({ url: '', focus: 'Positionnement défensif' });
    }
  });

  it('mental_checkin conserve prompts vides (pas de défaut forcé sur template)', () => {
    const r = validateCreateTemplate({
      ...base,
      type: 'mental_checkin',
      config: {},
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config).toEqual({ prompts: [] });
  });

  it('mental_checkin cap à 6 prompts', () => {
    const prompts = Array.from({ length: 10 }, (_, i) => `Q${i}`);
    const r = validateCreateTemplate({
      ...base,
      type: 'mental_checkin',
      config: { prompts },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const cfg = r.value.config as { prompts: string[] };
      expect(cfg.prompts.length).toBe(6);
    }
  });

  it('scope=structure accepté', () => {
    const r = validateCreateTemplate({ ...base, scope: 'structure' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.scope).toBe('structure');
  });
});

describe('validateUpdateTemplate', () => {
  it('patch vide retourne objet vide (aucun champ modifié)', () => {
    const r = validateUpdateTemplate('free', {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value)).toHaveLength(0);
  });

  it('rejette nom vide', () => {
    const r = validateUpdateTemplate('free', { name: '  ' });
    expect(r.ok).toBe(false);
  });

  it('update name uniquement', () => {
    const r = validateUpdateTemplate('free', { name: 'Nouveau nom' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Nouveau nom');
      expect(r.value.titleTemplate).toBeUndefined();
    }
  });

  it('revalidate config avec le type existant', () => {
    const r = validateUpdateTemplate('scouting', { config: { opponent: 'Vitality' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config).toEqual({ opponent: 'Vitality' });
  });

  it('descriptionTemplate vide autorisé (retire la description)', () => {
    const r = validateUpdateTemplate('free', { descriptionTemplate: '' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.descriptionTemplate).toBe('');
  });
});

describe('cleanTemplateConfig', () => {
  it('free → objet vide', () => {
    expect(cleanTemplateConfig('free', { anything: 'ignored' })).toEqual({});
  });

  it('watch_party clean location', () => {
    expect(cleanTemplateConfig('watch_party', { location: '  Discord #room  ' })).toEqual({
      location: 'Discord #room',
    });
  });

  it('replay_review accepte replayId null', () => {
    const r = cleanTemplateConfig('replay_review', { replayNote: 'Focus 2:15' });
    expect(r).toEqual({ replayId: null, replayNote: 'Focus 2:15' });
  });

  it("DEFAULT_MENTAL_PROMPTS n'est PAS appliqué sur template (vide reste vide)", () => {
    const r = cleanTemplateConfig('mental_checkin', {});
    expect(r).toEqual({ prompts: [] });
    // Vérifie que les defaults ne fuient pas dans le template.
    expect(r).not.toEqual({ prompts: DEFAULT_MENTAL_PROMPTS });
  });
});

describe('compareTemplates', () => {
  it('tri par updatedAt décroissant', () => {
    const a = template({ id: 'a', updatedAt: 100 });
    const b = template({ id: 'b', updatedAt: 200 });
    const c = template({ id: 'c', updatedAt: 150 });
    const sorted = [a, b, c].sort(compareTemplates).map(t => t.id);
    expect(sorted).toEqual(['b', 'c', 'a']);
  });
});
