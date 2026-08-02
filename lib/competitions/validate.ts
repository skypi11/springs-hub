// Validation serveur des payloads admin du moteur de compétitions (Lot 0).
// Fonctions PURES (aucun I/O) : les API routes les appellent après auth, et
// la suite Vitest les couvre. Chaque fonction renvoie soit la valeur nettoyée
// (clampée, coercée), soit une erreur lisible destinée au toast admin.

import { clampString, LIMITS } from '@/lib/validation';
import type {
  CircuitStatus,
  CircuitTieBreaker,
  CompetitionDiscordOptions,
  CompetitionEligibility,
  CompetitionFormat,
  CompetitionSchedule,
  PhasePlanEntry,
  TournamentStage,
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

const isValidBo = (n: number | null): n is number => n !== null && n % 2 === 1 && n >= 1 && n <= 9;

/** Identifiant Discord (serveur, salon, rôle). */
const SNOWFLAKE = /^\d{17,20}$/;

// ── Circuits ────────────────────────────────────────────────────────────────

export interface CircuitPayload {
  name: string;
  game: (typeof SUPPORTED_GAMES)[number];
  pointsScale: Record<string, number>;
  bestResultsCount: number;
  lanTeamCount: number;
  prizePool: { amount: number; currency: string; note?: string } | null;
  organizer: { name: string; logoUrl: string | null } | null;
  tieBreakers: CircuitTieBreaker[];
  status: CircuitStatus;
}

// Organisateur optionnel (la structure qui porte la compétition — Aedral n'est
// que l'hébergeur). name requis s'il est fourni ; logoUrl optionnel (URL /public
// ou http). Public-safe (pas d'uid).
function validateOrganizer(input: unknown): ValidationResult<CircuitPayload['organizer']> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object') return err('Organisateur invalide.');
  const o = input as Record<string, unknown>;
  const name = clampString(o.name, 60);
  if (!name) return { ok: true, value: null };
  const raw = typeof o.logoUrl === 'string' ? o.logoUrl.trim() : '';
  const logoUrl = raw && (raw.startsWith('http') || raw.startsWith('/')) ? clampString(raw, 500) : null;
  return { ok: true, value: { name, logoUrl } };
}

// Dotation optionnelle du circuit. null (ou absent) = pas de dotation.
const PRIZE_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD'] as const;
function validatePrizePool(input: unknown): ValidationResult<CircuitPayload['prizePool']> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'object') return err('Dotation invalide.');
  const p = input as Record<string, unknown>;
  const amount = asInt(p.amount);
  if (amount === null || amount < 0 || amount > 10_000_000) return err('Montant de dotation invalide.');
  if (amount === 0) return { ok: true, value: null }; // 0 = pas de dotation
  const currency = typeof p.currency === 'string' && PRIZE_CURRENCIES.includes(p.currency as (typeof PRIZE_CURRENCIES)[number])
    ? p.currency
    : 'EUR';
  const note = clampString(p.note, 80);
  return { ok: true, value: { amount, currency, ...(note ? { note } : {}) } };
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

  const prizePool = validatePrizePool(b.prizePool);
  if (!prizePool.ok) return prizePool;

  const organizer = validateOrganizer(b.organizer);
  if (!organizer.ok) return organizer;

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
      prizePool: prizePool.value,
      organizer: organizer.value,
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
  organizer: { name: string; logoUrl: string | null } | null;
  accentColor: string | null;
  format: CompetitionFormat;
  /** Séquence d'étapes (design §9d) — null = mono-étape (tout l'existant). */
  stages: TournamentStage[] | null;
  eligibility: CompetitionEligibility;
  roster: { starters: number; subsMax: number };
  registration: { opensAt: string; closesAt: string; waitlist: boolean };
  schedule: CompetitionSchedule;
  discordGuildId: string;
  discordOptions: CompetitionDiscordOptions;
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

  const stages = validateStages(b.stages, format.value, circuitId);
  if (!stages.ok) return stages;

  const eligibility = validateEligibility(b.eligibility);
  if (!eligibility.ok) return eligibility;

  const roster = validateRoster(b.roster);
  if (!roster.ok) return roster;

  const registration = validateRegistrationWindow(b.registration);
  if (!registration.ok) return registration;

  const schedule = validateSchedule(b.schedule);
  if (!schedule.ok) return schedule;

  // Cohérence FORMAT ↔ PLAN DE PHASES, ÉTAPE PAR ÉTAPE : le déroulé peut
  // couvrir plusieurs étapes de formats différents (poules le samedi, phase
  // finale le dimanche — planifiées dès la création). Chaque entrée est donc
  // confrontée au format de SON étape, jamais à celui de la compétition.
  const planStages = stages.value ?? [{ kind: format.value.kind, format: format.value }];
  for (const entry of schedule.value.phasePlan) {
    const stageNumber = entry.stage ?? 1;
    const stage = planStages[stageNumber - 1];
    if (!stage) {
      return err(`Phase ${entry.phase} : elle vise une étape ${stageNumber} qui n'existe pas.`);
    }
    const issue = phasePlanIssue(entry, stage.format);
    if (issue) return err(issue);
  }

  // Snowflake Discord : chiffres uniquement (17-20), optionnel en draft.
  const discordGuildId = typeof b.discordGuildId === 'string' ? b.discordGuildId.trim() : '';
  if (discordGuildId && !/^\d{17,20}$/.test(discordGuildId)) {
    return err('ID de serveur Discord invalide (snowflake attendu).');
  }

  const discordOptions = validateDiscordOptions(b.discordOptions);
  if (!discordOptions.ok) return discordOptions;

  // Organisateur propre à la compétition : réutilise la validation des
  // circuits, même forme et mêmes bornes.
  const organizer = validateOrganizer(b.organizer);
  if (!organizer.ok) return organizer;

  // Couleur d'accent des supports : hex strict. Un format libre finirait en
  // CSS invalide dans une image générée, donc en affiche cassée.
  const rawAccent = typeof b.accentColor === 'string' ? b.accentColor.trim() : '';
  if (rawAccent && !/^#[0-9a-fA-F]{6}$/.test(rawAccent)) {
    return err('Couleur d\'accent invalide (format #RRGGBB attendu).');
  }

  return {
    ok: true,
    value: {
      name,
      game: b.game as (typeof SUPPORTED_GAMES)[number],
      circuitId,
      organizer: organizer.value,
      accentColor: rawAccent ? rawAccent.toUpperCase() : null,
      format: format.value,
      stages: stages.value,
      eligibility: eligibility.value,
      roster: roster.value,
      registration: registration.value,
      schedule: schedule.value,
      discordGuildId,
      discordOptions: discordOptions.value,
    },
  };
}

/**
 * Réglages Discord. Absents = comportement historique (salons d'équipe créés,
 * rôle nommé d'après la compétition, aucune annonce publique) : une
 * compétition d'avant ces réglages continue de se comporter à l'identique.
 */
function validateDiscordOptions(input: unknown): ValidationResult<CompetitionDiscordOptions> {
  const defaults: CompetitionDiscordOptions = {
    teamChannels: true,
    teamVoiceChannels: false,
    categoryName: null,
    staffRoleIds: [],
    participantRoleName: null,
    announceChannelId: null,
    createAnnounceChannel: false,
    announceChannelName: null,
    staffChannelId: null,
    createStaffChannel: false,
    staffChannelName: null,
    resultsChannelId: null,
    createResultsChannel: false,
    resultsChannelName: null,
    generalChannelId: null,
    createGeneralChannel: false,
    generalChannelName: null,
  };
  if (input === null || input === undefined) return { ok: true, value: defaults };
  if (typeof input !== 'object') return err('Réglages Discord invalides.');
  const o = input as Record<string, unknown>;

  const snowflake = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const announceId = snowflake(o.announceChannelId);
  if (announceId && !SNOWFLAKE.test(announceId)) {
    return err("Salon d'annonces invalide.");
  }
  const staffChannelId = snowflake(o.staffChannelId);
  if (staffChannelId && !SNOWFLAKE.test(staffChannelId)) {
    return err('Salon du staff invalide.');
  }
  const resultsChannelId = snowflake(o.resultsChannelId);
  if (resultsChannelId && !SNOWFLAKE.test(resultsChannelId)) {
    return err('Salon des résultats invalide.');
  }
  const generalChannelId = snowflake(o.generalChannelId);
  if (generalChannelId && !SNOWFLAKE.test(generalChannelId)) {
    return err('Salon général invalide.');
  }

  const rawRoles = Array.isArray(o.staffRoleIds) ? o.staffRoleIds as unknown[] : [];
  if (rawRoles.length > 10) return err('Trop de rôles staff (10 maximum).');
  const staffRoleIds: string[] = [];
  for (const r of rawRoles) {
    const id = snowflake(r);
    if (!SNOWFLAKE.test(id)) return err('Rôle staff invalide.');
    if (!staffRoleIds.includes(id)) staffRoleIds.push(id);
  }

  return {
    ok: true,
    value: {
      // Le défaut reste « oui » : ne pas cocher ne doit pas priver une
      // compétition existante de ses salons.
      teamChannels: o.teamChannels !== false,
      teamVoiceChannels: o.teamVoiceChannels === true,
      categoryName: clampString(o.categoryName, 90) || null,
      staffRoleIds,
      participantRoleName: clampString(o.participantRoleName, 90) || null,  // limite Discord : 100
      announceChannelId: announceId || null,
      // « Créer » et « salon désigné » s'excluent : dans l'état hybride, le
      // provisioning gardait le salon désigné pendant que le nettoyage le
      // croyait créé par le bot — et le supprimait. L'identifiant gagne, comme
      // au provisioning.
      createAnnounceChannel: o.createAnnounceChannel === true && !announceId,
      announceChannelName: clampString(o.announceChannelName, 90) || null,
      staffChannelId: staffChannelId || null,
      createStaffChannel: o.createStaffChannel === true && !staffChannelId,
      staffChannelName: clampString(o.staffChannelName, 90) || null,
      resultsChannelId: resultsChannelId || null,
      createResultsChannel: o.createResultsChannel === true,
      resultsChannelName: clampString(o.resultsChannelName, 90) || null,
      generalChannelId: generalChannelId || null,
      createGeneralChannel: o.createGeneralChannel === true,
      generalChannelName: clampString(o.generalChannelName, 90) || null,
    },
  };
}

/**
 * Une entrée de déroulé est-elle jouable dans ce format ? (review adversariale :
 * un plan double élim collé sur un simple élim rangeait la petite finale en
 * début de jour). Renvoie le message d'erreur, ou null si tout va bien.
 */
function phasePlanIssue(entry: PhasePlanEntry, format: CompetitionFormat): string | null {
  const kind = format.kind;
  if (kind === 'round_robin' || kind === 'swiss') {
    for (const round of entry.rounds) {
      if (round.bracket !== kind) {
        return kind === 'swiss'
          ? 'Plan de phases incompatible : un suisse ne contient que des rondes suisses.'
          : 'Plan de phases incompatible : un round robin ne contient que des journées de poule.';
      }
    }
    return null;
  }
  for (const round of entry.rounds) {
    if (round.bracket === 'round_robin' || round.bracket === 'swiss') {
      return 'Plan de phases incompatible : journée de poule ou ronde suisse dans un format à élimination.';
    }
    if (kind === 'single_elim') {
      if (round.bracket === 'grand_final') {
        return 'Plan de phases incompatible : pas de grande finale en simple élimination.';
      }
      // En simple élim, le seul match « losers » est la petite finale.
      if (round.bracket === 'losers' && (round.round > 1 || format.thirdPlace !== true)) {
        return 'Plan de phases incompatible : en simple élimination, le bracket losers ne porte que la petite finale (activée).';
      }
    }
  }
  return null;
}

// ── Séquence d'étapes (multi-étapes, design §9d) ─────────────────────────────

// Bornes moteur en littéraux MIROIR (comme le reste de ce module, partagé
// client — jamais d'import des moteurs) : effectif minimum 4 pour tous les
// formats ; budget d'écriture ATOMIQUE d'un passage d'étape ≤ 200 matchs
// (docs + ACL ≤ ~400 writes, sous la limite de 500 d'une transaction — le
// publish de l'étape 1, lui, est batché avec reprise, pas concerné).
const STAGE_MIN_TEAMS = 4;
const STAGE_MAX_COUNT = 4;
const STAGE_MAX_ATOMIC_MATCHES = 200;
// 'manual' reste refusé au transfert (pas d'UI de réordonnancement à ce
// moment du flux) ; 'circuit' exige une compétition rattachée à un circuit.
const STAGE_RESEEDS = ['standings', 'random', 'mmr', 'circuit'] as const;

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Nombre de matchs matérialisés à l'ENTRÉE d'une étape de `teamCount`
 *  équipes (miroir déclaratif des générateurs — le suisse ne matérialise que
 *  sa ronde 1, les rondes suivantes naissent par appariement incrémental). */
export function estimateStageEntryMatches(format: CompetitionFormat, teamCount: number): number {
  const kind = format.kind;
  if (kind === 'swiss') return Math.ceil(teamCount / 2);
  if (kind === 'round_robin') {
    const groups = Math.max(1, format.groupCount ?? 1);
    const legs = format.doubleRound === true ? 2 : 1;
    const base = Math.floor(teamCount / groups);
    const extra = teamCount % groups;
    let total = 0;
    for (let g = 0; g < groups; g++) {
      const size = base + (g < extra ? 1 : 0);
      total += (size * (size - 1)) / 2;
    }
    return total * legs;
  }
  const size = nextPow2(Math.max(2, teamCount));
  if (kind === 'single_elim') return size - 1 + (format.thirdPlace === true ? 1 : 0);
  // Double élim : winners (size−1) + losers (size−2) + GF + reset pré-créé.
  return 2 * size;
}

/**
 * Valide la séquence d'étapes. null/absent = mono-étape. Sinon 2-4 étapes :
 * chaque format validé par le validateur de son kind, transfert obligatoire
 * sauf sur la dernière, `maxTeams` de l'étape N+1 = `advanceCount` du
 * transfert (l'effectif d'entrée est EXACT — la faisabilité poules/rondes de
 * l'étape suivante est ainsi vérifiée à la saisie, jamais au clic).
 * INVARIANT : `stages[0].format` = format top-level (validé identique).
 */
export function validateStages(
  input: unknown,
  topFormat: CompetitionFormat,
  circuitId: string | null = null,
): ValidationResult<TournamentStage[] | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (!Array.isArray(input)) return err('Étapes invalides.');
  if (input.length === 1) return err('Une seule étape : ne pas envoyer de séquence (format simple).');
  if (input.length < 2 || input.length > STAGE_MAX_COUNT) {
    return err(`Le tournoi doit compter entre 2 et ${STAGE_MAX_COUNT} étapes.`);
  }

  const stages: TournamentStage[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== 'object' || raw === null) return err(`Étape ${i + 1} invalide.`);
    const s = raw as Record<string, unknown>;
    const format = validateFormat(s.format);
    if (!format.ok) return err(`Étape ${i + 1} : ${format.error}`);
    const name = clampString(s.name, 40);

    const isLast = i === input.length - 1;
    let transfer: TournamentStage['transfer'];
    if (isLast) {
      if (s.transfer !== undefined && s.transfer !== null) {
        return err('La dernière étape ne peut pas avoir de transfert.');
      }
    } else {
      if (typeof s.transfer !== 'object' || s.transfer === null) {
        return err(`Étape ${i + 1} : transfert vers l'étape suivante requis (nombre de qualifiées).`);
      }
      const t = s.transfer as Record<string, unknown>;
      const advanceCount = asInt(t.advanceCount);
      if (advanceCount === null || advanceCount < STAGE_MIN_TEAMS) {
        return err(`Étape ${i + 1} : nombre de qualifiées invalide (minimum ${STAGE_MIN_TEAMS}).`);
      }
      if (advanceCount > format.value.maxTeams) {
        return err(`Étape ${i + 1} : ${advanceCount} qualifiées pour ${format.value.maxTeams} équipes au plus.`);
      }
      if (!STAGE_RESEEDS.includes(t.reseed as (typeof STAGE_RESEEDS)[number])) {
        return err(`Étape ${i + 1} : re-seeding invalide (classement, aléatoire, MMR ou circuit).`);
      }
      if (t.reseed === 'circuit' && !circuitId) {
        return err(`Étape ${i + 1} : re-seeding par classement de circuit réservé aux compétitions de circuit.`);
      }
      transfer = { advanceCount, reseed: t.reseed as (typeof STAGE_RESEEDS)[number] };
    }

    stages.push({
      kind: format.value.kind,
      format: format.value,
      ...(name ? { name } : {}),
      ...(transfer ? { transfer } : {}),
    });
  }

  // Cohérences croisées inter-étapes.
  if (JSON.stringify(stages[0].format) !== JSON.stringify(topFormat)) {
    return err('Le format de la compétition doit être celui de la première étape (invariant multi-étapes).');
  }
  for (let i = 1; i < stages.length; i++) {
    const advanceCount = stages[i - 1].transfer!.advanceCount;
    if (stages[i].format.maxTeams !== advanceCount) {
      return err(`Étape ${i + 1} : son nombre d'équipes (${stages[i].format.maxTeams}) doit égaler les qualifiées de l'étape précédente (${advanceCount}).`);
    }
    const entryMatches = estimateStageEntryMatches(stages[i].format, advanceCount);
    if (entryMatches > STAGE_MAX_ATOMIC_MATCHES) {
      return err(`Étape ${i + 1} : trop de matchs à créer d'un coup (${entryMatches}, maximum ${STAGE_MAX_ATOMIC_MATCHES}) — réduis les qualifiées ou découpe en poules plus petites.`);
    }
  }

  return { ok: true, value: stages };
}

/** Exporté pour la saisie : le formulaire de création valide le format SEUL à
 *  chaque frappe (bornes ET règles croisées), avec le message exact que
 *  renverrait l'enregistrement — jamais de refus découvert après coup. */
export function validateFormat(input: unknown): ValidationResult<CompetitionFormat> {
  if (typeof input !== 'object' || input === null) return err('Format invalide.');
  const f = input as Record<string, unknown>;

  if (f.kind !== 'double_elim' && f.kind !== 'single_elim' && f.kind !== 'round_robin' && f.kind !== 'swiss') {
    return err('Format non supporté (double élimination, simple élimination, round robin ou suisse).');
  }
  const kind = f.kind;
  if (kind === 'round_robin') return validateRoundRobinFormat(f);
  if (kind === 'swiss') return validateSwissFormat(f);

  // Miroir de MIN_TEAMS/MAX_TEAMS (lib/tournament/generate) — littéraux, comme
  // le reste de ce module partagé avec le client (jamais d'import de moteur).
  const maxTeams = asInt(f.maxTeams);
  if (maxTeams === null || maxTeams < 4 || maxTeams > 64) {
    return err("Nombre max d'équipes invalide (4-64).");
  }

  const bo = (typeof f.bo === 'object' && f.bo !== null) ? f.bo as Record<string, unknown> : null;
  if (!bo) return err('Configuration BO manquante.');
  const boDefault = asInt(bo.default);
  const boGrandFinal = asInt(bo.grandFinal);
  if (!isValidBo(boDefault)) return err('BO par défaut invalide (impair, 1-9).');
  // En simple élim, `grandFinal` est le BO de la FINALE (même champ, même règle).
  if (!isValidBo(boGrandFinal)) return err('BO de finale invalide (impair, 1-9).');

  const rawOverrides = Array.isArray(bo.overrides) ? bo.overrides as unknown[] : [];
  // 20 : l'écran « BO par tour » permet de régler CHAQUE tour, et un double
  // élim de 64 en compte 16 (6 vainqueurs + 10 perdants). La borne de 8
  // refusait des réglages pourtant proposés à l'organisateur.
  if (rawOverrides.length > 20) return err('Trop de règles BO spécifiques (max 20).');
  const overrides: CompetitionFormat['bo']['overrides'] = [];
  const seenOverrides = new Set<string>();
  for (const o of rawOverrides) {
    if (typeof o !== 'object' || o === null) return err('Règle BO invalide.');
    const ov = o as Record<string, unknown>;
    if (ov.bracket !== 'winners' && ov.bracket !== 'losers') return err('Règle BO : bracket invalide.');
    if (kind === 'single_elim' && ov.bracket === 'losers') {
      return err('Règle BO : pas de bracket losers en simple élimination.');
    }
    const roundsFromEnd = asInt(ov.roundsFromEnd);
    if (roundsFromEnd === null || roundsFromEnd < 1 || roundsFromEnd > 10) return err('Règle BO : ronde invalide.');
    const boValue = asInt(ov.bo);
    if (!isValidBo(boValue)) return err('Règle BO : valeur invalide (impair, 1-9).');
    // Deux règles sur la même ronde = résolution silencieuse premier-gagne
    // dans le moteur (review) : on refuse plutôt que de laisser deviner.
    const dupKey = `${ov.bracket}:${roundsFromEnd}`;
    if (seenOverrides.has(dupKey)) return err('Règle BO en doublon : une seule règle par ronde.');
    seenOverrides.add(dupKey);
    overrides.push({ bracket: ov.bracket, roundsFromEnd, bo: boValue });
  }

  // BO de la petite finale : simple élim uniquement, et seulement s'il DIFFÈRE
  // du défaut — sinon on ne stocke rien, et le moteur retombe sur le défaut
  // (aucun champ orphelin en base, comportement historique préservé).
  const hasThirdPlace = kind === 'single_elim' && f.thirdPlace === true;
  let boThirdPlace: number | null = null;
  if (hasThirdPlace && bo.thirdPlace !== undefined && bo.thirdPlace !== null) {
    boThirdPlace = asInt(bo.thirdPlace);
    if (!isValidBo(boThirdPlace)) return err('BO de petite finale invalide (impair, 1-9).');
    if (boThirdPlace === boDefault) boThirdPlace = null;
  }

  // Score conventionnel de forfait dérivé du BO par défaut : ceil(bo/2) manches
  // gagnées 1-0 (spec §11 : BO5 → ±3, BO7 → ±4). Pas saisi par l'admin.
  const forfeitScore = { games: Math.ceil(boDefault / 2), goalsPerGame: 1 };

  return {
    ok: true,
    value: {
      kind,
      maxTeams,
      bo: {
        default: boDefault, overrides, grandFinal: boGrandFinal,
        ...(boThirdPlace !== null ? { thirdPlace: boThirdPlace } : {}),
      },
      // Reset = double élim ; petite finale = simple élim. Chacun forcé à
      // false hors de son format (jamais de champ orphelin en base).
      bracketReset: kind === 'double_elim' && f.bracketReset === true,
      thirdPlace: kind === 'single_elim' && f.thirdPlace === true,
      forfeitScore,
    },
  };
}

// Bornes du moteur round robin (lib/tournament/round-robin.ts) : 4-64 équipes,
// poules de 2 à 20 — miroir de RR_MIN/MAX_TEAMS et RR_MAX_POOL_SIZE.
function validateRoundRobinFormat(f: Record<string, unknown>): ValidationResult<CompetitionFormat> {
  const maxTeams = asInt(f.maxTeams);
  if (maxTeams === null || maxTeams < 4 || maxTeams > 64) {
    return err("Nombre max d'équipes invalide (4-64 en round robin).");
  }

  const bo = (typeof f.bo === 'object' && f.bo !== null) ? f.bo as Record<string, unknown> : null;
  if (!bo) return err('Configuration BO manquante.');
  const boDefault = asInt(bo.default);
  if (!isValidBo(boDefault)) return err('BO par défaut invalide (impair, 1-9).');
  // Un match de poule n'est jamais « une finale » : pas de règles BO par
  // ronde ni de BO de finale — refusés plutôt qu'ignorés en silence.
  const rawOverrides = Array.isArray(bo.overrides) ? bo.overrides as unknown[] : [];
  if (rawOverrides.length > 0) {
    return err('Pas de règles BO par ronde en round robin (BO unique pour tous les matchs de poule).');
  }

  const groupCount = f.groupCount === undefined ? 1 : asInt(f.groupCount);
  if (groupCount === null || groupCount < 1 || groupCount > 16) {
    return err('Nombre de poules invalide (1-16).');
  }
  if (groupCount > Math.floor(maxTeams / 2)) {
    return err(`Trop de poules : ${groupCount} pour ${maxTeams} équipes (minimum 2 équipes par poule).`);
  }
  if (Math.ceil(maxTeams / groupCount) > 20) {
    return err(`Poule trop grande : ${Math.ceil(maxTeams / groupCount)} équipes (maximum 20 — augmenter le nombre de poules).`);
  }

  let points = { win: 3, draw: 1, loss: 0 };
  if (f.points !== undefined && f.points !== null) {
    if (typeof f.points !== 'object') return err('Barème de points invalide.');
    const p = f.points as Record<string, unknown>;
    const win = asInt(p.win);
    const draw = asInt(p.draw);
    const loss = asInt(p.loss);
    if (win === null || win < 0 || win > 10) return err('Points par victoire invalides (0-10).');
    if (draw === null || draw < 0 || draw > 10) return err('Points par nul invalides (0-10).');
    if (loss === null || loss < 0 || loss > 10) return err('Points par défaite invalides (0-10).');
    if (win <= loss) return err('Barème incohérent : la victoire doit rapporter plus que la défaite.');
    if (draw > win || draw < loss) return err('Barème incohérent : le nul doit se situer entre la défaite et la victoire.');
    points = { win, draw, loss };
  }

  return {
    ok: true,
    value: {
      kind: 'round_robin',
      maxTeams,
      // `grandFinal` est structurellement requis par BoConfig : forcé au BO
      // par défaut (aucun match ne le lit en round robin — jamais de valeur
      // mensongère en base).
      bo: { default: boDefault, overrides: [], grandFinal: boDefault },
      bracketReset: false,
      thirdPlace: false,
      groupCount,
      doubleRound: f.doubleRound === true,
      points,
      forfeitScore: { games: Math.ceil(boDefault / 2), goalsPerGame: 1 },
    },
  };
}

// Bornes du moteur suisse (lib/tournament/swiss.ts) : 4-64 équipes, 1-12
// rondes, rondes ≤ équipes − 1 (au-delà, re-matchs inévitables) — miroir de
// SWISS_MIN/MAX_TEAMS, SWISS_MAX_ROUNDS et swissBlocker.
function validateSwissFormat(f: Record<string, unknown>): ValidationResult<CompetitionFormat> {
  const maxTeams = asInt(f.maxTeams);
  if (maxTeams === null || maxTeams < 4 || maxTeams > 64) {
    return err("Nombre max d'équipes invalide (4-64 en suisse).");
  }

  const bo = (typeof f.bo === 'object' && f.bo !== null) ? f.bo as Record<string, unknown> : null;
  if (!bo) return err('Configuration BO manquante.');
  const boDefault = asInt(bo.default);
  if (!isValidBo(boDefault)) return err('BO par défaut invalide (impair, 1-9).');
  const rawOverrides = Array.isArray(bo.overrides) ? bo.overrides as unknown[] : [];
  if (rawOverrides.length > 0) {
    return err('Pas de règles BO par ronde en suisse (BO unique pour tous les matchs).');
  }

  // Défaut ⌈log2(maxTeams)⌉ — même règle que swissDefaultRounds.
  const swissRounds = f.swissRounds === undefined
    ? Math.max(1, Math.ceil(Math.log2(Math.max(2, maxTeams))))
    : asInt(f.swissRounds);
  if (swissRounds === null || swissRounds < 1 || swissRounds > 12) {
    return err('Nombre de rondes invalide (1-12).');
  }
  if (swissRounds > maxTeams - 1) {
    return err(`Trop de rondes : ${swissRounds} pour ${maxTeams} équipes (maximum ${maxTeams - 1} sans re-match).`);
  }

  let points = { win: 3, draw: 1, loss: 0 };
  if (f.points !== undefined && f.points !== null) {
    if (typeof f.points !== 'object') return err('Barème de points invalide.');
    const p = f.points as Record<string, unknown>;
    const win = asInt(p.win);
    const draw = asInt(p.draw);
    const loss = asInt(p.loss);
    if (win === null || win < 0 || win > 10) return err('Points par victoire invalides (0-10).');
    if (draw === null || draw < 0 || draw > 10) return err('Points par nul invalides (0-10).');
    if (loss === null || loss < 0 || loss > 10) return err('Points par défaite invalides (0-10).');
    if (win <= loss) return err('Barème incohérent : la victoire doit rapporter plus que la défaite.');
    if (draw > win || draw < loss) return err('Barème incohérent : le nul doit se situer entre la défaite et la victoire.');
    points = { win, draw, loss };
  }

  return {
    ok: true,
    value: {
      kind: 'swiss',
      maxTeams,
      bo: { default: boDefault, overrides: [], grandFinal: boDefault },
      bracketReset: false,
      thirdPlace: false,
      swissRounds,
      points,
      forfeitScore: { games: Math.ceil(boDefault / 2), goalsPerGame: 1 },
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
    // Heure de fin optionnelle (rétrocompat) : sert à poser la durée dans le
    // calendrier des équipes. Si fournie, doit être après le début.
    const endsAtRaw = typeof day.endsAt === 'string' ? day.endsAt.trim() : '';
    let endsAt: string | undefined;
    if (endsAtRaw) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endsAtRaw)) {
        return err(`Heure de fin invalide : « ${endsAtRaw} » (format HH:MM).`);
      }
      if (endsAtRaw <= startsAt) {
        return err(`L'heure de fin doit être après le début (jour ${days.length + 1}).`);
      }
      endsAt = endsAtRaw;
    }
    days.push(endsAt ? { date, startsAt, endsAt } : { date, startsAt });
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
  // Borne 60 : un round robin aller-retour à poule de 20 (RR_MAX_POOL_SIZE)
  // fait déjà 38 journées, et le déroulé couvre désormais TOUTES les étapes
  // (poules + phase finale planifiées ensemble). Sans danger pour les arbres
  // (8 rondes max) : une phase qui ne matche rien est ignorée par
  // attachPhasePlan.
  if (raw.length < 1 || raw.length > 60) return err('Le plan de phases doit compter entre 1 et 60 phases.');
  const plan: PhasePlanEntry[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) return err('Phase invalide dans le plan.');
    const entry = p as Record<string, unknown>;
    const phase = asInt(entry.phase);
    const day = asInt(entry.day);
    if (phase === null || phase < 1) return err('Numéro de phase invalide.');
    if (day === null || day < 1 || day > dayCount) return err(`Phase ${phase} : jour hors planning.`);
    const label = clampString(entry.label, 60);
    // Étape de format visée (absent = 1, tout l'existant). Le rattachement à
    // une étape réelle est vérifié par l'appelant, qui connaît la séquence.
    const stage = entry.stage === undefined ? 1 : asInt(entry.stage);
    if (stage === null || stage < 1 || stage > STAGE_MAX_COUNT) {
      return err(`Phase ${phase} : étape invalide.`);
    }
    const rawRounds = Array.isArray(entry.rounds) ? entry.rounds as unknown[] : [];
    if (rawRounds.length < 1 || rawRounds.length > 6) return err(`Phase ${phase} : rondes invalides.`);
    const rounds: PhasePlanEntry['rounds'] = [];
    for (const r of rawRounds) {
      if (typeof r !== 'object' || r === null) return err(`Phase ${phase} : ronde invalide.`);
      const round = r as Record<string, unknown>;
      if (round.bracket !== 'winners' && round.bracket !== 'losers' && round.bracket !== 'grand_final' && round.bracket !== 'round_robin' && round.bracket !== 'swiss') {
        return err(`Phase ${phase} : bracket invalide.`);
      }
      const num = asInt(round.round);
      // 40 : les journées d'un round robin aller-retour montent à 38 (les
      // rondes d'arbre plafonnent à 8) — même élargissement que ci-dessus.
      if (num === null || num < 1 || num > 40) return err(`Phase ${phase} : numéro de ronde invalide.`);
      rounds.push({ bracket: round.bracket, round: num });
    }
    plan.push({ phase, day, label: label || `P${phase}`, ...(stage > 1 ? { stage } : {}), rounds });
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
