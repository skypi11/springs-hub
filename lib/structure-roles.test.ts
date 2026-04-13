import { describe, it, expect } from 'vitest';
import {
  isFounder,
  isCoFounder,
  isDirigeant,
  countDirigeantSeats,
  hasReachedSeatLimit,
  noticeTimestampToMs,
  departureNoticeRemainingMs,
  isDepartureNoticeExpired,
  expiredDepartures,
  MAX_SEATS_PER_PERSON,
  DEPARTURE_NOTICE_MS,
  type DirigeantRef,
} from './structure-roles';

describe('isFounder', () => {
  it('true quand le uid correspond', () => {
    expect(isFounder({ founderId: 'u1' }, 'u1')).toBe(true);
  });
  it('false quand le uid diffère', () => {
    expect(isFounder({ founderId: 'u1' }, 'u2')).toBe(false);
  });
  it('false avec un uid vide', () => {
    expect(isFounder({ founderId: 'u1' }, '')).toBe(false);
  });
});

describe('isCoFounder', () => {
  it('true quand uid est dans coFounderIds', () => {
    expect(isCoFounder({ coFounderIds: ['u1', 'u2'] }, 'u2')).toBe(true);
  });
  it('false quand uid absent', () => {
    expect(isCoFounder({ coFounderIds: ['u1'] }, 'u2')).toBe(false);
  });
  it('false quand coFounderIds est undefined', () => {
    expect(isCoFounder({}, 'u2')).toBe(false);
  });
  it('false avec uid vide', () => {
    expect(isCoFounder({ coFounderIds: [''] }, '')).toBe(false);
  });
});

describe('isDirigeant', () => {
  it('true pour le fondateur', () => {
    expect(isDirigeant({ founderId: 'u1', coFounderIds: [], status: 'active' }, 'u1')).toBe(true);
  });
  it('true pour un co-fondateur', () => {
    expect(isDirigeant({ founderId: 'u2', coFounderIds: ['u1'], status: 'active' }, 'u1')).toBe(true);
  });
  it('false pour un membre simple', () => {
    expect(isDirigeant({ founderId: 'u2', coFounderIds: ['u3'], status: 'active' }, 'u1')).toBe(false);
  });
});

describe('countDirigeantSeats', () => {
  const s = (id: string, founderId: string, coFounderIds: string[] = [], status = 'active'): DirigeantRef => ({
    id, founderId, coFounderIds, status,
  });

  it('compte les structures où uid est fondateur', () => {
    const structures = [s('a', 'u1'), s('b', 'u1'), s('c', 'u2')];
    expect(countDirigeantSeats(structures, 'u1')).toBe(2);
  });

  it('compte les structures où uid est co-fondateur', () => {
    const structures = [s('a', 'u2', ['u1']), s('b', 'u3', ['u1', 'u4'])];
    expect(countDirigeantSeats(structures, 'u1')).toBe(2);
  });

  it('mixe fondateur + co-fondateur', () => {
    const structures = [s('a', 'u1'), s('b', 'u2', ['u1'])];
    expect(countDirigeantSeats(structures, 'u1')).toBe(2);
  });

  it('ignore les structures avec un statut hors SEAT_COUNTING_STATUSES', () => {
    const structures = [s('a', 'u1', [], 'rejected'), s('b', 'u1', [], 'active')];
    expect(countDirigeantSeats(structures, 'u1')).toBe(1);
  });

  it('compte suspended, orphaned, deletion_scheduled, pending_validation', () => {
    const structures = [
      s('a', 'u1', [], 'suspended'),
      s('b', 'u1', [], 'orphaned'),
      s('c', 'u1', [], 'deletion_scheduled'),
      s('d', 'u1', [], 'pending_validation'),
    ];
    expect(countDirigeantSeats(structures, 'u1')).toBe(4);
  });

  it('exclut la structure passée en paramètre ignoreStructureId', () => {
    const structures = [s('a', 'u1'), s('b', 'u1')];
    expect(countDirigeantSeats(structures, 'u1', 'a')).toBe(1);
  });

  it('déduplique par id (même doc listé deux fois)', () => {
    const doc = s('a', 'u1', ['u1']);
    expect(countDirigeantSeats([doc, doc], 'u1')).toBe(1);
  });

  it('renvoie 0 si uid absent partout', () => {
    expect(countDirigeantSeats([s('a', 'u1')], 'u2')).toBe(0);
  });
});

describe('hasReachedSeatLimit', () => {
  const s = (id: string, founderId: string, coFounderIds: string[] = []): DirigeantRef => ({
    id, founderId, coFounderIds, status: 'active',
  });

  it('true dès que le compte atteint MAX_SEATS_PER_PERSON', () => {
    const structures = Array.from({ length: MAX_SEATS_PER_PERSON }, (_, i) => s(`s${i}`, 'u1'));
    expect(hasReachedSeatLimit(structures, 'u1')).toBe(true);
  });

  it('false si en dessous de la limite', () => {
    expect(hasReachedSeatLimit([s('a', 'u1')], 'u1')).toBe(false);
  });

  it('respecte ignoreStructureId', () => {
    const structures = [s('a', 'u1'), s('b', 'u1')];
    expect(hasReachedSeatLimit(structures, 'u1', 'a')).toBe(false);
  });
});

describe('noticeTimestampToMs', () => {
  it('lit un Firestore Timestamp via toMillis()', () => {
    const ts = { toMillis: () => 1234567890 };
    expect(noticeTimestampToMs(ts)).toBe(1234567890);
  });
  it('lit un objet Date', () => {
    const d = new Date(1000);
    expect(noticeTimestampToMs(d)).toBe(1000);
  });
  it('lit un number epoch', () => {
    expect(noticeTimestampToMs(42)).toBe(42);
  });
  it('lit une ISO string', () => {
    expect(noticeTimestampToMs('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
  });
  it('renvoie null pour null/undefined', () => {
    expect(noticeTimestampToMs(null)).toBe(null);
    expect(noticeTimestampToMs(undefined)).toBe(null);
  });
  it('renvoie null pour une string non parseable', () => {
    expect(noticeTimestampToMs('pas une date')).toBe(null);
  });
});

describe('departureNoticeRemainingMs', () => {
  it('renvoie null si pas de préavis', () => {
    expect(departureNoticeRemainingMs(null)).toBe(null);
  });
  it('renvoie le temps restant si préavis récent', () => {
    const now = 1_000_000_000;
    const noticeAt = now - 1000; // il y a 1s
    expect(departureNoticeRemainingMs(noticeAt, now)).toBe(DEPARTURE_NOTICE_MS - 1000);
  });
  it('renvoie 0 si préavis expiré', () => {
    const now = 1_000_000_000;
    const noticeAt = now - DEPARTURE_NOTICE_MS - 1;
    expect(departureNoticeRemainingMs(noticeAt, now)).toBe(0);
  });
});

describe('isDepartureNoticeExpired', () => {
  it('false si pas de préavis', () => {
    expect(isDepartureNoticeExpired(null)).toBe(false);
  });
  it('false si préavis en cours', () => {
    const now = 1_000_000_000;
    expect(isDepartureNoticeExpired(now - 1000, now)).toBe(false);
  });
  it('true si 7 jours passés', () => {
    const now = 1_000_000_000;
    expect(isDepartureNoticeExpired(now - DEPARTURE_NOTICE_MS - 1, now)).toBe(true);
  });
});

describe('expiredDepartures', () => {
  it('renvoie [] si map absente ou vide', () => {
    expect(expiredDepartures(undefined)).toEqual([]);
    expect(expiredDepartures({})).toEqual([]);
  });

  it('filtre uniquement les uids expirés', () => {
    const now = 1_000_000_000;
    const departures = {
      u1: now - 1000, // récent
      u2: now - DEPARTURE_NOTICE_MS - 1, // expiré
      u3: now - DEPARTURE_NOTICE_MS * 2, // expiré
    };
    const expired = expiredDepartures(departures, now);
    expect(expired.sort()).toEqual(['u2', 'u3']);
  });

  it('ignore les entrées avec timestamp illisible', () => {
    const departures = { u1: 'pas une date' };
    expect(expiredDepartures(departures, Date.now())).toEqual([]);
  });
});
