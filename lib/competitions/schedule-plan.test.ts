import { describe, it, expect } from 'vitest';
import {
  blocksToPhasePlan,
  buildDefaultPlan,
  buildPlanBlocks,
  buildStagedBlocks,
  listBoRounds,
  poolSizes,
  spreadOverDays,
  type PlanBlock,
} from './schedule-plan';
import { setBoForRound } from './format-config';
import { validateCompetitionPayload } from './validate';
import { generateDoubleElim, generateSingleElim } from '@/lib/tournament';
import type { CompetitionFormat } from '@/types/competitions';

const BO = { default: 5, overrides: [], grandFinal: 7 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function fmt(over: Partial<CompetitionFormat> = {}): CompetitionFormat {
  return {
    kind: 'double_elim',
    maxTeams: 32,
    bo: BO,
    bracketReset: false,
    forfeitScore: FORFEIT,
    ...over,
  } as CompetitionFormat;
}

const pow2 = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };

/** Ce dont une ronde a besoin pour être jouable, en clés « bracket:round ». */
function dependenciesOf(round: { bracket: string; round: number }, winnersRounds: number, losersRounds: number): string[] {
  if (round.bracket === 'winners') {
    return round.round === 1 ? [] : [`winners:${round.round - 1}`];
  }
  if (round.bracket === 'losers') {
    const i = round.round;
    if (i === 1) return ['winners:1'];
    // Tours pairs : les rescapés affrontent les battus du tour vainqueurs
    // correspondant — d'où la double dépendance.
    return i % 2 === 0
      ? [`losers:${i - 1}`, `winners:${i / 2 + 1}`]
      : [`losers:${i - 1}`];
  }
  // Grande finale (et sa belle) : les deux brackets doivent être allés au bout.
  return [`winners:${winnersRounds}`, `losers:${losersRounds}`];
}

describe('buildPlanBlocks — double élimination', () => {
  it('reproduit la structure attendue à 32 équipes', () => {
    const blocks = buildPlanBlocks(fmt({ maxTeams: 32, bracketReset: true }));
    expect(blocks.map(b => b.label)).toEqual([
      'Tour 1 vainqueurs',
      'Tour 2 vainqueurs + Tour 1 perdants',
      'Tour 2 perdants',
      'Tour 3 vainqueurs + Tour 3 perdants',
      'Tour 4 perdants',
      'Demi-finales vainqueurs + Tour 5 perdants',
      'Tour 6 perdants',
      'Finale vainqueurs + Tour 7 perdants',
      'Finale perdants',
      'Grande finale',
    ]);
    expect(blocks.map(b => b.matchCount)).toEqual([16, 16, 8, 8, 4, 4, 2, 2, 1, 1]);
    // 16 + (8+8) + 8 + (4+4) + 4 + (2+2) + 2 + (1+1) + 1 + 1 = 62 matchs
    // joués + le reset pré-créé.
    expect(blocks.reduce((s, b) => s + b.matchCount, 0)).toBe(2 * 32 - 2);
  });

  it('chaque ronde apparaît une fois et jamais avant ses dépendances (4→64)', () => {
    for (let n = 4; n <= 64; n++) {
      const blocks = buildPlanBlocks(fmt({ maxTeams: n, bracketReset: true }));
      const size = pow2(Math.max(4, n));
      const winnersRounds = Math.log2(size);
      const losersRounds = 2 * (winnersRounds - 1);

      const phaseOf = new Map<string, number>();
      for (const b of blocks) {
        for (const r of b.rounds) {
          const key = `${r.bracket}:${r.round}`;
          expect(phaseOf.has(key), `${n} équipes : ${key} en double`).toBe(false);
          phaseOf.set(key, b.phase);
        }
      }

      // Couverture complète du bracket.
      for (let j = 1; j <= winnersRounds; j++) expect(phaseOf.has(`winners:${j}`), `${n}: winners ${j}`).toBe(true);
      for (let i = 1; i <= losersRounds; i++) expect(phaseOf.has(`losers:${i}`), `${n}: losers ${i}`).toBe(true);
      expect(phaseOf.has('grand_final:1')).toBe(true);
      expect(phaseOf.has('grand_final:2')).toBe(true);

      // Ordonnancement : une ronde ne peut pas être lancée avant ses sources.
      for (const b of blocks) {
        for (const r of b.rounds) {
          for (const dep of dependenciesOf(r, winnersRounds, losersRounds)) {
            const depPhase = phaseOf.get(dep);
            expect(depPhase, `${n} équipes : dépendance ${dep} absente`).toBeDefined();
            expect(depPhase!, `${n} équipes : ${r.bracket}:${r.round} avant ${dep}`).toBeLessThan(b.phase);
          }
        }
      }

      // Total de matchs : winners (size−1) + losers (size−2) + GF, + le reset.
      const played = blocks.reduce((s, b) => s + b.matchCount, 0);
      expect(played, `${n} équipes`).toBe(2 * size - 2);
    }
  });

  it('sans reset de grande finale, la belle n’est pas au programme', () => {
    const blocks = buildPlanBlocks(fmt({ maxTeams: 8, bracketReset: false }));
    const finale = blocks[blocks.length - 1];
    expect(finale.rounds).toEqual([{ bracket: 'grand_final', round: 1 }]);
  });

  it('numérote les blocs 1..N sans trou', () => {
    for (const n of [4, 8, 16, 32, 64]) {
      const blocks = buildPlanBlocks(fmt({ maxTeams: n }));
      expect(blocks.map(b => b.phase)).toEqual(blocks.map((_, i) => i + 1));
    }
  });
});

describe('buildPlanBlocks — élimination directe', () => {
  it('un bloc par tour, noms d’usage, volumes décroissants', () => {
    const blocks = buildPlanBlocks(fmt({ kind: 'single_elim', maxTeams: 16 }));
    expect(blocks.map(b => b.label)).toEqual(['Huitièmes', 'Quarts', 'Demi-finales', 'Finale']);
    expect(blocks.map(b => b.matchCount)).toEqual([8, 4, 2, 1]);
  });

  it('la petite finale se joue avec la finale', () => {
    const blocks = buildPlanBlocks(fmt({ kind: 'single_elim', maxTeams: 8, thirdPlace: true }));
    const last = blocks[blocks.length - 1];
    expect(last.label).toBe('Finale + petite finale');
    expect(last.matchCount).toBe(2);
    expect(last.rounds).toEqual([
      { bracket: 'winners', round: 3 },
      { bracket: 'losers', round: 1 },
    ]);
  });

  it('total de matchs = N−1 (+1 avec petite finale) pour toute puissance de 2', () => {
    for (const n of [4, 8, 16, 32, 64]) {
      const plain = buildPlanBlocks(fmt({ kind: 'single_elim', maxTeams: n }));
      expect(plain.reduce((s, b) => s + b.matchCount, 0)).toBe(n - 1);
      const third = buildPlanBlocks(fmt({ kind: 'single_elim', maxTeams: n, thirdPlace: true }));
      expect(third.reduce((s, b) => s + b.matchCount, 0)).toBe(n);
    }
  });
});

describe('buildPlanBlocks — poules et suisse', () => {
  it('poules serpentines : tailles équilibrées, une journée par tour de cercle', () => {
    expect(poolSizes(16, 4)).toEqual([4, 4, 4, 4]);
    expect(poolSizes(10, 3)).toEqual([4, 3, 3]);

    const blocks = buildPlanBlocks(fmt({ kind: 'round_robin', maxTeams: 16, groupCount: 4 }));
    expect(blocks.map(b => b.label)).toEqual(['Journée 1', 'Journée 2', 'Journée 3']);
    // 4 poules de 4 → 2 matchs par poule et par journée.
    expect(blocks.map(b => b.matchCount)).toEqual([8, 8, 8]);
    expect(blocks.reduce((s, b) => s + b.matchCount, 0)).toBe(24);
  });

  it('poule impaire : une équipe se repose chaque journée', () => {
    const blocks = buildPlanBlocks(fmt({ kind: 'round_robin', maxTeams: 5, groupCount: 1 }));
    expect(blocks).toHaveLength(5);
    expect(blocks.every(b => b.matchCount === 2)).toBe(true);
    // C(5,2) = 10 rencontres au total.
    expect(blocks.reduce((s, b) => s + b.matchCount, 0)).toBe(10);
  });

  it('aller-retour : les journées retour prolongent la numérotation', () => {
    const blocks = buildPlanBlocks(fmt({ kind: 'round_robin', maxTeams: 4, groupCount: 1, doubleRound: true }));
    expect(blocks.map(b => b.label)).toEqual(['Journée 1', 'Journée 2', 'Journée 3', 'Journée 4', 'Journée 5', 'Journée 6']);
    expect(blocks[3].hint).toContain('retour');
    expect(blocks.reduce((s, b) => s + b.matchCount, 0)).toBe(12);
  });

  it('suisse : une ronde par bloc, bye signalé sur effectif impair', () => {
    const even = buildPlanBlocks(fmt({ kind: 'swiss', maxTeams: 16, swissRounds: 4 }));
    expect(even.map(b => b.label)).toEqual(['Ronde 1', 'Ronde 2', 'Ronde 3', 'Ronde 4']);
    expect(even.every(b => b.matchCount === 8)).toBe(true);
    expect(even[1].hint).not.toContain('bye');

    const odd = buildPlanBlocks(fmt({ kind: 'swiss', maxTeams: 9, swissRounds: 3 }));
    expect(odd[1].hint).toContain('bye');
    expect(odd[0].matchCount).toBe(5);
  });
});

// Le BO annoncé à l'organisateur doit être CELUI que le moteur pose sur les
// matchs : afficher « Finale BO7 » pendant que le tournoi se joue en BO5
// serait le pire des mensonges — on le prouve contre le vrai générateur.
describe('listBoRounds — miroir du moteur', () => {
  const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

  function boByRound(bracketMatches: Record<string, { bracket: string; round: number; bo: number }>) {
    const map = new Map<string, number>();
    for (const m of Object.values(bracketMatches)) map.set(`${m.bracket}:${m.round}`, m.bo);
    return map;
  }

  it.each([8, 16, 32, 64])('double élimination %i équipes', n => {
    const format = fmt({
      maxTeams: n,
      bracketReset: true,
      bo: {
        default: 5,
        grandFinal: 7,
        overrides: [
          { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
          { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
          { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
        ],
      },
    });
    const bracket = generateDoubleElim(teams(n), { bo: format.bo, forfeitScore: FORFEIT });
    const actual = boByRound(bracket.matches);
    for (const ref of listBoRounds(format)) {
      const engineBo = actual.get(`${ref.bracket}:${ref.round}`);
      expect(engineBo, `${n} équipes — ${ref.label}`).toBe(ref.bo);
    }
  });

  it.each([8, 16, 32])('élimination directe %i équipes, petite finale comprise', n => {
    const format = fmt({
      kind: 'single_elim',
      maxTeams: n,
      thirdPlace: true,
      bo: { default: 5, grandFinal: 7, overrides: [{ bracket: 'winners', roundsFromEnd: 2, bo: 7 }] },
    });
    const bracket = generateSingleElim(teams(n), { bo: format.bo, forfeitScore: FORFEIT, thirdPlace: true });
    const actual = boByRound(bracket.matches);
    for (const ref of listBoRounds(format)) {
      expect(actual.get(`${ref.bracket}:${ref.round}`), `${n} équipes — ${ref.label}`).toBe(ref.bo);
    }
  });

  it('poules et suisse : pas de BO par tour (BO unique)', () => {
    expect(listBoRounds(fmt({ kind: 'round_robin', maxTeams: 8 }))).toEqual([]);
    expect(listBoRounds(fmt({ kind: 'swiss', maxTeams: 8, swissRounds: 3 }))).toEqual([]);
  });

  it('la petite finale est affichée mais pas réglable (le moteur lit le BO par défaut)', () => {
    const rounds = listBoRounds(fmt({ kind: 'single_elim', maxTeams: 8, thirdPlace: true }));
    const third = rounds.find(r => r.label === 'Petite finale');
    expect(third?.editable).toBe(false);
  });
});

describe('setBoForRound', () => {
  it('pose une exception, la retire quand elle rejoint le BO par défaut', () => {
    const base = fmt({ maxTeams: 16, bracketReset: true });
    const semis = listBoRounds(base).find(r => r.label === 'Demi-finales vainqueurs')!;

    const bumped = setBoForRound(base, semis, 7);
    expect(bumped.bo.overrides).toContainEqual({ bracket: 'winners', roundsFromEnd: 2, bo: 7 });
    expect(listBoRounds(bumped).find(r => r.label === 'Demi-finales vainqueurs')!.bo).toBe(7);

    const back = setBoForRound(bumped, semis, base.bo.default);
    expect(back.bo.overrides).toHaveLength(0);
  });

  it('la grande finale passe par son propre réglage, jamais par une exception', () => {
    const base = fmt({ maxTeams: 8, bracketReset: true });
    const gf = listBoRounds(base).find(r => r.bracket === 'grand_final')!;
    const next = setBoForRound(base, gf, 9);
    expect(next.bo.grandFinal).toBe(9);
    expect(next.bo.overrides).toHaveLength(0);
  });

  it('finale d’un simple élim : une seule source de vérité (le BO de finale)', () => {
    const base = fmt({ kind: 'single_elim', maxTeams: 8, bo: { default: 5, grandFinal: 5, overrides: [] } });
    const final = listBoRounds(base).find(r => r.label === 'Finale')!;
    const next = setBoForRound(base, final, 7);
    expect(next.bo.grandFinal).toBe(7);
    expect(next.bo.overrides.some(o => o.roundsFromEnd === 1)).toBe(false);
    // Et le moteur joue bien BO7 en finale.
    const bracket = generateSingleElim(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], {
      bo: next.bo, forfeitScore: FORFEIT,
    });
    expect(bracket.matches['W3-1'].bo).toBe(7);
  });
});

describe('spreadOverDays', () => {
  const blocks = (counts: number[]): PlanBlock[] =>
    counts.map((matchCount, i) => ({
      phase: i + 1, label: `B${i + 1}`, matchCount, rounds: [{ bracket: 'winners' as const, round: i + 1 }],
    }));

  it('une seule journée : tout le monde le même jour', () => {
    expect(spreadOverDays(blocks([16, 8, 4, 2, 1]), 1)).toEqual([1, 1, 1, 1, 1]);
  });

  it('équilibre la charge, pas le nombre de blocs', () => {
    // 31 matchs sur 2 journées : la coupure tombe après le gros bloc initial.
    expect(spreadOverDays(blocks([16, 8, 4, 2, 1]), 2)).toEqual([1, 2, 2, 2, 2]);
  });

  it('journées croissantes, aucune journée vide, tous les blocs affectés', () => {
    for (const counts of [[16, 8, 4, 2, 1], [8, 8, 8], [1, 1, 1, 1, 1, 1, 1], [62]]) {
      for (let days = 1; days <= 4; days++) {
        const out = spreadOverDays(blocks(counts), days);
        expect(out).toHaveLength(counts.length);
        for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
        const used = new Set(out);
        const expectedDays = Math.min(days, counts.length);
        expect(used.size).toBe(expectedDays);
        for (let d = 1; d <= expectedDays; d++) expect(used.has(d)).toBe(true);
      }
    }
  });

  it('plus de journées que de blocs : les journées en trop restent vides plutôt que de créer un trou', () => {
    expect(spreadOverDays(blocks([4, 2]), 5)).toEqual([1, 2]);
  });
});

describe('buildStagedBlocks', () => {
  const label = (s: { name?: string }, i: number) => s.name ?? `Étape ${i + 1}`;

  it('mono-étape : rien ne change, aucun marqueur d’étape', () => {
    const blocks = buildStagedBlocks([{ format: fmt({ kind: 'single_elim', maxTeams: 8 }) }], label);
    expect(blocks.map(b => b.label)).toEqual(['Quarts', 'Demi-finales', 'Finale']);
    expect(blocks.every(b => b.stage === undefined)).toBe(true);
  });

  it('poules puis phase finale : numérotation continue et étapes marquées', () => {
    const blocks = buildStagedBlocks([
      { format: fmt({ kind: 'round_robin', maxTeams: 16, groupCount: 4 }), name: 'Poules' },
      { format: fmt({ kind: 'single_elim', maxTeams: 8 }), name: 'Phase finale' },
    ], label);

    // 3 journées de poules + 3 tours de bracket, numérotés 1..6 d'affilée.
    expect(blocks.map(b => b.phase)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(blocks.map(b => b.stage)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(blocks.map(b => b.stageLabel)).toEqual(
      ['Poules', 'Poules', 'Poules', 'Phase finale', 'Phase finale', 'Phase finale']);
    expect(blocks.slice(3).map(b => b.label)).toEqual(['Quarts', 'Demi-finales', 'Finale']);
  });

  it('le plan multi-étapes est accepté par la validation serveur', () => {
    const stages = [
      { kind: 'round_robin' as const, format: fmt({ kind: 'round_robin', maxTeams: 16, groupCount: 4, bo: { default: 5, overrides: [], grandFinal: 5 }, points: { win: 3, draw: 1, loss: 0 } }), name: 'Poules', transfer: { advanceCount: 8, reseed: 'standings' as const } },
      { kind: 'single_elim' as const, format: fmt({ kind: 'single_elim', maxTeams: 8 }), name: 'Phase finale' },
    ];
    const blocks = buildStagedBlocks(stages, label);
    const phasePlan = blocksToPhasePlan(blocks, spreadOverDays(blocks, 2));
    // Les entrées de la phase finale portent bien leur étape.
    expect(phasePlan.filter(p => p.stage === 2)).toHaveLength(3);

    const res = validateCompetitionPayload({
      name: 'Poules puis playoff',
      game: 'rocket_league',
      circuitId: null,
      format: stages[0].format,
      stages,
      eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: { opensAt: '2026-08-29T12:00:00.000Z', closesAt: '2026-09-09T21:59:00.000Z', waitlist: true },
      schedule: {
        days: [
          { date: '2026-09-12', startsAt: '15:00', endsAt: '22:00' },
          { date: '2026-09-13', startsAt: '15:00', endsAt: '22:00' },
        ],
        phasePlan,
        generalCheckinMinutes: 20,
        matchCheckinMinutes: 5,
        scoreCounterMinutes: 3,
      },
      discordGuildId: '',
    });
    expect(res.ok ? null : res.error).toBeNull();
  });

  it('une phase qui vise une étape inexistante est refusée', () => {
    const format = fmt({ kind: 'single_elim', maxTeams: 8 });
    const res = validateCompetitionPayload({
      name: 'Étape fantôme',
      game: 'rocket_league',
      circuitId: null,
      format,
      stages: null,
      eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: { opensAt: '2026-08-29T12:00:00.000Z', closesAt: '2026-09-09T21:59:00.000Z', waitlist: true },
      schedule: {
        days: [{ date: '2026-09-12', startsAt: '15:00' }],
        phasePlan: [
          { phase: 1, day: 1, label: 'Finale', rounds: [{ bracket: 'winners', round: 3 }] },
          { phase: 2, day: 1, label: 'Ailleurs', stage: 2, rounds: [{ bracket: 'winners', round: 1 }] },
        ],
        generalCheckinMinutes: 20,
        matchCheckinMinutes: 5,
        scoreCounterMinutes: 3,
      },
      discordGuildId: '',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('étape 2');
  });
});

describe('blocksToPhasePlan / buildDefaultPlan', () => {
  it('produit un plan numéroté 1..N, jours croissants, labels bornés à 60', () => {
    const plan = buildDefaultPlan(fmt({ maxTeams: 32, bracketReset: true }), 2);
    expect(plan.map(p => p.phase)).toEqual(plan.map((_, i) => i + 1));
    for (let i = 1; i < plan.length; i++) expect(plan[i].day).toBeGreaterThanOrEqual(plan[i - 1].day);
    expect(plan.every(p => p.label.length > 0 && p.label.length <= 60)).toBe(true);
    expect(new Set(plan.map(p => p.day))).toEqual(new Set([1, 2]));
  });

  it('respecte la journée fournie pour chaque bloc', () => {
    const blocks = buildPlanBlocks(fmt({ kind: 'single_elim', maxTeams: 8 }));
    const plan = blocksToPhasePlan(blocks, [1, 2, 3]);
    expect(plan.map(p => p.day)).toEqual([1, 2, 3]);
    expect(plan[2].rounds).toEqual([{ bracket: 'winners', round: 3 }]);
  });
});

// Le contrat qui compte : ce que le formulaire produit, le serveur l'accepte.
// Un plan refusé après coup, c'est l'organisateur bloqué sans recours — le
// travers exact des plateformes que Matt a abandonnées.
describe('les plans par défaut passent la validation serveur', () => {
  function payload(format: CompetitionFormat, dayCount: number) {
    const days = Array.from({ length: dayCount }, (_, i) => ({
      date: `2026-09-${String(12 + i).padStart(2, '0')}`,
      startsAt: '15:00',
      endsAt: '22:00',
    }));
    return {
      name: 'Tournoi de vérification',
      game: 'rocket_league',
      circuitId: null,
      format,
      eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: {
        opensAt: '2026-08-29T12:00:00.000Z',
        closesAt: '2026-09-09T21:59:00.000Z',
        waitlist: true,
      },
      schedule: {
        days,
        phasePlan: buildDefaultPlan(format, dayCount),
        generalCheckinMinutes: 20,
        matchCheckinMinutes: 5,
        scoreCounterMinutes: 3,
      },
      discordGuildId: '',
    };
  }

  const cases: Array<[string, CompetitionFormat]> = [
    ['double élim 8', fmt({ maxTeams: 8, bracketReset: true })],
    ['double élim 32 (Legends)', fmt({ maxTeams: 32, bracketReset: true })],
    ['double élim 64 (nouveau cap)', fmt({ maxTeams: 64, bracketReset: true })],
    ['simple élim 16', fmt({ kind: 'single_elim', maxTeams: 16, bo: { ...BO } })],
    ['simple élim 64 + petite finale', fmt({ kind: 'single_elim', maxTeams: 64, thirdPlace: true })],
    ['poules 16 en 4', fmt({ kind: 'round_robin', maxTeams: 16, groupCount: 4, bo: { default: 5, overrides: [], grandFinal: 5 }, points: { win: 3, draw: 1, loss: 0 } })],
    ['poules 20 aller-retour', fmt({ kind: 'round_robin', maxTeams: 20, groupCount: 2, doubleRound: true, bo: { default: 5, overrides: [], grandFinal: 5 }, points: { win: 3, draw: 1, loss: 0 } })],
    ['suisse 16 en 4 rondes', fmt({ kind: 'swiss', maxTeams: 16, swissRounds: 4, bo: { default: 5, overrides: [], grandFinal: 5 }, points: { win: 3, draw: 1, loss: 0 } })],
  ];

  it.each(cases)('%s — sur 1 journée', (_label, format) => {
    const res = validateCompetitionPayload(payload(format, 1));
    expect(res.ok ? null : res.error).toBeNull();
  });

  it.each(cases)('%s — réparti sur 2 journées', (_label, format) => {
    const res = validateCompetitionPayload(payload(format, 2));
    expect(res.ok ? null : res.error).toBeNull();
  });
});
