import { describe, it, expect } from 'vitest';
import { tmIoUrlFromAccountId, tmAccountIdOf, extractAccountIdFromUrl } from './trackmania-identity';
import { checkProfileCompletion } from './profile-completion';
import type { SpringsUser } from '@/types';

const ID = '0a2d1bc0-4aaa-4374-b2db-3d561bdab1c9';

describe('identité Trackmania', () => {
  it('déduit l’adresse de la fiche depuis l’identifiant de compte', () => {
    expect(tmIoUrlFromAccountId(ID)).toBe(`https://trackmania.io/#/player/${ID}`);
  });

  it('ne déduit rien sans identifiant', () => {
    expect(tmIoUrlFromAccountId('')).toBeNull();
    expect(tmIoUrlFromAccountId(null)).toBeNull();
  });

  it('fait passer l’identifiant vérifié devant l’adresse saisie', () => {
    const autre = 'ffffffff-4aaa-4374-b2db-3d561bdab1c9';
    expect(
      tmAccountIdOf({ tmAccountId: ID, tmIoUrl: `https://trackmania.io/#/player/${autre}` })
    ).toBe(ID);
  });

  it('retombe sur l’adresse saisie pour les comptes d’avant la liaison', () => {
    expect(tmAccountIdOf({ tmIoUrl: `https://trackmania.io/#/player/${ID}` })).toBe(ID);
    expect(tmAccountIdOf({ tmIoUrl: `https://trackmania.io/player/${ID}` })).toBe(ID);
  });

  it('accepte un identifiant collé tel quel dans le champ adresse', () => {
    expect(extractAccountIdFromUrl(ID)).toBe(ID);
  });

  it('rejette une adresse qui ne porte aucun identifiant', () => {
    expect(extractAccountIdFromUrl('https://trackmania.io/#/leaderboard')).toBeNull();
  });
});

describe('complétion du profil d’un joueur Trackmania', () => {
  const base = {
    displayName: 'Noxx',
    country: 'FR',
    hasDateOfBirth: true,
    games: ['trackmania'],
    pseudoTM: 'Noxx',
  } as unknown as SpringsUser;

  it('laisse passer un joueur ayant lié son compte Ubisoft, sans adresse saisie', () => {
    // LE CAS QUI BLOQUAIT. Un inscrit de la LAN lie son compte pour s'inscrire,
    // puis se fait arrêter sur l'accueil par un formulaire réclamant une adresse
    // que le site sait fabriquer tout seul.
    const u = { ...base, tmAccountId: ID } as SpringsUser;
    expect(checkProfileCompletion(u)).toEqual({ complete: true, missing: [] });
  });

  it('laisse passer un ancien compte n’ayant que l’adresse saisie', () => {
    const u = { ...base, tmIoUrl: `https://trackmania.io/#/player/${ID}` } as SpringsUser;
    expect(checkProfileCompletion(u).complete).toBe(true);
  });

  it('réclame la liaison quand on n’a ni l’un ni l’autre', () => {
    expect(checkProfileCompletion(base).missing).toContain('compte Ubisoft/Nadeo lié');
  });
});
