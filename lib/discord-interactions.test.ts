import { describe, it, expect, vi } from 'vitest';
import {
  parsePresenceCustomId,
  buildPresenceCustomId,
  buildPresenceComponents,
  extractDiscordUserId,
  handleInteraction,
  type DiscordInteraction,
  type HandleInteractionDeps,
} from './discord-interactions';
import type { WritePresenceResult } from './event-presence-server';

describe('parsePresenceCustomId', () => {
  it('parses a valid custom_id', () => {
    expect(parsePresenceCustomId('pres.v1:aB3xYz9KpQ2Lm7:present'))
      .toEqual({ eventId: 'aB3xYz9KpQ2Lm7', status: 'present' });
    expect(parsePresenceCustomId('pres.v1:evt:maybe')).toEqual({ eventId: 'evt', status: 'maybe' });
    expect(parsePresenceCustomId('pres.v1:evt:absent')).toEqual({ eventId: 'evt', status: 'absent' });
  });

  it('rejects an unknown namespace (other feature / legacy)', () => {
    expect(parsePresenceCustomId('todo.v1:evt:done')).toBeNull();
    expect(parsePresenceCustomId('pres.v2:evt:present')).toBeNull();
  });

  it('rejects a non-button status (pending is not a button)', () => {
    expect(parsePresenceCustomId('pres.v1:evt:pending')).toBeNull();
    expect(parsePresenceCustomId('pres.v1:evt:bogus')).toBeNull();
  });

  it('rejects wrong shape / empty eventId / null', () => {
    expect(parsePresenceCustomId('pres.v1:evt')).toBeNull();
    expect(parsePresenceCustomId('pres.v1:evt:present:extra')).toBeNull();
    expect(parsePresenceCustomId('pres.v1::present')).toBeNull();
    expect(parsePresenceCustomId('')).toBeNull();
    expect(parsePresenceCustomId(null)).toBeNull();
    expect(parsePresenceCustomId(undefined)).toBeNull();
  });

  it('round-trips with buildPresenceCustomId and stays under 100 chars', () => {
    const id = buildPresenceCustomId('aB3xYz9KpQ2Lm7wRtV0z', 'present'); // 20-char Firestore id
    expect(id.length).toBeLessThanOrEqual(100);
    expect(parsePresenceCustomId(id)).toEqual({ eventId: 'aB3xYz9KpQ2Lm7wRtV0z', status: 'present' });
  });
});

describe('buildPresenceComponents', () => {
  it('builds one action row with 3 buttons wired to the event', () => {
    const rows = buildPresenceComponents('evt1') as Array<{
      type: number; components: Array<{ type: number; style: number; label: string; custom_id: string; emoji: { name: string } }>;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(1); // action row
    const btns = rows[0].components;
    expect(btns).toHaveLength(3);
    expect(btns.every(b => b.type === 2)).toBe(true);
    expect(btns.map(b => b.custom_id)).toEqual([
      'pres.v1:evt1:present', 'pres.v1:evt1:maybe', 'pres.v1:evt1:absent',
    ]);
    expect(btns.map(b => b.label)).toEqual(['Présent', 'Peut-être', 'Absent']);
    expect(btns.map(b => b.style)).toEqual([3, 2, 4]); // success, secondary, danger
  });
});

describe('extractDiscordUserId', () => {
  it('reads member.user.id in a guild', () => {
    expect(extractDiscordUserId({ type: 3, member: { user: { id: '123' } } })).toBe('123');
  });
  it('falls back to user.id in a DM', () => {
    expect(extractDiscordUserId({ type: 3, user: { id: '456' } })).toBe('456');
  });
  it('prefers member over user when both present', () => {
    expect(extractDiscordUserId({ type: 3, member: { user: { id: 'g' } }, user: { id: 'd' } })).toBe('g');
  });
  it('returns null when absent', () => {
    expect(extractDiscordUserId({ type: 3 })).toBeNull();
  });
});

// Fabrique des deps injectables pour handleInteraction.
function deps(overrides: Partial<HandleInteractionDeps> = {}): HandleInteractionDeps {
  return {
    recordPresence: vi.fn(async (): Promise<WritePresenceResult> => ({ ok: true, from: 'pending', to: 'present' })),
    checkRate: vi.fn(async () => false),
    ...overrides,
  };
}

const buttonClick = (customId: string, userId = '123'): DiscordInteraction => ({
  type: 3,
  data: { custom_id: customId, component_type: 2 },
  member: { user: { id: userId } },
});

describe('handleInteraction', () => {
  it('answers PING with PONG', async () => {
    const res = await handleInteraction({ type: 1 }, deps());
    expect(res).toEqual({ type: 1 });
  });

  it('records presence and confirms ephemerally on a valid click', async () => {
    const d = deps();
    const res = await handleInteraction(buttonClick('pres.v1:evt1:present'), d);
    expect(d.recordPresence).toHaveBeenCalledWith('evt1', '123', 'present');
    expect(res.type).toBe(4);
    expect(res.data?.flags).toBe(64); // ephemeral
    expect(res.data?.content).toContain('Présent');
  });

  it('surfaces "not invited" without recording', async () => {
    const d = deps({ recordPresence: vi.fn(async () => ({ ok: false as const, code: 'not_invited' as const })) });
    const res = await handleInteraction(buttonClick('pres.v1:evt1:absent'), d);
    expect(res.type).toBe(4);
    expect(res.data?.content?.toLowerCase()).toContain('invités');
  });

  it('surfaces a closed event', async () => {
    const d = deps({ recordPresence: vi.fn(async () => ({ ok: false as const, code: 'event_closed' as const })) });
    const res = await handleInteraction(buttonClick('pres.v1:evt1:present'), d);
    expect(res.data?.content?.toLowerCase()).toMatch(/passé|clôtur/);
  });

  it('ignores an unknown custom_id with a silent ack (no write)', async () => {
    const d = deps();
    const res = await handleInteraction(buttonClick('todo.v1:x:done'), d);
    expect(res).toEqual({ type: 6 });
    expect(d.recordPresence).not.toHaveBeenCalled();
  });

  it('does not record when rate-limited', async () => {
    const d = deps({ checkRate: vi.fn(async () => true) });
    const res = await handleInteraction(buttonClick('pres.v1:evt1:present'), d);
    expect(d.recordPresence).not.toHaveBeenCalled();
    expect(res.type).toBe(4);
    expect(res.data?.content).toContain('Trop de clics');
  });

  it('silently acks a click with no identifiable user', async () => {
    const d = deps();
    const res = await handleInteraction({ type: 3, data: { custom_id: 'pres.v1:evt1:present', component_type: 2 } }, d);
    expect(res).toEqual({ type: 6 });
    expect(d.recordPresence).not.toHaveBeenCalled();
  });

  it('silently acks non-button interaction types', async () => {
    expect(await handleInteraction({ type: 5 }, deps())).toEqual({ type: 6 });
  });
});
