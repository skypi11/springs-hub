// Helpers purs pour le calendrier de disponibilités MVP2a.
// Pas d'accès Firestore ici — toute la logique testable en isolation.
//
// Conventions :
// - Tous les slots sont des chaînes "YYYY-MM-DDTHH:MM" interprétées comme heure locale
//   Europe/Paris (indépendamment du fuseau du serveur).
// - Un slot représente un intervalle de 30 minutes : [slotStart, slotStart + 30min].
// - Les heures après minuit (00:00, 00:30, 01:00, 01:30) appartiennent à la grille
//   du jour précédent (la soirée qui déborde). Leur date calendaire est celle du
//   lendemain mais elles sont rattachées visuellement au jour d'avant.
// - Une semaine est identifiée par le lundi (YYYY-MM-DD) + un ID ISO (YYYY-Wnn).

// ─── Types ──────────────────────────────────────────────────────────────

export interface DaySchedule {
  startHour: number;          // ex: 17 pour "17h"
  endHourNextDay: number;     // ex: 2 pour "jusqu'à 2h du matin le lendemain"
}

export interface WeekGrid {
  weekId: string;             // "2026-W16"
  mondayYmd: string;          // "2026-04-13"
  days: DayGrid[];            // 7 entrées, lundi → dimanche
}

export interface DayGrid {
  dayOfWeek: number;          // 1 = lundi, 2 = mardi, ..., 7 = dimanche
  gridYmd: string;            // date du jour grille (YYYY-MM-DD)
  slots: string[];            // ISO slots "YYYY-MM-DDTHH:MM" (chronologiques)
  isPast: boolean;            // true si ce jour est révolu (lecture seule)
}

export interface MatchBlock {
  startSlot: string;          // premier slot du bloc (inclusif)
  endSlot: string;            // dernier slot du bloc (inclusif, 30min de durée)
  durationMinutes: number;    // nombre de slots × 30
  playerIds: string[];        // joueurs disponibles pendant tout le bloc
}

// ─── Config des horaires par jour (1 = lundi … 7 = dimanche) ────────────

export const DAY_SCHEDULES: Record<number, DaySchedule> = {
  1: { startHour: 17, endHourNextDay: 2 }, // Lundi
  2: { startHour: 17, endHourNextDay: 2 }, // Mardi
  3: { startHour: 12, endHourNextDay: 2 }, // Mercredi
  4: { startHour: 17, endHourNextDay: 2 }, // Jeudi
  5: { startHour: 17, endHourNextDay: 2 }, // Vendredi
  6: { startHour: 10, endHourNextDay: 2 }, // Samedi
  7: { startHour: 10, endHourNextDay: 2 }, // Dimanche
};

export const SLOT_DURATION_MINUTES = 30;

// ─── Helpers date / string ──────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Ajoute `n` jours à un YMD ("2026-04-14") en restant dans l'espace string. */
export function addDays(ymd: string, n: number): string {
  const [y, mo, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Jour de la semaine pour un YMD, format ISO : 1 = lundi … 7 = dimanche. */
export function isoDayOfWeek(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  const jsDow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = dim, 1 = lun …
  return jsDow === 0 ? 7 : jsDow;
}

/** Renvoie le lundi YMD de la semaine contenant `ymd`. */
export function getMondayYmd(ymd: string): string {
  const dow = isoDayOfWeek(ymd);
  return addDays(ymd, -(dow - 1));
}

/** ID ISO de la semaine à partir du lundi ("2026-04-13" → "2026-W16"). */
export function getIsoWeekId(mondayYmd: string): string {
  const [y, mo, d] = mondayYmd.split('-').map(Number);
  // Le jeudi de la semaine fixe l'année ISO (ISO 8601 §2.1.4)
  const thursday = new Date(Date.UTC(y, mo - 1, d + 3));
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${isoYear}-W${pad2(weekNo)}`;
}

/** "YYYY-MM-DD" Europe/Paris pour un instant UTC. */
export function parisYmd(utc: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(utc); // en-CA renvoie déjà "YYYY-MM-DD"
}

/** "YYYY-MM-DDTHH:MM" Europe/Paris pour un instant UTC (aligné sur 30min vers le bas). */
export function parisIsoMinute(utc: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(utc);
  const pick = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/** Ajoute `minutes` à un ISO Paris "YYYY-MM-DDTHH:MM" (arithmétique naïve, ignore DST). */
export function addMinutesToIso(iso: string, minutes: number): string {
  const [datePart, timePart] = iso.split('T');
  const [h, m] = timePart.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / (24 * 60));
  const rem = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const newH = Math.floor(rem / 60);
  const newM = rem % 60;
  const newDate = dayShift === 0 ? datePart : addDays(datePart, dayShift);
  return `${newDate}T${pad2(newH)}:${pad2(newM)}`;
}

// ─── Génération des slots d'une journée / semaine ───────────────────────

/**
 * Slots d'une journée grille : le gridYmd est la date "propriétaire" du jour.
 * Les slots après minuit (00h–endHourNextDay) ont comme date calendaire gridYmd+1.
 */
export function generateDaySlots(gridYmd: string, schedule: DaySchedule): string[] {
  const slots: string[] = [];
  for (let h = schedule.startHour; h < 24; h++) {
    slots.push(`${gridYmd}T${pad2(h)}:00`);
    slots.push(`${gridYmd}T${pad2(h)}:30`);
  }
  if (schedule.endHourNextDay > 0) {
    const next = addDays(gridYmd, 1);
    for (let h = 0; h < schedule.endHourNextDay; h++) {
      slots.push(`${next}T${pad2(h)}:00`);
      slots.push(`${next}T${pad2(h)}:30`);
    }
  }
  return slots;
}

/**
 * Grille complète d'une semaine à partir de son lundi.
 * `todayYmd` sert à marquer les jours passés (read-only) ; un jour est "past"
 * si son gridYmd est strictement antérieur à todayYmd.
 */
export function generateWeekGrid(mondayYmd: string, todayYmd: string): WeekGrid {
  const days: DayGrid[] = [];
  for (let i = 0; i < 7; i++) {
    const gridYmd = addDays(mondayYmd, i);
    const dayOfWeek = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    const schedule = DAY_SCHEDULES[dayOfWeek];
    days.push({
      dayOfWeek,
      gridYmd,
      slots: generateDaySlots(gridYmd, schedule),
      isPast: gridYmd < todayYmd,
    });
  }
  return {
    weekId: getIsoWeekId(mondayYmd),
    mondayYmd,
    days,
  };
}

/** Ensemble de tous les slots valides sur une semaine (pour validation côté serveur). */
export function validSlotsForWeek(mondayYmd: string): Set<string> {
  const grid = generateWeekGrid(mondayYmd, mondayYmd); // "past" nous importe pas ici
  const out = new Set<string>();
  for (const day of grid.days) {
    for (const s of day.slots) out.add(s);
  }
  return out;
}

// ─── Matching : blocs continus où N+ joueurs sont dispos ────────────────

/** True si `b` est le slot 30min immédiatement après `a`. */
export function areConsecutiveSlots(a: string, b: string): boolean {
  return addMinutesToIso(a, SLOT_DURATION_MINUTES) === b;
}

/**
 * Vérifie si un event couvre au moins partiellement un slot.
 * Les deux bornes d'event doivent être déjà converties en ISO Paris ("YYYY-MM-DDTHH:MM").
 */
export function eventCoversSlot(
  eventStartParis: string,
  eventEndParis: string,
  slotParis: string,
): boolean {
  const slotEndParis = addMinutesToIso(slotParis, SLOT_DURATION_MINUTES);
  return eventStartParis < slotEndParis && slotParis < eventEndParis;
}

export interface AvailabilityInput {
  /** Pour chaque joueur, les slots déclarés dispo sur la période étudiée. */
  playerSlots: Record<string, Set<string>>;
  /** Slots où certains joueurs ont un conflit d'event (à exclure). */
  conflictSlotsByPlayer: Record<string, Set<string>>;
  /** Liste exhaustive des slots valides, triés chronologiquement. */
  orderedSlots: string[];
  minPlayers: number;
  minDurationMinutes: number;
}

/**
 * Trouve les blocs continus de slots où au moins `minPlayers` joueurs sont
 * communément disponibles (même sous-ensemble de joueurs sur tout le bloc)
 * et la durée totale atteint `minDurationMinutes`.
 *
 * Algorithme glouton "greedy from start" :
 * - On parcourt les slots en ordre chronologique.
 * - À chaque slot, on essaie d'étendre un bloc en intersectant les joueurs dispos.
 * - Le bloc s'arrête dès que l'intersection passe sous `minPlayers` ou qu'un
 *   slot non consécutif apparaît.
 * - On saute ensuite au slot juste après le bloc yield.
 *
 * Cet algo produit un seul bloc par slot de départ, ce qui évite les doublons
 * et garde les suggestions lisibles.
 */
export function findMatchBlocks(input: AvailabilityInput): MatchBlock[] {
  const { playerSlots, conflictSlotsByPlayer, orderedSlots, minPlayers, minDurationMinutes } = input;

  // Pour chaque slot, construire l'ensemble des joueurs dispos (hors conflit)
  const availableBySlot = new Map<string, Set<string>>();
  for (const slot of orderedSlots) {
    const set = new Set<string>();
    for (const playerId of Object.keys(playerSlots)) {
      if (!playerSlots[playerId].has(slot)) continue;
      const conflicts = conflictSlotsByPlayer[playerId];
      if (conflicts && conflicts.has(slot)) continue;
      set.add(playerId);
    }
    availableBySlot.set(slot, set);
  }

  const blocks: MatchBlock[] = [];
  let i = 0;
  while (i < orderedSlots.length) {
    const startSlot = orderedSlots[i];
    const startAvailable = availableBySlot.get(startSlot) ?? new Set<string>();
    if (startAvailable.size < minPlayers) {
      i++;
      continue;
    }

    // Étendre tant qu'on peut, en intersectant
    let j = i;
    let common = new Set(startAvailable);
    while (j + 1 < orderedSlots.length) {
      const nextSlot = orderedSlots[j + 1];
      if (!areConsecutiveSlots(orderedSlots[j], nextSlot)) break;
      const nextAvailable = availableBySlot.get(nextSlot) ?? new Set<string>();
      const intersection = new Set<string>();
      for (const p of common) if (nextAvailable.has(p)) intersection.add(p);
      if (intersection.size < minPlayers) break;
      common = intersection;
      j++;
    }

    const durationMinutes = (j - i + 1) * SLOT_DURATION_MINUTES;
    if (durationMinutes >= minDurationMinutes) {
      blocks.push({
        startSlot: orderedSlots[i],
        endSlot: orderedSlots[j],
        durationMinutes,
        playerIds: Array.from(common).sort(),
      });
    }
    i = j + 1;
  }
  return blocks;
}

// ─── Helpers d'affichage (côté front) ───────────────────────────────────

/** Libellé court d'un slot "2026-04-14T20:00" → "20:00". */
export function formatSlotTime(slot: string): string {
  return slot.slice(11, 16);
}

/** Fin (inclusive) d'un slot 30min — utile pour afficher "20:00-20:30". */
export function formatSlotRange(slot: string): string {
  const end = addMinutesToIso(slot, SLOT_DURATION_MINUTES);
  return `${formatSlotTime(slot)}-${formatSlotTime(end)}`;
}

/** Libellé d'un bloc : "Mardi 14 avril 20:00-22:00 (2h)". */
export function formatBlockRange(block: MatchBlock): string {
  const endPlus30 = addMinutesToIso(block.endSlot, SLOT_DURATION_MINUTES);
  return `${formatSlotTime(block.startSlot)}-${formatSlotTime(endPlus30)}`;
}
