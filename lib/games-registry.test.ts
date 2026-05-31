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

  it('RL : rankVerification (Discord Epic/Steam ou OpenID) + replayParsing (ballchasing), PAS de cron rang', () => {
    const rl = GAMES_REGISTRY.rocket_league;
    expect(rl.features.rankVerification).toBe(true);
    expect(rl.features.replayParsing).toBe(true);
    // Fix Matt 2026-05-31 : pas de cron RL rang. Le rang est fetch on-demand
    // via /api/rl-stats (Tracker.gg) à l'affichage du profil. La passe
    // nocturne discord-sync ne touche que au lien Epic/Steam, pas au rang.
    expect(rl.features.rankAutoSync).toBe(false);
    expect(rl.features.trackerProfile).toBe(true);
  });

  it('TM : pas de vérification anti-mensonge mais lien public trackmania.io', () => {
    const tm = GAMES_REGISTRY.trackmania;
    expect(tm.features.rankVerification).toBe(false);
    expect(tm.features.replayParsing).toBe(false);
    expect(tm.features.rankAutoSync).toBe(false);
    // Fix Matt 2026-05-31 : trackmania.io est public + on fetch trophées/COTD
    // à la demande via /api/tm-stats. Le lien tracker existe et a une valeur.
    expect(tm.features.trackerProfile).toBe(true);
    expect(tm.trackerUrlTemplate).toContain('trackmania.io');
  });

  it('Valorant : 5 titulaires + 2 remplaçants, pas de solo', () => {
    const val = GAMES_REGISTRY.valorant;
    expect(val.roster.titulaires).toBe(5);
    expect(val.roster.remplacants).toBe(2);
    expect(val.roster.allowSolo).toBe(false);
  });

  it('Valorant : rankVerification + rankAutoSync (PUUID Riot + cron HenrikDev) + tracker.gg, pas de replayParsing', () => {
    const val = GAMES_REGISTRY.valorant;
    // PUUID Riot immuable stocké au capture via Discord connection riotgames.
    expect(val.features.rankVerification).toBe(true);
    // Pas d'équivalent ballchasing pour Val.
    expect(val.features.replayParsing).toBe(false);
    // Cron nocturne /api/cron/sync-valorant-ranks via HenrikDev.
    expect(val.features.rankAutoSync).toBe(true);
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
    expect(getGameLogoUrl('rocket_league')).toBe('/games/rocket-league.png');
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
