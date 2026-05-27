import { describe, it, expect } from 'vitest';
import {
  parseChangelogSections,
  categoriesInSections,
  dominantCategory,
} from './changelog-auto-tag';

describe('parseChangelogSections', () => {
  it('découpe un patch multi-sections par titre **emoji texte**', () => {
    const md = `**🎯 Nouvelle feature**\nBody 1\n\n**🐛 Bug fix**\n- Item 1\n- Item 2`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].emoji).toBe('🎯');
    expect(sections[0].title).toBe('Nouvelle feature');
    expect(sections[0].body).toBe('Body 1');
    expect(sections[0].category).toBe('feature');
    expect(sections[1].emoji).toBe('🐛');
    expect(sections[1].title).toBe('Bug fix');
    expect(sections[1].body).toBe('- Item 1\n- Item 2');
    expect(sections[1].category).toBe('fix');
  });

  it('mappe les emojis Tech / UX / Security correctement', () => {
    const md = `**⚙️ Refacto interne**\nA\n\n**🎨 Refonte UI**\nB\n\n**🛡️ Privacy fix**\nC`;
    const sections = parseChangelogSections(md);
    expect(sections.map(s => s.category)).toEqual(['tech', 'ux', 'security']);
  });

  it('fallback feature si emoji non mappé', () => {
    const md = `**🔮 Magique**\nBody`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].emoji).toBe('🔮');
    expect(sections[0].category).toBe('feature');
  });

  it('garde le préambule (texte avant la 1re section) comme section sans titre', () => {
    const md = `Intro libre avant les sections.\n\n**🎯 Section 1**\nBody`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('');
    expect(sections[0].body).toBe('Intro libre avant les sections.');
    expect(sections[1].emoji).toBe('🎯');
  });

  it('retourne 1 section unique si aucun titre détecté (fallback)', () => {
    const md = `Texte plat sans structure du tout.`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('');
    expect(sections[0].body).toBe('Texte plat sans structure du tout.');
    expect(sections[0].category).toBe('feature');
  });

  it('description vide → array vide', () => {
    expect(parseChangelogSections('')).toEqual([]);
    expect(parseChangelogSections('   \n\n  ')).toEqual([]);
  });

  it('gère les titres sans emoji (juste **Texte**)', () => {
    const md = `**Pas d'emoji**\nBody`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].emoji).toBe('');
    expect(sections[0].title).toBe("Pas d'emoji");
    expect(sections[0].category).toBe('feature');
  });

  it('extract un patch Valorant complet réel (snapshot)', () => {
    const md = `**🎯 Valorant intégré**\nDescription Val.\n\n**🏆 Sync rang**\nRang auto via HenrikDev.\n\n**⚙️ Game Registry**\nGros refacto.\n\n**🐛 Bug fix**\n- Bug 1\n- Bug 2\n\n**🛡️ Anti-mensonge**\nPUUID stocké.`;
    const sections = parseChangelogSections(md);
    expect(sections).toHaveLength(5);
    expect(sections.map(s => s.category)).toEqual(['feature', 'feature', 'tech', 'fix', 'security']);
  });
});

describe('categoriesInSections', () => {
  it('retourne le set unique de catégories', () => {
    const md = `**🎯 A**\n\n**🐛 B**\n\n**🎯 C**\n\n**🛡️ D**`;
    const sections = parseChangelogSections(md);
    const cats = categoriesInSections(sections);
    expect(cats.sort()).toEqual(['feature', 'fix', 'security'].sort());
  });
});

describe('dominantCategory', () => {
  it('retourne la catégorie la plus fréquente', () => {
    const md = `**🎯 A**\n\n**🎯 B**\n\n**🐛 C**`;
    const sections = parseChangelogSections(md);
    expect(dominantCategory(sections)).toBe('feature');
  });

  it('fallback feature sur array vide', () => {
    expect(dominantCategory([])).toBe('feature');
  });
});
