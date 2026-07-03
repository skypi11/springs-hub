import { describe, it, expect } from 'vitest';
import {
  normalizeTeamName,
  circuitTeamSlug,
  coreThreshold,
  resolveCircuitIdentity,
  type IdentityCandidate,
} from './identity';

const STARTERS = ['u1', 'u2', 'u3'];

function candidate(over: Partial<IdentityCandidate> = {}): IdentityCandidate {
  return {
    circuitTeamId: 'ct1',
    name: 'Les Foudres',
    lastRosterUids: ['u1', 'u2', 'u3', 'u4', 'u5'],
    claimedByOther: false,
    ...over,
  };
}

describe('normalizeTeamName', () => {
  it('ignore casse, accents et espaces multiples', () => {
    expect(normalizeTeamName('  Les   Foudres ')).toBe('les foudres');
    expect(normalizeTeamName('LES FOUDRES')).toBe('les foudres');
    expect(normalizeTeamName('Lés Fôudres')).toBe('les foudres');
  });
});

describe('circuitTeamSlug', () => {
  it('slug déterministe préfixé par le circuit', () => {
    expect(circuitTeamSlug('c1', 'Les Foudres')).toBe('c1__les-foudres');
    expect(circuitTeamSlug('c1', 'LÉS FOUDRES!')).toBe('c1__les-foudres');
  });
  it('nom vide ou tout-symboles → fallback stable', () => {
    expect(circuitTeamSlug('c1', '###')).toBe('c1__equipe');
  });
});

describe('coreThreshold', () => {
  it('2 sur 3 en RL, généralisé ⌈2n/3⌉', () => {
    expect(coreThreshold(3)).toBe(2);
    expect(coreThreshold(5)).toBe(4);
    expect(coreThreshold(1)).toBe(1);
  });
});

describe('resolveCircuitIdentity', () => {
  it('aucun candidat → new automatique (cas Qualif 1)', () => {
    const r = resolveCircuitIdentity({ name: 'Les Foudres', starterUids: STARTERS, candidates: [] });
    expect(r.kind).toBe('new');
    expect(r.flags).toEqual([]);
  });

  it('nom + noyau (2/3 titulaires) → attach automatique', () => {
    const r = resolveCircuitIdentity({
      name: 'les foudres',
      starterUids: ['u1', 'u2', 'u9'],
      candidates: [candidate()],
    });
    expect(r.kind).toBe('attach');
    if (r.kind === 'attach') expect(r.circuitTeamId).toBe('ct1');
  });

  it('noyau 3/3 via des anciens SUBS compte aussi (titulaires OU subs)', () => {
    const r = resolveCircuitIdentity({
      name: 'Les Foudres',
      starterUids: ['u4', 'u5', 'u9'],
      candidates: [candidate()],
    });
    // u4 et u5 étaient subs de la précédente participation → noyau OK
    expect(r.kind).toBe('attach');
  });

  it('noyau insuffisant (1/3) sous le même nom → identity_conflict, choix admin', () => {
    const r = resolveCircuitIdentity({
      name: 'Les Foudres',
      starterUids: ['u1', 'u8', 'u9'],
      candidates: [candidate()],
    });
    expect(r.kind).toBe('choice_required');
    expect(r.flags).toContain('identity_conflict');
  });

  it('noyau OK mais nom différent → name_mismatch, choix admin', () => {
    const r = resolveCircuitIdentity({
      name: 'Nouvelle Ère',
      starterUids: ['u1', 'u2', 'u9'],
      candidates: [candidate()],
    });
    expect(r.kind).toBe('choice_required');
    expect(r.flags).toContain('name_mismatch');
    expect(r.flags).not.toContain('identity_conflict');
  });

  it('candidat déjà réclamé par une autre inscription → identity_conflict', () => {
    const r = resolveCircuitIdentity({
      name: 'Les Foudres',
      starterUids: ['u1', 'u2', 'u3'],
      candidates: [candidate({ claimedByOther: true })],
    });
    expect(r.kind).toBe('choice_required');
    expect(r.flags).toContain('identity_conflict');
  });

  it('deux candidats (split d\'équipe) → identity_conflict', () => {
    const r = resolveCircuitIdentity({
      name: 'Les Foudres',
      starterUids: ['u1', 'u2', 'u6'],
      candidates: [
        candidate(),
        candidate({ circuitTeamId: 'ct2', name: 'Autre Team', lastRosterUids: ['u2', 'u6', 'u7'] }),
      ],
    });
    expect(r.kind).toBe('choice_required');
    expect(r.flags).toContain('identity_conflict');
    expect(r.matches).toHaveLength(2);
  });

  it('candidat sans roster enregistré ne matche jamais par noyau', () => {
    const r = resolveCircuitIdentity({
      name: 'Sans Historique',
      starterUids: STARTERS,
      candidates: [candidate({ name: 'Autre Nom', lastRosterUids: [] })],
    });
    expect(r.kind).toBe('new');
  });

  it('nom identique modulo accents/casse matche', () => {
    const r = resolveCircuitIdentity({
      name: 'LÉS FOUDRES',
      starterUids: ['u1', 'u2', 'u9'],
      candidates: [candidate()],
    });
    expect(r.kind).toBe('attach');
  });
});
