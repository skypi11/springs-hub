import { describe, it, expect } from 'vitest';
import {
  validateCreateTodo,
  compareTodosPending,
  compareTodosDone,
  isOverdue,
  TODO_TITLE_MAX,
  TODO_DESCRIPTION_MAX,
  TODO_MAX_ASSIGNEES,
  type TodoRef,
} from './todos';

// ---------- Factories ----------

const todo = (partial: Partial<TodoRef> = {}): TodoRef => ({
  id: 't1',
  structureId: 's1',
  subTeamId: 'team1',
  assigneeId: 'u1',
  title: 'Regarder VOD',
  description: '',
  eventId: null,
  deadline: null,
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
    if (r.ok) expect(r.value.deadline).toBeNull();
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
