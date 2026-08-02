import { describe, it, expect } from 'vitest';
import { buildEmbedDescription } from './discord-competition';

// Composition du pied des embeds de compétition. Le reste du module parle à
// Discord et n'est vérifiable que par les e2e ; cette partie-là est du texte
// pur, donc testable — et elle porte une décision produit : le salon des
// résultats ne doit JAMAIS publier deux fois la même affiche, le second format
// passe par un lien.

describe('buildEmbedDescription', () => {
  it('rend le message seul quand il n’y a aucun lien', () => {
    expect(buildEmbedDescription('Résultat du match')).toBe('Résultat du match');
  });

  it('ajoute le lien principal après une ligne vide', () => {
    expect(buildEmbedDescription('Texte', 'https://aedral.com/m/1'))
      .toBe('Texte\n\n[Ouvrir sur Aedral →](https://aedral.com/m/1)');
  });

  it('met les liens secondaires sur la MÊME ligne que le principal', () => {
    const out = buildEmbedDescription('Texte', 'https://aedral.com/m/1', [
      { label: 'Affiche carrée', url: 'https://aedral.com/og?format=square' },
    ]);
    // Une seule ligne de liens : un message de résultat est lu des dizaines de
    // fois par tournoi, chaque ligne en plus se paie.
    expect(out).toBe(
      'Texte\n\n[Ouvrir sur Aedral →](https://aedral.com/m/1) · [Affiche carrée](https://aedral.com/og?format=square)',
    );
    expect(out.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('affiche les liens secondaires même sans lien principal', () => {
    expect(buildEmbedDescription('Texte', null, [{ label: 'Carrée', url: 'https://x/y' }]))
      .toBe('Texte\n\n[Carrée](https://x/y)');
  });

  it('ignore les entrées incomplètes plutôt que de rendre un lien vide', () => {
    const out = buildEmbedDescription('Texte', null, [
      { label: '', url: 'https://x/y' },
      { label: 'Sans url', url: '' },
      { label: 'Bonne', url: 'https://ok' },
    ]);
    expect(out).toBe('Texte\n\n[Bonne](https://ok)');
  });

  it('tronque le corps à 3800 caractères sans amputer les liens', () => {
    const out = buildEmbedDescription('x'.repeat(5000), 'https://aedral.com/m/1');
    expect(out.startsWith('x'.repeat(3800))).toBe(true);
    expect(out).toContain('[Ouvrir sur Aedral →]');
    // La limite Discord est de 4096 : le corps borné + le pied doivent tenir.
    expect(out.length).toBeLessThan(4096);
  });
});
