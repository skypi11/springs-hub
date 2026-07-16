import { describe, it, expect } from 'vitest';
import { isActive, getBlockingSanctions } from './sanctions';

// isActive prend un doc « brut » Firestore (expiresAt/revokedAt = Timestamp-like
// avec .toDate()). On simule ça avec un petit wrapper.
const ts = (d: Date | null) => (d ? { toDate: () => d } : null);
const future = new Date(Date.now() + 86400000);
const past = new Date(Date.now() - 86400000);

describe('isActive', () => {
  it('actif si ni révoqué ni expiré', () => {
    expect(isActive({ revokedAt: null, expiresAt: null }, new Date())).toBe(true);
    expect(isActive({ revokedAt: null, expiresAt: ts(future) }, new Date())).toBe(true);
  });
  it('inactif si révoqué', () => {
    expect(isActive({ revokedAt: ts(past), expiresAt: null }, new Date())).toBe(false);
  });
  it('inactif si expiré', () => {
    expect(isActive({ revokedAt: null, expiresAt: ts(past) }, new Date())).toBe(false);
  });
});

// Mock Firestore minimal : chaque query renvoie TOUS les docs fournis (les where
// sont ignorés — getBlockingSanctions filtre ensuite type/scope/actif ; la
// déduplication par id dans queryByTargets gère les requêtes multiples).
function mockDb(docs: Array<{ id: string } & Record<string, unknown>>) {
  const snap = { docs: docs.map(d => ({ id: d.id, data: () => d })) };
  const chain: Record<string, unknown> = {};
  chain.where = () => chain;
  chain.get = async () => snap;
  return { collection: () => chain } as never;
}

describe('getBlockingSanctions', () => {
  const base = { targetType: 'user', targetId: 'u1', targetLabel: 'U1', reason: 'x', revokedAt: null, expiresAt: null };

  it('un ban actif (global) bloque', async () => {
    const db = mockDb([{ id: 's1', ...base, type: 'ban', scope: { kind: 'global' } }]);
    const r = await getBlockingSanctions(db, { uids: ['u1'], competitionId: 'compA' });
    expect(r).toHaveLength(1);
    expect(r[0].type).toBe('ban');
  });

  it('un warn ne bloque JAMAIS', async () => {
    const db = mockDb([{ id: 's1', ...base, type: 'warn', scope: { kind: 'global' } }]);
    const r = await getBlockingSanctions(db, { uids: ['u1'], competitionId: 'compA' });
    expect(r).toHaveLength(0);
  });

  it('une exclusion bloque UNIQUEMENT sa compétition', async () => {
    const excl = { id: 's1', ...base, type: 'exclusion', scope: { kind: 'competition', competitionId: 'compA' } };
    const dbMatch = mockDb([excl]);
    expect(await getBlockingSanctions(dbMatch, { uids: ['u1'], competitionId: 'compA' })).toHaveLength(1);
    const dbOther = mockDb([excl]);
    expect(await getBlockingSanctions(dbOther, { uids: ['u1'], competitionId: 'compB' })).toHaveLength(0);
  });

  it('une exclusion de circuit bloque toute compétition de CE circuit', async () => {
    const excl = { id: 's1', ...base, type: 'exclusion', scope: { kind: 'circuit', circuitId: 'circ1' } };
    expect(await getBlockingSanctions(mockDb([excl]), { uids: ['u1'], competitionId: 'compA', circuitId: 'circ1' })).toHaveLength(1);
    expect(await getBlockingSanctions(mockDb([excl]), { uids: ['u1'], competitionId: 'compA', circuitId: 'circ2' })).toHaveLength(0);
  });

  it('une sanction révoquée ne bloque plus', async () => {
    const db = mockDb([{ id: 's1', ...base, type: 'ban', scope: { kind: 'global' }, revokedAt: ts(past) }]);
    expect(await getBlockingSanctions(db, { uids: ['u1'], competitionId: 'compA' })).toHaveLength(0);
  });
});
