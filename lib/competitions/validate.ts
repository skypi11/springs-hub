// Validation serveur des payloads admin du moteur de compétitions (Lot 0).
// Fonctions PURES (aucun I/O) : les API routes les appellent après auth, et
// la suite Vitest les couvre. Chaque fonction renvoie soit la valeur nettoyée
// (clampée, coercée), soit une erreur lisible destinée au toast admin.

import { clampString, LIMITS } from '@/lib/validation';
import type {
  CircuitStatus,
  CircuitTieBreaker,
  CompetitionEligibility,
  CompetitionFormat,
  CompetitionSchedule,
  PhasePlanEntry,
} from '@/types/competitions';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const err = (error: string): { ok: false; error: string } => ({ ok: false, error });

// Seul jeu supporté par le moteur v1. Générique : étendre ici quand TM/Valorant
// auront un format natif (la registry UI suit toute seule via <GameTag>).
const SUPPORTED_GAMES = ['rocket_league'] as const;

const CIRCUIT_STATUSES: CircuitStatus[] = ['draft', 'active', 'finished', 'archived'];
const TIE_BREAKERS: CircuitTieBreaker[] = ['best_placement', 'goal_diff_total', 'latest_event'];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function asInt(v: unknown): number | null {
  if (!isFiniteNumber(v)) return null;
  if (!Number.isInteger(v)) return null;
  return v;
}

// ── Circuits ────────────────────────────────────────────────────────────────

export interface CircuitPayload {
  name: string;
  game: (typeof SUPPORTED_GAMES)[number];
  pointsScale: Record<string, number>;
  bestResultsCount: number;
  lanTeamCount: number;
  tieBreakers: CircuitTieBreaker[];
  status: CircuitStatus;
}

export function validateCircuitPayload(body: unknown): ValidationResult<CircuitPayload> {
  if (typeof body !== 'object' || body === null) return err('Payload invalide.');
  const b = body as Record<string, unknown>;

  const name = clampString(b.name, LIMITS.circuitName);
  if (!name) return err('Le nom du circuit est obligatoire.');

  if (!SUPPORTED_GAMES.includes(b.game as (typeof SUPPORTED_GAMES)[number])) {
    return err('Jeu non supporté par le moteur de compétitions.');
  }

  const scale = validatePointsScale(b.pointsScale);
  if (!scale.ok) return scale;

  const bestResultsCount = asInt(b.bestResultsCount);
  if (bestResultsCount === null || bestResultsCount < 1 || bestResultsCount > 20) {
    return err('Nombre de résultats comptés invalide (1-20).');
  }

  const lanTeamCount = asInt(b.lanTeamCount);
  if (lanTeamCount === null || lanTeamCount < 2 || lanTeamCount > 64) {
    return err("Nombre d'équipes qualifiées invalide (2-64).");
  }

  // L'ordre des clés de départage est figé au Lot 0 (celui de la spec). On
  // accepte le tableau du client uniquement s'il est une permutation valide.
  const tb = Array.isArray(b.tieBreakers) ? (b.tieBreakers as unknown[]) : [];
  const tieBreakers = tb.filter((t): t is CircuitTieBreaker =>
    TIE_BREAKERS.includes(t as CircuitTieBreaker));
  if (tieBreakers.length !== TIE_BREAKERS.length || new Set(tieBreakers).size !== TIE_BREAKERS.length) {
    return err('Clés de départage invalides.');
  }

  const status = CIRCUIT_STATUSES.includes(b.status as CircuitStatus)
    ? (b.status as CircuitStatus)
    : 'draft';

  return {
    ok: true,
    value: {
      name,
      game: b.game as (typeof SUPPORTED_GAMES)[number],
      pointsScale: scale.value,
      bestResultsCount,
      lanTeamCount,
      tieBreakers,
      status,
    },
  };
}

// Barème : clés "1".."N" contiguës (place compressée — archi §3), points
// entiers ≥ 0 et décroissants au sens large (une place mieux classée ne peut
// pas rapporter moins que la suivante).
export function validatePointsScale(input: unknown): ValidationResult<Record<string, number>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err('Barème de points invalide.');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length < 2 || entries.length > 64) {
    return err('Le barème doit couvrir entre 2 et 64 places.');
  }
  const byPlace = new Map<number, number>();
  for (const [key, val] of entries) {
    const place = Number(key);
    if (!Number.isInteger(place) || place < 1) return err(`Place invalide dans le barème : « ${key} ».`);
    const points = asInt(val);
    if (points === null || points < 0 || points > 10000) return err(`Points invalides pour la place ${place}.`);
    byPlace.set(place, points);
  }
  for (let p = 1; p <= byPlace.size; p++) {
    if (!byPlace.has(p)) return err(`Barème non contigu : place ${p} manquante.`);
  }
  for (let p = 2; p <= byPlace.size; p++) {
    if (byPlace.get(p)! > byPlace.get(p - 1)!) {
      return err(`Barème incohérent : la place ${p} rapporte plus que la place ${p - 1}.`);
    }
  }
  const value: Record<string, number> = {};
  for (const [place, points] of byPlace) value[String(place)] = points;
  return { ok: true, value };
}

// ── Compétitions ────────────────────────────────────────────────────────────

export interface CompetitionPayload {
  name: string;
  game: (typeof SUPPORTED_GAMES)[number];
  circuitId: string | null;
  format: CompetitionFormat;
  eligibility: CompetitionEligibility;
  roster: { starters: number; subsMax: number };
  registration: { opensAt: string; closesAt: string; waitlist: boolean };
  schedule: CompetitionSchedule;
  discordGuildId: string;
}

export function validateCompetitionPayload(body: unknown): ValidationResult<CompetitionPayload> {
  if (typeof body !== 'object' || body === null) return err('Payload invalide.');
  const b = body as Record<string, unknown>;

  const name = clampString(b.name, LIMITS.competitionName);
  if (!name) return err('Le nom de la compétition est obligatoire.');

  if (!SUPPORTED_GAMES.includes(b.game as (typeof SUPPORTED_GAMES)[number])) {
    return err('Jeu non supporté par le moteur de compétitions.');
  }

  const circuitId = typeof b.circuitId === 'string' && b.circuitId.trim()
    ? b.circuitId.trim()
    : null;

  const format = validateFormat(b.format);
  if (!format.ok) return format;

  const eligibility = validateEligibility(b.eligibility);
  if (!eligibility.ok) return eligibility;

  const roster = validateRoster(b.roster);
  if (!roster.ok) return roster;

  const registration = validateRegistrationWindow(b.registration);
  if (!registration.ok) return registration;

  const schedule = validateSchedule(b.schedule);
  if (!schedule.ok) return schedule;

  // Snowflake Discord : chiffres uniquement (17-20), optionnel en draft.
  const discordGuildId = typeof b.discordGuildId === 'string' ? b.discordGuildId.trim() : '';
  if (discordGuildId && !/^\d{17,20}$/.test(discordGuildId)) {
    return err('ID de serveur Discord invalide (snowflake attendu).');
  }

  return {
    ok: true,
    value: {
      name,
      game: b.game as (typeof SUPPORTED_GAMES)[number],
      circuitId,
      format: format.value,
      eligibility: eligibility.value,
      roster: roster.value,
      registration: registration.value,
      schedule: schedule.value,
      discordGuildId,
    },
  };
}

function validateFormat(input: unknown): ValidationResult<CompetitionFormat> {
  if (typeof input !== 'object' || input === null) return err('Format invalide.');
  const f = input as Record<string, unknown>;

  if (f.kind !== 'double_elim') return err('Seul le format double élimination est supporté pour l’instant.');

  const maxTeams = asInt(f.maxTeams);
  if (maxTeams === null || maxTeams < 4 || maxTeams > 32) {
    return err("Nombre max d'équipes invalide (4-32).");
  }

  const bo = (typeof f.bo === 'object' && f.bo !== null) ? f.bo as Record<string, unknown> : null;
  if (!bo) return err('Configuration BO manquante.');
  const boDefault = asInt(bo.default);
  const boGrandFinal = asInt(bo.grandFinal);
  const isValidBo = (n: number | null): n is number => n !== null && n % 2 === 1 && n >= 1 && n <= 9;
  if (!isValidBo(boDefault)) return err('BO par défaut invalide (impair, 1-9).');
  if (!isValidBo(boGrandFinal)) return err('BO de grande finale invalide (impair, 1-9).');

  const rawOverrides = Array.isArray(bo.overrides) ? bo.overrides as unknown[] : [];
  if (rawOverrides.length > 8) return err('Trop de règles BO spécifiques (max 8).');
  const overrides: CompetitionFormat['bo']['overrides'] = [];
  for (const o of rawOverrides) {
    if (typeof o !== 'object' || o === null) return err('Règle BO invalide.');
    const ov = o as Record<string, unknown>;
    if (ov.bracket !== 'winners' && ov.bracket !== 'losers') return err('Règle BO : bracket invalide.');
    const roundsFromEnd = asInt(ov.roundsFromEnd);
    if (roundsFromEnd === null || roundsFromEnd < 1 || roundsFromEnd > 10) return err('Règle BO : ronde invalide.');
    const boValue = asInt(ov.bo);
    if (!isValidBo(boValue)) return err('Règle BO : valeur invalide (impair, 1-9).');
    overrides.push({ bracket: ov.bracket, roundsFromEnd, bo: boValue });
  }

  // Score conventionnel de forfait dérivé du BO par défaut : ceil(bo/2) manches
  // gagnées 1-0 (spec §11 : BO5 → ±3, BO7 → ±4). Pas saisi par l'admin.
  const forfeitScore = { games: Math.ceil(boDefault / 2), goalsPerGame: 1 };

  return {
    ok: true,
    value: {
      kind: 'double_elim',
      maxTeams,
      bo: { default: boDefault, overrides, grandFinal: boGrandFinal },
      bracketReset: f.bracketReset === true,
      forfeitScore,
    },
  };
}

function validateEligibility(input: unknown): ValidationResult<CompetitionEligibility> {
  if (typeof input !== 'object' || input === null) return err('Règles d’éligibilité invalides.');
  const e = input as Record<string, unknown>;

  let minAge: number | null = null;
  if (e.minAge !== null && e.minAge !== undefined && e.minAge !== '') {
    const parsed = asInt(e.minAge);
    if (parsed === null || parsed < 0 || parsed > 99) return err('Âge minimum invalide.');
    minAge = parsed;
  }

  let mmr: CompetitionEligibility['mmr'] = null;
  if (e.mmr !== null && e.mmr !== undefined) {
    if (typeof e.mmr !== 'object') return err('Règles MMR invalides.');
    const m = e.mmr as Record<string, unknown>;
    const weightCurrent = isFiniteNumber(m.weightCurrent) ? m.weightCurrent : NaN;
    if (!(weightCurrent >= 0 && weightCurrent <= 1)) return err('Pondération MMR actuel invalide (0-1).');
    const maxAvg = asInt(m.maxAvg);
    const maxGap = asInt(m.maxGap);
    const maxPlayer = asInt(m.maxPlayer);
    if (maxAvg === null || maxAvg < 0 || maxAvg > 5000) return err('Moyenne MMR max invalide.');
    if (maxGap === null || maxGap < 0 || maxGap > 5000) return err('Écart MMR max invalide.');
    if (maxPlayer === null || maxPlayer < 0 || maxPlayer > 5000) return err('Plafond MMR individuel invalide.');
    mmr = { weightCurrent, maxAvg, maxGap, maxPlayer };
  }

  return {
    ok: true,
    value: {
      requireVerifiedAccounts: e.requireVerifiedAccounts === true,
      minAge,
      mmr,
    },
  };
}

function validateRoster(input: unknown): ValidationResult<{ starters: number; subsMax: number }> {
  if (typeof input !== 'object' || input === null) return err('Configuration roster invalide.');
  const r = input as Record<string, unknown>;
  const starters = asInt(r.starters);
  const subsMax = asInt(r.subsMax);
  if (starters === null || starters < 1 || starters > 10) return err('Nombre de titulaires invalide (1-10).');
  if (subsMax === null || subsMax < 0 || subsMax > 10) return err('Nombre de remplaçants invalide (0-10).');
  return { ok: true, value: { starters, subsMax } };
}

function validateRegistrationWindow(input: unknown): ValidationResult<{ opensAt: string; closesAt: string; waitlist: boolean }> {
  if (typeof input !== 'object' || input === null) return err('Fenêtre d’inscription invalide.');
  const r = input as Record<string, unknown>;
  const opensAt = parseIsoDate(r.opensAt);
  const closesAt = parseIsoDate(r.closesAt);
  if (!opensAt) return err("Date d'ouverture des inscriptions invalide.");
  if (!closesAt) return err('Date de fermeture des inscriptions invalide.');
  if (new Date(opensAt) >= new Date(closesAt)) {
    return err("L'ouverture des inscriptions doit précéder la fermeture.");
  }
  return { ok: true, value: { opensAt, closesAt, waitlist: r.waitlist === true } };
}

function validateSchedule(input: unknown): ValidationResult<CompetitionSchedule> {
  if (typeof input !== 'object' || input === null) return err('Planning invalide.');
  const s = input as Record<string, unknown>;

  const rawDays = Array.isArray(s.days) ? s.days as unknown[] : [];
  if (rawDays.length < 1 || rawDays.length > 14) return err('Le planning doit compter entre 1 et 14 jours.');
  const days: CompetitionSchedule['days'] = [];
  for (const d of rawDays) {
    if (typeof d !== 'object' || d === null) return err('Jour de compétition invalide.');
    const day = d as Record<string, unknown>;
    const date = typeof day.date === 'string' ? day.date.trim() : '';
    const startsAt = typeof day.startsAt === 'string' ? day.startsAt.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
      return err(`Date de journée invalide : « ${date || '?'} ».`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startsAt)) {
      return err(`Heure de début invalide : « ${startsAt || '?'} » (format HH:MM).`);
    }
    days.push({ date, startsAt });
  }
  for (let i = 1; i < days.length; i++) {
    if (days[i].date <= days[i - 1].date) return err('Les journées doivent être en ordre chronologique.');
  }

  const phasePlan = validatePhasePlan(s.phasePlan, days.length);
  if (!phasePlan.ok) return phasePlan;

  const generalCheckinMinutes = asInt(s.generalCheckinMinutes);
  const matchCheckinMinutes = asInt(s.matchCheckinMinutes);
  const scoreCounterMinutes = asInt(s.scoreCounterMinutes);
  if (generalCheckinMinutes === null || generalCheckinMinutes < 5 || generalCheckinMinutes > 120) {
    return err('Durée du check-in général invalide (5-120 min).');
  }
  if (matchCheckinMinutes === null || matchCheckinMinutes < 1 || matchCheckinMinutes > 60) {
    return err('Durée du check-in de match invalide (1-60 min).');
  }
  if (scoreCounterMinutes === null || scoreCounterMinutes < 1 || scoreCounterMinutes > 60) {
    return err('Délai de contre-saisie invalide (1-60 min).');
  }

  return {
    ok: true,
    value: { days, phasePlan: phasePlan.value, generalCheckinMinutes, matchCheckinMinutes, scoreCounterMinutes },
  };
}

function validatePhasePlan(input: unknown, dayCount: number): ValidationResult<PhasePlanEntry[]> {
  const raw = Array.isArray(input) ? input as unknown[] : [];
  if (raw.length < 1 || raw.length > 30) return err('Le plan de phases doit compter entre 1 et 30 phases.');
  const plan: PhasePlanEntry[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) return err('Phase invalide dans le plan.');
    const entry = p as Record<string, unknown>;
    const phase = asInt(entry.phase);
    const day = asInt(entry.day);
    if (phase === null || phase < 1) return err('Numéro de phase invalide.');
    if (day === null || day < 1 || day > dayCount) return err(`Phase ${phase} : jour hors planning.`);
    const label = clampString(entry.label, 60);
    const rawRounds = Array.isArray(entry.rounds) ? entry.rounds as unknown[] : [];
    if (rawRounds.length < 1 || rawRounds.length > 6) return err(`Phase ${phase} : rondes invalides.`);
    const rounds: PhasePlanEntry['rounds'] = [];
    for (const r of rawRounds) {
      if (typeof r !== 'object' || r === null) return err(`Phase ${phase} : ronde invalide.`);
      const round = r as Record<string, unknown>;
      if (round.bracket !== 'winners' && round.bracket !== 'losers' && round.bracket !== 'grand_final') {
        return err(`Phase ${phase} : bracket invalide.`);
      }
      const num = asInt(round.round);
      if (num === null || num < 1 || num > 20) return err(`Phase ${phase} : numéro de ronde invalide.`);
      rounds.push({ bracket: round.bracket, round: num });
    }
    plan.push({ phase, day, label: label || `P${phase}`, rounds });
  }
  // Phases numérotées 1..N sans trou ni doublon, jours croissants au fil des phases.
  const sorted = [...plan].sort((a, b) => a.phase - b.phase);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].phase !== i + 1) return err('Les phases doivent être numérotées 1..N sans trou.');
    if (i > 0 && sorted[i].day < sorted[i - 1].day) return err('Les jours des phases doivent être croissants.');
  }
  return { ok: true, value: sorted };
}

// Accepte un ISO string (ou tout format Date-parsable) et renvoie l'ISO
// normalisé, ou null si illisible.
function parseIsoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
