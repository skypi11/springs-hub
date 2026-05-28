// Helpers purs pour les exercices (v2, types structurés).
// Pas d'accès Firestore ici, toute la logique testable en isolation.

export const TODO_TITLE_MAX = 120;
export const TODO_DESCRIPTION_MAX = 2000;
export const TODO_MAX_ASSIGNEES = 30;
export const TODO_CONFIG_TEXT_MAX = 500;
export const TODO_RESPONSE_MAX = 4000;

// ---------- Types de exercices ----------
// Refonte 2026-05-26 : retiré `watch_party` (= event social, pas un exercice)
// et `scouting` (couvert par `vod_review`). Ajouté `workshop_map` (essentiel RL)
// et `free_play` (pratique libre chronométrée).
//
// Les anciens types restent dans l'union TodoType (pour ne pas casser les anciens
// docs en base et les types TS). On les liste comme `DEPRECATED_TODO_TYPES` :
//   - acceptés par validateExerciseStep (pas de fallback 'free')
//   - PAS exposés dans le picker UI (TODO_TYPES = canonical seulement)
//   - leurs labels/metas restent dans TODO_TYPE_META

export type TodoType =
  | 'free'            // Tâche libre (fallback historique), CROSS-JEUX
  | 'replay_review'   // Visionnage replay RL avec analyse, RL only
  | 'training_pack'   // Training pack RL avec code + objectif, RL only
  | 'workshop_map'    // Map Steam Workshop (passing, dribbles, etc.), RL/CS principalement
  | 'free_play'       // Pratique libre chronométrée avec focus, RL surtout
  | 'vod_review'      // Visionnage VOD externe (YouTube/Twitch) + analyse, CROSS-JEUX
  | 'mental_checkin'  // Auto-évaluation rapide mental/fitness, CROSS-JEUX
  // FPS / Valorant (ajoutés 2026-05-27)
  | 'aim_trainer'     // Session Aimlabs/Kovaak's/Range Val avec scénario + score cible
  | 'lineups'         // Apprendre des lineups smokes/flashs par agent par map
  | 'custom_game'     // Custom 1v1 aim duels, 5v5 scrim custom
  | 'warmup_routine'  // Routine warm-up structurée avant scrim/match, CROSS-JEUX
  // Deprecated 2026-05-26, gardés pour rétrocompat lecture, plus créables
  | 'scouting'
  | 'watch_party';

/** Types canonical exposés dans le picker UI (création nouveaux exos/templates).
 * Filtré par jeu via GameDef.availableTodoTypes côté NewTodoForm, la liste
 * complète ici sert de référence pour la validation server-side (qui accepte
 * tous les types canoniques, peu importe le jeu). */
export const TODO_TYPES: readonly TodoType[] = [
  'free',
  'replay_review',
  'training_pack',
  'workshop_map',
  'free_play',
  'vod_review',
  'mental_checkin',
  // FPS / Valorant
  'aim_trainer',
  'lineups',
  'custom_game',
  'warmup_routine',
];

/** Types deprecated, acceptés en lecture pour les anciens docs, pas en création. */
export const DEPRECATED_TODO_TYPES: readonly TodoType[] = ['scouting', 'watch_party'];

/** Union complète (canonical + deprecated), utilisé par les validateurs. */
export const TODO_TYPES_ALL: readonly TodoType[] = [...TODO_TYPES, ...DEPRECATED_TODO_TYPES];

// Métadonnées affichage par type (source de vérité unique, UI + éventuels rapports).
export const TODO_TYPE_META: Record<TodoType, { label: string; short: string; needsResponse: boolean }> = {
  free:           { label: 'Tâche libre',          short: 'Tâche',     needsResponse: false },
  replay_review:  { label: 'Visionnage replay',    short: 'Replay',    needsResponse: true  },
  training_pack:  { label: 'Training pack',        short: 'Training',  needsResponse: true  },
  workshop_map:   { label: 'Map Workshop',         short: 'Workshop',  needsResponse: true  },
  free_play:      { label: 'Free play',            short: 'Freeplay',  needsResponse: true  },
  vod_review:     { label: 'VOD review',           short: 'VOD',       needsResponse: true  },
  mental_checkin: { label: 'Check-in mental',      short: 'Check-in',  needsResponse: true  },
  // FPS / Valorant
  aim_trainer:    { label: 'Aim trainer',          short: 'Aim',       needsResponse: true  },
  lineups:        { label: 'Lineups',              short: 'Lineups',   needsResponse: true  },
  custom_game:    { label: 'Custom game',          short: 'Custom',    needsResponse: true  },
  warmup_routine: { label: 'Routine warm-up',      short: 'Warm-up',   needsResponse: false },
  // Deprecated, affichage maintenu pour les anciens docs uniquement
  scouting:       { label: 'Analyse adversaire',   short: 'Scouting',  needsResponse: true  },
  watch_party:    { label: 'Watch party',          short: 'Watch',     needsResponse: false },
};

// ---------- Config par type (défini à la création par le staff) ----------
// Stocké tel quel dans Firestore dans `config`. Objet libre validé selon type.

export interface ReplayReviewConfig {
  // Multi-replays (BO5 = plusieurs games à regarder). On garde aussi
  // l'ancien `replayId` pour rétrocompat des vieux todos en base, au runtime,
  // on lit replayIds en priorité, fallback sur [replayId] si présent.
  replayIds: string[];       // refs vers structure_replays
  replayId?: string | null;  // @deprecated, vieux format mono-replay
  replayNote: string;        // "Regarde à 2:15, notre rotation défensive"
}
export interface TrainingPackItem {
  code: string;              // ex "A503-264B-9D4C-E4F7"
  objective: string;         // "80% sans rater de reset", optionnel, spécifique à ce pack
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
export interface WorkshopMapConfig {
  code: string;              // code Steam Workshop OU URL "https://steamcommunity.com/sharedfiles/filedetails/?id=..."
  objective: string;         // ce qu'on veut accomplir (ex: "10 wall reads consécutifs sans rater")
}
export interface FreePlayConfig {
  durationMinutes: number;   // durée cible en minutes (5-180)
  focus: string;             // sur quoi se concentrer (ex: "wall dribbles + recoveries")
}
export const FREEPLAY_MIN_MINUTES = 5;
export const FREEPLAY_MAX_MINUTES = 180;

// ── FPS / Valorant (2026-05-27) ─────────────────────────────────────────────
export interface AimTrainerConfig {
  software: string;          // "Aimlabs", "Kovaak's", "Range Valorant", autre…
  scenario: string;          // nom du scénario / playlist
  targetScore?: number;      // score cible optionnel
  focus: string;             // ex: "tracking long range", "click timing"
}
export interface LineupsConfig {
  agent: string;             // "Sage", "Brimstone", "Cypher"…
  map: string;               // "Ascent", "Haven", "Bind"…
  count: number;             // nombre de lineups à apprendre dans cette session
  notes: string;             // contexte / source / focus
}
export const LINEUPS_MIN_COUNT = 1;
export const LINEUPS_MAX_COUNT = 20;
export interface CustomGameConfig {
  mode: string;              // "1v1 aim duels", "5v5 scrim custom", "Deathmatch focus"
  durationMinutes: number;   // 5-180
  focus: string;             // ce qu'on doit travailler
}
export interface WarmupRoutineConfig {
  durationMinutes: number;   // 5-90, durée cible totale
  steps: string[];           // mini-tâches "200 kills DM", "50 wall reads", etc.
}
export const WARMUP_MIN_MINUTES = 5;
export const WARMUP_MAX_MINUTES = 90;
export const WARMUP_MAX_STEPS = 10;

export type TodoConfig =
  | ({ type: 'free' } & Record<string, never>)
  | ({ type: 'replay_review' } & ReplayReviewConfig)
  | ({ type: 'training_pack' } & TrainingPackConfig)
  | ({ type: 'vod_review' } & VodReviewConfig)
  | ({ type: 'scouting' } & ScoutingConfig)
  | ({ type: 'watch_party' } & WatchPartyConfig)
  | ({ type: 'mental_checkin' } & MentalCheckinConfig)
  | ({ type: 'aim_trainer' } & AimTrainerConfig)
  | ({ type: 'lineups' } & LineupsConfig)
  | ({ type: 'custom_game' } & CustomGameConfig)
  | ({ type: 'warmup_routine' } & WarmupRoutineConfig);

export const DEFAULT_MENTAL_PROMPTS = ['Humeur', 'Énergie', 'Motivation'];

// ---------- Réponse par type (remplie par le joueur à la validation) ----------

export interface ReplayReviewResponse { analysis: string }
export interface TrainingPackResult { done: boolean; note: string }
export interface TrainingPackResponse { results: TrainingPackResult[]; comment: string }
export interface VodReviewResponse { analysis: string }
export interface ScoutingResponse { notes: string }
export interface MentalCheckinResponse { ratings: number[] } // 1-5, longueur = prompts
export interface AimTrainerResponse { scoreAchieved?: number; notes: string }
export interface LineupsResponse { countLearned: number; notes: string }
export interface CustomGameResponse { result: string; notes: string }

export type TodoResponse =
  | { type: 'free' }
  | { type: 'watch_party' }
  | { type: 'warmup_routine' }
  | ({ type: 'replay_review' } & ReplayReviewResponse)
  | ({ type: 'training_pack' } & TrainingPackResponse)
  | ({ type: 'vod_review' } & VodReviewResponse)
  | ({ type: 'scouting' } & ScoutingResponse)
  | ({ type: 'mental_checkin' } & MentalCheckinResponse)
  | ({ type: 'aim_trainer' } & AimTrainerResponse)
  | ({ type: 'lineups' } & LineupsResponse)
  | ({ type: 'custom_game' } & CustomGameResponse);

// ---------- EXERCICES MULTI-STEPS (v3, 2026-05-26) ----------
//
// Un exercice n'est plus un type+config unique mais une LISTE de steps,
// chaque step ayant son propre type/config/réponse/état completed.
//
// Stratégie compat ascendante :
//   - Les anciens docs (sans `steps[]`) sont automatiquement vus comme un
//     exo à 1 step via `getSteps()` (wrap { type, config, response, done } legacy).
//   - Les nouveaux docs sont écrits avec `steps[]` ET maintenir `type='free'`
//     + `config={}` au top-level pour les composants pas encore migrés.
//   - Le champ top-level `done` est toujours maintenu (calculé = tous steps
//     completed) pour le tri/comptage rapide sans avoir à lire `steps`.

export const TODO_MAX_STEPS = 10;

export interface ExerciseStep {
  id: string;                              // uuid local (drag&drop + cocher individuellement)
  type: TodoType;                           // un des TODO_TYPES
  label?: string;                           // titre custom optionnel (sinon TODO_TYPE_META[type].label)
  config: Record<string, unknown>;          // config spécifique au type (mêmes validateurs que `config` legacy)
  // ── État côté joueur ────────────────────────────────────────────────────
  response?: Record<string, unknown> | null; // réponse (si TODO_TYPE_META[type].needsResponse)
  completed?: boolean;                       // case cochée par le joueur
  completedAt?: number | null;               // ms epoch
  completedBy?: string | null;
}

// Lecture défensive : renvoie toujours un tableau de steps, même pour les
// anciens docs single-type (wrap en 1 step legacy).
export function getSteps(todo: { steps?: unknown; type?: unknown; config?: unknown; response?: unknown; done?: unknown; doneAt?: unknown; doneBy?: unknown; title?: unknown }): ExerciseStep[] {
  if (Array.isArray(todo.steps) && todo.steps.length > 0) {
    return todo.steps.filter((s): s is ExerciseStep =>
      !!s && typeof s === 'object' && typeof (s as ExerciseStep).id === 'string'
    );
  }
  // Legacy : wrap l'ancien { type, config, response } en un step unique.
  const legacyType: TodoType = (typeof todo.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(todo.type))
    ? todo.type as TodoType
    : 'free';
  return [{
    id: 'legacy',
    type: legacyType,
    config: (todo.config && typeof todo.config === 'object' ? todo.config : {}) as Record<string, unknown>,
    response: (todo.response && typeof todo.response === 'object' ? todo.response : null) as Record<string, unknown> | null,
    completed: todo.done === true,
    completedAt: typeof todo.doneAt === 'number' ? todo.doneAt : null,
    completedBy: typeof todo.doneBy === 'string' ? todo.doneBy : null,
  }];
}

export type TodoStatus = 'pending' | 'in_progress' | 'done';

// Calcule le statut global d'un exercice à partir de ses steps.
// - 'done'        : TOUS les steps completed
// - 'in_progress' : au moins 1 step completed mais pas tous
// - 'pending'    : 0 step completed
export function computeTodoStatus(todo: Parameters<typeof getSteps>[0]): TodoStatus {
  const steps = getSteps(todo);
  if (steps.length === 0) return 'pending';
  const doneCount = steps.filter(s => s.completed === true).length;
  if (doneCount === 0) return 'pending';
  if (doneCount === steps.length) return 'done';
  return 'in_progress';
}

// Compteur affiché dans les cards : "2/4 étapes".
export function getStepProgress(todo: Parameters<typeof getSteps>[0]): { done: number; total: number } {
  const steps = getSteps(todo);
  return { done: steps.filter(s => s.completed === true).length, total: steps.length };
}

// Valide + normalise un step côté création/édition.
export function validateExerciseStep(
  raw: unknown,
): { ok: true; value: ExerciseStep } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Step invalide.' };
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.trim()
    ? r.id.trim().slice(0, 64)
    : `step-${Math.random().toString(36).slice(2, 10)}`;

  const type: TodoType = (typeof r.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(r.type))
    ? r.type as TodoType
    : 'free';

  const configResult = validateTodoConfig(type, r.config);
  if (!configResult.ok) return { ok: false, error: `Step "${type}" : ${configResult.error}` };

  const step: ExerciseStep = {
    id,
    type,
    config: configResult.value,
    completed: false,
  };
  if (typeof r.label === 'string' && r.label.trim()) {
    step.label = r.label.trim().slice(0, TODO_TITLE_MAX);
  }
  return { ok: true, value: step };
}

// Valide une liste de steps pour création/édition d'exercice.
export function validateSteps(
  raw: unknown,
): { ok: true; value: ExerciseStep[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Les steps doivent être un tableau.' };
  if (raw.length === 0) return { ok: false, error: 'Au moins une étape requise.' };
  if (raw.length > TODO_MAX_STEPS) return { ok: false, error: `Trop d'étapes (max ${TODO_MAX_STEPS}).` };
  const steps: ExerciseStep[] = [];
  const seenIds = new Set<string>();
  for (const r of raw) {
    const res = validateExerciseStep(r);
    if (!res.ok) return res;
    // Garantir l'unicité des ids dans le tableau
    let finalId = res.value.id;
    while (seenIds.has(finalId)) {
      finalId = `${res.value.id}-${Math.random().toString(36).slice(2, 6)}`;
    }
    seenIds.add(finalId);
    steps.push({ ...res.value, id: finalId });
  }
  return { ok: true, value: steps };
}

// Validation de la réponse d'un step (utilisée à l'API PATCH toggleStep).
// Délègue à validateTodoResponse selon le type du step.
export function validateStepResponse(
  stepType: TodoType,
  raw: unknown,
): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  // Pour les types sans réponse, on accepte null/undefined.
  if (!TODO_TYPE_META[stepType].needsResponse) {
    return { ok: true, value: null };
  }
  return validateTodoResponse(stepType, raw);
}

// ---------- TodoRef ----------

export interface TodoRef {
  id: string;
  structureId: string;
  subTeamId: string;
  assigneeId: string;
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>; // sérialisé tel quel depuis Firestore (legacy, vide pour les exos multi-step)
  response: Record<string, unknown> | null;
  // Nouveau format multi-steps (2026-05-26). Si absent, l'exo est un legacy
  // single-type wrap automatiquement en 1 step via getSteps().
  steps?: ExerciseStep[];
  eventId: string | null;
  deadline: string | null;  // "YYYY-MM-DD" ou null, jour de la deadline en heure Paris (pour affichage + tri secondaire)
  deadlineAt: number | null; // ms epoch, moment exact où la deadline tombe (source de vérité pour isOverdue/tri)
  deadlineMode: DeadlineMode | null;  // null = pas de deadline ; 'absolute' = fixée ; 'relative' = calée sur event.startsAt
  deadlineOffsetDays: number | null;  // uniquement si mode='relative', N jours autour de event.startsAt (0 = au début de l'event)
  done: boolean;            // calculé = tous les steps completed (maintenu top-level pour le tri/count rapide)
  doneAt: number | null;    // ms epoch, instant où le dernier step a été coché
  doneBy: string | null;
  // Verrouillage v3 : une fois lockedAt set, le joueur ne peut plus modifier ses
  // réponses ni décocher de steps. Action explicite via "Verrouiller l'exercice"
  // après que tous les steps soient cochés. Un staff peut forcer la réouverture.
  lockedAt?: number | null;
  lockedBy?: string | null;
  createdBy: string;
  createdAt: number;        // ms epoch
}

export interface CreateTodoInput {
  subTeamId: unknown;
  assigneeIds: unknown;
  // Nouveau format multi-steps. Si fourni, prend le pas sur type+config.
  steps?: unknown;
  // Format legacy (rétrocompat, encore utilisé par seed dev et anciens clients).
  // Si steps[] absent, on wrap type+config en un step unique en aval.
  type?: unknown;
  title: unknown;
  description?: unknown;
  config?: unknown;
  eventId?: unknown;
  deadline?: unknown;
  deadlineMode?: unknown;
  deadlineOffsetDays?: unknown;
  postToChannel?: unknown;
}

export interface ValidatedTodoInput {
  subTeamId: string;
  assigneeIds: string[];
  // Source de vérité v3 : la liste des steps. Toujours présente après validation
  // (les inputs legacy single-type sont wrappés en 1 step ici).
  steps: ExerciseStep[];
  // Champs legacy maintenus pour rétrocompat des composants/cron pas encore migrés.
  // - `type` = type du 1er step (ou 'free')
  // - `config` = config du 1er step (peu utile mais évite undefined)
  type: TodoType;
  title: string;
  description: string;
  config: Record<string, unknown>;
  eventId: string | null;
  deadline: string | null;   // YMD Paris, pour absolute, calculé côté API pour relative
  deadlineAt: number | null; // ms epoch, idem : null pour relative (API calcule depuis event.startsAt)
  deadlineMode: DeadlineMode | null;
  deadlineOffsetDays: number | null;
  postToChannel: boolean;    // true = publier aussi dans le channel Discord de l'équipe (visible par tous).
                              // DM à l'assigné est envoyé dans tous les cas. Par défaut false : privé.
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
      // Multi-replays : on lit `replayIds` en priorité (nouveau format),
      // fallback sur `replayId` mono (ancien format).
      const rawIds = Array.isArray(r.replayIds) ? r.replayIds : null;
      let replayIds: string[] = [];
      if (rawIds) {
        replayIds = rawIds
          .map(id => typeof id === 'string' ? id.trim() : '')
          .filter(id => id.length > 0);
      } else if (typeof r.replayId === 'string' && r.replayId.trim()) {
        replayIds = [r.replayId.trim()];
      }
      return {
        ok: true,
        value: { replayIds, replayNote: s(r.replayNote) },
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
    case 'workshop_map': {
      const code = s(r.code, 500);
      if (!code) return { ok: false, error: 'Code Workshop ou URL Steam requis.' };
      return { ok: true, value: { code, objective: s(r.objective, 500) } };
    }
    case 'free_play': {
      let durationMinutes = typeof r.durationMinutes === 'number'
        ? r.durationMinutes
        : Number(r.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < FREEPLAY_MIN_MINUTES) {
        durationMinutes = FREEPLAY_MIN_MINUTES;
      }
      if (durationMinutes > FREEPLAY_MAX_MINUTES) durationMinutes = FREEPLAY_MAX_MINUTES;
      const focus = s(r.focus, 500);
      if (!focus) return { ok: false, error: 'Indique sur quoi se concentrer pendant le free play.' };
      return { ok: true, value: { durationMinutes: Math.round(durationMinutes), focus } };
    }
    case 'aim_trainer': {
      const software = s(r.software, 60);
      const scenario = s(r.scenario, 120);
      if (!software) return { ok: false, error: 'Indique le logiciel (Aimlabs, Kovaak\'s, Range Val…).' };
      if (!scenario) return { ok: false, error: 'Indique le scénario à jouer.' };
      const focus = s(r.focus, 500);
      let targetScore: number | undefined;
      if (r.targetScore !== undefined && r.targetScore !== null && r.targetScore !== '') {
        const n = typeof r.targetScore === 'number' ? r.targetScore : Number(r.targetScore);
        if (Number.isFinite(n) && n > 0) targetScore = Math.round(n);
      }
      return { ok: true, value: { software, scenario, focus, ...(targetScore !== undefined ? { targetScore } : {}) } };
    }
    case 'lineups': {
      const agent = s(r.agent, 60);
      const map = s(r.map, 60);
      if (!agent) return { ok: false, error: 'Indique l\'agent concerné.' };
      if (!map) return { ok: false, error: 'Indique la map concernée.' };
      let count = typeof r.count === 'number' ? r.count : Number(r.count);
      if (!Number.isFinite(count) || count < LINEUPS_MIN_COUNT) count = LINEUPS_MIN_COUNT;
      if (count > LINEUPS_MAX_COUNT) count = LINEUPS_MAX_COUNT;
      return { ok: true, value: { agent, map, count: Math.round(count), notes: s(r.notes, 500) } };
    }
    case 'custom_game': {
      const mode = s(r.mode, 120);
      if (!mode) return { ok: false, error: 'Indique le mode (1v1 aim duels, 5v5 scrim custom…).' };
      let durationMinutes = typeof r.durationMinutes === 'number'
        ? r.durationMinutes
        : Number(r.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < FREEPLAY_MIN_MINUTES) {
        durationMinutes = FREEPLAY_MIN_MINUTES;
      }
      if (durationMinutes > FREEPLAY_MAX_MINUTES) durationMinutes = FREEPLAY_MAX_MINUTES;
      const focus = s(r.focus, 500);
      return { ok: true, value: { mode, durationMinutes: Math.round(durationMinutes), focus } };
    }
    case 'warmup_routine': {
      let durationMinutes = typeof r.durationMinutes === 'number'
        ? r.durationMinutes
        : Number(r.durationMinutes);
      if (!Number.isFinite(durationMinutes) || durationMinutes < WARMUP_MIN_MINUTES) {
        durationMinutes = WARMUP_MIN_MINUTES;
      }
      if (durationMinutes > WARMUP_MAX_MINUTES) durationMinutes = WARMUP_MAX_MINUTES;
      const rawSteps = Array.isArray(r.steps) ? r.steps : [];
      const steps = rawSteps
        .map(x => (typeof x === 'string' ? x.trim().slice(0, 200) : ''))
        .filter(x => x.length > 0)
        .slice(0, WARMUP_MAX_STEPS);
      if (steps.length === 0) return { ok: false, error: 'Ajoute au moins une étape (ex: "200 kills DM").' };
      return { ok: true, value: { durationMinutes: Math.round(durationMinutes), steps } };
    }
    default: {
      const _exhaustive: never = type;
      void _exhaustive;
      return { ok: false, error: 'Type inconnu.' };
    }
  }
}

// ---------- Validation réponse par type (joueur qui valide son exercice) ----------

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
    case 'workshop_map': {
      // Réponse libre : résultat de la session sur la map (ex: "9/10 wall reads").
      const result = s(r.result, TODO_RESPONSE_MAX);
      if (!result) return { ok: false, error: 'Indique ton résultat sur la map.' };
      return { ok: true, value: { result } };
    }
    case 'free_play': {
      // Notes libres + temps effectif (optionnel, peut différer du durationMinutes cible).
      const notes = s(r.notes, TODO_RESPONSE_MAX);
      if (!notes) return { ok: false, error: 'Indique ce que tu as travaillé pendant ton free play.' };
      let actualMinutes: number | null = null;
      if (r.actualMinutes !== undefined && r.actualMinutes !== null && r.actualMinutes !== '') {
        const n = typeof r.actualMinutes === 'number' ? r.actualMinutes : Number(r.actualMinutes);
        if (Number.isFinite(n) && n > 0 && n <= 600) actualMinutes = Math.round(n);
      }
      return { ok: true, value: { notes, ...(actualMinutes !== null ? { actualMinutes } : {}) } };
    }
    case 'warmup_routine':
      // Bouton "fait", pas de saisie spécifique requise.
      return { ok: true, value: {} };
    case 'aim_trainer': {
      const notes = s(r.notes, TODO_RESPONSE_MAX);
      if (!notes) return { ok: false, error: 'Décris brièvement ta session (score, ressentis…).' };
      let scoreAchieved: number | undefined;
      if (r.scoreAchieved !== undefined && r.scoreAchieved !== null && r.scoreAchieved !== '') {
        const n = typeof r.scoreAchieved === 'number' ? r.scoreAchieved : Number(r.scoreAchieved);
        if (Number.isFinite(n) && n >= 0) scoreAchieved = Math.round(n);
      }
      return { ok: true, value: { notes, ...(scoreAchieved !== undefined ? { scoreAchieved } : {}) } };
    }
    case 'lineups': {
      const notes = s(r.notes, TODO_RESPONSE_MAX);
      let countLearned = typeof r.countLearned === 'number' ? r.countLearned : Number(r.countLearned);
      if (!Number.isFinite(countLearned) || countLearned < 0) countLearned = 0;
      if (countLearned > LINEUPS_MAX_COUNT) countLearned = LINEUPS_MAX_COUNT;
      if (countLearned === 0 && !notes) {
        return { ok: false, error: 'Indique au moins le nombre appris ou laisse un commentaire.' };
      }
      return { ok: true, value: { countLearned: Math.round(countLearned), notes } };
    }
    case 'custom_game': {
      const result = s(r.result, 200);
      const notes = s(r.notes, TODO_RESPONSE_MAX);
      if (!result && !notes) return { ok: false, error: 'Indique le résultat ou laisse des notes.' };
      return { ok: true, value: { result, notes } };
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

  if (typeof input.title !== 'string' || !input.title.trim()) {
    return { ok: false, error: 'Le titre est obligatoire.' };
  }
  const title = input.title.trim().slice(0, TODO_TITLE_MAX);

  let description = '';
  if (typeof input.description === 'string') {
    description = input.description.trim().slice(0, TODO_DESCRIPTION_MAX);
  }

  // Résolution steps : nouveau format prioritaire, fallback wrap legacy single-type.
  let steps: ExerciseStep[];
  if (input.steps !== undefined && input.steps !== null) {
    const stepsResult = validateSteps(input.steps);
    if (!stepsResult.ok) return { ok: false, error: stepsResult.error };
    steps = stepsResult.value;
  } else {
    // Legacy : on wrap { type, config } en un seul step.
    let legacyType: TodoType = 'free';
    if (typeof input.type === 'string' && (TODO_TYPES_ALL as readonly string[]).includes(input.type)) {
      legacyType = input.type as TodoType;
    }
    const configResult = validateTodoConfig(legacyType, input.config);
    if (!configResult.ok) return { ok: false, error: configResult.error };
    steps = [{
      id: `step-${Math.random().toString(36).slice(2, 10)}`,
      type: legacyType,
      config: configResult.value,
      completed: false,
    }];
  }

  // Type/config top-level maintenus pour compat ascendante des lecteurs legacy.
  const type: TodoType = steps[0].type;
  const config: Record<string, unknown> = steps[0].config;

  let eventId: string | null = null;
  if (typeof input.eventId === 'string' && input.eventId.trim()) {
    eventId = input.eventId.trim();
  }

  // Deadline : deux modes.
  //  - 'absolute' : YYYY-MM-DD fournie directement → deadlineAt = fin de journée Paris de cette date.
  //  - 'relative' : offset en jours appliqué à event.startsAt → nécessite eventId. La valeur concrète
  //    est calculée côté API (accès DB pour lire startsAt), pas ici, donc deadline/deadlineAt null.
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
    // deadline / deadlineAt restent null ici, l'API les calcule via computeRelativeDeadlineAt().
  } else if (input.deadline !== undefined && input.deadline !== null && input.deadline !== '') {
    if (!isValidYmd(input.deadline)) {
      return { ok: false, error: 'Deadline invalide (format attendu YYYY-MM-DD).' };
    }
    deadline = input.deadline as string;
    deadlineAt = endOfDayParisMs(deadline);
    deadlineMode = 'absolute';
  }

  const postToChannel = input.postToChannel === true;

  return {
    ok: true,
    value: {
      subTeamId, assigneeIds, steps, type, title, description, config,
      eventId, deadline, deadlineAt, deadlineMode, deadlineOffsetDays,
      postToChannel,
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

// Un exercice est en retard si on a dépassé l'instant précis de sa deadline.
// Avec l'option A, un exercice avec offset=0 et match à 18:00 est overdue à 18:01, pas le lendemain.
export function isOverdue(todo: TodoRef, nowMs: number): boolean {
  if (todo.done) return false;
  const ms = effectiveDeadlineMs(todo);
  if (ms === null) return false;
  return nowMs > ms;
}
