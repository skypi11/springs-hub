// Tests du runtime multi-étapes (lib PURE — design docs/registry-formats-design.md §9).
// Le test d'intégration joue un VRAI tournoi deux étapes avec les moteurs purs
// (round robin 8 équipes → top 4 → simple élim + petite finale) : le transfert
// et le classement final sont vérifiés sur du vrai output moteur, pas des
// fixtures fabriquées.

import { describe, expect, it } from 'vitest';
import {
  advanceMatch,
  computeRoundRobinPlacements,
  computeTeamStats,
  computePlacements,
  generateRoundRobin,
  generateSingleElim,
  DEFAULT_RR_POINTS,
  isConcluded,
  isFinished,
  type Bracket,
  type BoConfig,
  type Placement,
  type TeamStats,
} from '@/lib/tournament';
import {
  computeMultiStageFinalOrder,
  computeStageAdvance,
  cumulativeTeamStats,
  currentStageOf,
  formatOfStage,
  isStageTransferStuck,
  parseStageMatchId,
  stageAt,
  stageLabelOf,
  stageMatchId,
  stageOfMatch,
  stagesOf,
  teamBoundsForKind,
} from './stages';
import type { CompetitionFormat, StageResult, TournamentStage } from '@/types/competitions';

const BO1: BoConfig = { default: 1, overrides: [], grandFinal: 1 };
const FORFEIT = { games: 1, goalsPerGame: 1 };

function rrFormat(maxTeams: number, groupCount = 1): CompetitionFormat {
  return {
    kind: 'round_robin', maxTeams, bo: BO1, bracketReset: false, thirdPlace: false,
    groupCount, doubleRound: false, points: DEFAULT_RR_POINTS, forfeitScore: FORFEIT,
  };
}

function seFormat(maxTeams: number): CompetitionFormat {
  return {
    kind: 'single_elim', maxTeams, bo: BO1, bracketReset: false, thirdPlace: true,
    forfeitScore: FORFEIT,
  };
}

/** Joue tous les matchs jouables : gagne toujours l'équipe au plus petit
 *  numéro (t1 > t2 > …), score 1-0 — classement strictement ordonné, zéro
 *  égalité par construction. */
function playAll(bracket: Bracket): Bracket {
  let b = bracket;
  for (let guard = 0; guard < 200; guard++) {
    const playable = b.order.find(id => {
      const m = b.matches[id];
      return m.status === 'pending' && m.teamA !== null && m.teamB !== null && !m.voidA && !m.voidB;
    });
    if (!playable) break;
    const m = b.matches[playable];
    const numA = Number((m.teamA as string).slice(1));
    const numB = Number((m.teamB as string).slice(1));
    const winner = numA < numB ? 'a' : 'b';
    b = advanceMatch(b, playable, { type: 'winner', winner, scores: winner === 'a' ? [{ a: 1, b: 0 }] : [{ a: 0, b: 1 }] });
  }
  return b;
}

const TEAMS8 = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'];

function playedGroupStage(): { bracket: Bracket; placements: Placement[]; stats: Map<string, TeamStats> } {
  const bracket = playAll(generateRoundRobin(TEAMS8, { bo: BO1, forfeitScore: FORFEIT, groups: 1 }));
  expect(isConcluded(bracket)).toBe(true);
  const placements = computeRoundRobinPlacements(bracket, DEFAULT_RR_POINTS);
  return { bracket, placements, stats: computeTeamStats(bracket) };
}

// ── Helpers de lecture (rétrocompat) ─────────────────────────────────────────

describe('stagesOf / currentStageOf / formatOfStage', () => {
  const rr = rrFormat(8);
  const se = seFormat(4);
  const twoStages: TournamentStage[] = [
    { kind: 'round_robin', format: rr, name: 'Poules', transfer: { advanceCount: 4, reseed: 'standings' } },
    { kind: 'single_elim', format: se },
  ];

  it('compétition sans stages = mono-étape dérivée du format (rétrocompat)', () => {
    const stages = stagesOf({ format: se });
    expect(stages).toHaveLength(1);
    expect(stages[0].kind).toBe('single_elim');
    expect(stages[0].format).toBe(se);
  });

  it('docs legacy sans kind → double élim (comportement kindOf)', () => {
    const legacy = { ...se, kind: undefined } as unknown as CompetitionFormat;
    expect(stagesOf({ format: legacy })[0].kind).toBe('double_elim');
  });

  it('compétition avec stages : la séquence est retournée telle quelle', () => {
    const stages = stagesOf({ format: rr, stages: twoStages });
    expect(stages).toHaveLength(2);
    expect(stages[1].kind).toBe('single_elim');
  });

  it('currentStage absent/invalide = 1, clampé au nombre d\'étapes', () => {
    expect(currentStageOf({ format: rr })).toBe(1);
    expect(currentStageOf({ format: rr, currentStage: 0 })).toBe(1);
    expect(currentStageOf({ format: rr, stages: twoStages, currentStage: 2 })).toBe(2);
    expect(currentStageOf({ format: rr, stages: twoStages, currentStage: 9 })).toBe(2);
  });

  it('formatOfStage route sur le format de l\'étape, clamp hors bornes', () => {
    const comp = { format: rr, stages: twoStages };
    expect(formatOfStage(comp, 1)).toBe(rr);
    expect(formatOfStage(comp, 2)).toBe(se);
    expect(formatOfStage(comp, 99)).toBe(se);
    expect(stageAt(comp, 0)).toBe(twoStages[0]);
  });

  it('stageOfMatch : absent = 1', () => {
    expect(stageOfMatch({})).toBe(1);
    expect(stageOfMatch({ stage: null })).toBe(1);
    expect(stageOfMatch({ stage: 3 })).toBe(3);
  });

  it('stageLabelOf : nom choisi sinon label du format', () => {
    expect(stageLabelOf(twoStages[0])).toBe('Poules');
    expect(stageLabelOf(twoStages[1])).toBe('Élimination directe');
  });

  it('teamBoundsForKind : arbres 4-32, RR et suisse 4-64', () => {
    expect(teamBoundsForKind('double_elim')).toEqual({ min: 4, max: 32 });
    expect(teamBoundsForKind('single_elim')).toEqual({ min: 4, max: 32 });
    expect(teamBoundsForKind('round_robin')).toEqual({ min: 4, max: 64 });
    expect(teamBoundsForKind('swiss')).toEqual({ min: 4, max: 64 });
  });
});

// ── Ids préfixés ─────────────────────────────────────────────────────────────

describe('stageMatchId / parseStageMatchId', () => {
  it('étape 1 : id nu (rétrocompat totale)', () => {
    expect(stageMatchId(1, 'W1-1')).toBe('W1-1');
    expect(parseStageMatchId('W1-1')).toEqual({ stage: 1, engineId: 'W1-1' });
    expect(parseStageMatchId('GF')).toEqual({ stage: 1, engineId: 'GF' });
    expect(parseStageMatchId('R12-3')).toEqual({ stage: 1, engineId: 'R12-3' });
  });

  it('étape N ≥ 2 : préfixe E{N}_, round-trip identitaire', () => {
    for (const [stage, id] of [[2, 'W1-1'], [3, 'GF'], [2, 'S4-2'], [10, 'P3']] as const) {
      const prefixed = stageMatchId(stage, id);
      expect(prefixed).toBe(`E${stage}_${id}`);
      expect(parseStageMatchId(prefixed)).toEqual({ stage, engineId: id });
    }
  });

  it('E1_ théorique et préfixes malformés retombent sur étape 1', () => {
    expect(parseStageMatchId('E1_W1-1')).toEqual({ stage: 1, engineId: 'E1_W1-1' });
    expect(parseStageMatchId('E_W1-1')).toEqual({ stage: 1, engineId: 'E_W1-1' });
  });
});

// ── Transfert d'étape ────────────────────────────────────────────────────────

describe('computeStageAdvance', () => {
  const base = () => {
    const { placements, stats } = playedGroupStage();
    return {
      stage: 1,
      transfer: { advanceCount: 4, reseed: 'standings' as const },
      placements,
      stats,
      withdrawn: [] as string[],
      tiebreakResolutions: {},
      nextStageMinTeams: 4,
    };
  };

  it('standings : top-4 dans l\'ordre du classement, résultat d\'étape figé complet', () => {
    const res = computeStageAdvance(base());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.advanced).toEqual(['t1', 't2', 't3', 't4']);
    expect(res.stageResult.stage).toBe(1);
    expect(res.stageResult.placements.map(p => p.registrationId))
      .toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
    expect(res.stageResult.placements.map(p => p.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Stats brutes : t1 gagne 7 matchs 1-0 → délta +7 sur 7 matchs.
    const p1 = res.stageResult.placements[0];
    expect(p1.goalDiff).toBe(7);
    expect(p1.goalsFor).toBe(7);
    expect(p1.matchesCounted).toBe(7);
  });

  it('repêchage : une retirée garde sa place mais ne se qualifie jamais', () => {
    const input = base();
    input.withdrawn = ['t3'];
    const res = computeStageAdvance(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.advanced).toEqual(['t1', 't2', 't4', 't5']);
    // t3 reste classée 3e dans le résultat d'étape (R5-4 : place figée).
    expect(res.stageResult.placements.find(p => p.registrationId === 't3')?.placement).toBe(3);
  });

  it('random : shuffle injecté, permutation exigée', () => {
    const input = { ...base(), transfer: { advanceCount: 4, reseed: 'random' as const } };
    const reversed = computeStageAdvance({ ...input, shuffle: xs => [...xs].reverse() });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) expect(reversed.advanced).toEqual(['t4', 't3', 't2', 't1']);

    const broken = computeStageAdvance({ ...input, shuffle: xs => xs.slice(1) });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.code).toBe('reseed_unsupported');

    const missing = computeStageAdvance(input);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('reseed_unsupported');
  });

  it('stratégies non supportées au transfert : refus explicite', () => {
    for (const reseed of ['manual', 'mmr', 'circuit'] as const) {
      const res = computeStageAdvance({ ...base(), transfer: { advanceCount: 4, reseed } });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('reseed_unsupported');
    }
  });

  it('égalité irrésolue → tiebreak_required avec les groupes', () => {
    const input = base();
    input.placements = input.placements.map((p, i) =>
      i < 2 ? { ...p, placement: null, needsAdminTiebreak: true, group: 'rank1' } : p);
    const res = computeStageAdvance(input);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('tiebreak_required');
      expect(res.tiebreakGroups).toEqual(['rank1']);
    }
  });

  it('placement manquant ou en double → not_placed (jamais un transfert faux)', () => {
    const missing = base();
    missing.placements = missing.placements.map((p, i) => (i === 5 ? { ...p, placement: null } : p));
    const r1 = computeStageAdvance(missing);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('not_placed');

    const dup = base();
    dup.placements = dup.placements.map((p, i) => (i === 5 ? { ...p, placement: 5 } : p));
    const r2 = computeStageAdvance(dup);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('not_placed');
  });

  it('trop de retraits → not_enough_teams (bornes du format suivant)', () => {
    const input = base();
    input.withdrawn = ['t1', 't2', 't3', 't4', 't5'];
    const res = computeStageAdvance(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_enough_teams');
  });
});

// ── Classement final multi-étapes ────────────────────────────────────────────

describe('computeMultiStageFinalOrder + cumulativeTeamStats — tournoi complet réel', () => {
  it('poules 8 → top 4 → simple élim : classement final = permutation exacte 1..8', () => {
    // Étape 1 : poules jouées + transfert.
    const { placements, stats } = playedGroupStage();
    const adv = computeStageAdvance({
      stage: 1,
      transfer: { advanceCount: 4, reseed: 'standings' },
      placements,
      stats,
      withdrawn: [],
      tiebreakResolutions: {},
      nextStageMinTeams: 4,
    });
    expect(adv.ok).toBe(true);
    if (!adv.ok) return;

    // Étape 2 : simple élim + petite finale, jouée avec la même règle.
    const finalBracket = playAll(generateSingleElim(adv.advanced, {
      bo: BO1, forfeitScore: FORFEIT, thirdPlace: true,
    }));
    expect(isFinished(finalBracket)).toBe(true);
    const finalPlacements = computePlacements(finalBracket)
      .filter((p): p is Placement & { placement: number } => p.placement !== null)
      .map(p => ({ teamId: p.teamId, placement: p.placement }));
    expect(finalPlacements).toHaveLength(4);

    const order = computeMultiStageFinalOrder([adv.stageResult], finalPlacements);
    expect(order.map(o => o.registrationId)).toEqual(TEAMS8);
    expect(order.map(o => o.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // Stats cumulées : t1 gagne 7 matchs de poule + 2 matchs d'arbre, tous 1-0
    // → délta brut +9 sur 9 matchs = +1.00 normalisé ; 9 buts marqués.
    const finalStats = computeTeamStats(finalBracket);
    expect(cumulativeTeamStats('t1', [adv.stageResult], finalStats))
      .toEqual({ goalDiff: 1, goalsFor: 9 });
    // t5 éliminée en poules : ses stats viennent uniquement de l'étape 1
    // (3 victoires, 4 défaites → délta brut −1 sur 7 matchs ≈ −0.14).
    expect(cumulativeTeamStats('t5', [adv.stageResult], finalStats))
      .toEqual({ goalDiff: -0.14, goalsFor: 3 });
  });

  it('repêchage d\'une retirée : recompression correcte des places', () => {
    const { placements, stats } = playedGroupStage();
    const adv = computeStageAdvance({
      stage: 1,
      transfer: { advanceCount: 4, reseed: 'standings' },
      placements,
      stats,
      withdrawn: ['t3'],
      tiebreakResolutions: {},
      nextStageMinTeams: 4,
    });
    expect(adv.ok).toBe(true);
    if (!adv.ok) return;
    expect(adv.advanced).toEqual(['t1', 't2', 't4', 't5']);

    const finalBracket = playAll(generateSingleElim(adv.advanced, {
      bo: BO1, forfeitScore: FORFEIT, thirdPlace: true,
    }));
    const finalPlacements = computePlacements(finalBracket)
      .filter((p): p is Placement & { placement: number } => p.placement !== null)
      .map(p => ({ teamId: p.teamId, placement: p.placement }));

    const order = computeMultiStageFinalOrder([adv.stageResult], finalPlacements);
    // Étape finale : t1, t2, t4, t5 (règle du plus petit numéro). Puis les
    // éliminées de l'étape 1 par leur place d'étape : t3 (3e, retirée), t6,
    // t7, t8 — recompressées 5..8.
    expect(order.map(o => o.registrationId)).toEqual(['t1', 't2', 't4', 't5', 't3', 't6', 't7', 't8']);
    expect(order.map(o => o.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('trois étapes : les éliminées de chaque étape s\'empilent (plus récente d\'abord)', () => {
    const sr1: StageResult = {
      stage: 1,
      placements: [
        { registrationId: 'a', placement: 1, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'b', placement: 2, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'c', placement: 3, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'd', placement: 4, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'e', placement: 5, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'f', placement: 6, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
      ],
      advanced: ['a', 'b', 'c', 'd'],
      tiebreakResolutions: {},
      closedAt: '',
    };
    const sr2: StageResult = {
      stage: 2,
      placements: [
        { registrationId: 'b', placement: 1, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'a', placement: 2, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'd', placement: 3, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'c', placement: 4, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
      ],
      advanced: ['b', 'a'],
      tiebreakResolutions: {},
      closedAt: '',
    };
    const order = computeMultiStageFinalOrder([sr1, sr2], [
      { teamId: 'a', placement: 1 },
      { teamId: 'b', placement: 2 },
    ]);
    // Finale : a, b. Éliminées étape 2 : d (3e), c (4e). Éliminées étape 1 : e, f.
    expect(order.map(o => o.registrationId)).toEqual(['a', 'b', 'd', 'c', 'e', 'f']);
    expect(order.map(o => o.placement)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('données incohérentes : doublon ou qualifiée absente → throw (jamais un classement faux)', () => {
    const sr: StageResult = {
      stage: 1,
      placements: [
        { registrationId: 'a', placement: 1, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
        { registrationId: 'b', placement: 2, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0 },
      ],
      advanced: ['a'],
      tiebreakResolutions: {},
      closedAt: '',
    };
    // 'b' éliminée MAIS aussi classée par l'étape finale → doublon.
    expect(() => computeMultiStageFinalOrder([sr], [
      { teamId: 'a', placement: 1 },
      { teamId: 'b', placement: 2 },
    ])).toThrow(/en double/);
    // Qualifiée absente de l'étape finale.
    expect(() => computeMultiStageFinalOrder([sr], [
      { teamId: 'x', placement: 1 },
    ])).toThrow(/qualifiée mais absente|en double/);
  });
});

describe('correctifs review adversariale — défense complète + soupape', () => {
  const srp = (registrationId: string, placement: number) => ({
    registrationId, placement, goalDiff: 0, goalsFor: 0, goalsAgainst: 0, matchesCounted: 0,
  });

  it('une qualifiée d\'une étape ANTÉRIEURE absente de toute la suite → throw (jamais d\'omission silencieuse)', () => {
    // s1 qualifie a..d ; s2 (corrompu) ne classe que a,b,c — d a disparu.
    const s1: StageResult = {
      stage: 1,
      placements: [srp('a', 1), srp('b', 2), srp('c', 3), srp('d', 4), srp('e', 5), srp('f', 6)],
      advanced: ['a', 'b', 'c', 'd'],
      tiebreakResolutions: {}, closedAt: '',
    };
    const s2: StageResult = {
      stage: 2,
      placements: [srp('a', 1), srp('b', 2), srp('c', 3)],
      advanced: ['a', 'b'],
      tiebreakResolutions: {}, closedAt: '',
    };
    expect(() => computeMultiStageFinalOrder([s1, s2], [
      { teamId: 'a', placement: 1 },
      { teamId: 'b', placement: 2 },
    ])).toThrow(/absente de toute la suite/);
  });

  it('isStageTransferStuck : trop de retraits = impasse ; transfert sain = pas d\'impasse', () => {
    const { placements, stats } = (() => {
      const bracket = playAll(generateRoundRobin(TEAMS8, { bo: BO1, forfeitScore: FORFEIT, groups: 1 }));
      return { placements: computeRoundRobinPlacements(bracket, DEFAULT_RR_POINTS), stats: computeTeamStats(bracket) };
    })();
    const nextStage: TournamentStage = { kind: 'single_elim', format: seFormat(4) };
    const generateNext = (seeding: string[]) =>
      generateSingleElim(seeding, { bo: BO1, forfeitScore: FORFEIT, thirdPlace: true });

    // 5 retraits → 3 qualifiables < 4 : impasse (la clôture prend le relais).
    expect(isStageTransferStuck({
      transfer: { advanceCount: 4, reseed: 'standings' },
      placements, stats,
      withdrawn: ['t1', 't2', 't3', 't4', 't5'],
      tiebreakResolutions: {},
      nextStage,
      generateNext,
    })).toBe(true);

    // Champ complet : transfert possible, pas d'impasse.
    expect(isStageTransferStuck({
      transfer: { advanceCount: 4, reseed: 'standings' },
      placements, stats,
      withdrawn: [],
      tiebreakResolutions: {},
      nextStage,
      generateNext,
    })).toBe(false);

    // Génération infaisable (le générateur jette) : impasse aussi.
    expect(isStageTransferStuck({
      transfer: { advanceCount: 4, reseed: 'standings' },
      placements, stats,
      withdrawn: [],
      tiebreakResolutions: {},
      nextStage,
      generateNext: () => { throw new Error('répartition impossible'); },
    })).toBe(true);

    // reseed 'random' au dry-run : la faisabilité s'évalue sans source d'aléa.
    expect(isStageTransferStuck({
      transfer: { advanceCount: 4, reseed: 'random' },
      placements, stats,
      withdrawn: [],
      tiebreakResolutions: {},
      nextStage,
      generateNext,
    })).toBe(false);
  });
});
