import { describe, it, expect } from 'vitest';
import {
  computeMemberRole,
  groupAffiliations,
  type MemberRoleTeam,
  type TeamAffiliation,
} from './member-role';

const baseTeam = (overrides: Partial<MemberRoleTeam> = {}): MemberRoleTeam => ({
  id: 't1',
  name: 'Team 1',
  playerIds: [],
  subIds: [],
  staffIds: [],
  staffRoles: {},
  captainId: null,
  status: 'active',
  ...overrides,
});

describe('computeMemberRole — primary', () => {
  it('fondateur gagne sur tout le reste', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'u1',
      coFounderIds: ['u1'],
      managerIds: ['u1'],
      teams: [baseTeam({ playerIds: ['u1'] })],
    });
    expect(res.primary).toBe('fondateur');
  });

  it('co-fondateur gagne sur responsable', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      coFounderIds: ['u1'],
      managerIds: ['u1'],
      teams: [],
    });
    expect(res.primary).toBe('co_fondateur');
  });

  it('responsable (managerIds) gagne sur manager d\'équipe', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      managerIds: ['u1'],
      teams: [baseTeam({ staffIds: ['u1'], staffRoles: { u1: 'manager' } })],
    });
    expect(res.primary).toBe('responsable');
  });

  it('coach structure (coachIds) gagne sur manager d\'équipe', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      coachIds: ['u1'],
      teams: [baseTeam({ staffIds: ['u1'], staffRoles: { u1: 'manager' } })],
    });
    expect(res.primary).toBe('coach_structure');
  });

  it('coach structure sans aucune équipe = primary coach_structure', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      coachIds: ['u1'],
      teams: [],
    });
    expect(res.primary).toBe('coach_structure');
    expect(res.affiliations).toHaveLength(0);
  });

  it('responsable gagne sur coach structure', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      managerIds: ['u1'],
      coachIds: ['u1'],
      teams: [],
    });
    expect(res.primary).toBe('responsable');
  });

  it('manager d\'équipe gagne sur coach d\'équipe', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [
        baseTeam({ id: 'a', name: 'A', staffIds: ['u1'], staffRoles: { u1: 'coach' } }),
        baseTeam({ id: 'b', name: 'B', staffIds: ['u1'], staffRoles: { u1: 'manager' } }),
      ],
    });
    expect(res.primary).toBe('manager_equipe');
  });

  it('staff sans staffRoles fallback = coach', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ staffIds: ['u1'] })],
    });
    expect(res.primary).toBe('coach_equipe');
    expect(res.affiliations[0].role).toBe('coach');
  });

  it('coach d\'équipe (staff) ≠ coach structure (coachIds)', () => {
    // Même user, deux voies : coach_equipe via staff vs coach_structure via coachIds
    const teamCoach = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ staffIds: ['u1'], staffRoles: { u1: 'coach' } })],
    });
    expect(teamCoach.primary).toBe('coach_equipe');

    const structCoach = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      coachIds: ['u1'],
      teams: [],
    });
    expect(structCoach.primary).toBe('coach_structure');
  });

  it('capitaine sans être staff = primary capitaine', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ playerIds: ['u1'], captainId: 'u1' })],
    });
    expect(res.primary).toBe('capitaine');
  });

  it('joueur simple = primary joueur', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ playerIds: ['u1'] })],
    });
    expect(res.primary).toBe('joueur');
  });

  it('remplaçant-only = primary joueur (rôle player générique)', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ subIds: ['u1'] })],
    });
    expect(res.primary).toBe('joueur');
  });

  it('aucune affectation = membre', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam()],
    });
    expect(res.primary).toBe('membre');
  });

  it('ignore les équipes archivées par défaut', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ staffIds: ['u1'], staffRoles: { u1: 'manager' }, status: 'archived' })],
    });
    expect(res.primary).toBe('membre');
    expect(res.affiliations).toHaveLength(0);
  });

  it('inclut les équipes archivées si demandé', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      includeArchived: true,
      teams: [baseTeam({ staffIds: ['u1'], staffRoles: { u1: 'manager' }, status: 'archived' })],
    });
    expect(res.primary).toBe('manager_equipe');
  });
});

describe('computeMemberRole — affiliations', () => {
  it('cumule joueur + capitaine sur la même équipe', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [baseTeam({ id: 'a', name: 'Elite 1', playerIds: ['u1'], captainId: 'u1' })],
    });
    expect(res.affiliations).toEqual(
      expect.arrayContaining<TeamAffiliation>([
        { teamId: 'a', teamName: 'Elite 1', role: 'capitaine' },
        { teamId: 'a', teamName: 'Elite 1', role: 'joueur' },
      ]),
    );
    expect(res.primary).toBe('capitaine'); // non-staff → capitaine wins
  });

  it('manager + joueur sur deux équipes différentes', () => {
    const res = computeMemberRole({
      userId: 'u1',
      founderId: 'other',
      teams: [
        baseTeam({ id: 'a', name: 'Elite 1', staffIds: ['u1'], staffRoles: { u1: 'manager' } }),
        baseTeam({ id: 'b', name: 'Academy A', playerIds: ['u1'] }),
      ],
    });
    expect(res.primary).toBe('manager_equipe');
    expect(res.affiliations).toEqual([
      { teamId: 'a', teamName: 'Elite 1', role: 'manager' },
      { teamId: 'b', teamName: 'Academy A', role: 'joueur' },
    ]);
  });
});

describe('groupAffiliations', () => {
  it('regroupe par rôle dans l\'ordre fixé', () => {
    const badges = groupAffiliations([
      { teamId: 'a', teamName: 'Elite 1', role: 'manager' },
      { teamId: 'b', teamName: 'Academy A', role: 'joueur' },
      { teamId: 'c', teamName: 'Academy B', role: 'manager' },
    ]);
    expect(badges).toEqual([
      { key: 'manager', label: 'Manager', teamNames: ['Elite 1', 'Academy B'] },
      { key: 'joueur', label: 'Joueur', teamNames: ['Academy A'] },
    ]);
  });

  it('omet les rôles absents', () => {
    const badges = groupAffiliations([
      { teamId: 'a', teamName: 'Elite 1', role: 'joueur' },
    ]);
    expect(badges).toHaveLength(1);
    expect(badges[0].key).toBe('joueur');
  });
});
