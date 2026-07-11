import { describe, it, expect } from 'vitest';
import {
  validateEntry,
  openPhaseCheckin,
  submitCheckin,
  submitScores,
  openDispute,
  applyDeadlines,
  forceScore,
  validateForfeit,
  type FlowMatchState,
  type FlowConfig,
  type GamePair,
} from './match-flow';

const CFG: FlowConfig = { matchCheckinMinutes: 5, scoreCounterMinutes: 3 };
const NOW = 1_000_000_000;             // millis arbitraires (jamais Date.now())

function mkState(over: Partial<FlowMatchState> = {}): FlowMatchState {
  return {
    id: 'W1-1',
    bo: 5,
    teamA: 'regA',
    teamB: 'regB',
    voidA: false,
    voidB: false,
    status: 'pending',
    checkin: null,
    scores: { a: [], b: [], aSubmittedAtMs: null, bSubmittedAtMs: null, counterDeadlineMs: null },
    disputeOpen: false,
    ...over,
  };
}

const WIN_A_31: GamePair[] = [{ a: 3, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 0 }, { a: 4, b: 2 }];

describe('validateEntry', () => {
  it('accepte une saisie BO5 3-1 et identifie le vainqueur', () => {
    const r = validateEntry(WIN_A_31, 5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.winner).toBe('a');
  });

  it('rejette : manche nulle, manche après décision, pas de vainqueur net, buts invalides', () => {
    expect(validateEntry([{ a: 1, b: 1 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }], 5).ok).toBe(false);
    // 3 wins A puis une manche de plus
    expect(validateEntry([{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 0, b: 1 }], 5).ok).toBe(false);
    expect(validateEntry([{ a: 1, b: 0 }, { a: 1, b: 0 }], 5).ok).toBe(false);
    expect(validateEntry([{ a: -1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }], 5).ok).toBe(false);
    expect(validateEntry([{ a: 1.5, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }], 5).ok).toBe(false);
  });

  it('respecte le BO du match (BO7 : 4 manches gagnantes)', () => {
    const bo7 = [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }];
    expect(validateEntry(bo7, 7).ok).toBe(true);
    expect(validateEntry(bo7, 5).ok).toBe(false);   // 4e manche après décision en BO5
  });
});

describe('openPhaseCheckin (R5-2 : action admin explicite)', () => {
  it('ouvre le check-in avec la deadline à +5 min', () => {
    const r = openPhaseCheckin(mkState(), CFG, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deadlineMs).toBe(NOW + 5 * 60_000);
      expect(r.events[0]).toEqual({ kind: 'checkin_opened', deadlineMs: r.deadlineMs });
    }
  });

  it('refuse : équipe manquante, côté void, statut non pending, litige ouvert', () => {
    expect(openPhaseCheckin(mkState({ teamB: null }), CFG, NOW)).toEqual({ ok: false, error: 'teams_not_ready' });
    expect(openPhaseCheckin(mkState({ voidB: true }), CFG, NOW)).toEqual({ ok: false, error: 'teams_not_ready' });
    expect(openPhaseCheckin(mkState({ status: 'live' }), CFG, NOW)).toEqual({ ok: false, error: 'invalid_state' });
    expect(openPhaseCheckin(mkState({ disputeOpen: true }), CFG, NOW)).toEqual({ ok: false, error: 'dispute_open' });
  });
});

describe('submitCheckin (capitaine seul, camp dérivé serveur)', () => {
  const inCheckin = (a = false, b = false) => mkState({
    status: 'checkin',
    checkin: { deadlineMs: NOW + 60_000, aDone: a, bDone: b },
  });

  it('premier check-in : ok, pas encore live', () => {
    const r = submitCheckin(inCheckin(), 'a', NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bothDone).toBe(false);
      expect(r.events).toEqual([]);
    }
  });

  it('second check-in : bothDone + événement', () => {
    const r = submitCheckin(inCheckin(true, false), 'b', NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bothDone).toBe(true);
      expect(r.events).toEqual([{ kind: 'both_checked_in' }]);
    }
  });

  it('refuse : doublon, hors délai, mauvais statut', () => {
    expect(submitCheckin(inCheckin(true, false), 'a', NOW)).toEqual({ ok: false, error: 'already_done' });
    expect(submitCheckin(inCheckin(), 'a', NOW + 61_000)).toEqual({ ok: false, error: 'deadline_passed' });
    expect(submitCheckin(mkState({ status: 'live' }), 'a', NOW)).toEqual({ ok: false, error: 'invalid_state' });
  });
});

describe('submitScores (spec §9)', () => {
  const live = (over: Partial<FlowMatchState> = {}) => mkState({ status: 'live', ...over });

  it('première saisie du match : compteur 3 min posé + événement', () => {
    const r = submitScores(live(), 'a', WIN_A_31, CFG, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toBeNull();
      expect(r.counterDeadlineMs).toBe(NOW + 3 * 60_000);
      expect(r.events[0]).toMatchObject({ kind: 'counter_started', awaiting: 'b' });
    }
  });

  it('correction par le MÊME camp : le compteur ne bouge pas', () => {
    const st = live({
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
      status: 'score_review',
    });
    const fixed = [{ a: 2, b: 1 }, { a: 1, b: 0 }, { a: 3, b: 2 }];
    const r = submitScores(st, 'a', fixed, CFG, NOW + 30_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.counterDeadlineMs).toBe(NOW + 180_000);   // inchangé
      expect(r.events).toEqual([]);
      expect(r.resolution).toBeNull();
    }
  });

  it('contre-saisie CONCORDANTE : outcome par accord', () => {
    const st = live({
      status: 'score_review',
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
    });
    const r = submitScores(st, 'b', WIN_A_31, CFG, NOW + 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toMatchObject({ kind: 'agreement' });
      expect(r.events[0]).toMatchObject({ kind: 'outcome', via: 'agreement' });
      if (r.resolution?.kind === 'agreement' && r.resolution.outcome.type === 'winner') {
        expect(r.resolution.outcome.winner).toBe('a');
      }
    }
  });

  it('contre-saisie DIVERGENTE : litige automatique', () => {
    const st = live({
      status: 'score_review',
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
    });
    const other = [{ a: 1, b: 3 }, { a: 0, b: 1 }, { a: 2, b: 0 }, { a: 0, b: 2 }];
    const r = submitScores(st, 'b', other, CFG, NOW + 60_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolution).toEqual({ kind: 'mismatch' });
      expect(r.events).toEqual([{ kind: 'dispute_opened', auto: true }]);
    }
  });

  it('règle de course (archi §5) : contre-saisie APRÈS la deadline mais avant finalisation → acceptée', () => {
    const st = live({
      status: 'score_review',
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
    });
    const r = submitScores(st, 'b', WIN_A_31, CFG, NOW + 999_000);   // bien après les 3 min
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolution).toMatchObject({ kind: 'agreement' });
  });

  it('refuse : litige ouvert, statut illégal, saisie invalide', () => {
    expect(submitScores(live({ disputeOpen: true }), 'a', WIN_A_31, CFG, NOW)).toEqual({ ok: false, error: 'dispute_open' });
    expect(submitScores(mkState({ status: 'checkin' }), 'a', WIN_A_31, CFG, NOW)).toEqual({ ok: false, error: 'invalid_state' });
    expect(submitScores(live(), 'a', [{ a: 1, b: 1 }], CFG, NOW)).toEqual({ ok: false, error: 'invalid_scores' });
  });
});

describe('openDispute (manuel)', () => {
  it('possible pendant le jeu / la saisie, pas en terminal ni en doublon', () => {
    expect(openDispute(mkState({ status: 'live' })).ok).toBe(true);
    expect(openDispute(mkState({ status: 'score_review' })).ok).toBe(true);
    expect(openDispute(mkState({ status: 'completed' }))).toEqual({ ok: false, error: 'invalid_state' });
    expect(openDispute(mkState({ status: 'live', disputeOpen: true }))).toEqual({ ok: false, error: 'already_done' });
  });
});

describe('applyDeadlines (tick idempotent, archi §5)', () => {
  it('check-in échu : transition vers validation de forfait avec les absents', () => {
    const st = mkState({
      status: 'checkin',
      checkin: { deadlineMs: NOW, aDone: true, bDone: false },
    });
    const t = applyDeadlines(st, NOW + 1);
    expect(t).toMatchObject({ type: 'checkin_expired', missing: ['b'] });
    const both = mkState({ status: 'checkin', checkin: { deadlineMs: NOW, aDone: false, bDone: false } });
    expect(applyDeadlines(both, NOW + 1)).toMatchObject({ missing: ['a', 'b'] });
  });

  it('check-in échu mais complet : rien à faire', () => {
    const st = mkState({ status: 'checkin', checkin: { deadlineMs: NOW, aDone: true, bDone: true } });
    expect(applyDeadlines(st, NOW + 1)).toBeNull();
  });

  it('compteur échu avec une seule saisie : finalisation + notification admin', () => {
    const st = mkState({
      status: 'score_review',
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
    });
    const t = applyDeadlines(st, NOW + 180_001);
    expect(t).toMatchObject({ type: 'finalize_single_entry', submitted: 'a' });
    if (t?.type === 'finalize_single_entry') {
      expect(t.outcome).toMatchObject({ type: 'winner', winner: 'a' });
      expect(t.events.map(e => e.kind)).toEqual(['single_entry_notice', 'outcome']);
    }
  });

  it('rien avant la deadline, rien en litige, rien en terminal', () => {
    const st = mkState({
      status: 'score_review',
      scores: { a: WIN_A_31, b: [], aSubmittedAtMs: NOW, bSubmittedAtMs: null, counterDeadlineMs: NOW + 180_000 },
    });
    expect(applyDeadlines(st, NOW + 179_999)).toBeNull();
    expect(applyDeadlines({ ...st, disputeOpen: true }, NOW + 999_999)).toBeNull();
    expect(applyDeadlines(mkState({ status: 'completed' }), NOW)).toBeNull();
  });
});

describe('actions admin', () => {
  it('forceScore résout un litige (voie de résolution, spec §9)', () => {
    const st = mkState({ status: 'disputed', disputeOpen: true });
    const r = forceScore(st, WIN_A_31);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.outcome).toMatchObject({ type: 'winner', winner: 'a' });
      expect(r.events[0]).toMatchObject({ kind: 'outcome', via: 'admin' });
    }
  });

  it('forceScore refuse : terminal, équipes incomplètes, saisie invalide', () => {
    expect(forceScore(mkState({ status: 'completed' }), WIN_A_31)).toEqual({ ok: false, error: 'invalid_state' });
    expect(forceScore(mkState({ status: 'live', teamB: null }), WIN_A_31)).toEqual({ ok: false, error: 'teams_not_ready' });
    expect(forceScore(mkState({ status: 'live' }), [{ a: 1, b: 1 }])).toEqual({ ok: false, error: 'invalid_scores' });
  });

  it('validateForfeit : simple et double, jamais depuis un terminal', () => {
    const r = validateForfeit(mkState({ status: 'awaiting_forfeit_validation' }), 'b');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outcome).toEqual({ type: 'forfeit', team: 'b' });
    const both = validateForfeit(mkState({ status: 'checkin' }), 'both');
    expect(both.ok).toBe(true);
    expect(validateForfeit(mkState({ status: 'walkover' }), 'a')).toEqual({ ok: false, error: 'invalid_state' });
  });
});
