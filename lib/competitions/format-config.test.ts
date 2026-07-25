import { describe, it, expect } from 'vitest';
import {
  configFieldsByLevel,
  defaultFormatFor,
  getConfigValue,
  normalizeFormat,
  setConfigValue,
  switchFormatKind,
  swissDefaultRounds,
} from './format-config';
import { FORMAT_KINDS } from './formats';
import { validateFormat } from './validate';
import type { CompetitionFormat, FormatKind } from '@/types/competitions';

function expectAccepted(format: CompetitionFormat, context: string) {
  const res = validateFormat(format);
  expect(res.ok ? null : `${context} : ${res.error}`).toBeNull();
}

describe('defaultFormatFor', () => {
  it('chaque format de la registry a un préréglage accepté par le serveur', () => {
    for (const kind of FORMAT_KINDS) {
      const format = defaultFormatFor(kind);
      expect(format.kind).toBe(kind);
      expectAccepted(format, kind);
    }
  });
});

describe('getConfigValue / setConfigValue', () => {
  it('lit et écrit les chemins déclarés par les fiches', () => {
    const base = defaultFormatFor('double_elim');
    expect(getConfigValue(base, 'maxTeams')).toBe(base.maxTeams);
    expect(getConfigValue(base, 'bo.default')).toBe(base.bo.default);
    expect(getConfigValue(base, 'bracketReset')).toBe(base.bracketReset);
    expect(getConfigValue(base, 'inexistant')).toBeUndefined();
    expect(getConfigValue(base, 'bo.inexistant')).toBeUndefined();

    const changed = setConfigValue(base, 'bo.grandFinal', 9);
    expect(changed.bo.grandFinal).toBe(9);
    // Immuable : l'original n'est jamais modifié en place.
    expect(base.bo.grandFinal).not.toBe(9);
  });

  it('le score de forfait suit le BO par défaut, sans saisie', () => {
    const base = defaultFormatFor('single_elim');
    expect(setConfigValue(base, 'bo.default', 7).forfeitScore).toEqual({ games: 4, goalsPerGame: 1 });
    expect(setConfigValue(base, 'bo.default', 3).forfeitScore).toEqual({ games: 2, goalsPerGame: 1 });
  });

  it('un réglage sans objet dans ce format ne s’installe pas', () => {
    // Cocher « reset » sur un simple élim ne doit rien écrire : le serveur le
    // refuserait, l'aperçu mentirait.
    const single = setConfigValue(defaultFormatFor('single_elim'), 'bracketReset', true);
    expect(single.bracketReset).toBe(false);
    const double = setConfigValue(defaultFormatFor('double_elim'), 'thirdPlace', true);
    expect(double.thirdPlace).toBe(false);
  });
});

describe('normalizeFormat', () => {
  it('poules et suisse : BO unique, aucune règle par tour', () => {
    for (const kind of ['round_robin', 'swiss'] as FormatKind[]) {
      const polluted = {
        ...defaultFormatFor(kind),
        bo: { default: 5, overrides: [{ bracket: 'winners' as const, roundsFromEnd: 1, bo: 7 }], grandFinal: 9 },
      };
      const clean = normalizeFormat(polluted);
      expect(clean.bo.overrides).toEqual([]);
      expect(clean.bo.grandFinal).toBe(5);
      expectAccepted(clean, kind);
    }
  });

  it('changer l’effectif ajuste les poules et les rondes plutôt que de produire une config refusée', () => {
    // Une ligue de 8 poussée à 64 : sans relèvement des poules, ce serait une
    // poule unique de 64 (maximum 20).
    const grown = setConfigValue(defaultFormatFor('round_robin'), 'maxTeams', 64);
    expect(grown.groupCount).toBeGreaterThanOrEqual(4);
    expectAccepted(grown, 'poules 64');

    // Un suisse ramené à 4 équipes ne peut plus tenir 4 rondes sans re-match.
    const shrunk = setConfigValue(defaultFormatFor('swiss'), 'maxTeams', 4);
    expect(shrunk.swissRounds).toBeLessThanOrEqual(3);
    expectAccepted(shrunk, 'suisse 4');
  });

  it('ne laisse aucun réglage orphelin d’un autre format', () => {
    const orphan = {
      ...defaultFormatFor('double_elim'),
      groupCount: 4,
      doubleRound: true,
      swissRounds: 6,
      points: { win: 3, draw: 1, loss: 0 },
    } as CompetitionFormat;
    const clean = normalizeFormat(orphan);
    expect(clean.groupCount).toBeUndefined();
    expect(clean.doubleRound).toBeUndefined();
    expect(clean.swissRounds).toBeUndefined();
    expect(clean.points).toBeUndefined();
  });
});

describe('switchFormatKind', () => {
  it('toute transition entre formats produit une config acceptée par le serveur', () => {
    for (const from of FORMAT_KINDS) {
      for (const to of FORMAT_KINDS) {
        const start = defaultFormatFor(from);
        const next = switchFormatKind(start, to);
        expect(next.kind).toBe(to);
        expectAccepted(next, `${from} → ${to}`);
      }
    }
  });

  it('conserve la taille du champ et le BO des matchs', () => {
    const start = setConfigValue(
      setConfigValue(defaultFormatFor('single_elim'), 'maxTeams', 24),
      'bo.default', 3,
    );
    const next = switchFormatKind(start, 'double_elim');
    expect(next.maxTeams).toBe(24);
    expect(next.bo.default).toBe(3);
  });

  it('borne la taille conservée aux limites du format d’arrivée', () => {
    const big = setConfigValue(defaultFormatFor('round_robin'), 'maxTeams', 64);
    const next = switchFormatKind(big, 'double_elim');
    expect(next.maxTeams).toBeLessThanOrEqual(64);
    expectAccepted(next, 'poules 64 → double élim');
  });

  it('suisse : les rondes suivent la taille du champ, jamais plus que N−1', () => {
    const small = setConfigValue(defaultFormatFor('double_elim'), 'maxTeams', 4);
    const next = switchFormatKind(small, 'swiss');
    expect(next.swissRounds).toBeLessThanOrEqual(3);
    expectAccepted(next, 'double élim 4 → suisse');
    expect(swissDefaultRounds(16)).toBe(4);
    expect(swissDefaultRounds(32)).toBe(5);
  });

  it('poules : jamais plus de poules que d’équipes à deux par poule', () => {
    const tiny = setConfigValue(defaultFormatFor('single_elim'), 'maxTeams', 4);
    const next = switchFormatKind(tiny, 'round_robin');
    expect(next.groupCount).toBeLessThanOrEqual(2);
    expectAccepted(next, 'simple élim 4 → poules');
  });
});

describe('configFieldsByLevel', () => {
  it('sépare l’essentiel de l’avancé sans rien perdre', () => {
    for (const kind of FORMAT_KINDS) {
      const { essential, advanced } = configFieldsByLevel(kind);
      expect(essential.length).toBeGreaterThan(0);
      const keys = [...essential, ...advanced].map(f => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
