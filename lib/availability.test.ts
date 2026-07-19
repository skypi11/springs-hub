import { describe, it, expect } from 'vitest';
import {
  addDays,
  isoDayOfWeek,
  getMondayYmd,
  getIsoWeekId,
  addMinutesToIso,
  generateDaySlots,
  generateWeekGrid,
  validSlotsForWeek,
  DAY_SCHEDULES,
  areConsecutiveSlots,
  eventCoversSlot,
  findMatchBlocks,
  formatSlotTime,
  formatSlotRange,
  formatBlockRange,
  validateWeekSlots,
  mergeFrozenPastSlots,
  slotsBetween,
  MAX_SLOTS_PER_WEEK,
} from './availability';

// ─── Helpers date / string ──────────────────────────────────────────────

describe('addDays', () => {
  it('adds days forward', () => {
    expect(addDays('2026-04-14', 1)).toBe('2026-04-15');
    expect(addDays('2026-04-14', 7)).toBe('2026-04-21');
  });
  it('adds days backward', () => {
    expect(addDays('2026-04-14', -1)).toBe('2026-04-13');
  });
  it('crosses month', () => {
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30');
  });
  it('crosses year', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('isoDayOfWeek', () => {
  it('returns 1 for Monday', () => {
    expect(isoDayOfWeek('2026-04-13')).toBe(1); // lundi 13 avril 2026
  });
  it('returns 7 for Sunday', () => {
    expect(isoDayOfWeek('2026-04-19')).toBe(7);
  });
  it('returns 3 for Wednesday', () => {
    expect(isoDayOfWeek('2026-04-15')).toBe(3);
  });
});

describe('getMondayYmd', () => {
  it('returns the Monday of a Wednesday', () => {
    expect(getMondayYmd('2026-04-15')).toBe('2026-04-13');
  });
  it('returns itself for a Monday', () => {
    expect(getMondayYmd('2026-04-13')).toBe('2026-04-13');
  });
  it('returns the Monday for a Sunday', () => {
    expect(getMondayYmd('2026-04-19')).toBe('2026-04-13');
  });
});

describe('getIsoWeekId', () => {
  it('formats the current week correctly', () => {
    // 2026-04-13 est un lundi, semaine ISO 16
    expect(getIsoWeekId('2026-04-13')).toBe('2026-W16');
  });
  it('handles year-end rollover', () => {
    // Semaine 1 2026 commence le lundi 29 décembre 2025
    expect(getIsoWeekId('2025-12-29')).toBe('2026-W01');
  });
  it('handles year 53', () => {
    // 2020 a 53 semaines ISO, semaine 53 commence le 28 décembre 2020
    expect(getIsoWeekId('2020-12-28')).toBe('2020-W53');
  });
});

describe('addMinutesToIso', () => {
  it('adds 30 minutes within the hour', () => {
    expect(addMinutesToIso('2026-04-14T20:00', 30)).toBe('2026-04-14T20:30');
  });
  it('crosses hour boundary', () => {
    expect(addMinutesToIso('2026-04-14T20:30', 30)).toBe('2026-04-14T21:00');
  });
  it('crosses day boundary', () => {
    expect(addMinutesToIso('2026-04-14T23:30', 30)).toBe('2026-04-15T00:00');
  });
  it('supports negative values', () => {
    expect(addMinutesToIso('2026-04-15T00:00', -30)).toBe('2026-04-14T23:30');
  });
  it('adds multiple hours', () => {
    expect(addMinutesToIso('2026-04-14T20:00', 120)).toBe('2026-04-14T22:00');
  });
});

// ─── Génération des slots ──────────────────────────────────────────────

describe('generateDaySlots', () => {
  it('generates 36 slots per day (8h → 2h next day)', () => {
    const slots = generateDaySlots('2026-04-14', DAY_SCHEDULES[2]); // mardi
    expect(slots).toHaveLength(36);
    expect(slots[0]).toBe('2026-04-14T08:00');
    expect(slots[31]).toBe('2026-04-14T23:30');
    expect(slots[32]).toBe('2026-04-15T00:00');
    expect(slots[35]).toBe('2026-04-15T01:30');
  });
  it('uses the same uniform schedule for every day of the week', () => {
    for (let dow = 1; dow <= 7; dow++) {
      const slots = generateDaySlots('2026-04-14', DAY_SCHEDULES[dow]);
      expect(slots).toHaveLength(36);
      expect(slots[0]).toBe('2026-04-14T08:00');
    }
  });
  it('slots are chronologically sorted', () => {
    const slots = generateDaySlots('2026-04-14', DAY_SCHEDULES[2]);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i] > slots[i - 1]).toBe(true);
    }
  });
});

describe('generateWeekGrid', () => {
  it('generates 7 days starting Monday', () => {
    const grid = generateWeekGrid('2026-04-13', '2026-04-13');
    expect(grid.days).toHaveLength(7);
    expect(grid.days[0].dayOfWeek).toBe(1); // lundi
    expect(grid.days[0].gridYmd).toBe('2026-04-13');
    expect(grid.days[6].dayOfWeek).toBe(7); // dimanche
    expect(grid.days[6].gridYmd).toBe('2026-04-19');
  });
  it('computes weekId correctly', () => {
    const grid = generateWeekGrid('2026-04-13', '2026-04-13');
    expect(grid.weekId).toBe('2026-W16');
  });
  it('marks past days as read-only', () => {
    const grid = generateWeekGrid('2026-04-13', '2026-04-16'); // on est jeudi
    expect(grid.days[0].isPast).toBe(true);  // lundi
    expect(grid.days[1].isPast).toBe(true);  // mardi
    expect(grid.days[2].isPast).toBe(true);  // mercredi
    expect(grid.days[3].isPast).toBe(false); // jeudi
    expect(grid.days[4].isPast).toBe(false); // vendredi
  });
  it('total slots for a week = 252 (7 × 36)', () => {
    const grid = generateWeekGrid('2026-04-13', '2026-04-13');
    const total = grid.days.reduce((sum, d) => sum + d.slots.length, 0);
    expect(total).toBe(7 * 36);
  });
});

describe('validSlotsForWeek', () => {
  it('returns a set with all week slots', () => {
    const valid = validSlotsForWeek('2026-04-13');
    expect(valid.size).toBe(252);
    expect(valid.has('2026-04-13T08:00')).toBe(true);   // lundi 8h (début de journée)
    expect(valid.has('2026-04-13T17:00')).toBe(true);   // lundi 17h
    expect(valid.has('2026-04-14T01:30')).toBe(true);   // nuit lundi→mardi
    expect(valid.has('2026-04-13T07:30')).toBe(false);  // avant 8h
    expect(valid.has('2026-04-14T02:00')).toBe(false);  // après fin lundi (2h max)
  });
});

// ─── Consécutivité et conflit d'events ─────────────────────────────────

describe('areConsecutiveSlots', () => {
  it('true for slot + 30min', () => {
    expect(areConsecutiveSlots('2026-04-14T20:00', '2026-04-14T20:30')).toBe(true);
    expect(areConsecutiveSlots('2026-04-14T23:30', '2026-04-15T00:00')).toBe(true);
  });
  it('false for non-consecutive', () => {
    expect(areConsecutiveSlots('2026-04-14T20:00', '2026-04-14T21:00')).toBe(false);
    expect(areConsecutiveSlots('2026-04-14T20:00', '2026-04-14T20:00')).toBe(false);
  });
});

describe('eventCoversSlot', () => {
  it('covers when event fully contains slot', () => {
    expect(
      eventCoversSlot('2026-04-14T19:00', '2026-04-14T22:00', '2026-04-14T20:00'),
    ).toBe(true);
  });
  it('covers when event starts within slot', () => {
    expect(
      eventCoversSlot('2026-04-14T20:15', '2026-04-14T21:00', '2026-04-14T20:00'),
    ).toBe(true);
  });
  it('covers when event ends within slot', () => {
    expect(
      eventCoversSlot('2026-04-14T19:30', '2026-04-14T20:15', '2026-04-14T20:00'),
    ).toBe(true);
  });
  it('does not cover when event is entirely before slot', () => {
    expect(
      eventCoversSlot('2026-04-14T18:00', '2026-04-14T20:00', '2026-04-14T20:00'),
    ).toBe(false);
  });
  it('does not cover when event is entirely after slot', () => {
    expect(
      eventCoversSlot('2026-04-14T20:30', '2026-04-14T22:00', '2026-04-14T20:00'),
    ).toBe(false);
  });
});

// ─── Matching ───────────────────────────────────────────────────────────

describe('findMatchBlocks', () => {
  const orderedSlots = [
    '2026-04-14T20:00',
    '2026-04-14T20:30',
    '2026-04-14T21:00',
    '2026-04-14T21:30',
    '2026-04-14T22:00',
  ];

  it('returns empty when no player is available', () => {
    const blocks = findMatchBlocks({
      playerSlots: {},
      conflictSlotsByPlayer: {},
      orderedSlots,
      minPlayers: 3,
      minDurationMinutes: 60,
    });
    expect(blocks).toEqual([]);
  });

  it('returns a single block when 3 players are available for the whole window', () => {
    const allSlots = new Set(orderedSlots);
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(allSlots),
        p2: new Set(allSlots),
        p3: new Set(allSlots),
      },
      conflictSlotsByPlayer: {},
      orderedSlots,
      minPlayers: 3,
      minDurationMinutes: 60,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startSlot).toBe('2026-04-14T20:00');
    expect(blocks[0].endSlot).toBe('2026-04-14T22:00');
    expect(blocks[0].durationMinutes).toBe(150); // 5 slots × 30min
    expect(blocks[0].playerIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('rejects blocks shorter than minDurationMinutes', () => {
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(['2026-04-14T20:00']),
        p2: new Set(['2026-04-14T20:00']),
        p3: new Set(['2026-04-14T20:00']),
      },
      conflictSlotsByPlayer: {},
      orderedSlots,
      minPlayers: 3,
      minDurationMinutes: 60,
    });
    // 1 slot seul = 30min, < 60min → rejeté
    expect(blocks).toEqual([]);
  });

  it('yields a 1h block when exactly 2 consecutive slots match', () => {
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(['2026-04-14T20:00', '2026-04-14T20:30']),
        p2: new Set(['2026-04-14T20:00', '2026-04-14T20:30']),
        p3: new Set(['2026-04-14T20:00', '2026-04-14T20:30']),
      },
      conflictSlotsByPlayer: {},
      orderedSlots,
      minPlayers: 3,
      minDurationMinutes: 60,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].durationMinutes).toBe(60);
  });

  it('respects minPlayers intersection (same players across the whole block)', () => {
    // p1 dispo partout, p2 dispo que sur les 2 premiers, p3 dispo que sur les 2 derniers
    // Avec minPlayers=2, le bloc {p1,p2} couvre les 2 premiers slots
    // puis {p1,p3} couvre les 2 derniers slots
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(orderedSlots),
        p2: new Set(['2026-04-14T20:00', '2026-04-14T20:30']),
        p3: new Set(['2026-04-14T21:30', '2026-04-14T22:00']),
      },
      conflictSlotsByPlayer: {},
      orderedSlots,
      minPlayers: 2,
      minDurationMinutes: 60,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].playerIds).toEqual(['p1', 'p2']);
    expect(blocks[0].durationMinutes).toBe(60);
    expect(blocks[1].playerIds).toEqual(['p1', 'p3']);
    expect(blocks[1].durationMinutes).toBe(60);
  });

  it('excludes players with conflict on a slot', () => {
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(orderedSlots),
        p2: new Set(orderedSlots),
        p3: new Set(orderedSlots),
      },
      conflictSlotsByPlayer: {
        // p3 a un event pile sur le 2e slot → on retombe à 2 joueurs
        p3: new Set(['2026-04-14T20:30']),
      },
      orderedSlots,
      minPlayers: 3,
      minDurationMinutes: 60,
    });
    // On cherche 3 joueurs minimum, avec p3 out sur le 2e slot :
    // - Slot 1 (20:00) : {p1,p2,p3} → on démarre
    // - Slot 2 (20:30) : {p1,p2} (p3 out) → intersection devient {p1,p2}, size 2 < 3 → stop
    // → bloc yield = slot 1 seul, 30min, < 60min → rejeté
    // Puis on reprend au slot 2 : {p1,p2} < 3 → skip
    // Puis slot 3 : {p1,p2,p3} → on démarre un nouveau bloc qui va jusqu'au bout
    // Bloc slot 3-5 = 90min, 3 joueurs
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startSlot).toBe('2026-04-14T21:00');
    expect(blocks[0].endSlot).toBe('2026-04-14T22:00');
    expect(blocks[0].durationMinutes).toBe(90);
    expect(blocks[0].playerIds).toEqual(['p1', 'p2', 'p3']);
  });

  it('splits at non-consecutive slots', () => {
    // Gap entre 20:30 et 21:30 (pas de 21:00 dans orderedSlots)
    const blocks = findMatchBlocks({
      playerSlots: {
        p1: new Set(['2026-04-14T20:00', '2026-04-14T20:30', '2026-04-14T21:30', '2026-04-14T22:00']),
        p2: new Set(['2026-04-14T20:00', '2026-04-14T20:30', '2026-04-14T21:30', '2026-04-14T22:00']),
      },
      conflictSlotsByPlayer: {},
      orderedSlots: ['2026-04-14T20:00', '2026-04-14T20:30', '2026-04-14T21:30', '2026-04-14T22:00'],
      minPlayers: 2,
      minDurationMinutes: 60,
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0].startSlot).toBe('2026-04-14T20:00');
    expect(blocks[0].endSlot).toBe('2026-04-14T20:30');
    expect(blocks[1].startSlot).toBe('2026-04-14T21:30');
    expect(blocks[1].endSlot).toBe('2026-04-14T22:00');
  });
});

// ─── Helpers d'affichage ────────────────────────────────────────────────

describe('formatSlotTime', () => {
  it('extracts HH:MM from slot', () => {
    expect(formatSlotTime('2026-04-14T20:00')).toBe('20:00');
    expect(formatSlotTime('2026-04-15T00:30')).toBe('00:30');
  });
});

describe('formatSlotRange', () => {
  it('formats a 30min range', () => {
    expect(formatSlotRange('2026-04-14T20:00')).toBe('20:00-20:30');
    expect(formatSlotRange('2026-04-14T23:30')).toBe('23:30-00:00');
  });
});

describe('formatBlockRange', () => {
  it('formats a multi-slot block', () => {
    expect(
      formatBlockRange({
        startSlot: '2026-04-14T20:00',
        endSlot: '2026-04-14T21:30',
        durationMinutes: 120,
        playerIds: ['p1', 'p2', 'p3'],
      }),
    ).toBe('20:00-22:00');
  });
});

// ─── Validation d'un PUT de dispos ──────────────────────────────────────

// Semaines de référence : lundi 13/07/2026 (courante si today = jeudi 16/07),
// lundi 20/07/2026 (suivante), lundi 06/07/2026 (passée).
const MONDAY = '2026-07-13';
const NEXT_MONDAY = '2026-07-20';
const TODAY = '2026-07-16';

describe('validateWeekSlots', () => {
  it('rejects a malformed mondayYmd', () => {
    expect(validateWeekSlots({ mondayYmd: '13/07/2026', slots: [] }, TODAY))
      .toEqual({ ok: false, error: 'mondayYmd invalide.' });
    expect(validateWeekSlots({ slots: [] }, TODAY))
      .toEqual({ ok: false, error: 'mondayYmd invalide.' });
    expect(validateWeekSlots(null, TODAY))
      .toEqual({ ok: false, error: 'mondayYmd invalide.' });
  });

  it('rejects a date that is not a monday', () => {
    expect(validateWeekSlots({ mondayYmd: '2026-07-14', slots: [] }, TODAY))
      .toEqual({ ok: false, error: 'La date doit être un lundi.' });
  });

  it('rejects a missing slots array', () => {
    expect(validateWeekSlots({ mondayYmd: MONDAY }, TODAY))
      .toEqual({ ok: false, error: 'slots requis (array).' });
  });

  it('rejects too many slots', () => {
    const slots = Array.from({ length: MAX_SLOTS_PER_WEEK + 1 }, (_, i) => `slot${i}`);
    expect(validateWeekSlots({ mondayYmd: MONDAY, slots }, TODAY))
      .toEqual({ ok: false, error: 'Trop de slots.' });
  });

  it('rejects a past week', () => {
    expect(validateWeekSlots({ mondayYmd: '2026-07-06', slots: [] }, TODAY))
      .toEqual({ ok: false, error: 'Les semaines passées ne peuvent pas être modifiées.' });
  });

  it('keeps valid slots, deduped and sorted', () => {
    const res = validateWeekSlots(
      { mondayYmd: NEXT_MONDAY, slots: ['2026-07-21T20:30', '2026-07-20T20:00', '2026-07-21T20:30'] },
      TODAY,
    );
    expect(res).toEqual({
      ok: true,
      mondayYmd: NEXT_MONDAY,
      slots: ['2026-07-20T20:00', '2026-07-21T20:30'],
    });
  });

  it('drops slots that do not belong to the week or to the schedule', () => {
    const res = validateWeekSlots(
      {
        mondayYmd: NEXT_MONDAY,
        slots: [
          '2026-07-20T20:00',  // valide
          '2026-07-20T07:30',  // avant 8h
          '2026-08-03T20:00',  // autre semaine
          '2026-07-20T20:15',  // pas aligné sur 30min
          42,                  // pas une string
        ],
      },
      TODAY,
    );
    expect(res).toEqual({ ok: true, mondayYmd: NEXT_MONDAY, slots: ['2026-07-20T20:00'] });
  });

  it("keeps sunday's after-midnight slots, which are dated on the next monday", () => {
    // Piège : "2026-07-20T01:30" est le dimanche soir de la semaine du 13/07,
    // pas le lundi 20/07 (cf. generateDaySlots).
    const res = validateWeekSlots(
      { mondayYmd: MONDAY, slots: ['2026-07-20T00:00', '2026-07-20T01:30', '2026-07-20T02:00'] },
      TODAY,
    );
    expect(res).toEqual({
      ok: true,
      mondayYmd: MONDAY,
      slots: ['2026-07-20T00:00', '2026-07-20T01:30'], // 02:00 hors plage
    });
  });

  it('drops past days on the current week but keeps today', () => {
    const res = validateWeekSlots(
      {
        mondayYmd: MONDAY,
        slots: ['2026-07-13T20:00', '2026-07-15T20:00', '2026-07-16T20:00', '2026-07-18T20:00'],
      },
      TODAY,
    );
    expect(res).toEqual({
      ok: true,
      mondayYmd: MONDAY,
      slots: ['2026-07-16T20:00', '2026-07-18T20:00'],
    });
  });

  it('keeps every day of a future week', () => {
    const res = validateWeekSlots(
      { mondayYmd: NEXT_MONDAY, slots: ['2026-07-20T20:00', '2026-07-26T20:00'] },
      TODAY,
    );
    expect(res).toEqual({
      ok: true,
      mondayYmd: NEXT_MONDAY,
      slots: ['2026-07-20T20:00', '2026-07-26T20:00'],
    });
  });
});

describe('mergeFrozenPastSlots', () => {
  it('keeps the past slots already stored on the current week', () => {
    expect(mergeFrozenPastSlots(
      MONDAY,
      TODAY,
      ['2026-07-16T20:00'],
      ['2026-07-13T21:00', '2026-07-14T20:00', '2026-07-17T20:00'],
    )).toEqual(['2026-07-13T21:00', '2026-07-14T20:00', '2026-07-16T20:00']);
  });

  it('never resurrects a stored slot of a day still to come', () => {
    expect(mergeFrozenPastSlots(MONDAY, TODAY, [], ['2026-07-18T20:00'])).toEqual([]);
  });

  it('ignores stored slots on a future week', () => {
    expect(mergeFrozenPastSlots(
      NEXT_MONDAY,
      TODAY,
      ['2026-07-21T20:00'],
      ['2026-07-20T20:00'],
    )).toEqual(['2026-07-21T20:00']);
  });

  it('dedupes and sorts', () => {
    expect(mergeFrozenPastSlots(
      MONDAY,
      TODAY,
      ['2026-07-16T20:00', '2026-07-16T20:00'],
      ['2026-07-14T20:00'],
    )).toEqual(['2026-07-14T20:00', '2026-07-16T20:00']);
  });
});

// ─── Sélection par plage (grille mobile) ────────────────────────────────

describe('slotsBetween', () => {
  const col = [
    '2026-07-20T16:00',
    '2026-07-20T16:30',
    '2026-07-20T17:00',
    '2026-07-20T17:30',
    '2026-07-20T18:00',
  ];

  it('returns the inclusive range anchor → target (downward)', () => {
    expect(slotsBetween(col, '2026-07-20T16:30', '2026-07-20T17:30')).toEqual([
      '2026-07-20T16:30', '2026-07-20T17:00', '2026-07-20T17:30',
    ]);
  });

  it('is order-independent (anchor below target)', () => {
    expect(slotsBetween(col, '2026-07-20T17:30', '2026-07-20T16:30')).toEqual([
      '2026-07-20T16:30', '2026-07-20T17:00', '2026-07-20T17:30',
    ]);
  });

  it('returns a single cell when anchor === target', () => {
    expect(slotsBetween(col, '2026-07-20T17:00', '2026-07-20T17:00')).toEqual(['2026-07-20T17:00']);
  });

  it('spans the full column', () => {
    expect(slotsBetween(col, '2026-07-20T16:00', '2026-07-20T18:00')).toEqual(col);
  });

  it('returns [] when the anchor is no longer in the column (hidden after collapse)', () => {
    // Ancre à 08:00 hors de la vue soirée → l'appelant doit ré-armer l'ancre.
    expect(slotsBetween(col, '2026-07-20T08:00', '2026-07-20T17:00')).toEqual([]);
  });

  it('returns [] when the target is absent', () => {
    expect(slotsBetween(col, '2026-07-20T16:00', '2026-07-20T23:00')).toEqual([]);
  });

  it('works on a real evening slice of the axis (crosses midnight in full view)', () => {
    // Vue complète : 23:30 (même jour) → 00:30 (lendemain), contiguïté visuelle.
    const late = ['2026-07-20T23:00', '2026-07-20T23:30', '2026-07-21T00:00', '2026-07-21T00:30'];
    expect(slotsBetween(late, '2026-07-20T23:30', '2026-07-21T00:30')).toEqual([
      '2026-07-20T23:30', '2026-07-21T00:00', '2026-07-21T00:30',
    ]);
  });
});
