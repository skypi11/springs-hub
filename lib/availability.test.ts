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
  it('generates 18 slots for a weekday (17h → 2h next day)', () => {
    const slots = generateDaySlots('2026-04-14', DAY_SCHEDULES[2]); // mardi
    expect(slots).toHaveLength(18);
    expect(slots[0]).toBe('2026-04-14T17:00');
    expect(slots[13]).toBe('2026-04-14T23:30');
    expect(slots[14]).toBe('2026-04-15T00:00');
    expect(slots[17]).toBe('2026-04-15T01:30');
  });
  it('generates 28 slots for Wednesday (12h → 2h next day)', () => {
    const slots = generateDaySlots('2026-04-15', DAY_SCHEDULES[3]); // mercredi
    expect(slots).toHaveLength(28);
    expect(slots[0]).toBe('2026-04-15T12:00');
    expect(slots[23]).toBe('2026-04-15T23:30');
    expect(slots[24]).toBe('2026-04-16T00:00');
    expect(slots[27]).toBe('2026-04-16T01:30');
  });
  it('generates 32 slots for a weekend day (10h → 2h next day)', () => {
    const slots = generateDaySlots('2026-04-18', DAY_SCHEDULES[6]); // samedi
    expect(slots).toHaveLength(32);
    expect(slots[0]).toBe('2026-04-18T10:00');
    expect(slots[27]).toBe('2026-04-18T23:30');
    expect(slots[31]).toBe('2026-04-19T01:30');
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
  it('total slots for a week = 164 (4×18 + 1×28 + 2×32)', () => {
    const grid = generateWeekGrid('2026-04-13', '2026-04-13');
    const total = grid.days.reduce((sum, d) => sum + d.slots.length, 0);
    expect(total).toBe(4 * 18 + 28 + 2 * 32);
  });
});

describe('validSlotsForWeek', () => {
  it('returns a set with all week slots', () => {
    const valid = validSlotsForWeek('2026-04-13');
    expect(valid.size).toBe(164);
    expect(valid.has('2026-04-13T17:00')).toBe(true);   // lundi 17h
    expect(valid.has('2026-04-15T12:00')).toBe(true);   // mercredi 12h
    expect(valid.has('2026-04-18T10:00')).toBe(true);   // samedi 10h
    expect(valid.has('2026-04-13T16:30')).toBe(false);  // avant lundi 17h
    expect(valid.has('2026-04-14T03:00')).toBe(false);  // après fin lundi (2h max)
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
