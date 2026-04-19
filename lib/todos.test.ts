import { describe, it, expect } from 'vitest';
import {
  validateCreateTodo,
  validateTodoConfig,
  validateTodoResponse,
  compareTodosPending,
  compareTodosDone,
  isOverdue,
  computeRelativeDeadline,
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_MAX_ASSIGNEES,
  DEADLINE_OFFSET_DAYS_MAX,
  type TodoRef,
} from './todos';

// ---------- Factories ----------

const todo = (partial: Partial<TodoRef> = {}): TodoRef => ({
  id: 't1',
  structureId: 's1',
  subTeamId: 'team1',
  assigneeId: 'u1',
  type: 'free',
  title: 'Regarder VOD',
  description: '',
  config: {},
  response: null,
  eventId: null,
  deadline: null,
  deadlineMode: null,
  deadlineOffsetDays: null,
  done: false,
  doneAt: null,
  doneBy: null,
  createdBy: 'coach1',
  createdAt: 1000,
  ...partial,
});

// ---------- validateCreateTodo ----------

describe('validateCreateTodo', () => {
  it('rejette sans subTeamId', () => {
    const r = validateCreateTodo({ subTeamId: '', assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejette subTeamId non-string', () => {
    const r = validateCreateTodo({ subTeamId: 42, assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejette assigneeIds vide', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: [], title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejette assigneeIds non-array', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: 'u1', title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('dédupe les assignees', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1', 'u1', 'u2', '  u1  '],
      title: 'x',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.assigneeIds).toEqual(['u1', 'u2']);
  });

  it('rejette au-delà de TODO_MAX_ASSIGNEES', () => {
    const ids = Array.from({ length: TODO_MAX_ASSIGNEES + 1 }, (_, i) => `u${i}`);
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ids, title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejette title vide', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: '   ' });
    expect(r.ok).toBe(false);
  });

  it('tronque le titre à TODO_TITLE_MAX', () => {
    const long = 'a'.repeat(TODO_TITLE_MAX + 50);
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: long });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title.length).toBe(TODO_TITLE_MAX);
  });

  it('tronque la description à TODO_DESCRIPTION_MAX', () => {
    const long = 'b'.repeat(TODO_DESCRIPTION_MAX + 50);
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      description: long,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description.length).toBe(TODO_DESCRIPTION_MAX);
  });

  it('description vide par défaut', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('');
  });

  it('eventId optionnel — null par défaut', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.eventId).toBeNull();
  });

  it('eventId accepté si non vide', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'ev42',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.eventId).toBe('ev42');
  });

  it('deadline null par défaut', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.deadline).toBeNull();
  });

  it('deadline ISO YMD acceptée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadline: '2026-05-01',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.deadline).toBe('2026-05-01');
  });

  it('deadline format incorrect rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadline: '01/05/2026',
    });
    expect(r.ok).toBe(false);
  });

  it('deadline inexistante (31 février) rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadline: '2026-02-31',
    });
    expect(r.ok).toBe(false);
  });

  it('deadline vide → null', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadline: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.deadline).toBeNull();
      expect(r.value.deadlineMode).toBeNull();
      expect(r.value.deadlineOffsetDays).toBeNull();
    }
  });

  // ---------- Deadline relative (liée à un event) ----------

  it('deadline absolue → mode="absolute"', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadline: '2026-05-01',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.deadline).toBe('2026-05-01');
      expect(r.value.deadlineMode).toBe('absolute');
      expect(r.value.deadlineOffsetDays).toBeNull();
    }
  });

  it('deadline relative valide (J+2)', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'evt1',
      deadlineMode: 'relative',
      deadlineOffsetDays: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.deadlineMode).toBe('relative');
      expect(r.value.deadlineOffsetDays).toBe(2);
      expect(r.value.deadline).toBeNull(); // API calcule depuis event.startsAt
      expect(r.value.eventId).toBe('evt1');
    }
  });

  it('deadline relative sans event → rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      deadlineMode: 'relative',
      deadlineOffsetDays: 1,
    });
    expect(r.ok).toBe(false);
  });

  it('deadline relative offset négatif → rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'evt1',
      deadlineMode: 'relative',
      deadlineOffsetDays: -1,
    });
    expect(r.ok).toBe(false);
  });

  it('deadline relative offset > DEADLINE_OFFSET_DAYS_MAX → rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'evt1',
      deadlineMode: 'relative',
      deadlineOffsetDays: DEADLINE_OFFSET_DAYS_MAX + 1,
    });
    expect(r.ok).toBe(false);
  });

  it('deadline relative offset non entier → rejetée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'evt1',
      deadlineMode: 'relative',
      deadlineOffsetDays: 1.5,
    });
    expect(r.ok).toBe(false);
  });

  it('deadline relative offset=0 (même jour) accepté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1',
      assigneeIds: ['u1'],
      title: 'x',
      eventId: 'evt1',
      deadlineMode: 'relative',
      deadlineOffsetDays: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.deadlineOffsetDays).toBe(0);
  });

  // ---------- Types structurés ----------

  it('type absent → fallback free (rétrocompat)', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('free');
      expect(r.value.config).toEqual({});
    }
  });

  it('type inconnu → fallback free', () => {
    const r = validateCreateTodo({ subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'bogus' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe('free');
  });

  it('training_pack sans packCode rejeté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'training_pack', config: {},
    });
    expect(r.ok).toBe(false);
  });

  it('training_pack avec packs[] accepté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'training_pack',
      config: { packs: [
        { code: 'A503-264B-9D4C-E4F7', objective: '80%' },
        { code: 'B111-2222-3333-4444', objective: 'maîtrise aerials' },
      ] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.config).toEqual({ packs: [
        { code: 'A503-264B-9D4C-E4F7', objective: '80%' },
        { code: 'B111-2222-3333-4444', objective: 'maîtrise aerials' },
      ] });
    }
  });

  it('training_pack ancienne forme { packCode, objective } convertie en packs[]', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'training_pack',
      config: { packCode: 'A503-264B-9D4C-E4F7', objective: '80%' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.config).toEqual({ packs: [{ code: 'A503-264B-9D4C-E4F7', objective: '80%' }] });
    }
  });

  it('training_pack vide (pack sans code) rejeté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'training_pack',
      config: { packs: [{ code: '', objective: 'x' }] },
    });
    expect(r.ok).toBe(false);
  });

  it('vod_review avec URL invalide rejeté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'vod_review',
      config: { url: 'pas-une-url' },
    });
    expect(r.ok).toBe(false);
  });

  it('vod_review avec URL https acceptée', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'vod_review',
      config: { url: 'https://youtube.com/watch?v=abc', focus: 'rotations' },
    });
    expect(r.ok).toBe(true);
  });

  it('scouting sans opponent rejeté', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'scouting', config: {},
    });
    expect(r.ok).toBe(false);
  });

  it('mental_checkin sans prompts → defaults', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'mental_checkin',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const prompts = (r.value.config as { prompts: string[] }).prompts;
      expect(prompts.length).toBeGreaterThan(0);
    }
  });

  it('replay_review accepte sans replayId (note seule)', () => {
    const r = validateCreateTodo({
      subTeamId: 'team1', assigneeIds: ['u1'], title: 'x', type: 'replay_review',
      config: { replayNote: 'Regarde la 2e mi-temps' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.config.replayId).toBeNull();
  });
});

// ---------- validateTodoResponse ----------

describe('validateTodoResponse', () => {
  it('free sans réponse OK', () => {
    const r = validateTodoResponse('free', undefined);
    expect(r.ok).toBe(true);
  });

  it('watch_party sans réponse OK', () => {
    const r = validateTodoResponse('watch_party', undefined);
    expect(r.ok).toBe(true);
  });

  it('replay_review sans analyse rejeté', () => {
    const r = validateTodoResponse('replay_review', {});
    expect(r.ok).toBe(false);
  });

  it('replay_review avec analyse OK', () => {
    const r = validateTodoResponse('replay_review', { analysis: 'Mon équipe trop bas' });
    expect(r.ok).toBe(true);
  });

  it('training_pack sans case cochée ni commentaire rejeté', () => {
    const r = validateTodoResponse('training_pack', {});
    expect(r.ok).toBe(false);
  });

  it('training_pack avec au moins 1 pack coché accepté', () => {
    const r = validateTodoResponse('training_pack', {
      results: [{ done: true, note: '' }, { done: false, note: 'abandonné' }],
      comment: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        results: [{ done: true, note: '' }, { done: false, note: 'abandonné' }],
        comment: '',
      });
    }
  });

  it('training_pack aucun pack coché mais commentaire accepté', () => {
    const r = validateTodoResponse('training_pack', {
      results: [{ done: false, note: '' }],
      comment: 'trop difficile, je reporte',
    });
    expect(r.ok).toBe(true);
  });

  it('mental_checkin note hors range rejetée', () => {
    const r = validateTodoResponse('mental_checkin', { ratings: [3, 8, 2] });
    expect(r.ok).toBe(false);
  });

  it('mental_checkin notes valides OK', () => {
    const r = validateTodoResponse('mental_checkin', { ratings: [3, 4, 5] });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { ratings: number[] }).ratings).toEqual([3, 4, 5]);
  });

  it('mental_checkin notes vides rejetées', () => {
    const r = validateTodoResponse('mental_checkin', { ratings: [] });
    expect(r.ok).toBe(false);
  });
});

// ---------- validateTodoConfig (edge cases) ----------

describe('validateTodoConfig', () => {
  it('vod_review URL http OK (pas que https)', () => {
    const r = validateTodoConfig('vod_review', { url: 'http://example.com' });
    expect(r.ok).toBe(true);
  });

  it('vod_review URL ftp rejetée', () => {
    const r = validateTodoConfig('vod_review', { url: 'ftp://example.com' });
    expect(r.ok).toBe(false);
  });

  it('mental_checkin plafonne les prompts à 6', () => {
    const r = validateTodoConfig('mental_checkin', {
      prompts: Array.from({ length: 20 }, (_, i) => `p${i}`),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as { prompts: string[] }).prompts.length).toBe(6);
  });
});

// ---------- compareTodosPending ----------

describe('compareTodosPending', () => {
  it('deadline plus proche en premier', () => {
    const a = todo({ id: 'a', deadline: '2026-04-20' });
    const b = todo({ id: 'b', deadline: '2026-04-15' });
    expect(compareTodosPending(a, b)).toBeGreaterThan(0);
    expect(compareTodosPending(b, a)).toBeLessThan(0);
  });

  it('les deadlinés passent avant les non-deadlinés', () => {
    const a = todo({ id: 'a', deadline: '2026-04-20' });
    const b = todo({ id: 'b', deadline: null });
    expect(compareTodosPending(a, b)).toBeLessThan(0);
  });

  it('entre non-deadlinés, plus récent (createdAt desc) en premier', () => {
    const a = todo({ id: 'a', deadline: null, createdAt: 1000 });
    const b = todo({ id: 'b', deadline: null, createdAt: 2000 });
    // b plus récent → b avant a
    expect(compareTodosPending(a, b)).toBeGreaterThan(0);
  });

  it('même deadline → createdAt desc', () => {
    const a = todo({ id: 'a', deadline: '2026-04-20', createdAt: 1000 });
    const b = todo({ id: 'b', deadline: '2026-04-20', createdAt: 2000 });
    expect(compareTodosPending(a, b)).toBeGreaterThan(0);
  });

  it('tri multi-items cohérent', () => {
    const items = [
      todo({ id: 'a', deadline: null, createdAt: 500 }),
      todo({ id: 'b', deadline: '2026-04-20', createdAt: 100 }),
      todo({ id: 'c', deadline: '2026-04-14', createdAt: 100 }),
      todo({ id: 'd', deadline: null, createdAt: 800 }),
    ];
    const sorted = [...items].sort(compareTodosPending);
    expect(sorted.map(t => t.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

// ---------- compareTodosDone ----------

describe('compareTodosDone', () => {
  it('doneAt desc', () => {
    const a = todo({ id: 'a', done: true, doneAt: 1000 });
    const b = todo({ id: 'b', done: true, doneAt: 2000 });
    // b plus récent → b avant a
    expect(compareTodosDone(a, b)).toBeGreaterThan(0);
  });

  it('fallback sur createdAt si doneAt null', () => {
    const a = todo({ id: 'a', done: true, doneAt: null, createdAt: 1000 });
    const b = todo({ id: 'b', done: true, doneAt: null, createdAt: 2000 });
    expect(compareTodosDone(a, b)).toBeGreaterThan(0);
  });
});

// ---------- isOverdue ----------

describe('isOverdue', () => {
  it('done = jamais en retard', () => {
    const t = todo({ done: true, deadline: '2020-01-01' });
    expect(isOverdue(t, '2026-04-15')).toBe(false);
  });

  it('sans deadline = jamais en retard', () => {
    const t = todo({ deadline: null });
    expect(isOverdue(t, '2026-04-15')).toBe(false);
  });

  it('deadline dans le futur = pas en retard', () => {
    const t = todo({ deadline: '2026-05-01' });
    expect(isOverdue(t, '2026-04-15')).toBe(false);
  });

  it('deadline aujourd\'hui = pas en retard', () => {
    const t = todo({ deadline: '2026-04-15' });
    expect(isOverdue(t, '2026-04-15')).toBe(false);
  });

  it('deadline passée = en retard', () => {
    const t = todo({ deadline: '2026-04-10' });
    expect(isOverdue(t, '2026-04-15')).toBe(true);
  });
});

// ---------- computeRelativeDeadline ----------

describe('computeRelativeDeadline', () => {
  // 1er mai 2026, 20h00 Paris = 2026-05-01T18:00:00Z (CEST, UTC+2).
  const evtMs = Date.UTC(2026, 4, 1, 18, 0, 0);

  it('offset=0 → même jour que l\'event (Paris)', () => {
    expect(computeRelativeDeadline(evtMs, 0)).toBe('2026-05-01');
  });

  it('offset=1 → lendemain', () => {
    expect(computeRelativeDeadline(evtMs, 1)).toBe('2026-05-02');
  });

  it('offset=7 → une semaine après', () => {
    expect(computeRelativeDeadline(evtMs, 7)).toBe('2026-05-08');
  });

  it('franchit le mois', () => {
    // 30 avril 2026 Paris + 3 jours → 3 mai 2026.
    const apr30 = Date.UTC(2026, 3, 30, 10, 0, 0);
    expect(computeRelativeDeadline(apr30, 3)).toBe('2026-05-03');
  });

  it('event tard le soir en heure Paris → jour Paris pas UTC', () => {
    // 1er mai 2026 23h30 Paris = 2026-05-01T21:30:00Z. Le jour en UTC est encore le 1er ici,
    // mais on vérifie surtout que le calcul part bien du jour Paris.
    const ms = Date.UTC(2026, 4, 1, 21, 30, 0);
    expect(computeRelativeDeadline(ms, 0)).toBe('2026-05-01');
    expect(computeRelativeDeadline(ms, 1)).toBe('2026-05-02');
  });

  it('event tôt le matin UTC après minuit Paris', () => {
    // 2026-05-02T00:30:00Z = 2026-05-02 02h30 à Paris (CEST). Jour Paris = 2 mai.
    const ms = Date.UTC(2026, 4, 2, 0, 30, 0);
    expect(computeRelativeDeadline(ms, 0)).toBe('2026-05-02');
  });
});
