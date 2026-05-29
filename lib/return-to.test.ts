import { describe, it, expect } from 'vitest';
import { isValidNext, sanitizeNext } from './return-to';

describe('isValidNext - cas légitimes', () => {
  it('accepte un chemin racine', () => {
    expect(isValidNext('/')).toBe(true);
  });

  it('accepte un chemin simple', () => {
    expect(isValidNext('/community')).toBe(true);
  });

  it('accepte un chemin avec sous-segments', () => {
    expect(isValidNext('/community/structure/abc123')).toBe(true);
  });

  it('accepte un chemin avec query string', () => {
    expect(isValidNext('/profile/noxx?tab=stats')).toBe(true);
  });

  it('accepte un chemin avec plusieurs params', () => {
    expect(isValidNext('/community?game=rl&recruiting=1')).toBe(true);
  });

  it('accepte un chemin avec fragment', () => {
    expect(isValidNext('/guide#features')).toBe(true);
  });

  it('accepte un chemin avec query + fragment', () => {
    expect(isValidNext('/calendar?view=week#today')).toBe(true);
  });

  it('accepte un slug profil', () => {
    expect(isValidNext('/profile/noxx')).toBe(true);
  });

  it('accepte un token de join (cas critique)', () => {
    expect(isValidNext('/community/join/abc-def-123')).toBe(true);
  });

  it('accepte des caractères encodés légitimes (espace dans nom)', () => {
    expect(isValidNext('/search?q=foo%20bar')).toBe(true);
  });

  it('accepte les underscores et tirets', () => {
    expect(isValidNext('/community/my-structure')).toBe(true);
    expect(isValidNext('/profile/some_user_name')).toBe(true);
  });

  it('trim les espaces autour avant validation', () => {
    expect(isValidNext('  /community  ')).toBe(true);
  });
});

describe('isValidNext - open redirect attacks', () => {
  it('rejette protocol-relative URL //evil.com', () => {
    expect(isValidNext('//evil.com')).toBe(false);
  });

  it('rejette protocol-relative URL //evil.com/path', () => {
    expect(isValidNext('//evil.com/path')).toBe(false);
  });

  it('rejette http:// absolu', () => {
    expect(isValidNext('http://evil.com')).toBe(false);
  });

  it('rejette https:// absolu', () => {
    expect(isValidNext('https://evil.com')).toBe(false);
  });

  it('rejette https://aedral.com (même domaine absolu refusé)', () => {
    expect(isValidNext('https://aedral.com/community')).toBe(false);
  });

  it('rejette javascript: XSS', () => {
    expect(isValidNext('javascript:alert(1)')).toBe(false);
  });

  it('rejette data: URLs', () => {
    expect(isValidNext('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejette vbscript:', () => {
    expect(isValidNext('vbscript:msgbox(1)')).toBe(false);
  });

  it('rejette mailto:', () => {
    expect(isValidNext('mailto:foo@bar.com')).toBe(false);
  });

  it('rejette file://', () => {
    expect(isValidNext('file:///etc/passwd')).toBe(false);
  });

  it('rejette /\\evil.com (backslash trick)', () => {
    expect(isValidNext('/\\evil.com')).toBe(false);
  });

  it('rejette \\\\evil.com (double backslash)', () => {
    expect(isValidNext('\\\\evil.com')).toBe(false);
  });

  it('rejette /\\\\evil.com', () => {
    expect(isValidNext('/\\\\evil.com')).toBe(false);
  });
});

describe('isValidNext - encodage caché', () => {
  it('rejette %2F%2Fevil.com (// encodé)', () => {
    expect(isValidNext('%2F%2Fevil.com')).toBe(false);
  });

  it('rejette /%2F%2Fevil.com', () => {
    expect(isValidNext('/%2F%2Fevil.com')).toBe(false);
  });

  it('rejette /%2Fevil.com (// résolu après décode + leading /)', () => {
    // "/" + "%2F" décodé = "/" + "/" = "//"
    expect(isValidNext('/%2Fevil.com')).toBe(false);
  });

  it('rejette %5C%5Cevil.com (\\\\ encodé)', () => {
    expect(isValidNext('%5C%5Cevil.com')).toBe(false);
  });

  it('rejette javascript%3Aalert(1) (: encodé)', () => {
    expect(isValidNext('javascript%3Aalert(1)')).toBe(false);
  });

  it('rejette double-encodage %252F%252Fevil.com', () => {
    expect(isValidNext('%252F%252Fevil.com')).toBe(false);
  });

  it('rejette triple-encodage %25252F%25252Fevil.com', () => {
    expect(isValidNext('%25252F%25252Fevil.com')).toBe(false);
  });

  it('rejette séquence URL malformée %ZZ', () => {
    expect(isValidNext('/foo%ZZ')).toBe(false);
  });
});

describe('isValidNext - header injection', () => {
  it('rejette CR injection', () => {
    expect(isValidNext('/foo\rLocation: evil.com')).toBe(false);
  });

  it('rejette LF injection', () => {
    expect(isValidNext('/foo\nLocation: evil.com')).toBe(false);
  });

  it('rejette CRLF injection', () => {
    expect(isValidNext('/foo\r\nLocation: evil.com')).toBe(false);
  });

  it('rejette CR encodé %0d', () => {
    expect(isValidNext('/foo%0dLocation: evil.com')).toBe(false);
  });

  it('rejette LF encodé %0a', () => {
    expect(isValidNext('/foo%0aLocation: evil.com')).toBe(false);
  });

  it('rejette tab \\t', () => {
    expect(isValidNext('/foo\tbar')).toBe(false);
  });

  it('rejette null byte', () => {
    expect(isValidNext('/foo\x00bar')).toBe(false);
  });
});

describe('isValidNext - cas dégénérés', () => {
  it('rejette string vide', () => {
    expect(isValidNext('')).toBe(false);
  });

  it('rejette string blanche', () => {
    expect(isValidNext('   ')).toBe(false);
  });

  it('rejette null', () => {
    expect(isValidNext(null)).toBe(false);
  });

  it('rejette undefined', () => {
    expect(isValidNext(undefined)).toBe(false);
  });

  it('rejette nombre', () => {
    expect(isValidNext(42)).toBe(false);
  });

  it('rejette objet', () => {
    expect(isValidNext({ path: '/foo' })).toBe(false);
  });

  it('rejette array', () => {
    expect(isValidNext(['/foo'])).toBe(false);
  });

  it('rejette path qui ne commence pas par /', () => {
    expect(isValidNext('community')).toBe(false);
  });

  it('rejette path relatif ./foo', () => {
    expect(isValidNext('./foo')).toBe(false);
  });

  it('rejette path relatif ../foo', () => {
    expect(isValidNext('../foo')).toBe(false);
  });

  it('rejette path trop long (> 512 chars)', () => {
    const long = '/' + 'a'.repeat(520);
    expect(isValidNext(long)).toBe(false);
  });

  it('accepte path à la limite (512 chars exactement)', () => {
    const max = '/' + 'a'.repeat(511); // 512 total
    expect(isValidNext(max)).toBe(true);
  });

  it('rejette si encodage gonfle au-delà de la limite après décodage', () => {
    // Si la version encodée est sous la limite mais que le décodage dépasse,
    // on rejette (sécurité du cookie).
    const longEncoded = '/' + '%41'.repeat(200); // 601 chars encodés
    expect(isValidNext(longEncoded)).toBe(false);
  });
});

describe('isValidNext - cas trompeurs valides', () => {
  it('accepte un path avec : dans la query string (timestamp ISO par exemple)', () => {
    expect(isValidNext('/calendar?from=2026-05-29T14:30:00')).toBe(true);
  });

  it('accepte un path avec : dans le fragment', () => {
    expect(isValidNext('/foo#section:bar')).toBe(true);
  });

  it('rejette un path avec : dans le pathname (ressemble à un schéma)', () => {
    expect(isValidNext('/foo:bar')).toBe(false);
  });
});

describe('sanitizeNext', () => {
  it('renvoie le path quand valide', () => {
    expect(sanitizeNext('/community')).toBe('/community');
  });

  it('renvoie le fallback / quand invalide', () => {
    expect(sanitizeNext('//evil.com')).toBe('/');
  });

  it('renvoie un fallback custom', () => {
    expect(sanitizeNext('//evil.com', '/home')).toBe('/home');
  });

  it('renvoie / pour null', () => {
    expect(sanitizeNext(null)).toBe('/');
  });

  it('renvoie / pour javascript:', () => {
    expect(sanitizeNext('javascript:alert(1)')).toBe('/');
  });

  it('trim avant de renvoyer', () => {
    expect(sanitizeNext('  /foo  ')).toBe('/foo');
  });
});
