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
export interface TrainingPackItem {
  code: string;              // ex "A503-264B-9D4C-E4F7"
  objective: string;         // "80% sans rater de reset" — optionnel, spécifique à ce pack
}
export interface TrainingPackConfig {
  packs: TrainingPackItem[]; // au moins 1 pack à la création, max TRAINING_PACKS_MAX
}
export const TRAINING_PACKS_MAX = 10;

// Deadline relative à un event : offset en jours autour de l'event.
//  - négatif : N jours AVANT (ex: -1 = la veille, pour un training pack / check-in à faire avant un match)
//  - 0 : le jour même
//  - positif : N jours APRÈS (ex: +1 = le lendemain, pour une analyse post-match)
// Bornes symétriques : ±30 jours.
export const DEADLINE_OFFSET_DAYS_MAX = 30;
export const DEADLINE_OFFSET_DAYS_MIN = -30;
export const DEADLINE_OFFSET_PRESETS: readonly number[] = [-2, -1, 0, 1, 2, 7];
export type DeadlineMode = 'absolute' | 'relative';
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
export interface TrainingPackResult { done: boolean; note: string }
export interface TrainingPackResponse { results: TrainingPackResult[]; comment: string }
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
  deadline: string | null;  // "YYYY-MM-DD" ou null — jour de la deadline en heure Paris (pour affichage + tri secondaire)
  deadlineAt: number | null; // ms epoch — moment exact où la deadline tombe (source de vérité pour isOverdue/tri)
  deadlineMode: DeadlineMode | null;  // null = pas de deadline ; 'absolute' = fixée ; 'relative' = calée sur event.startsAt
  deadlineOffsetDays: number | null;  // uniquement si mode='relative' — N jours autour de event.startsAt (0 = au début de l'event)
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
  deadlineMode?: unknown;
  deadlineOffsetDays?: unknown;
}

export interface ValidatedTodoInput {
  subTeamId: string;
  assigneeIds: string[];
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>;
  eventId: string | null;
  deadline: string | null;   // YMD Paris — pour absolute, calculé côté API pour relative
  deadlineAt: number | null; // ms epoch — idem : null pour relative (API calcule depuis event.startsAt)
  deadlineMode: DeadlineMode | null;
  deadlineOffsetDays: number | null;
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

// Normalise un config training_pack en `TrainingPackItem[]` pour l'UI.
// Accepte forme canonique { packs: [...] } ou ancienne { packCode, objective }.
// Retourne toujours au moins 1 ligne (ajoute une ligne vide si config absent).
export function normalizeTrainingPacks(config: Record<string, unknown> | null | undefined): TrainingPackItem[] {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const out: TrainingPackItem[] = [];
  if (Array.isArray(c.packs)) {
    for (const p of c.packs) {
      if (!p || typeof p !== 'object') continue;
      const pr = p as Record<string, unknown>;
      const code = typeof pr.code === 'string' ? pr.code : (typeof pr.packCode === 'string' ? pr.packCode : '');
      const objective = typeof pr.objective === 'string' ? pr.objective : '';
      out.push({ code, objective });
    }
  } else if (typeof c.packCode === 'string' || typeof c.objective === 'string') {
    out.push({
      code: typeof c.packCode === 'string' ? c.packCode : '',
      objective: typeof c.objective === 'string' ? c.objective : '',
    });
  }
  if (out.length === 0) out.push({ code: '', objective: '' });
  return out;
}

// Formate un ms epoch en YYYY-MM-DD dans le fuseau Europe/Paris.
export function parisYmd(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

// Fin de journée Paris (23:59:59.999) pour un YMD donné, renvoyée en ms epoch.
// Gère CET (+1, hiver) et CEST (+2, été) en testant l'heure Paris effective de chaque candidat :
// on retient celui dont l'heure locale Paris est bien 23:59.
// Le simple round-trip via parisYmd ne suffit pas (les deux candidats tombent sur le même YMD).
const parisHourFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export function endOfDayParisMs(ymd: string): number {
  const parts = ymd.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  for (const utcHour of [21, 22]) {
    const ms = Date.UTC(y, m - 1, d, utcHour, 59, 59, 999);
    if (parisHourFmt.format(new Date(ms)) === '23:59') return ms;
  }
  // Ne devrait pas arriver sauf bug env : fallback CET.
  return Date.UTC(y, m - 1, d, 22, 59, 59, 999);
}

// Calcule une deadline précise (ms epoch) à partir d'un event et d'un offset en jours.
// Sémantique option A : offsetDays=0 → deadline = event.startsAt (au début de l'event).
//  -1 → 24h avant event.startsAt
//  +1 → 24h après event.startsAt
// Usage : check-in mental / training pack avec offset 0 = à rendre avant le kick-off du match.
export function computeRelativeDeadlineAt(eventStartsAtMs: number, offsetDays: number): number {
  return eventStartsAtMs + offsetDays * 86400000;
}

// Legacy/compat : renvoie uniquement le jour Paris de la deadline relative.
// Conservé pour éviter de casser les imports existants mais préfère computeRelativeDeadlineAt.
export function computeRelativeDeadline(eventStartsAtMs: number, offsetDays: number): string {
  return parisYmd(computeRelativeDeadlineAt(eventStartsAtMs, offsetDays));
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
      // Forme canonique : { packs: [{ code, objective }] }.
      // Compat ascendante : si `packs` absent mais ancien `packCode` présent, on convertit.
      const rawPacks: unknown[] = Array.isArray(r.packs)
        ? (r.packs as unknown[])
        : (typeof r.packCode === 'string' ? [{ code: r.packCode, objective: r.objective }] : []);
      const packs: TrainingPackItem[] = [];
      for (const p of rawPacks) {
        if (!p || typeof p !== 'object') continue;
        const pr = p as Record<string, unknown>;
        const code = s(pr.code ?? pr.packCode, 50);
        if (!code) continue;
        packs.push({ code, objective: s(pr.objective, 500) });
      }
      if (packs.length === 0) return { ok: false, error: 'Au moins un training pack (avec code) est requis.' };
      if (packs.length > TRAINING_PACKS_MAX) {
        return { ok: false, error: `Trop de packs (max ${TRAINING_PACKS_MAX}).` };
      }
      return { ok: true, value: { packs } };
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
      // results[i] = { done, note } aligné avec config.packs[i] (longueur identique côté joueur).
      // Au moins une case cochée OU un commentaire non vide.
      const rawResults = Array.isArray(r.results) ? r.results : [];
      const results: TrainingPackResult[] = [];
      for (const x of rawResults) {
        if (!x || typeof x !== 'object') {
          results.push({ done: false, note: '' });
          continue;
        }
        const xr = x as Record<string, unknown>;
        results.push({
          done: xr.done === true,
          note: s(xr.note, 500),
        });
      }
      const comment = s(r.comment, TODO_RESPONSE_MAX);
      const anyDone = results.some(x => x.done);
      if (!anyDone && !comment) {
        return { ok: false, error: 'Coche au moins un pack réussi ou laisse un commentaire pour valider.' };
      }
      return { ok: true, value: { results, comment } };
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

  // Deadline : deux modes.
  //  - 'absolute' : YYYY-MM-DD fournie directement → deadlineAt = fin de journée Paris de cette date.
  //  - 'relative' : offset en jours appliqué à event.startsAt → nécessite eventId. La valeur concrète
  //    est calculée côté API (accès DB pour lire startsAt), pas ici — donc deadline/deadlineAt null.
  let deadlineMode: DeadlineMode | null = null;
  let deadlineOffsetDays: number | null = null;
  let deadline: string | null = null;
  let deadlineAt: number | null = null;

  if (input.deadlineMode === 'relative') {
    if (!eventId) {
      return { ok: false, error: 'Deadline relative : un event doit être lié.' };
    }
    const off = typeof input.deadlineOffsetDays === 'number'
      ? input.deadlineOffsetDays
      : Number(input.deadlineOffsetDays);
    if (!Number.isFinite(off) || !Number.isInteger(off)) {
      return { ok: false, error: 'Offset de deadline invalide (entier requis).' };
    }
    if (off < DEADLINE_OFFSET_DAYS_MIN || off > DEADLINE_OFFSET_DAYS_MAX) {
      return { ok: false, error: `Offset de deadline hors limites (${DEADLINE_OFFSET_DAYS_MIN} à ${DEADLINE_OFFSET_DAYS_MAX} jours).` };
    }
    deadlineMode = 'relative';
    deadlineOffsetDays = off;
    // deadline / deadlineAt restent null ici — l'API les calcule via computeRelativeDeadlineAt().
  } else if (input.deadline !== undefined && input.deadline !== null && input.deadline !== '') {
    if (!isValidYmd(input.deadline)) {
      return { ok: false, error: 'Deadline invalide (format attendu YYYY-MM-DD).' };
    }
    deadline = input.deadline as string;
    deadlineAt = endOfDayParisMs(deadline);
    deadlineMode = 'absolute';
  }

  return {
    ok: true,
    value: {
      subTeamId, assigneeIds, type, title, description,
      config: configResult.value,
      eventId, deadline, deadlineAt, deadlineMode, deadlineOffsetDays,
    },
  };
}

// ---------- Tri & retard (inchangés depuis v1) ----------

// Source de vérité = deadlineAt (ms). Si absent (ancien doc), fallback via fin de journée Paris du YMD.
function effectiveDeadlineMs(todo: TodoRef): number | null {
  if (typeof todo.deadlineAt === 'number') return todo.deadlineAt;
  if (todo.deadline) return endOfDayParisMs(todo.deadline);
  return null;
}

export function compareTodosPending(a: TodoRef, b: TodoRef): number {
  const aMs = effectiveDeadlineMs(a);
  const bMs = effectiveDeadlineMs(b);
  if (aMs !== null && bMs !== null) {
    if (aMs !== bMs) return aMs - bMs;
    return b.createdAt - a.createdAt;
  }
  if (aMs !== null) return -1;
  if (bMs !== null) return 1;
  return b.createdAt - a.createdAt;
}

export function compareTodosDone(a: TodoRef, b: TodoRef): number {
  const aDone = a.doneAt ?? a.createdAt;
  const bDone = b.doneAt ?? b.createdAt;
  return bDone - aDone;
}

// Un devoir est en retard si on a dépassé l'instant précis de sa deadline.
// Avec l'option A, un devoir avec offset=0 et match à 18:00 est overdue à 18:01, pas le lendemain.
export function isOverdue(todo: TodoRef, nowMs: number): boolean {
  if (todo.done) return false;
  const ms = effectiveDeadlineMs(todo);
  if (ms === null) return false;
  return nowMs > ms;
}
