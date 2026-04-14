// Helpers purs pour les devoirs (MVP2b).
// Pas d'accès Firestore ici — toute la logique testable en isolation.

export const TODO_TITLE_MAX = 120;
export const TODO_DESCRIPTION_MAX = 2000;
export const TODO_MAX_ASSIGNEES = 30;

export interface TodoRef {
  id: string;
  structureId: string;
  subTeamId: string;
  assigneeId: string;
  title: string;
  description: string;
  eventId: string | null;
  deadline: string | null;  // "YYYY-MM-DD" ou null
  done: boolean;
  doneAt: number | null;    // ms epoch
  doneBy: string | null;
  createdBy: string;
  createdAt: number;        // ms epoch
}

export interface CreateTodoInput {
  subTeamId: unknown;
  assigneeIds: unknown;
  title: unknown;
  description?: unknown;
  eventId?: unknown;
  deadline?: unknown;
}

export interface ValidatedTodoInput {
  subTeamId: string;
  assigneeIds: string[];
  title: string;
  description: string;
  eventId: string | null;
  deadline: string | null;
}

// Format ISO date simple "YYYY-MM-DD"
function isValidYmd(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const d = new Date(input + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === input;
}

// Valide et normalise le payload de création d'un devoir.
// Renvoie { ok: true, value } en cas de succès, { ok: false, error } sinon.
export function validateCreateTodo(
  input: CreateTodoInput
): { ok: true; value: ValidatedTodoInput } | { ok: false; error: string } {
  // subTeamId
  if (typeof input.subTeamId !== 'string' || !input.subTeamId.trim()) {
    return { ok: false, error: 'Équipe manquante.' };
  }
  const subTeamId = input.subTeamId.trim();

  // assigneeIds
  if (!Array.isArray(input.assigneeIds) || input.assigneeIds.length === 0) {
    return { ok: false, error: 'Au moins un joueur doit être assigné.' };
  }
  if (input.assigneeIds.length > TODO_MAX_ASSIGNEES) {
    return { ok: false, error: `Trop de joueurs assignés (max ${TODO_MAX_ASSIGNEES}).` };
  }
  const assigneeIds: string[] = [];
  const seen = new Set<string>();
  for (const a of input.assigneeIds) {
    if (typeof a !== 'string' || !a.trim()) continue;
    const v = a.trim();
    if (seen.has(v)) continue;
    seen.add(v);
    assigneeIds.push(v);
  }
  if (assigneeIds.length === 0) {
    return { ok: false, error: 'Aucun joueur valide assigné.' };
  }

  // title
  if (typeof input.title !== 'string' || !input.title.trim()) {
    return { ok: false, error: 'Le titre est obligatoire.' };
  }
  const title = input.title.trim().slice(0, TODO_TITLE_MAX);

  // description
  let description = '';
  if (typeof input.description === 'string') {
    description = input.description.trim().slice(0, TODO_DESCRIPTION_MAX);
  }

  // eventId
  let eventId: string | null = null;
  if (typeof input.eventId === 'string' && input.eventId.trim()) {
    eventId = input.eventId.trim();
  }

  // deadline
  let deadline: string | null = null;
  if (input.deadline !== undefined && input.deadline !== null && input.deadline !== '') {
    if (!isValidYmd(input.deadline)) {
      return { ok: false, error: 'Deadline invalide (format attendu YYYY-MM-DD).' };
    }
    deadline = input.deadline;
  }

  return {
    ok: true,
    value: { subTeamId, assigneeIds, title, description, eventId, deadline },
  };
}

// Tri des devoirs "à faire" : deadline ascendante en premier (plus proche = plus urgent),
// les sans-deadline à la fin, triés par createdAt desc (plus récent en premier).
export function compareTodosPending(a: TodoRef, b: TodoRef): number {
  const aHasDeadline = a.deadline !== null;
  const bHasDeadline = b.deadline !== null;
  if (aHasDeadline && bHasDeadline) {
    if (a.deadline! < b.deadline!) return -1;
    if (a.deadline! > b.deadline!) return 1;
    return b.createdAt - a.createdAt;
  }
  if (aHasDeadline) return -1;
  if (bHasDeadline) return 1;
  return b.createdAt - a.createdAt;
}

// Tri des devoirs "faits" : doneAt desc (plus récemment coché en premier).
export function compareTodosDone(a: TodoRef, b: TodoRef): number {
  const aDone = a.doneAt ?? a.createdAt;
  const bDone = b.doneAt ?? b.createdAt;
  return bDone - aDone;
}

// Un devoir est "en retard" si sa deadline est strictement antérieure à aujourd'hui
// (en YMD, comparaison string lexicographique safe).
export function isOverdue(todo: TodoRef, todayYmd: string): boolean {
  if (todo.done) return false;
  if (!todo.deadline) return false;
  return todo.deadline < todayYmd;
}
