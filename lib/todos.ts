// Helpers purs pour les devoirs (v2 — types structurés).
// Pas d'accès Firestore ici — toute la logique testable en isolation.

export const TODO_TITLE_MAX = 120;
export const TODO_DESCRIPTION_MAX = 2000;
export const TODO_MAX_ASSIGNEES = 30;
export const TODO_CONFIG_TEXT_MAX = 500;
export const TODO_RESPONSE_MAX = 4000;

// ---------- Types de devoirs ----------

export type TodoType =
  | 'free'            // Tâche libre (fallback historique)
  | 'replay_review'   // Visionnage replay RL avec analyse
  | 'training_pack'   // Training pack RL avec code + objectif
  | 'vod_review'      // Visionnage VOD externe (YouTube/Twitch) + analyse
  | 'scouting'        // Analyse adversaire
  | 'watch_party'     // Visionnage groupé (event calendrier lié)
  | 'mental_checkin'; // Auto-évaluation rapide mental/fitness

export const TODO_TYPES: readonly TodoType[] = [
  'free',
  'replay_review',
  'training_pack',
  'vod_review',
  'scouting',
  'watch_party',
  'mental_checkin',
];

// Métadonnées affichage par type (source de vérité unique, UI + éventuels rapports).
export const TODO_TYPE_META: Record<TodoType, { label: string; short: string; needsResponse: boolean }> = {
  free:           { label: 'Tâche libre',         short: 'Tâche',     needsResponse: false },
  replay_review:  { label: 'Visionnage replay',   short: 'Replay',    needsResponse: true  },
  training_pack:  { label: 'Training pack',       short: 'Training',  needsResponse: true  },
  vod_review:     { label: 'VOD review',          short: 'VOD',       needsResponse: true  },
  scouting:       { label: 'Analyse adversaire',  short: 'Scouting',  needsResponse: true  },
  watch_party:    { label: 'Watch party',         short: 'Watch',     needsResponse: false },
  mental_checkin: { label: 'Check-in mental',     short: 'Check-in',  needsResponse: true  },
};

// ---------- Config par type (défini à la création par le staff) ----------
// Stocké tel quel dans Firestore dans `config`. Objet libre validé selon type.

export interface ReplayReviewConfig {
  replayId: string | null;   // ref vers structure_replays (picker étape 3)
  replayNote: string;        // "Regarde à 2:15, notre rotation défensive"
}
export interface TrainingPackConfig {
  packCode: string;          // ex "A503-264B-9D4C-E4F7"
  objective: string;         // "Passer 80% du pack sans rater de reset"
}
export interface VodReviewConfig {
  url: string;               // lien YouTube / Twitch
  focus: string;             // ce sur quoi le joueur doit se concentrer
}
export interface ScoutingConfig {
  opponent: string;          // nom de l'équipe adverse
}
export interface WatchPartyConfig {
  location: string;          // "Discord #watch-room" ou lien meet
}
export interface MentalCheckinConfig {
  prompts: string[];         // questions à noter /5 (défaut: humeur / énergie / motivation)
}

export type TodoConfig =
  | ({ type: 'free' } & Record<string, never>)
  | ({ type: 'replay_review' } & ReplayReviewConfig)
  | ({ type: 'training_pack' } & TrainingPackConfig)
  | ({ type: 'vod_review' } & VodReviewConfig)
  | ({ type: 'scouting' } & ScoutingConfig)
  | ({ type: 'watch_party' } & WatchPartyConfig)
  | ({ type: 'mental_checkin' } & MentalCheckinConfig);

export const DEFAULT_MENTAL_PROMPTS = ['Humeur', 'Énergie', 'Motivation'];

// ---------- Réponse par type (remplie par le joueur à la validation) ----------

export interface ReplayReviewResponse { analysis: string }
export interface TrainingPackResponse { result: string }
export interface VodReviewResponse { analysis: string }
export interface ScoutingResponse { notes: string }
export interface MentalCheckinResponse { ratings: number[] } // 1-5, longueur = prompts

export type TodoResponse =
  | { type: 'free' }
  | { type: 'watch_party' }
  | ({ type: 'replay_review' } & ReplayReviewResponse)
  | ({ type: 'training_pack' } & TrainingPackResponse)
  | ({ type: 'vod_review' } & VodReviewResponse)
  | ({ type: 'scouting' } & ScoutingResponse)
  | ({ type: 'mental_checkin' } & MentalCheckinResponse);

// ---------- TodoRef ----------

export interface TodoRef {
  id: string;
  structureId: string;
  subTeamId: string;
  assigneeId: string;
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>; // sérialisé tel quel depuis Firestore
  response: Record<string, unknown> | null;
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
  type?: unknown;
  title: unknown;
  description?: unknown;
  config?: unknown;
  eventId?: unknown;
  deadline?: unknown;
}

export interface ValidatedTodoInput {
  subTeamId: string;
  assigneeIds: string[];
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>;
  eventId: string | null;
  deadline: string | null;
}

// ---------- Helpers internes ----------

function isValidYmd(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const d = new Date(input + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === input;
}

function s(v: unknown, max = TODO_CONFIG_TEXT_MAX): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- Validation config par type ----------

// Valide + normalise la config selon le type. Retourne un objet prêt à stocker en Firestore.
// Exclut le champ discriminant `type` du stockage (stocké séparément au top-level du document).
export function validateTodoConfig(
  type: TodoType,
  raw: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (type) {
    case 'free':
    case 'watch_party': {
      if (type === 'watch_party') {
        return { ok: true, value: { location: s(r.location, 200) } };
      }
      return { ok: true, value: {} };
    }
    case 'replay_review': {
      const replayId = typeof r.replayId === 'string' && r.replayId.trim() ? r.replayId.trim() : null;
      return {
        ok: true,
        value: { replayId, replayNote: s(r.replayNote) },
      };
    }
    case 'training_pack': {
      const code = s(r.packCode, 50);
      if (!code) return { ok: false, error: 'Code du training pack requis.' };
      return { ok: true, value: { packCode: code, objective: s(r.objective) } };
    }
    case 'vod_review': {
      const url = s(r.url, 500);
      if (!url) return { ok: false, error: 'Lien VOD requis.' };
      if (!isHttpUrl(url)) return { ok: false, error: 'Lien VOD invalide.' };
      return { ok: true, value: { url, focus: s(r.focus) } };
    }
    case 'scouting': {
      const opponent = s(r.opponent, 120);
      if (!opponent) return { ok: false, error: 'Nom de l\'adversaire requis.' };
      return { ok: true, value: { opponent } };
    }
    case 'mental_checkin': {
      let prompts: string[] = [];
      if (Array.isArray(r.prompts)) {
        prompts = r.prompts
          .map(p => (typeof p === 'string' ? p.trim().slice(0, 60) : ''))
          .filter(p => p.length > 0)
          .slice(0, 6);
      }
      if (prompts.length === 0) prompts = [...DEFAULT_MENTAL_PROMPTS];
      return { ok: true, value: { prompts } };
    }
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return { ok: false, error: 'Type inconnu.' };
    }
  }
}

// ---------- Validation réponse par type (joueur qui valide son devoir) ----------

export function validateTodoResponse(
  type: TodoType,
  raw: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (type) {
    case 'free':
    case 'watch_party':
      return { ok: true, value: {} };
    case 'replay_review':
    case 'vod_review': {
      const analysis = s(r.analysis, TODO_RESPONSE_MAX);
      if (!analysis) return { ok: false, error: 'Une analyse est requise pour valider.' };
      return { ok: true, value: { analysis } };
    }
    case 'training_pack': {
      const result = s(r.result, TODO_RESPONSE_MAX);
      if (!result) return { ok: false, error: 'Ton résultat est requis pour valider.' };
      return { ok: true, value: { result } };
    }
    case 'scouting': {
      const notes = s(r.notes, TODO_RESPONSE_MAX);
      if (!notes) return { ok: false, error: 'Notes de scouting requises.' };
      return { ok: true, value: { notes } };
    }
    case 'mental_checkin': {
      const ratings = Array.isArray(r.ratings) ? r.ratings : [];
      const cleaned: number[] = [];
      for (const x of ratings) {
        const n = typeof x === 'number' ? x : Number(x);
        if (!Number.isFinite(n) || n < 1 || n > 5) {
          return { ok: false, error: 'Chaque note doit être entre 1 et 5.' };
        }
        cleaned.push(Math.round(n));
      }
      if (cleaned.length === 0) return { ok: false, error: 'Aucune note fournie.' };
      return { ok: true, value: { ratings: cleaned } };
    }
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return { ok: false, error: 'Type inconnu.' };
    }
  }
}

// ---------- Validation création ----------

export function validateCreateTodo(
  input: CreateTodoInput
): { ok: true; value: ValidatedTodoInput } | { ok: false; error: string } {
  if (typeof input.subTeamId !== 'string' || !input.subTeamId.trim()) {
    return { ok: false, error: 'Équipe manquante.' };
  }
  const subTeamId = input.subTeamId.trim();

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

  // type — rétrocompat : absent ou invalide → 'free'
  let type: TodoType = 'free';
  if (typeof input.type === 'string' && (TODO_TYPES as readonly string[]).includes(input.type)) {
    type = input.type as TodoType;
  }

  if (typeof input.title !== 'string' || !input.title.trim()) {
    return { ok: false, error: 'Le titre est obligatoire.' };
  }
  const title = input.title.trim().slice(0, TODO_TITLE_MAX);

  let description = '';
  if (typeof input.description === 'string') {
    description = input.description.trim().slice(0, TODO_DESCRIPTION_MAX);
  }

  const configResult = validateTodoConfig(type, input.config);
  if (!configResult.ok) return { ok: false, error: configResult.error };

  let eventId: string | null = null;
  if (typeof input.eventId === 'string' && input.eventId.trim()) {
    eventId = input.eventId.trim();
  }

  let deadline: string | null = null;
  if (input.deadline !== undefined && input.deadline !== null && input.deadline !== '') {
    if (!isValidYmd(input.deadline)) {
      return { ok: false, error: 'Deadline invalide (format attendu YYYY-MM-DD).' };
    }
    deadline = input.deadline as string;
  }

  return {
    ok: true,
    value: { subTeamId, assigneeIds, type, title, description, config: configResult.value, eventId, deadline },
  };
}

// ---------- Tri & retard (inchangés depuis v1) ----------

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

export function compareTodosDone(a: TodoRef, b: TodoRef): number {
  const aDone = a.doneAt ?? a.createdAt;
  const bDone = b.doneAt ?? b.createdAt;
  return bDone - aDone;
}

export function isOverdue(todo: TodoRef, todayYmd: string): boolean {
  if (todo.done) return false;
  if (!todo.deadline) return false;
  return todo.deadline < todayYmd;
}
