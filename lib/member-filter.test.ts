import { describe, it, expect } from 'vitest';
import { filterSortMembers, memberGroupOf, isPlaceableMember, type FilterableMember } from '@/lib/member-filter';

function m(overrides: Partial<FilterableMember> = {}): FilterableMember {
  return {
    displayName: 'Nom',
    discordUsername: 'discord',
    joinedAt: 0,
    primary: 'joueur',
    roleOrder: 7,
    teamNames: [],
    ...overrides,
  };
}

describe('memberGroupOf', () => {
  it('mappe les 9 rôles vers 3 familles', () => {
    expect(memberGroupOf('fondateur')).toBe('direction');
    expect(memberGroupOf('co_fondateur')).toBe('direction');
    expect(memberGroupOf('responsable')).toBe('direction');
    expect(memberGroupOf('coach_structure')).toBe('staff');
    expect(memberGroupOf('manager_equipe')).toBe('staff');
    expect(memberGroupOf('coach_equipe')).toBe('staff');
    expect(memberGroupOf('capitaine')).toBe('staff');
    expect(memberGroupOf('joueur')).toBe('joueurs');
    expect(memberGroupOf('membre')).toBe('joueurs');
  });
});

describe('filterSortMembers', () => {
  const noxx = m({ displayName: 'Noxx', discordUsername: 'noxx#1', primary: 'fondateur', roleOrder: 0, joinedAt: 100 });
  const aran = m({ displayName: 'Aran', discordUsername: 'aran_', primary: 'joueur', roleOrder: 7, joinedAt: 300, teamNames: ['Nova'] });
  const zed = m({ displayName: 'Zed', discordUsername: 'zed', primary: 'coach_structure', roleOrder: 3, joinedAt: 200 });

  it('recherche sur le pseudo (insensible à la casse)', () => {
    const r = filterSortMembers([noxx, aran, zed], { q: 'NOX', group: 'all', sort: 'role' });
    expect(r.map(x => x.displayName)).toEqual(['Noxx']);
  });

  it('recherche sur le pseudo Discord', () => {
    const r = filterSortMembers([noxx, aran, zed], { q: 'aran_', group: 'all', sort: 'role' });
    expect(r.map(x => x.displayName)).toEqual(['Aran']);
  });

  it('recherche sur le nom d’équipe', () => {
    const r = filterSortMembers([noxx, aran, zed], { q: 'nova', group: 'all', sort: 'role' });
    expect(r.map(x => x.displayName)).toEqual(['Aran']);
  });

  it('filtre par groupe de rôle', () => {
    expect(filterSortMembers([noxx, aran, zed], { q: '', group: 'direction', sort: 'role' }).map(x => x.displayName)).toEqual(['Noxx']);
    expect(filterSortMembers([noxx, aran, zed], { q: '', group: 'staff', sort: 'role' }).map(x => x.displayName)).toEqual(['Zed']);
    expect(filterSortMembers([noxx, aran, zed], { q: '', group: 'joueurs', sort: 'role' }).map(x => x.displayName)).toEqual(['Aran']);
  });

  it('tri par rôle (défaut) = ordre hiérarchique', () => {
    const r = filterSortMembers([aran, zed, noxx], { q: '', group: 'all', sort: 'role' });
    expect(r.map(x => x.displayName)).toEqual(['Noxx', 'Zed', 'Aran']);
  });

  it('tri par nom (A→Z, insensible aux accents)', () => {
    const r = filterSortMembers([noxx, aran, zed], { q: '', group: 'all', sort: 'name' });
    expect(r.map(x => x.displayName)).toEqual(['Aran', 'Noxx', 'Zed']);
  });

  it('tri par arrivée récente (joinedAt desc, null en dernier)', () => {
    const late = m({ displayName: 'Sans date', joinedAt: null });
    const r = filterSortMembers([noxx, aran, zed, late], { q: '', group: 'all', sort: 'recent' });
    expect(r.map(x => x.displayName)).toEqual(['Aran', 'Zed', 'Noxx', 'Sans date']);
  });

  it('combine groupe + recherche', () => {
    const r = filterSortMembers([noxx, aran, zed], { q: 'z', group: 'staff', sort: 'role' });
    expect(r.map(x => x.displayName)).toEqual(['Zed']);
  });

  it('ne mute pas l’entrée', () => {
    const input = [aran, noxx];
    const snapshot = [...input];
    filterSortMembers(input, { q: '', group: 'all', sort: 'name' });
    expect(input).toEqual(snapshot);
  });
});

describe('isPlaceableMember (bannière « sans équipe »)', () => {
  const staff = new Set(['founder', 'cofo', 'resp', 'coachStruct']);
  const assigned = new Set(['joueurEnEquipe']);

  it('exclut le staff structurel (fondateur/co-fondateur/responsable/coach structure)', () => {
    expect(isPlaceableMember('founder', staff, assigned)).toBe(false);
    expect(isPlaceableMember('cofo', staff, assigned)).toBe(false);
    expect(isPlaceableMember('resp', staff, assigned)).toBe(false); // le bug remonté
    expect(isPlaceableMember('coachStruct', staff, assigned)).toBe(false);
  });

  it('exclut un joueur déjà en équipe', () => {
    expect(isPlaceableMember('joueurEnEquipe', staff, assigned)).toBe(false);
  });

  it('inclut une recrue sans équipe et sans rôle structurel', () => {
    expect(isPlaceableMember('recrue', staff, assigned)).toBe(true);
  });
});
