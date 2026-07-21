import { describe, it, expect } from 'vitest';
import { mergeThread, threadPostSide, type ThreadMsg } from './match-thread';

const msg = (over: Partial<ThreadMsg>): ThreadMsg => ({
  id: 'x', side: 'a', authorName: 'Noxx', body: 'go', createdAt: null, ...over,
});

describe('mergeThread — fusion optimiste (dédup par nonce)', () => {
  it('affiche l\'optimiste tant que le serveur ne l\'a pas renvoyé', () => {
    const server: ThreadMsg[] = [];
    const pending = [msg({ id: 'opt-1', side: 'a', body: 'on est prêts', clientNonce: 'n1' })];
    const out = mergeThread(server, pending);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('opt-1');
  });

  it('retire l\'optimiste dès que le message serveur portant SON nonce arrive', () => {
    const server = [msg({ id: 'srv-1', side: 'a', body: 'on est prêts', clientNonce: 'n1' })];
    const pending = [msg({ id: 'opt-1', side: 'a', body: 'on est prêts', clientNonce: 'n1' })];
    const out = mergeThread(server, pending);
    expect(out).toHaveLength(1);            // pas de doublon
    expect(out[0].id).toBe('srv-1');        // c'est le vrai qui reste
  });

  it('garde l\'écho instantané d\'un texte DÉJÀ confirmé (nonce différent)', () => {
    // Le bug corrigé : « gg » déjà dans le fil ne doit pas avaler un nouveau « gg ».
    const server = [msg({ id: 'srv-old', side: 'a', body: 'gg', clientNonce: 'n0' })];
    const pending = [msg({ id: 'opt-new', side: 'a', body: 'gg', clientNonce: 'n1' })];
    const out = mergeThread(server, pending);
    expect(out.map(m => m.id)).toEqual(['srv-old', 'opt-new']);
  });

  it('garde l\'optimiste si le message serveur n\'a pas de nonce (déploiement en cours)', () => {
    const server = [msg({ id: 'srv-old', side: 'a', body: 'gg' })]; // pas de clientNonce
    const pending = [msg({ id: 'opt-new', side: 'a', body: 'gg', clientNonce: 'n1' })];
    expect(mergeThread(server, pending).map(m => m.id)).toEqual(['srv-old', 'opt-new']);
  });

  it('préserve l\'ordre serveur puis optimistes', () => {
    const server = [msg({ id: 's1', body: 'un' }), msg({ id: 's2', body: 'deux' })];
    const pending = [msg({ id: 'o1', body: 'trois', clientNonce: 'n1' })];
    expect(mergeThread(server, pending).map(m => m.id)).toEqual(['s1', 's2', 'o1']);
  });

  it('sans optimiste : renvoie le fil serveur tel quel', () => {
    const server = [msg({ id: 's1', body: 'un' })];
    expect(mergeThread(server, [])).toEqual(server);
  });
});

describe('threadPostSide — miroir exact de la route serveur', () => {
  const cases: Array<[string, { side: 'a' | 'b' | null; canSubmitScores: boolean } | null, boolean, 'a' | 'b' | 'admin' | null]> = [
    ['admin sans équipe → admin', { side: null, canSubmitScores: false }, true, 'admin'],
    ['admin capitaine (peut saisir) → son camp', { side: 'a', canSubmitScores: true }, true, 'a'],
    ['admin sur le roster mais sans droit de saisie → admin', { side: 'a', canSubmitScores: false }, true, 'admin'],
    ['capitaine non-admin → son camp', { side: 'b', canSubmitScores: true }, false, 'b'],
    ['joueur du roster non-capitaine → lecture seule', { side: 'a', canSubmitScores: false }, false, null],
    ['aucun accès, pas admin → null', { side: null, canSubmitScores: false }, false, null],
    ['access null, pas admin → null', null, false, null],
    ['access null, admin → admin', null, true, 'admin'],
  ];
  for (const [label, access, isAdmin, expected] of cases) {
    it(label, () => expect(threadPostSide(access, isAdmin)).toBe(expected));
  }
});
