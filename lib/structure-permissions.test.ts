import { describe, it, expect } from 'vitest';
import {
  isResponsable, isCoach,
  isResponsableForGame, isCoachForGame,
  isStructureAdminForGame,
  getResponsableGames, getCoachGames,
  canManageEventsForGame, canManageTeamsForGame, canManageTodosForGame,
  canDeleteTeam, canDeleteStructure,
  structureContext,
  type StructureRoleData,
} from './structure-permissions';

const FOUNDER_UID = 'u-founder';
const RESPONSABLE_UID = 'u-resp';
const COACH_UID = 'u-coach';
const RANDOM_UID = 'u-random';

function buildStructure(overrides: Partial<StructureRoleData> = {}): StructureRoleData {
  return {
    founderId: FOUNDER_UID,
    managerIds: [RESPONSABLE_UID],
    coachIds: [COACH_UID],
    status: 'active',
    ...overrides,
  };
}

describe('Rôles staff scopés par jeu, sémantique d\'absence (rétrocompat)', () => {
  it('Responsable sans managerGames → all-games (null)', () => {
    const ctx = structureContext(RESPONSABLE_UID, buildStructure());
    expect(getResponsableGames(ctx)).toBeNull();
    expect(isResponsableForGame(ctx, 'rocket_league')).toBe(true);
    expect(isResponsableForGame(ctx, 'trackmania')).toBe(true);
    expect(isResponsableForGame(ctx, 'valorant')).toBe(true);
  });

  it('Coach sans coachGames → all-games (null)', () => {
    const ctx = structureContext(COACH_UID, buildStructure());
    expect(getCoachGames(ctx)).toBeNull();
    expect(isCoachForGame(ctx, 'rocket_league')).toBe(true);
    expect(isCoachForGame(ctx, 'valorant')).toBe(true);
  });

  it('Random user → ni responsable ni coach (pour aucun jeu)', () => {
    const ctx = structureContext(RANDOM_UID, buildStructure());
    expect(getResponsableGames(ctx)).toEqual([]);
    expect(isResponsableForGame(ctx, 'rocket_league')).toBe(false);
    expect(isCoachForGame(ctx, 'rocket_league')).toBe(false);
  });
});

describe('Rôles staff scopés, scope explicite', () => {
  it('Responsable scopé RL uniquement → bloqué sur Val', () => {
    const ctx = structureContext(RESPONSABLE_UID, buildStructure({
      managerGames: { [RESPONSABLE_UID]: ['rocket_league'] },
    }));
    expect(getResponsableGames(ctx)).toEqual(['rocket_league']);
    expect(isResponsableForGame(ctx, 'rocket_league')).toBe(true);
    expect(isResponsableForGame(ctx, 'valorant')).toBe(false);
    expect(isResponsableForGame(ctx, 'trackmania')).toBe(false);
    // Helper non-scopé continue de retourner true (au moins 1 jeu)
    expect(isResponsable(ctx)).toBe(true);
  });

  it('Coach scopé RL+Val → bloqué sur TM', () => {
    const ctx = structureContext(COACH_UID, buildStructure({
      coachGames: { [COACH_UID]: ['rocket_league', 'valorant'] },
    }));
    expect(isCoachForGame(ctx, 'rocket_league')).toBe(true);
    expect(isCoachForGame(ctx, 'valorant')).toBe(true);
    expect(isCoachForGame(ctx, 'trackmania')).toBe(false);
  });

  it('Scope vide [] → équivaut à pas le rôle pour aucun jeu', () => {
    const ctx = structureContext(RESPONSABLE_UID, buildStructure({
      managerGames: { [RESPONSABLE_UID]: [] },
    }));
    expect(isResponsableForGame(ctx, 'rocket_league')).toBe(false);
    expect(isResponsableForGame(ctx, 'valorant')).toBe(false);
  });
});

describe('Dirigeants jamais scopés', () => {
  it('Founder garde tous les droits sur tous les jeux', () => {
    const ctx = structureContext(FOUNDER_UID, buildStructure({
      managerGames: { [FOUNDER_UID]: ['rocket_league'] }, // ignoré pour dirigeants
    }));
    expect(isStructureAdminForGame(ctx, 'rocket_league')).toBe(true);
    expect(isStructureAdminForGame(ctx, 'valorant')).toBe(true);
    expect(isStructureAdminForGame(ctx, 'trackmania')).toBe(true);
  });

  it('CoFondateur (coFounderIds) garde tous les droits cross-jeux', () => {
    const ctx = structureContext('u-cofounder', buildStructure({
      coFounderIds: ['u-cofounder'],
    }));
    expect(isStructureAdminForGame(ctx, 'rocket_league')).toBe(true);
    expect(isStructureAdminForGame(ctx, 'valorant')).toBe(true);
  });
});

describe('canDeleteTeam', () => {
  const CO_FOUNDER_UID = 'u-cofounder';
  const withCoFounder = () => buildStructure({ coFounderIds: [CO_FOUNDER_UID] });

  it('autorise le fondateur', () => {
    expect(canDeleteTeam(structureContext(FOUNDER_UID, withCoFounder()))).toBe(true);
  });

  it('autorise le CO-FONDATEUR', () => {
    // Ouvert le 14/08/2026 : un co-fondateur est un dirigeant, il crée et
    // archive déjà les équipes. Lui refuser la dernière étape n'ajoutait pas de
    // sécurité, seulement une dépendance au fondateur.
    expect(canDeleteTeam(structureContext(CO_FOUNDER_UID, withCoFounder()))).toBe(true);
  });

  it('refuse le responsable — il gère les équipes, il ne les efface pas', () => {
    expect(canDeleteTeam(structureContext(RESPONSABLE_UID, withCoFounder()))).toBe(false);
  });

  it('refuse le coach et un inconnu', () => {
    expect(canDeleteTeam(structureContext(COACH_UID, withCoFounder()))).toBe(false);
    expect(canDeleteTeam(structureContext(RANDOM_UID, withCoFounder()))).toBe(false);
  });

  it('refuse tout le monde sur une structure suspendue', () => {
    const gelee = buildStructure({ coFounderIds: [CO_FOUNDER_UID], status: 'suspended' });
    expect(canDeleteTeam(structureContext(FOUNDER_UID, gelee))).toBe(false);
    expect(canDeleteTeam(structureContext(CO_FOUNDER_UID, gelee))).toBe(false);
  });

  it('la suppression de la STRUCTURE reste au fondateur seul', () => {
    // Ce qui vient d'être ouvert, c'est l'équipe — pas la structure.
    expect(canDeleteStructure(structureContext(CO_FOUNDER_UID, withCoFounder()))).toBe(false);
    expect(canDeleteStructure(structureContext(FOUNDER_UID, withCoFounder()))).toBe(true);
  });
});

describe('Variantes can*ForGame', () => {
  it('canManageTeamsForGame respecte le scope responsable', () => {
    const ctx = structureContext(RESPONSABLE_UID, buildStructure({
      managerGames: { [RESPONSABLE_UID]: ['rocket_league'] },
    }));
    expect(canManageTeamsForGame(ctx, 'rocket_league')).toBe(true);
    expect(canManageTeamsForGame(ctx, 'valorant')).toBe(false);
    // Sans gameId → comportement legacy (true car responsable au moins 1 jeu)
    expect(canManageTeamsForGame(ctx)).toBe(true);
  });

  it('canManageEventsForGame autorise coach scopé sur son jeu', () => {
    const ctx = structureContext(COACH_UID, buildStructure({
      coachGames: { [COACH_UID]: ['valorant'] },
    }));
    expect(canManageEventsForGame(ctx, 'valorant')).toBe(true);
    expect(canManageEventsForGame(ctx, 'rocket_league')).toBe(false);
  });

  it('canManageTodosForGame bloqué sur struct suspended', () => {
    const ctx = structureContext(COACH_UID, buildStructure({
      status: 'suspended',
    }));
    expect(canManageTodosForGame(ctx, 'rocket_league')).toBe(false);
  });
});

describe('Helper global isResponsable/isCoach inchangé (rétrocompat)', () => {
  it('isResponsable retourne true si user dans managerIds, peu importe scope', () => {
    const ctx = structureContext(RESPONSABLE_UID, buildStructure({
      managerGames: { [RESPONSABLE_UID]: ['rocket_league'] },
    }));
    expect(isResponsable(ctx)).toBe(true);
  });

  it('isCoach retourne true si user dans coachIds, peu importe scope', () => {
    const ctx = structureContext(COACH_UID, buildStructure({
      coachGames: { [COACH_UID]: [] }, // dégénéré
    }));
    expect(isCoach(ctx)).toBe(true);
    // Mais les variants ForGame sont à false
    expect(isCoachForGame(ctx, 'rocket_league')).toBe(false);
  });
});
