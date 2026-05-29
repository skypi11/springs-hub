import { describe, it, expect } from 'vitest';
import {
  websiteSchema,
  organizationSchema,
  sportsOrganizationSchema,
  personSchema,
  breadcrumbSchema,
  articleSchema,
} from './jsonld';

describe('websiteSchema', () => {
  it('génère un schéma WebSite minimal valide', () => {
    const out = websiteSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
    });
    expect(out['@context']).toBe('https://schema.org');
    expect(out['@type']).toBe('WebSite');
    expect(out.url).toBe('https://aedral.com');
    expect(out.name).toBe('Aedral');
    // Pas de description ni searchUrl → pas de potentialAction
    expect(out.potentialAction).toBeUndefined();
    expect(out.description).toBeUndefined();
  });

  it('inclut description et SearchAction quand fournis', () => {
    const out = websiteSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      description: 'Plateforme esport amateur',
      searchUrl: 'https://aedral.com/search?q={search_term_string}',
    });
    expect(out.description).toBe('Plateforme esport amateur');
    expect(out.potentialAction).toEqual({
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://aedral.com/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    });
  });
});

describe('organizationSchema', () => {
  it('génère un schéma Organization minimal', () => {
    const out = organizationSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      logo: 'https://aedral.com/aedral/mark.svg',
    });
    expect(out['@type']).toBe('Organization');
    expect(out.logo).toBe('https://aedral.com/aedral/mark.svg');
    expect(out.sameAs).toBeUndefined();
  });

  it('inclut sameAs quand fourni avec au moins un profil', () => {
    const out = organizationSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      logo: 'https://aedral.com/logo.png',
      sameAs: ['https://discord.gg/aedral', 'https://x.com/aedral'],
    });
    expect(out.sameAs).toEqual(['https://discord.gg/aedral', 'https://x.com/aedral']);
  });

  it('omet sameAs si tableau vide', () => {
    const out = organizationSchema({
      url: 'https://aedral.com',
      name: 'Aedral',
      logo: 'https://aedral.com/logo.png',
      sameAs: [],
    });
    expect(out.sameAs).toBeUndefined();
  });
});

describe('sportsOrganizationSchema', () => {
  it('génère un schéma SportsOrganization avec sport par défaut "Esport"', () => {
    const out = sportsOrganizationSchema({
      url: 'https://aedral.com/community/structure/abc123',
      name: 'TimeToShine',
    });
    expect(out['@type']).toBe('SportsOrganization');
    expect(out.sport).toBe('Esport');
    expect(out.logo).toBeUndefined();
    expect(out.description).toBeUndefined();
    expect(out.foundingDate).toBeUndefined();
  });

  it('inclut tous les champs optionnels quand fournis', () => {
    const out = sportsOrganizationSchema({
      url: 'https://aedral.com/community/structure/abc123',
      name: 'TimeToShine',
      logo: 'https://aedral.com/logos/tts.png',
      description: 'Structure esport française',
      sport: 'Rocket League',
      foundingDate: '2024-09-01',
    });
    expect(out.logo).toBe('https://aedral.com/logos/tts.png');
    expect(out.description).toBe('Structure esport française');
    expect(out.sport).toBe('Rocket League');
    expect(out.foundingDate).toBe('2024-09-01');
  });
});

describe('personSchema', () => {
  it('génère un schéma Person minimal sans image', () => {
    const out = personSchema({
      url: 'https://aedral.com/profile/noxx',
      name: 'Noxx',
    });
    expect(out['@type']).toBe('Person');
    expect(out.name).toBe('Noxx');
    // image absente → pas de champ image dans la sortie
    expect(out.image).toBeUndefined();
    expect(out.nationality).toBeUndefined();
    expect(out.knowsAbout).toBeUndefined();
  });

  it('inclut image, nationalité, knowsAbout quand fournis', () => {
    const out = personSchema({
      url: 'https://aedral.com/profile/noxx',
      name: 'Noxx',
      image: 'https://cdn.discordapp.com/avatars/123/abc.png',
      nationality: 'FR',
      knowsAbout: ['Rocket League', 'Trackmania'],
    });
    expect(out.image).toBe('https://cdn.discordapp.com/avatars/123/abc.png');
    expect(out.nationality).toBe('FR');
    expect(out.knowsAbout).toEqual(['Rocket League', 'Trackmania']);
  });

  it('omet knowsAbout si tableau vide', () => {
    const out = personSchema({
      url: 'https://aedral.com/profile/noxx',
      name: 'Noxx',
      knowsAbout: [],
    });
    expect(out.knowsAbout).toBeUndefined();
  });
});

describe('breadcrumbSchema', () => {
  it('génère un BreadcrumbList avec positions auto-incrémentées', () => {
    const out = breadcrumbSchema([
      { name: 'Accueil', url: 'https://aedral.com/' },
      { name: 'Structures', url: 'https://aedral.com/community/structures' },
      { name: 'TimeToShine', url: 'https://aedral.com/community/structure/abc123' },
    ]);
    expect(out['@type']).toBe('BreadcrumbList');
    const items = out.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Accueil',
      item: 'https://aedral.com/',
    });
    expect(items[1].position).toBe(2);
    expect(items[2].position).toBe(3);
  });

  it('gère un breadcrumb vide', () => {
    const out = breadcrumbSchema([]);
    expect(out.itemListElement).toEqual([]);
  });

  it('gère un breadcrumb à 1 seul item (position 1)', () => {
    const out = breadcrumbSchema([{ name: 'Accueil', url: 'https://aedral.com/' }]);
    const items = out.itemListElement as Array<Record<string, unknown>>;
    expect(items[0].position).toBe(1);
  });
});

describe('articleSchema', () => {
  it('génère un Article minimal valide', () => {
    const out = articleSchema({
      url: 'https://aedral.com/changelog/2026-05-29',
      headline: 'Patch notes 29 mai 2026',
      description: 'Events visibles et dispos',
    });
    expect(out['@type']).toBe('Article');
    expect(out.headline).toBe('Patch notes 29 mai 2026');
    expect(out.description).toBe('Events visibles et dispos');
    expect(out.datePublished).toBeUndefined();
    expect(out.dateModified).toBeUndefined();
    expect(out.author).toBeUndefined();
  });

  it('inclut les dates et auteur quand fournis', () => {
    const out = articleSchema({
      url: 'https://aedral.com/changelog/2026-05-29',
      headline: 'Patch notes',
      description: 'desc',
      datePublished: '2026-05-29',
      dateModified: '2026-05-30',
      author: 'Matt Molines',
    });
    expect(out.datePublished).toBe('2026-05-29');
    expect(out.dateModified).toBe('2026-05-30');
    expect(out.author).toEqual({ '@type': 'Person', name: 'Matt Molines' });
  });
});

describe('JSON serialization', () => {
  it('chaque builder produit un objet sérialisable sans cycle', () => {
    expect(() => JSON.stringify(websiteSchema({ url: 'x', name: 'y' }))).not.toThrow();
    expect(() => JSON.stringify(organizationSchema({ url: 'x', name: 'y', logo: 'z' }))).not.toThrow();
    expect(() => JSON.stringify(sportsOrganizationSchema({ url: 'x', name: 'y' }))).not.toThrow();
    expect(() => JSON.stringify(personSchema({ url: 'x', name: 'y' }))).not.toThrow();
    expect(() => JSON.stringify(breadcrumbSchema([{ name: 'a', url: 'b' }]))).not.toThrow();
    expect(() => JSON.stringify(articleSchema({ url: 'x', headline: 'y', description: 'z' }))).not.toThrow();
  });

  it('aucun champ undefined ne fuit dans la sortie JSON', () => {
    // Si on omet les optionnels, la sérialisation ne doit pas contenir "undefined"
    const json = JSON.stringify(personSchema({ url: 'https://x', name: 'Y' }));
    expect(json).not.toContain('undefined');
    expect(json).not.toContain('null');
  });
});
