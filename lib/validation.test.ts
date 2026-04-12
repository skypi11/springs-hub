import { describe, it, expect } from 'vitest';
import { safeUrl, clampString, LIMITS } from './validation';

describe('safeUrl', () => {
  it('accepte une URL https valide', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('accepte une URL http valide', () => {
    expect(safeUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1');
  });

  it('trim les espaces autour', () => {
    expect(safeUrl('  https://example.com  ')).toBe('https://example.com/');
  });

  it('rejette javascript: (XSS)', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
  });

  it('rejette data: URLs', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejette ftp:', () => {
    expect(safeUrl('ftp://example.com')).toBe('');
  });

  it('rejette les chaînes non-URL', () => {
    expect(safeUrl('not a url')).toBe('');
  });

  it('rejette une chaîne vide', () => {
    expect(safeUrl('')).toBe('');
  });

  it('rejette null/undefined/non-string', () => {
    expect(safeUrl(null)).toBe('');
    expect(safeUrl(undefined)).toBe('');
    expect(safeUrl(123)).toBe('');
    expect(safeUrl({})).toBe('');
  });

  it('rejette les URLs de plus de 2048 caractères', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2050);
    expect(safeUrl(longUrl)).toBe('');
  });

  it('accepte une URL juste sous 2048 caractères', () => {
    const url = 'https://example.com/' + 'a'.repeat(2000);
    expect(safeUrl(url)).toBe(url);
  });
});

describe('clampString', () => {
  it('tronque à la limite spécifiée', () => {
    expect(clampString('hello world', 5)).toBe('hello');
  });

  it('trim les espaces avant le clamp', () => {
    expect(clampString('   hello   ', 100)).toBe('hello');
  });

  it('renvoie la chaîne entière si plus courte que max', () => {
    expect(clampString('hi', 100)).toBe('hi');
  });

  it('renvoie une chaîne vide pour non-string', () => {
    expect(clampString(null, 100)).toBe('');
    expect(clampString(undefined, 100)).toBe('');
    expect(clampString(42, 100)).toBe('');
    expect(clampString({}, 100)).toBe('');
  });

  it('gère max=0', () => {
    expect(clampString('hello', 0)).toBe('');
  });
});

describe('LIMITS', () => {
  it('expose toutes les limites attendues', () => {
    expect(LIMITS.bio).toBe(500);
    expect(LIMITS.recruitmentMessage).toBe(500);
    expect(LIMITS.structureDescription).toBe(5000);
    expect(LIMITS.structureName).toBe(50);
    expect(LIMITS.structureTag).toBe(5);
    expect(LIMITS.displayName).toBe(32);
  });
});
