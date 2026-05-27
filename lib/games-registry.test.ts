import { describe, it, expect } from 'vitest';
import {
  GAMES_REGISTRY,
  ALL_GAME_DEFS,
  getGame,
  getGameOrThrow,
  getGameColor,
  getGameColorRgb,
  getGameLabel,
  getGameShortLabel,
  getGameLogoUrl,
  getGameBannerUrl,
  getGameSlug,
  getGameBySlug,
  gameHasFeature,
  isKnownGame,
} from './games-registry';

describe('GAMES_REGISTRY invariants', () => {
  it('contient au moins RL, TM et Valorant', () => {
    expect(GAMES_REGISTRY.rocket_league).toBeDefined();
    expect(GAMES_REGISTRY.trackmania).toBeDefined();
    expect(GAMES_REGISTRY.valorant).toBeDefined();
  });

  it('chaque def a un id qui match sa clé (cohérence interne)', () => {
    for (const [key, def] of Object.entries(GAMES_REGISTRY)) {
      expect(def.id).toBe(key);
    }
  });

  it('chaque def a un slug unique (sert aux URLs /competitions/{slug}/[id])', () => {
    const slugs = ALL_GAME_DEFS.map(g => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('chaque def a un shortLabel unique (sert aux tags)', () => {
    const labels = ALL_GAME_DEFS.map(g => g.shortLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('chaque logoUrl/bannerUrl est un chemin absolu local (commence par "/")', () => {
    for (const g of ALL_GAME_DEFS) {
      expect(g.logoUrl.startsWith('/')).toBe(true);
      expect(g.bannerUrl.startsWith('/')).toBe(true);
    }
  });

  it('roster cohérent (titulaires >= 0, remplacants >= 0)', () => {
    for (const g of ALL_GAME_DEFS) {
      expect(g.roster.titulaires).toBeGreaterThanOrEqual(0);
      expect(g.roster.remplacants).toBeGreaterThanOrEqual(0);
    }
  });

  it('RL : 3 titulaires + 2 remplaçants, pas de solo', () => {
    const rl = GAMES_REGISTRY.rocket_league;
    expect(rl.roster.titulaires).toBe(3);
    expect(rl.roster.remplacants).toBe(2);
    expect(rl.roster.allowSolo).toBe(false);
  });

  it('TM : 1 titulaire, solo autorisé', () => {
    const tm = GAMES_REGISTRY.trackmania;
    expect(tm.roster.titulaires).toBe(1);
    expect(tm.roster.allowSolo).toBe(true);
  });

  it('RL active rankVerification + replayParsing + rankAutoSync (système anti-mensonge)', () => {
    const rl = GAMES_REGISTRY.rocket_league;
    expect(rl.features.rankVerification).toBe(true);
    expect(rl.features.replayParsing).toBe(true);
    expect(rl.features.rankAutoSync).toBe(true);
  });

  it('TM n\'a aucune feature anti-mensonge (legacy)', () => {
    const tm = GAMES_REGISTRY.trackmania;
    expect(tm.features.rankVerification).toBe(false);
    expect(tm.features.replayParsing).toBe(false);
    expect(tm.features.rankAutoSync).toBe(false);
  });

  it('Valorant : 5 titulaires + 2 remplaçants, pas de solo', () => {
    const val = GAMES_REGISTRY.valorant;
    expect(val.roster.titulaires).toBe(5);
    expect(val.roster.remplacants).toBe(2);
    expect(val.roster.allowSolo).toBe(false);
  });

  it('Valorant : MVP sans rankVerification/replayParsing mais avec tracker.gg', () => {
    const val = GAMES_REGISTRY.valorant;
    expect(val.features.rankVerification).toBe(false);
    expect(val.features.replayParsing).toBe(false);
    expect(val.features.rankAutoSync).toBe(false);
    expect(val.features.trackerProfile).toBe(true);
  });
});

describe('getGame', () => {
  it('retourne la def pour un id connu', () => {
    expect(getGame('rocket_league')?.shortLabel).toBe('RL');
  });

  it('retourne undefined pour null, undefined, vide', () => {
    expect(getGame(null)).toBeUndefined();
    expect(getGame(undefined)).toBeUndefined();
    expect(getGame('')).toBeUndefined();
  });

  it('retourne undefined pour un id inconnu (pas de throw)', () => {
    expect(getGame('lol')).toBeUndefined();
    expect(getGame('cs2')).toBeUndefined();
  });
});

describe('getGameOrThrow', () => {
  it('retourne la def pour un id connu', () => {
    expect(getGameOrThrow('trackmania').label).toBe('Trackmania');
  });

  it('throw pour un id inconnu', () => {
    expect(() => getGameOrThrow('cs2')).toThrow(/Unknown game/);
  });
});

describe('getters avec fallback', () => {
  it('getGameColor fallback neutre si jeu inconnu', () => {
    expect(getGameColor('lol')).toBe('var(--s-text-dim)');
    expect(getGameColor('rocket_league')).toBe('#0081FF');
  });

  it('getGameColorRgb parsable en R,G,B et match getGameColor', () => {
    expect(getGameColorRgb('rocket_league')).toBe('0,129,255');
    expect(getGameColorRgb('trackmania')).toBe('0,217,54');
    expect(getGameColorRgb('lol')).toMatch(/^\d+,\d+,\d+$/); // fallback valide
  });

  it('getGameLabel fallback "Jeu inconnu"', () => {
    expect(getGameLabel('lol')).toBe('Jeu inconnu');
    expect(getGameLabel('trackmania')).toBe('Trackmania');
  });

  it('getGameShortLabel fallback "?"', () => {
    expect(getGameShortLabel('lol')).toBe('?');
    expect(getGameShortLabel('rocket_league')).toBe('RL');
  });

  it('getGameLogoUrl null si jeu inconnu', () => {
    expect(getGameLogoUrl('lol')).toBeNull();
    expect(getGameLogoUrl('rocket_league')).toBe('/rocket-league.webp');
  });

  it('getGameBannerUrl null si jeu inconnu', () => {
    expect(getGameBannerUrl('lol')).toBeNull();
    expect(getGameBannerUrl('trackmania')).toBe('/tm.webp');
  });

  it('getGameSlug null si jeu inconnu', () => {
    expect(getGameSlug('lol')).toBeNull();
    expect(getGameSlug('rocket_league')).toBe('rl');
  });
});

describe('getGameBySlug', () => {
  it('résout rl → rocket_league', () => {
    expect(getGameBySlug('rl')?.id).toBe('rocket_league');
  });

  it('résout tm → trackmania', () => {
    expect(getGameBySlug('tm')?.id).toBe('trackmania');
  });

  it('résout val → valorant', () => {
    expect(getGameBySlug('val')?.id).toBe('valorant');
  });

  it('undefined si slug inconnu', () => {
    expect(getGameBySlug('xxx')).toBeUndefined();
    expect(getGameBySlug(null)).toBeUndefined();
  });
});

describe('gameHasFeature', () => {
  it('true pour features actives', () => {
    expect(gameHasFeature('rocket_league', 'rankVerification')).toBe(true);
    expect(gameHasFeature('rocket_league', 'replayParsing')).toBe(true);
  });

  it('false pour features désactivées', () => {
    expect(gameHasFeature('trackmania', 'rankVerification')).toBe(false);
  });

  it('false pour jeu inconnu (jamais throw)', () => {
    expect(gameHasFeature('lol', 'rankVerification')).toBe(false);
    expect(gameHasFeature(null, 'replayParsing')).toBe(false);
  });
});

describe('isKnownGame', () => {
  it('true pour jeu connu', () => {
    expect(isKnownGame('rocket_league')).toBe(true);
    expect(isKnownGame('trackmania')).toBe(true);
    expect(isKnownGame('valorant')).toBe(true);
  });

  it('false pour inconnu/null/vide', () => {
    expect(isKnownGame('cs2')).toBe(false);
    expect(isKnownGame('lol')).toBe(false);
    expect(isKnownGame(null)).toBe(false);
    expect(isKnownGame('')).toBe(false);
  });
});
