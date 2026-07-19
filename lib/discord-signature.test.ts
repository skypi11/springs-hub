import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyDiscordSignature } from './discord-signature';

// Génère une vraie paire Ed25519 et en extrait la clé publique brute (hex) —
// exactement le format que Discord fournit (32 octets = 64 hex).
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  // SPKI Ed25519 = 12 octets de préfixe + 32 octets de clé brute.
  const publicKeyHex = der.subarray(der.length - 32).toString('hex');
  return { publicKey, privateKey, publicKeyHex };
}

function sign(privateKey: crypto.KeyObject, timestamp: string, body: string): string {
  return crypto.sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');
}

describe('verifyDiscordSignature', () => {
  const { privateKey, publicKeyHex } = keypair();
  const timestamp = '1731000000';
  const body = '{"type":1}';
  const sig = sign(privateKey, timestamp, body);

  it('accepts a valid signature over timestamp + body', () => {
    expect(verifyDiscordSignature(publicKeyHex, sig, timestamp, body)).toBe(true);
  });

  it('rejects a tampered body (byte change breaks the signature)', () => {
    expect(verifyDiscordSignature(publicKeyHex, sig, timestamp, '{"type":2}')).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    expect(verifyDiscordSignature(publicKeyHex, sig, '1731000001', body)).toBe(false);
  });

  it('rejects a signature made with another key', () => {
    const other = keypair();
    const otherSig = sign(other.privateKey, timestamp, body);
    expect(verifyDiscordSignature(publicKeyHex, otherSig, timestamp, body)).toBe(false);
  });

  it('rejects when verified against the wrong public key', () => {
    const other = keypair();
    expect(verifyDiscordSignature(other.publicKeyHex, sig, timestamp, body)).toBe(false);
  });

  it('rejects malformed signature (not 128 hex chars)', () => {
    expect(verifyDiscordSignature(publicKeyHex, 'deadbeef', timestamp, body)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, 'zz'.repeat(64), timestamp, body)).toBe(false);
  });

  it('rejects malformed public key (not 64 hex chars)', () => {
    expect(verifyDiscordSignature('abc', sig, timestamp, body)).toBe(false);
    expect(verifyDiscordSignature('zz'.repeat(32), sig, timestamp, body)).toBe(false);
  });

  it('rejects missing params (empty/undefined) without throwing', () => {
    expect(verifyDiscordSignature(undefined, sig, timestamp, body)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, null, timestamp, body)).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, sig, '', body)).toBe(false);
    expect(verifyDiscordSignature('', '', '', '')).toBe(false);
  });
});
