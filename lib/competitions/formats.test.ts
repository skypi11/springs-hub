// Tests de la registry de formats : cohérence fiches (formats.ts) ↔ engines
// (formats-server.ts), résumés, capabilities, plans de phases et helpers de
// routage — le contrat que la page de création et la clôture consommeront.

import { describe, it, expect } from 'vitest';
import { FORMAT_DEFS, FORMAT_KINDS, isFormatKind } from './formats';
import { FORMAT_ENGINES, engineFor, kindOf } from './formats-server';
import { ROUND_ROBIN_FORMAT, roundRobinMatchdays, buildRoundRobinPhasePlan } from './defaults';
import { advanceMatch, isConcluded } from '@/lib/tournament';
import type { GameScore } from '@/lib/tournament';

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

const sweepA: GameScore[] = [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 1, b: 0 }];

describe('registry — cohérence fiches ↔ engines', () => {
  it('chaque kind a sa fiche ET son engine, dans l\'ordre déclaré', () => {
    expect(Object.keys(FORMAT_DEFS).sort()).toEqual([...FORMAT_KINDS].sort());
    expect(Object.keys(FORMAT_ENGINES).sort()).toEqual([...FORMAT_KINDS].sort());
    for (const kind of FORMAT_KINDS) {
      expect(FORMAT_DEFS[kind].kind).toBe(kind);
    }
  });

  it('chaque preset se génère sans erreur via son engine et produit le bon kind', () => {
    for (const kind of FORMAT_KINDS) {
      for (const preset of FORMAT_DEFS[kind].presets) {
        expect(preset.format.kind).toBe(kind);
        const bracket = FORMAT_ENGINES[kind].generate(teams(preset.format.maxTeams), preset.format);
        expect(bracket.kind).toBe(kind);
        expect(bracket.order.length).toBeGreaterThan(0);
      }
    }
  });

  it('summarize renvoie un aperçu non vide pour chaque fiche', () => {
    for (const kind of FORMAT_KINDS) {
      const def = FORMAT_DEFS[kind];
      for (const preset of def.presets) {
        const text = def.summarize(preset.format, preset.format.maxTeams);
        expect(text.length).toBeGreaterThan(10);
        expect(text).toContain(String(preset.format.maxTeams));
      }
    }
  });

  it('capabilities cohérentes : une étape de groupes produit un classement', () => {
    for (const kind of FORMAT_KINDS) {
      const caps = FORMAT_DEFS[kind].capabilities;
      if (caps.canBeGroupStage) expect(caps.producesRanking).toBe(true);
      // Chaque format doit pouvoir conclure OU qualifier — jamais ni l'un ni l'autre.
      expect(caps.canBeFinalStage || caps.canBeGroupStage).toBe(true);
    }
  });

  it('configFields : défauts dans les bornes déclarées', () => {
    for (const kind of FORMAT_KINDS) {
      for (const field of FORMAT_DEFS[kind].configFields) {
        if (field.type === 'number') {
          expect(field.default).toBeGreaterThanOrEqual(field.min);
          expect(field.default).toBeLessThanOrEqual(field.max);
        }
      }
    }
  });
});

describe('routage kindOf / engineFor', () => {
  it('kindOf : kinds connus conservés, legacy/inconnu → double élim', () => {
    expect(kindOf({ kind: 'round_robin' })).toBe('round_robin');
    expect(kindOf({ kind: 'single_elim' })).toBe('single_elim');
    expect(kindOf({ kind: 'double_elim' })).toBe('double_elim');
    expect(kindOf({})).toBe('double_elim');
    expect(kindOf(null)).toBe('double_elim');
    expect(kindOf({ kind: 'swiss' })).toBe('double_elim');
  });

  it('isFormatKind filtre les valeurs inconnues', () => {
    expect(isFormatKind('round_robin')).toBe(true);
    expect(isFormatKind('swiss')).toBe(false);
    expect(isFormatKind(42)).toBe(false);
  });

  it('engineFor ne renvoie jamais undefined', () => {
    expect(engineFor('round_robin')).toBe(FORMAT_ENGINES.round_robin);
    expect(engineFor(undefined)).toBe(FORMAT_ENGINES.double_elim);
  });
});

describe('engine round robin — prédicats de fin', () => {
  it('isFinished = tous les matchs terminaux (jamais championOf) ; needsAdminDecision toujours false', () => {
    const engine = FORMAT_ENGINES.round_robin;
    let bracket = engine.generate(teams(4), ROUND_ROBIN_FORMAT);
    expect(engine.isFinished(bracket)).toBe(false);
    expect(engine.needsAdminDecision(bracket)).toBe(false);

    for (const id of [...bracket.order]) {
      bracket = advanceMatch(bracket, id, { type: 'winner', winner: 'a', scores: sweepA });
    }
    expect(isConcluded(bracket)).toBe(true);
    expect(engine.isFinished(bracket)).toBe(true);
    // Pas de champion mécanique en poules : jamais une « décision admin ».
    expect(engine.needsAdminDecision(bracket)).toBe(false);
  });

  it('computePlacements applique le barème du format (points custom)', () => {
    const engine = FORMAT_ENGINES.round_robin;
    const format = { ...ROUND_ROBIN_FORMAT, maxTeams: 4 };
    let bracket = engine.generate(teams(4), format);
    for (const id of [...bracket.order]) {
      bracket = advanceMatch(bracket, id, { type: 'winner', winner: 'a', scores: sweepA });
    }
    const placements = engine.computePlacements(bracket, format);
    expect(placements).toHaveLength(4);
    expect(placements.every(p => p.placement !== null)).toBe(true);
  });
});

describe('roundRobinMatchdays / buildRoundRobinPhasePlan', () => {
  it('journées : poule paire = taille−1, impaire = taille, ×2 en aller-retour', () => {
    expect(roundRobinMatchdays(8, 1, false)).toBe(7);
    expect(roundRobinMatchdays(8, 1, true)).toBe(14);
    expect(roundRobinMatchdays(16, 4, false)).toBe(3);   // poules de 4
    expect(roundRobinMatchdays(7, 2, false)).toBe(3);    // poules de 4 et 3
    expect(roundRobinMatchdays(5, 1, false)).toBe(5);    // impaire : 5 journées
  });

  it('le plan par défaut colle aux journées générées (une phase par journée)', () => {
    const format = { ...ROUND_ROBIN_FORMAT, maxTeams: 8, groupCount: 2 };
    const plan = buildRoundRobinPhasePlan(format.maxTeams, 2, false);
    expect(plan).toHaveLength(3); // poules de 4 → 3 journées
    expect(plan.map(p => p.label)).toEqual(['J1', 'J2', 'J3']);
    expect(plan.every(p => p.rounds.every(r => r.bracket === 'round_robin'))).toBe(true);

    // Le bracket généré avec ce plan rattache chaque match à sa phase.
    const bracket = FORMAT_ENGINES.round_robin.generate(teams(8), format, plan);
    for (const id of bracket.order) {
      const m = bracket.matches[id];
      expect(m.phase).toBe(m.round);
    }
  });
});
