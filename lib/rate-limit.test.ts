import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { rateLimitKey } from './rate-limit';

// On fabrique un faux NextRequest minimal — seul `headers.get` est utilisé.
function makeReq(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe('rateLimitKey', () => {
  it('préfixe avec u: quand un userId est fourni', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(rateLimitKey(req, 'discord_42')).toBe('u:discord_42');
  });

  it('ignore l\'IP si userId présent (un user authentifié garde son quota)', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '5.6.7.8' });
    expect(rateLimitKey(req, 'abc')).toBe('u:abc');
  });

  it('utilise x-forwarded-for sans userId', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(rateLimitKey(req)).toBe('ip:1.2.3.4');
  });

  it('prend la première IP si x-forwarded-for est une liste', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9, 10.0.0.1' });
    expect(rateLimitKey(req)).toBe('ip:1.2.3.4');
  });

  it('trim les espaces autour de la première IP', () => {
    const req = makeReq({ 'x-forwarded-for': '   1.2.3.4   , 9.9.9.9' });
    expect(rateLimitKey(req)).toBe('ip:1.2.3.4');
  });

  it('fallback sur x-real-ip si pas de x-forwarded-for', () => {
    const req = makeReq({ 'x-real-ip': '5.6.7.8' });
    expect(rateLimitKey(req)).toBe('ip:5.6.7.8');
  });

  it('renvoie ip:unknown si aucun header n\'est présent', () => {
    expect(rateLimitKey(makeReq())).toBe('ip:unknown');
  });

  it('traite userId null comme absent (fallback IP)', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(rateLimitKey(req, null)).toBe('ip:1.2.3.4');
  });

  it('traite userId vide comme absent (fallback IP)', () => {
    const req = makeReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(rateLimitKey(req, '')).toBe('ip:1.2.3.4');
  });
});
