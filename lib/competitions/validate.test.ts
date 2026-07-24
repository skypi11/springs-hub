import { describe, it, expect } from 'vitest';
import {
  validateCircuitPayload,
  validateCompetitionPayload,
  validatePointsScale,
  estimateStageEntryMatches,
} from './validate';
import {
  LEGENDS_POINTS_SCALE,
  LEGENDS_FORMAT,
  LEGENDS_ELIGIBILITY,
  LEGENDS_ROSTER,
  LEGENDS_CHECKIN,
  LEGENDS_TIE_BREAKERS,
  buildLegendsPhasePlan,
  buildRoundRobinPhasePlan,
  buildSwissPhasePlan,
} from './defaults';

// Payload circuit complet et valide (préréglage Legends).
function circuitBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Legends Springs Cup 2026',
    game: 'rocket_league',
    pointsScale: { ...LEGENDS_POINTS_SCALE },
    bestResultsCount: 3,
    lanTeamCount: 16,
    tieBreakers: [...LEGENDS_TIE_BREAKERS],
    status: 'draft',
    ...overrides,
  };
}

// Payload compétition complet et valide (préréglage Legends Qualif 1).
function competitionBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Legends Qualifier #1',
    game: 'rocket_league',
    circuitId: 'circuit-1',
    format: {
      kind: 'double_elim',
      maxTeams: 32,
      bo: {
        default: LEGENDS_FORMAT.bo.default,
        overrides: LEGENDS_FORMAT.bo.overrides.map(o => ({ ...o })),
        grandFinal: LEGENDS_FORMAT.bo.grandFinal,
      },
      bracketReset: true,
    },
    eligibility: {
      requireVerifiedAccounts: true,
      minAge: LEGENDS_ELIGIBILITY.minAge,
      mmr: { ...LEGENDS_ELIGIBILITY.mmr },
    },
    roster: { ...LEGENDS_ROSTER },
    registration: {
      opensAt: '2026-09-12T12:00:00.000Z',
      closesAt: '2026-09-23T23:59:00.000Z',
      waitlist: true,
    },
    schedule: {
      days: [
        { date: '2026-09-26', startsAt: '15:00' },
        { date: '2026-09-27', startsAt: '15:00' },
      ],
      phasePlan: buildLegendsPhasePlan(),
      ...LEGENDS_CHECKIN,
    },
    discordGuildId: '',
    ...overrides,
  };
}

describe('validatePointsScale', () => {
  it('accepte le barème Legends v2 (32 places)', () => {
    const res = validatePointsScale(LEGENDS_POINTS_SCALE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value['1']).toBe(40);
      expect(res.value['32']).toBe(3);
      expect(Object.keys(res.value)).toHaveLength(32);
    }
  });

  it('rejette un barème non contigu (place manquante)', () => {
    const scale: Record<string, number> = { '1': 40, '2': 34, '4': 26 };
    const res = validatePointsScale(scale);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('place 3');
  });

  it('rejette un barème croissant (place 2 > place 1)', () => {
    const res = validatePointsScale({ '1': 10, '2': 20 });
    expect(res.ok).toBe(false);
  });

  it('accepte les points à égalité entre places voisines (17e = 18e)', () => {
    const res = validatePointsScale({ '1': 10, '2': 10, '3': 5 });
    expect(res.ok).toBe(true);
  });

  it('rejette points négatifs, non entiers et clés non numériques', () => {
    expect(validatePointsScale({ '1': -1, '2': 0 }).ok).toBe(false);
    expect(validatePointsScale({ '1': 1.5, '2': 1 }).ok).toBe(false);
    expect(validatePointsScale({ premier: 40, '2': 30 }).ok).toBe(false);
    expect(validatePointsScale([40, 30]).ok).toBe(false);
    expect(validatePointsScale(null).ok).toBe(false);
  });
});

describe('validateCircuitPayload', () => {
  it('accepte le circuit Legends complet', () => {
    const res = validateCircuitPayload(circuitBody());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.name).toBe('Legends Springs Cup 2026');
      expect(res.value.bestResultsCount).toBe(3);
      expect(res.value.lanTeamCount).toBe(16);
    }
  });

  it('rejette nom vide, jeu inconnu et compteurs hors bornes', () => {
    expect(validateCircuitPayload(circuitBody({ name: '  ' })).ok).toBe(false);
    expect(validateCircuitPayload(circuitBody({ game: 'valorant' })).ok).toBe(false);
    expect(validateCircuitPayload(circuitBody({ bestResultsCount: 0 })).ok).toBe(false);
    expect(validateCircuitPayload(circuitBody({ lanTeamCount: 1 })).ok).toBe(false);
  });

  it('rejette des tieBreakers incomplets ou dupliqués', () => {
    expect(validateCircuitPayload(circuitBody({ tieBreakers: ['best_placement'] })).ok).toBe(false);
    expect(validateCircuitPayload(circuitBody({
      tieBreakers: ['best_placement', 'best_placement', 'latest_event'],
    })).ok).toBe(false);
  });

  it('force un statut inconnu à draft', () => {
    const res = validateCircuitPayload(circuitBody({ status: 'hacked' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe('draft');
  });
});

describe('validateCompetitionPayload', () => {
  it('accepte le Qualif Legends complet', () => {
    const res = validateCompetitionPayload(competitionBody());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.format.maxTeams).toBe(32);
      expect(res.value.format.bo.overrides).toHaveLength(4);
      // Forfait dérivé du BO5 par défaut : 3 manches 1-0 (spec §11).
      expect(res.value.format.forfeitScore).toEqual({ games: 3, goalsPerGame: 1 });
      expect(res.value.eligibility.minAge).toBe(16);
      expect(res.value.eligibility.mmr?.maxAvg).toBe(1850);
      expect(res.value.schedule.phasePlan).toHaveLength(11);
    }
  });

  it('normalise circuitId vide en null', () => {
    const res = validateCompetitionPayload(competitionBody({ circuitId: '  ' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.circuitId).toBe(null);
  });

  it('rejette un BO pair et un kind inconnu', () => {
    const badBo = competitionBody();
    (badBo.format.bo as { default: number }).default = 4;
    expect(validateCompetitionPayload(badBo).ok).toBe(false);

    // « gauntlet » : format réellement inconnu (round_robin ET swiss sont
    // désormais supportés — couverts par leurs describe dédiés plus bas).
    const badKind = competitionBody();
    (badKind.format as { kind: string }).kind = 'gauntlet';
    expect(validateCompetitionPayload(badKind).ok).toBe(false);
  });

  it('accepte le simple élim : reset forcé à false, petite finale conservée, pas d\'override losers', () => {
    const single = competitionBody();
    (single.format as Record<string, unknown>).kind = 'single_elim';
    (single.format as Record<string, unknown>).thirdPlace = true;
    (single.format as Record<string, unknown>).bracketReset = true;   // ignoré hors double élim
    (single.format.bo as { overrides: unknown[] }).overrides = [
      { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
    ];
    (single.schedule as Record<string, unknown>).phasePlan = [
      { phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] },
      { phase: 2, day: 1, label: 'P2', rounds: [{ bracket: 'winners', round: 2 }, { bracket: 'losers', round: 1 }] },
    ];
    const res = validateCompetitionPayload(single);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.format.kind).toBe('single_elim');
      expect(res.value.format.bracketReset).toBe(false);
      expect(res.value.format.thirdPlace).toBe(true);
    }

    const badOverride = competitionBody();
    (badOverride.format as Record<string, unknown>).kind = 'single_elim';
    (badOverride.format.bo as { overrides: unknown[] }).overrides = [
      { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
    ];
    expect(validateCompetitionPayload(badOverride).ok).toBe(false);
  });

  it('double élim : la petite finale est forcée à false', () => {
    const dbl = competitionBody();
    (dbl.format as Record<string, unknown>).thirdPlace = true;
    const res = validateCompetitionPayload(dbl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.format.thirdPlace).toBe(false);
  });

  it('review : plan de phases double élim refusé sur un format simple élim', () => {
    // Le fixture garde le plan Legends (LR1→LR8 + grand_final) : basculer le
    // kind seul doit être refusé — pas de petite finale rangée en début de jour.
    const single = competitionBody();
    (single.format as Record<string, unknown>).kind = 'single_elim';
    (single.format as Record<string, unknown>).thirdPlace = true;
    (single.format.bo as { overrides: unknown[] }).overrides = [];
    const res = validateCompetitionPayload(single);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Plan de phases');

    // Un plan single conforme passe (winners + petite finale en dernière phase).
    const ok = competitionBody();
    (ok.format as Record<string, unknown>).kind = 'single_elim';
    (ok.format as Record<string, unknown>).thirdPlace = true;
    (ok.format.bo as { overrides: unknown[] }).overrides = [];
    (ok.schedule as Record<string, unknown>).phasePlan = [
      { phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] },
      { phase: 2, day: 1, label: 'P2', rounds: [{ bracket: 'winners', round: 2 }, { bracket: 'losers', round: 1 }] },
    ];
    expect(validateCompetitionPayload(ok).ok).toBe(true);

    // Petite finale au plan SANS thirdPlace : refusé aussi.
    const noP3 = structuredClone(ok);
    (noP3.format as Record<string, unknown>).thirdPlace = false;
    expect(validateCompetitionPayload(noP3).ok).toBe(false);
  });

  it('review : deux règles BO sur la même ronde → refus explicite', () => {
    const dup = competitionBody();
    (dup.format.bo as { overrides: unknown[] }).overrides = [
      { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
      { bracket: 'winners', roundsFromEnd: 1, bo: 9 },
    ];
    const res = validateCompetitionPayload(dup);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('doublon');
  });

  it('rejette une fenêtre d’inscription inversée', () => {
    const res = validateCompetitionPayload(competitionBody({
      registration: {
        opensAt: '2026-09-23T12:00:00.000Z',
        closesAt: '2026-09-12T12:00:00.000Z',
        waitlist: true,
      },
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('précéder');
  });

  it('rejette des journées désordonnées ou mal formées', () => {
    const disordered = competitionBody();
    (disordered.schedule as { days: unknown }).days = [
      { date: '2026-09-27', startsAt: '15:00' },
      { date: '2026-09-26', startsAt: '15:00' },
    ];
    expect(validateCompetitionPayload(disordered).ok).toBe(false);

    const badTime = competitionBody();
    (badTime.schedule as { days: unknown }).days = [{ date: '2026-09-26', startsAt: '25:00' }];
    expect(validateCompetitionPayload(badTime).ok).toBe(false);
  });

  it('rejette un plan de phases troué ou pointant hors planning', () => {
    const gap = competitionBody();
    (gap.schedule as { phasePlan: unknown }).phasePlan = [
      { phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] },
      { phase: 3, day: 1, label: 'P3', rounds: [{ bracket: 'winners', round: 2 }] },
    ];
    expect(validateCompetitionPayload(gap).ok).toBe(false);

    const badDay = competitionBody();
    (badDay.schedule as { phasePlan: unknown }).phasePlan = [
      { phase: 1, day: 5, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] },
    ];
    expect(validateCompetitionPayload(badDay).ok).toBe(false);
  });

  it('rejette un snowflake Discord invalide et accepte un valide', () => {
    expect(validateCompetitionPayload(competitionBody({ discordGuildId: 'abc' })).ok).toBe(false);
    const res = validateCompetitionPayload(competitionBody({ discordGuildId: '1498052178143875153' }));
    expect(res.ok).toBe(true);
  });

  it('rejette un poids MMR hors 0-1 et accepte mmr null', () => {
    const bad = competitionBody();
    (bad.eligibility.mmr as { weightCurrent: number }).weightCurrent = 1.5;
    expect(validateCompetitionPayload(bad).ok).toBe(false);

    const res = validateCompetitionPayload(competitionBody({
      eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
    }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.eligibility.mmr).toBe(null);
      expect(res.value.eligibility.minAge).toBe(null);
    }
  });

  it('dérive le forfait du BO par défaut (BO7 → 4 manches)', () => {
    const bo7 = competitionBody();
    (bo7.format.bo as { default: number }).default = 7;
    const res = validateCompetitionPayload(bo7);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.format.forfeitScore).toEqual({ games: 4, goalsPerGame: 1 });
  });
});

describe('validateCompetitionPayload — format round robin', () => {
  function rrBody(formatOverrides: Record<string, unknown> = {}, planTeams = 8, planGroups = 1) {
    return competitionBody({
      format: {
        kind: 'round_robin',
        maxTeams: 8,
        bo: { default: 5, overrides: [], grandFinal: 5 },
        groupCount: 1,
        doubleRound: false,
        points: { win: 3, draw: 1, loss: 0 },
        ...formatOverrides,
      },
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: buildRoundRobinPhasePlan(planTeams, planGroups, false),
        ...LEGENDS_CHECKIN,
      },
    });
  }

  it('accepte un round robin valide et normalise le format', () => {
    const res = validateCompetitionPayload(rrBody());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.format.kind).toBe('round_robin');
      expect(res.value.format.groupCount).toBe(1);
      expect(res.value.format.points).toEqual({ win: 3, draw: 1, loss: 0 });
      // Pas de champ d'arbre orphelin, grandFinal aligné sur le BO par défaut.
      expect(res.value.format.bracketReset).toBe(false);
      expect(res.value.format.thirdPlace).toBe(false);
      expect(res.value.format.bo.grandFinal).toBe(5);
      expect(res.value.format.forfeitScore).toEqual({ games: 3, goalsPerGame: 1 });
    }
  });

  it('accepte 64 équipes en poules (au-delà de la borne des arbres)', () => {
    const res = validateCompetitionPayload(rrBody({ maxTeams: 64, groupCount: 8 }, 64, 8));
    expect(res.ok).toBe(true);
  });

  it('refuse les règles BO par ronde (BO unique en poules)', () => {
    const res = validateCompetitionPayload(rrBody({
      bo: { default: 5, overrides: [{ bracket: 'winners', roundsFromEnd: 1, bo: 7 }], grandFinal: 7 },
    }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('BO');
  });

  it('refuse une poule de moins de 2 équipes et une poule trop grande', () => {
    expect(validateCompetitionPayload(rrBody({ groupCount: 5 })).ok).toBe(false);       // 8/5 → poule de 1
    expect(validateCompetitionPayload(rrBody({ maxTeams: 42, groupCount: 2 }, 42, 2)).ok).toBe(false); // poule de 21
  });

  it('refuse un barème incohérent (défaite ≥ victoire, nul hors bornes)', () => {
    expect(validateCompetitionPayload(rrBody({ points: { win: 1, draw: 1, loss: 1 } })).ok).toBe(false);
    expect(validateCompetitionPayload(rrBody({ points: { win: 3, draw: 4, loss: 0 } })).ok).toBe(false);
  });

  it('refuse un plan de phases d\'arbre sur un round robin, et inversement', () => {
    const treePlanOnRR = competitionBody({
      format: {
        kind: 'round_robin',
        maxTeams: 8,
        bo: { default: 5, overrides: [], grandFinal: 5 },
        groupCount: 1,
      },
    });
    expect(validateCompetitionPayload(treePlanOnRR).ok).toBe(false); // plan Legends (winners/losers)

    const rrPlanOnTree = competitionBody({
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: buildRoundRobinPhasePlan(8, 1, false),
        ...LEGENDS_CHECKIN,
      },
    });
    expect(validateCompetitionPayload(rrPlanOnTree).ok).toBe(false); // journées de poule sur un double élim
  });
});

describe('régressions review — plan de phases round robin', () => {
  it('accepte le plan par défaut d\'un aller-retour à poule de 20 (38 journées)', () => {
    const plan = buildRoundRobinPhasePlan(20, 1, true);
    expect(plan).toHaveLength(38); // au-delà des anciennes bornes 30/20
    const res = validateCompetitionPayload(competitionBody({
      format: {
        kind: 'round_robin',
        maxTeams: 20,
        bo: { default: 5, overrides: [], grandFinal: 5 },
        groupCount: 1,
        doubleRound: true,
      },
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: plan,
        ...LEGENDS_CHECKIN,
      },
    }));
    expect(res.ok).toBe(true);
  });
});

describe('validateCompetitionPayload — format suisse', () => {
  function swissBody(formatOverrides: Record<string, unknown> = {}, planRounds = 4) {
    return competitionBody({
      format: {
        kind: 'swiss',
        maxTeams: 16,
        bo: { default: 5, overrides: [], grandFinal: 5 },
        swissRounds: 4,
        points: { win: 3, draw: 1, loss: 0 },
        ...formatOverrides,
      },
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: buildSwissPhasePlan(planRounds),
        ...LEGENDS_CHECKIN,
      },
    });
  }

  it('accepte un suisse valide et normalise le format', () => {
    const res = validateCompetitionPayload(swissBody());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.format.kind).toBe('swiss');
      expect(res.value.format.swissRounds).toBe(4);
      expect(res.value.format.bracketReset).toBe(false);
      expect(res.value.format.bo.grandFinal).toBe(5);
    }
  });

  it('rondes par défaut = ⌈log2(maxTeams)⌉ si absentes', () => {
    const res = validateCompetitionPayload(swissBody({ swissRounds: undefined }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.format.swissRounds).toBe(4);
  });

  it('refuse trop de rondes pour le champ et les overrides BO', () => {
    expect(validateCompetitionPayload(swissBody({ maxTeams: 4, swissRounds: 5 }, 5)).ok).toBe(false);
    expect(validateCompetitionPayload(swissBody({
      bo: { default: 5, overrides: [{ bracket: 'winners', roundsFromEnd: 1, bo: 7 }], grandFinal: 7 },
    })).ok).toBe(false);
  });

  it('refuse un plan d\'arbre sur un suisse, et des rondes suisses sur un arbre', () => {
    const treePlanOnSwiss = competitionBody({
      format: {
        kind: 'swiss',
        maxTeams: 16,
        bo: { default: 5, overrides: [], grandFinal: 5 },
        swissRounds: 4,
      },
    });
    expect(validateCompetitionPayload(treePlanOnSwiss).ok).toBe(false); // plan Legends

    const swissPlanOnTree = competitionBody({
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: buildSwissPhasePlan(4),
        ...LEGENDS_CHECKIN,
      },
    });
    expect(validateCompetitionPayload(swissPlanOnTree).ok).toBe(false);
  });
});

describe('validateStages — séquence multi-étapes (design §9d)', () => {
  const rrFormat = (maxTeams = 8, groupCount = 2) => ({
    kind: 'round_robin', maxTeams,
    bo: { default: 5, overrides: [], grandFinal: 5 },
    groupCount, doubleRound: false,
  });
  const seFormat = (maxTeams = 4) => ({
    kind: 'single_elim', maxTeams,
    bo: { default: 5, overrides: [], grandFinal: 7 },
    thirdPlace: true,
  });
  const twoStageBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => competitionBody({
    format: rrFormat(),
    stages: [
      { format: rrFormat(), name: 'Poules', transfer: { advanceCount: 4, reseed: 'standings' } },
      { format: seFormat() },
    ],
    schedule: {
      days: [
        { date: '2026-09-26', startsAt: '15:00' },
        { date: '2026-09-27', startsAt: '15:00' },
      ],
      phasePlan: buildRoundRobinPhasePlan(8, 2, false),
      generalCheckinMinutes: 20,
      matchCheckinMinutes: 5,
      scoreCounterMinutes: 3,
    },
    ...overrides,
  });

  it('accepte un poules→playoff valide : stages canoniques, invariant format = étape 1', () => {
    const res = validateCompetitionPayload(twoStageBody());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stages).toHaveLength(2);
    expect(res.value.stages![0].kind).toBe('round_robin');
    expect(res.value.stages![0].name).toBe('Poules');
    expect(res.value.stages![0].transfer).toEqual({ advanceCount: 4, reseed: 'standings' });
    expect(res.value.stages![1].kind).toBe('single_elim');
    expect(res.value.stages![1].transfer).toBeUndefined();
    // Invariant §9a : le format top-level EST l'étape 1 (formes canoniques).
    expect(JSON.stringify(res.value.stages![0].format)).toBe(JSON.stringify(res.value.format));
  });

  it('mono-étape : stages absent → null (rétrocompat totale)', () => {
    const res = validateCompetitionPayload(competitionBody());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.stages).toBe(null);
  });

  it('rejette les séquences incohérentes', () => {
    // Dernière étape avec transfert.
    const lastWithTransfer = twoStageBody();
    (lastWithTransfer.stages as Array<Record<string, unknown>>)[1].transfer = { advanceCount: 2, reseed: 'standings' };
    expect(validateCompetitionPayload(lastWithTransfer).ok).toBe(false);

    // Étape intermédiaire sans transfert.
    const noTransfer = twoStageBody();
    delete (noTransfer.stages as Array<Record<string, unknown>>)[0].transfer;
    expect(validateCompetitionPayload(noTransfer).ok).toBe(false);

    // maxTeams de l'étape 2 ≠ advanceCount du transfert.
    const mismatch = twoStageBody();
    (mismatch.stages as Array<Record<string, unknown>>)[1] = { format: seFormat(8) };
    expect(validateCompetitionPayload(mismatch).ok).toBe(false);

    // Une seule étape envoyée en séquence.
    const single = twoStageBody({ stages: [{ format: rrFormat() }] });
    expect(validateCompetitionPayload(single).ok).toBe(false);

    // Re-seeding non supporté au transfert (jamais ignoré en silence).
    const manual = twoStageBody();
    ((manual.stages as Array<Record<string, unknown>>)[0].transfer as Record<string, unknown>).reseed = 'manual';
    expect(validateCompetitionPayload(manual).ok).toBe(false);

    // Format top-level ≠ étape 1.
    const divergent = twoStageBody({ format: rrFormat(8, 1) });
    expect(validateCompetitionPayload(divergent).ok).toBe(false);
  });

  it('borne le budget d\'écriture atomique du passage d\'étape (≤ 200 matchs)', () => {
    // Suisse 64 → top 32 en round robin 2 poules de 16 : 2 × C(16,2) = 240
    // matchs d'un coup — passe les validateurs de format mais dépasse la
    // limite transactionnelle → refus À LA SAISIE, jamais au clic.
    const swiss64 = {
      kind: 'swiss', maxTeams: 64,
      bo: { default: 5, overrides: [], grandFinal: 5 },
      swissRounds: 6,
    };
    const big = twoStageBody({
      format: swiss64,
      stages: [
        { format: swiss64, transfer: { advanceCount: 32, reseed: 'standings' } },
        { format: rrFormat(32, 2) },
      ],
      schedule: {
        days: [{ date: '2026-09-26', startsAt: '15:00' }],
        phasePlan: [{ phase: 1, day: 1, label: 'R1', rounds: [{ bracket: 'swiss', round: 1 }] }],
        generalCheckinMinutes: 20,
        matchCheckinMinutes: 5,
        scoreCounterMinutes: 3,
      },
    });
    const res = validateCompetitionPayload(big);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/trop de matchs/i);
  });

  it('estimateStageEntryMatches : miroir déclaratif des générateurs', () => {
    const bo = { default: 5, overrides: [], grandFinal: 5 };
    const base = { bo, bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 } };
    // Simple élim 4 + petite finale : 3 + 1.
    expect(estimateStageEntryMatches({ ...base, kind: 'single_elim', maxTeams: 4, thirdPlace: true } as never, 4)).toBe(4);
    // Double élim 8 : 2 × 8 (winners 7 + losers 6 + GF + reset).
    expect(estimateStageEntryMatches({ ...base, kind: 'double_elim', maxTeams: 8 } as never, 8)).toBe(16);
    // RR 8 en 2 poules de 4 : 2 × 6.
    expect(estimateStageEntryMatches({ ...base, kind: 'round_robin', maxTeams: 8, groupCount: 2 } as never, 8)).toBe(12);
    // RR 32 en 2 poules de 16 : 2 × 120.
    expect(estimateStageEntryMatches({ ...base, kind: 'round_robin', maxTeams: 32, groupCount: 2 } as never, 32)).toBe(240);
    // Suisse : ronde 1 seule.
    expect(estimateStageEntryMatches({ ...base, kind: 'swiss', maxTeams: 8, swissRounds: 3 } as never, 8)).toBe(4);
  });
});
