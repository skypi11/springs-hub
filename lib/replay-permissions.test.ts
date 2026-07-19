import { describe, it, expect } from 'vitest';
import {
  canUploadReplay, canViewReplayStats, canTriggerParse,
  canViewEventReplayStats, canDeleteReplay,
} from './replay-permissions';
import type { UserContext, TeamRef } from './event-permissions';

const ctx = (partial: Partial<UserContext> = {}): UserContext => ({
  uid: 'u1',
  isFounder: false,
  isCoFounder: false,
  isManager: false,
  isCoach: false,
  staffedTeamIds: [],
  ...partial,
});

// Setup multi-jeux : team RL t-rl, team Valorant t-val
const teamGames = { 't-rl': 'rocket_league', 't-val': 'valorant' };

describe('canUploadReplay — modèle A simple (rétrocompat all-games)', () => {
  it('fondateur peut uploader sur n\'importe quelle team', () => {
    expect(canUploadReplay(ctx({ isFounder: true }), 't-rl')).toBe(true);
    expect(canUploadReplay(ctx({ isFounder: true }), 't-val')).toBe(true);
  });

  it('manager all-games (managerGames absent) peut uploader partout', () => {
    const c = ctx({ isManager: true, teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });

  it('coach all-games (coachGames absent) peut uploader partout', () => {
    const c = ctx({ isCoach: true, teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });

  it('staff explicite d\'une team peut uploader sur cette team', () => {
    const c = ctx({ staffedTeamIds: ['t-rl'] });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(false);
  });

  it('capitaine de team peut uploader sur sa team', () => {
    const c = ctx({ captainOfTeamIds: ['t-rl'] });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(false);
  });

  it('joueur simple ne peut pas uploader', () => {
    expect(canUploadReplay(ctx(), 't-rl')).toBe(false);
  });
});

describe('canUploadReplay — scope par jeu (managerGames / coachGames)', () => {
  it('manager scopé RL peut uploader sur team RL mais pas Val', () => {
    const c = ctx({ isManager: true, managerGames: ['rocket_league'], teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(false);
  });

  it('manager scopé Val peut uploader sur team Val mais pas RL', () => {
    const c = ctx({ isManager: true, managerGames: ['valorant'], teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(false);
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });

  it('coach scopé RL peut uploader sur team RL mais pas Val', () => {
    const c = ctx({ isCoach: true, coachGames: ['rocket_league'], teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(false);
  });

  it('coach scopé Val peut uploader sur team Val mais pas RL', () => {
    const c = ctx({ isCoach: true, coachGames: ['valorant'], teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(false);
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });

  it('manager scopé liste vide [] ne peut rien uploader', () => {
    const c = ctx({ isManager: true, managerGames: [], teamGames });
    expect(canUploadReplay(c, 't-rl')).toBe(false);
    expect(canUploadReplay(c, 't-val')).toBe(false);
  });

  it('dirigeant n\'est jamais scopé même avec managerGames défini', () => {
    const c = ctx({ isFounder: true, isManager: true, managerGames: ['rocket_league'], teamGames });
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });

  it('manager scopé RL + staff explicite Val → peut uploader sur Val via staff explicite', () => {
    const c = ctx({ isManager: true, managerGames: ['rocket_league'], teamGames, staffedTeamIds: ['t-val'] });
    expect(canUploadReplay(c, 't-rl')).toBe(true);
    expect(canUploadReplay(c, 't-val')).toBe(true);
  });
});

describe('canViewReplayStats — lecture des stats (joueur inclus, scopé par jeu)', () => {
  const teamRL = { id: 't-rl', playerIds: ['pRL'], subIds: ['sRL'] } as TeamRef;
  const teamVal = { id: 't-val', playerIds: ['pVal'], subIds: [] } as TeamRef;

  it('dirigeant voit tout', () => {
    expect(canViewReplayStats(ctx({ isFounder: true }), 't-rl', teamRL)).toBe(true);
    expect(canViewReplayStats(ctx({ isFounder: true }), 't-val', teamVal)).toBe(true);
  });
  it('coach scopé RL ne voit PAS les stats Val (anti-fuite inter-jeux §2.14)', () => {
    const c = ctx({ isCoach: true, coachGames: ['rocket_league'], teamGames });
    expect(canViewReplayStats(c, 't-rl', teamRL)).toBe(true);
    expect(canViewReplayStats(c, 't-val', teamVal)).toBe(false);
  });
  it('capitaine voit sa team, pas une autre', () => {
    const c = ctx({ captainOfTeamIds: ['t-rl'] });
    expect(canViewReplayStats(c, 't-rl', teamRL)).toBe(true);
    expect(canViewReplayStats(c, 't-val', teamVal)).toBe(false);
  });
  it('joueur / remplaçant de la team voit ses stats', () => {
    expect(canViewReplayStats(ctx({ uid: 'pRL' }), 't-rl', teamRL)).toBe(true);
    expect(canViewReplayStats(ctx({ uid: 'sRL' }), 't-rl', teamRL)).toBe(true);
  });
  it('joueur d\'une AUTRE team ne voit pas (anti-fuite)', () => {
    expect(canViewReplayStats(ctx({ uid: 'pRL' }), 't-val', teamVal)).toBe(false);
  });
  it('doc team absent + joueur simple → KO', () => {
    expect(canViewReplayStats(ctx({ uid: 'pRL' }), 't-rl', undefined)).toBe(false);
  });
});

describe('canTriggerParse — déclenchement du parsing (JAMAIS un joueur)', () => {
  it('joueur simple → false (test central : pas de quota structure cramé)', () => {
    expect(canTriggerParse(ctx({ uid: 'pRL' }), 't-rl')).toBe(false);
  });
  it('remplaçant → false', () => {
    expect(canTriggerParse(ctx({ uid: 'sRL' }), 't-rl')).toBe(false);
  });
  it('capitaine → true', () => {
    expect(canTriggerParse(ctx({ captainOfTeamIds: ['t-rl'] }), 't-rl')).toBe(true);
  });
  it('coach scopé RL → true sur RL, false sur Val', () => {
    const c = ctx({ isCoach: true, coachGames: ['rocket_league'], teamGames });
    expect(canTriggerParse(c, 't-rl')).toBe(true);
    expect(canTriggerParse(c, 't-val')).toBe(false);
  });
});

describe('canViewEventReplayStats — page stats d\'un event', () => {
  const teams = [{ id: 't-rl', playerIds: ['pRL'], subIds: [] } as TeamRef];
  it('staff → true quel que soit le scope', () => {
    expect(canViewEventReplayStats(ctx({ isFounder: true }), { scope: 'structure' }, teams)).toBe(true);
  });
  it('joueur d\'une team ciblée (scope teams) → true', () => {
    expect(canViewEventReplayStats(ctx({ uid: 'pRL' }), { scope: 'teams', teamIds: ['t-rl'] }, teams)).toBe(true);
  });
  it('joueur hors des teams ciblées → false', () => {
    expect(canViewEventReplayStats(ctx({ uid: 'autre' }), { scope: 'teams', teamIds: ['t-rl'] }, teams)).toBe(false);
  });
  it('scope structure + joueur simple → false', () => {
    expect(canViewEventReplayStats(ctx({ uid: 'pRL' }), { scope: 'structure' }, teams)).toBe(false);
  });
});

describe('canDeleteReplay', () => {
  it('uploader peut supprimer son propre replay', () => {
    expect(canDeleteReplay(ctx({ uid: 'u1' }), 'u1')).toBe(true);
  });

  it('dirigeant peut supprimer n\'importe quel replay', () => {
    expect(canDeleteReplay(ctx({ uid: 'u1', isFounder: true }), 'u-someone-else')).toBe(true);
    expect(canDeleteReplay(ctx({ uid: 'u1', isCoFounder: true }), 'u-someone-else')).toBe(true);
  });

  it('manager / coach NE peuvent PAS supprimer un replay qu\'ils n\'ont pas uploadé', () => {
    expect(canDeleteReplay(ctx({ uid: 'u1', isManager: true }), 'u-someone-else')).toBe(false);
    expect(canDeleteReplay(ctx({ uid: 'u1', isCoach: true }), 'u-someone-else')).toBe(false);
  });

  it('joueur simple ne peut pas supprimer un replay d\'un autre', () => {
    expect(canDeleteReplay(ctx({ uid: 'u1' }), 'u-someone-else')).toBe(false);
  });
});
