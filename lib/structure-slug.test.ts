import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  MIN_STRUCTURE_SLUG_LENGTH,
  MAX_STRUCTURE_SLUG_LENGTH,
  RESERVED_STRUCTURE_SLUGS,
  generateBaseStructureSlug,
  isValidStructureSlug,
  isLegacyStructureId,
  generateUniqueStructureSlug,
  getStructureHref,
  getStructureHrefFromId,
} from './structure-slug';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Firestore minimal — on n'a besoin que de db.collection().where().limit().get()
// pour les tests d'unicité. On stocke les slugs "déjà pris" dans un Set.
// ─────────────────────────────────────────────────────────────────────────────
function makeMockDb(takenSlugs: Map<string, string /* docId */>): Firestore {
  const collectionFn = (name: string) => {
    if (name !== 'structures') {
      throw new Error(`Mock attend uniquement la collection 'structures', reçu '${name}'`);
    }
    return {
      where: (_field: string, _op: string, value: string) => ({
        limit: (_n: number) => ({
          get: async () => {
            const docId = takenSlugs.get(value);
            if (!docId) return { empty: true, docs: [] as Array<{ id: string }> };
            return { empty: false, docs: [{ id: docId }] };
          },
        }),
      }),
    };
  };
  return { collection: collectionFn } as unknown as Firestore;
}

// ─────────────────────────────────────────────────────────────────────────────
// generateBaseStructureSlug
// ─────────────────────────────────────────────────────────────────────────────
describe('generateBaseStructureSlug', () => {
  it('lowercase un nom simple', () => {
    expect(generateBaseStructureSlug('TimeToShine')).toBe('timetoshine');
  });

  it('remplace les espaces par des tirets', () => {
    expect(generateBaseStructureSlug('Time To Shine')).toBe('time-to-shine');
  });

  it('strip les accents (NFD)', () => {
    expect(generateBaseStructureSlug('Équipe Éléphant')).toBe('equipe-elephant');
    expect(generateBaseStructureSlug('Café')).toBe('cafe');
  });

  it('remplace la ponctuation par des tirets', () => {
    expect(generateBaseStructureSlug("Aedral's Team!")).toBe('aedral-s-team');
  });

  it('collapse les tirets multiples', () => {
    expect(generateBaseStructureSlug('A---B___C   D')).toBe('a-b-c-d');
  });

  it('trim les tirets en début et fin', () => {
    expect(generateBaseStructureSlug('  -Hello-  ')).toBe('hello');
    expect(generateBaseStructureSlug('!!!Hello!!!')).toBe('hello');
  });

  it('tronque proprement à MAX_STRUCTURE_SLUG_LENGTH', () => {
    const longName = 'a'.repeat(50);
    const result = generateBaseStructureSlug(longName);
    expect(result.length).toBe(MAX_STRUCTURE_SLUG_LENGTH);
    expect(result).toBe('a'.repeat(MAX_STRUCTURE_SLUG_LENGTH));
  });

  it('tronque sans laisser un tiret final', () => {
    // Construit un nom qui produirait un tiret pile à l'index MAX
    const longName = 'abc-'.repeat(20); // "abc-abc-abc-..."
    const result = generateBaseStructureSlug(longName);
    expect(result.endsWith('-')).toBe(false);
    expect(result.length).toBeLessThanOrEqual(MAX_STRUCTURE_SLUG_LENGTH);
  });

  it('retourne une chaîne vide pour un input vide', () => {
    expect(generateBaseStructureSlug('')).toBe('');
  });

  it('retourne une chaîne vide pour un input uniquement non-ASCII', () => {
    // Caractères japonais → tout strippé après normalisation
    expect(generateBaseStructureSlug('日本語')).toBe('');
  });

  it('conserve les chiffres', () => {
    expect(generateBaseStructureSlug('Team 2024')).toBe('team-2024');
    expect(generateBaseStructureSlug('G2 Esports')).toBe('g2-esports');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isValidStructureSlug
// ─────────────────────────────────────────────────────────────────────────────
describe('isValidStructureSlug', () => {
  it('accepte un slug simple', () => {
    expect(isValidStructureSlug('timetoshine')).toBe(true);
  });

  it('accepte un slug avec tirets', () => {
    expect(isValidStructureSlug('time-to-shine')).toBe(true);
    expect(isValidStructureSlug('g2-esports')).toBe(true);
  });

  it('accepte un slug avec chiffres', () => {
    expect(isValidStructureSlug('team2024')).toBe(true);
    expect(isValidStructureSlug('ttc-academy-2')).toBe(true);
  });

  it('rejette une string vide', () => {
    expect(isValidStructureSlug('')).toBe(false);
  });

  it('rejette null/undefined/non-string', () => {
    expect(isValidStructureSlug(null as unknown as string)).toBe(false);
    expect(isValidStructureSlug(undefined as unknown as string)).toBe(false);
    expect(isValidStructureSlug(42 as unknown as string)).toBe(false);
  });

  it('rejette un slug trop court', () => {
    expect(isValidStructureSlug('ab')).toBe(false);
    expect(isValidStructureSlug('a')).toBe(false);
  });

  it('rejette un slug trop long', () => {
    expect(isValidStructureSlug('a'.repeat(MAX_STRUCTURE_SLUG_LENGTH + 1))).toBe(false);
  });

  it('accepte un slug pile à la longueur min/max', () => {
    expect(isValidStructureSlug('a'.repeat(MIN_STRUCTURE_SLUG_LENGTH))).toBe(true);
    expect(isValidStructureSlug('a'.repeat(MAX_STRUCTURE_SLUG_LENGTH))).toBe(true);
  });

  it('rejette un slug avec majuscules', () => {
    expect(isValidStructureSlug('TimeToShine')).toBe(false);
    expect(isValidStructureSlug('team-A')).toBe(false);
  });

  it('rejette un slug commençant ou finissant par un tiret', () => {
    expect(isValidStructureSlug('-team')).toBe(false);
    expect(isValidStructureSlug('team-')).toBe(false);
  });

  it('rejette un slug avec caractères spéciaux', () => {
    expect(isValidStructureSlug('team_2024')).toBe(false);
    expect(isValidStructureSlug('team.2024')).toBe(false);
    expect(isValidStructureSlug('team 2024')).toBe(false);
    expect(isValidStructureSlug('équipe')).toBe(false);
  });

  it('rejette un slug réservé générique', () => {
    expect(isValidStructureSlug('admin')).toBe(false);
    expect(isValidStructureSlug('settings')).toBe(false);
    expect(isValidStructureSlug('aedral')).toBe(false);
    expect(isValidStructureSlug('api')).toBe(false);
  });

  it('rejette les nouveaux réservés spécifiques structures', () => {
    expect(isValidStructureSlug('request')).toBe(false);
    expect(isValidStructureSlug('create')).toBe(false);
    expect(isValidStructureSlug('new')).toBe(false);
    expect(isValidStructureSlug('browse')).toBe(false);
    expect(isValidStructureSlug('manage')).toBe(false);
  });

  it('contient bien les slugs réservés attendus dans le set', () => {
    expect(RESERVED_STRUCTURE_SLUGS.has('request')).toBe(true);
    expect(RESERVED_STRUCTURE_SLUGS.has('admin')).toBe(true);
    expect(RESERVED_STRUCTURE_SLUGS.has('aedral')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isLegacyStructureId
// ─────────────────────────────────────────────────────────────────────────────
describe('isLegacyStructureId', () => {
  it('detecte un docId Firestore typique (20 chars + uppercase)', () => {
    expect(isLegacyStructureId('fjUNrMQfPwiEisZcVixX')).toBe(true);
    expect(isLegacyStructureId('AbCdEfGhIjKlMnOpQrSt')).toBe(true);
  });

  it('detecte un docId même sans majuscule (20 chars all-lowercase + digits)', () => {
    // Cas extrêmement rare mais possible (~1/26^20)
    expect(isLegacyStructureId('abcdefghij1234567890')).toBe(true);
  });

  it('rejette un slug typique (lowercase + tirets)', () => {
    expect(isLegacyStructureId('timetoshine')).toBe(false);
    expect(isLegacyStructureId('time-to-shine')).toBe(false);
    expect(isLegacyStructureId('ttc-academy-2')).toBe(false);
    expect(isLegacyStructureId('g2-esports')).toBe(false);
  });

  it('rejette un slug même proche de 20 chars (mais avec tirets)', () => {
    // Tirets disqualifient le check de docId (qui exige [a-z0-9] only)
    expect(isLegacyStructureId('aa-bb-cc-dd-ee-fff-g')).toBe(false); // 20 chars avec tirets
  });

  it('detecte tout input avec au moins une majuscule', () => {
    expect(isLegacyStructureId('Team')).toBe(true);
    expect(isLegacyStructureId('aBc')).toBe(true);
    expect(isLegacyStructureId('teamA')).toBe(true);
  });

  it('rejette les longueurs différentes de 20 sans majuscule', () => {
    expect(isLegacyStructureId('abcdef1234567')).toBe(false); // 13 chars
    expect(isLegacyStructureId('abc')).toBe(false);
    expect(isLegacyStructureId('abcdefghij12345678901')).toBe(false); // 21 chars
    expect(isLegacyStructureId('abcdefghij123456789')).toBe(false); // 19 chars
  });

  it('rejette null/undefined/empty', () => {
    expect(isLegacyStructureId('')).toBe(false);
    expect(isLegacyStructureId(null as unknown as string)).toBe(false);
    expect(isLegacyStructureId(undefined as unknown as string)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateUniqueStructureSlug
// ─────────────────────────────────────────────────────────────────────────────
describe('generateUniqueStructureSlug', () => {
  it('renvoie le baseSlug s\'il est libre', async () => {
    const db = makeMockDb(new Map());
    const result = await generateUniqueStructureSlug('timetoshine', db);
    expect(result).toBe('timetoshine');
  });

  it('suffixe -2 si baseSlug est pris', async () => {
    const db = makeMockDb(new Map([['timetoshine', 'STRUCTURE_ID_1']]));
    const result = await generateUniqueStructureSlug('timetoshine', db);
    expect(result).toBe('timetoshine-2');
  });

  it('suffixe -6 si baseSlug et -2 → -5 sont pris', async () => {
    const taken = new Map([
      ['timetoshine', 'id1'],
      ['timetoshine-2', 'id2'],
      ['timetoshine-3', 'id3'],
      ['timetoshine-4', 'id4'],
      ['timetoshine-5', 'id5'],
    ]);
    const db = makeMockDb(taken);
    const result = await generateUniqueStructureSlug('timetoshine', db);
    expect(result).toBe('timetoshine-6');
  });

  it('renvoie le baseSlug si la collision est sa propre structure (excludeStructureId)', async () => {
    const db = makeMockDb(new Map([['timetoshine', 'MY_STRUCTURE_ID']]));
    const result = await generateUniqueStructureSlug('timetoshine', db, 'MY_STRUCTURE_ID');
    expect(result).toBe('timetoshine');
  });

  it('considère la collision si excludeStructureId ne match pas', async () => {
    const db = makeMockDb(new Map([['timetoshine', 'OTHER_STRUCTURE_ID']]));
    const result = await generateUniqueStructureSlug('timetoshine', db, 'MY_STRUCTURE_ID');
    expect(result).toBe('timetoshine-2');
  });

  it('fallback "structure-XXXX" si baseSlug est trop court', async () => {
    const db = makeMockDb(new Map());
    const result = await generateUniqueStructureSlug('', db);
    expect(result).toMatch(/^structure-\d{4}$/);
  });

  it('fallback "structure-XXXX" si baseSlug a moins de MIN_STRUCTURE_SLUG_LENGTH chars', async () => {
    const db = makeMockDb(new Map());
    const result = await generateUniqueStructureSlug('ab', db);
    expect(result).toMatch(/^structure-\d{4}$/);
  });

  it('ajoute "-team" si le baseSlug est un mot réservé', async () => {
    const db = makeMockDb(new Map());
    const result = await generateUniqueStructureSlug('admin', db);
    expect(result).toBe('admin-team');
  });

  it('tronque la base si baseSlug-N dépasse MAX_STRUCTURE_SLUG_LENGTH', async () => {
    // baseSlug de 32 chars pile, le -2 ferait 34 → doit tronquer
    const longBase = 'a'.repeat(MAX_STRUCTURE_SLUG_LENGTH);
    const taken = new Map([[longBase, 'id1']]);
    const db = makeMockDb(taken);
    const result = await generateUniqueStructureSlug(longBase, db);
    expect(result.length).toBeLessThanOrEqual(MAX_STRUCTURE_SLUG_LENGTH);
    expect(result.endsWith('-2')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStructureHref / getStructureHrefFromId
// ─────────────────────────────────────────────────────────────────────────────
describe('getStructureHref', () => {
  it('utilise le slug si dispo', () => {
    expect(getStructureHref({ slug: 'timetoshine', id: 'abc123' }))
      .toBe('/community/structure/timetoshine');
  });

  it('fallback sur l\'id si slug absent', () => {
    expect(getStructureHref({ id: 'fjUNrMQfPwiEisZcVixX' }))
      .toBe('/community/structure/fjUNrMQfPwiEisZcVixX');
  });

  it('fallback sur l\'id si slug null', () => {
    expect(getStructureHref({ slug: null, id: 'abc123' }))
      .toBe('/community/structure/abc123');
  });

  it('fallback sur l\'id si slug vide ou whitespace', () => {
    expect(getStructureHref({ slug: '', id: 'abc123' }))
      .toBe('/community/structure/abc123');
    expect(getStructureHref({ slug: '   ', id: 'abc123' }))
      .toBe('/community/structure/abc123');
  });

  it('renvoie "#" si structure null/undefined', () => {
    expect(getStructureHref(null)).toBe('#');
    expect(getStructureHref(undefined)).toBe('#');
  });
});

describe('getStructureHrefFromId', () => {
  it('construit le href depuis un id ou slug brut', () => {
    expect(getStructureHrefFromId('timetoshine')).toBe('/community/structure/timetoshine');
    expect(getStructureHrefFromId('fjUNrMQfPwiEisZcVixX'))
      .toBe('/community/structure/fjUNrMQfPwiEisZcVixX');
  });

  it('renvoie "#" si null/undefined/empty', () => {
    expect(getStructureHrefFromId(null)).toBe('#');
    expect(getStructureHrefFromId(undefined)).toBe('#');
    expect(getStructureHrefFromId('')).toBe('#');
  });
});
