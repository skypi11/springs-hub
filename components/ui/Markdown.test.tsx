import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

// Le registre RGPD du règlement de la Mania Cup est un tableau. Sans remark-gfm,
// react-markdown le rendait comme une seule ligne de barres verticales — dans la
// section la plus juridique du document, publiée en production. Ces tests
// existent pour que ça ne puisse plus repasser.

const RGPD = `
| Donnée | À quoi elle sert | Combien de temps |
|---|---|---|
| Identité, e-mail | vous accueillir | 1 an après l'événement |
| Contact d'urgence | joindre quelqu'un | 30 jours après l'événement |
`;

describe('Markdown', () => {
  it('rend un tableau markdown comme un vrai tableau', () => {
    render(<Markdown>{RGPD}</Markdown>);
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Donnée' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: "Contact d'urgence" })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // en-tête + 2 lignes
  });

  it('enferme le tableau dans un cadre qui défile', () => {
    // Un tableau est le seul contenu qui peut dépasser la colonne de texte. S'il
    // n'a pas son propre cadre, c'est la page qui part en travers sur mobile.
    const { container } = render(<Markdown>{RGPD}</Markdown>);
    const wrapper = container.querySelector('.md-table');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector('table')).not.toBeNull();
  });

  it('rend toujours le markdown ordinaire', () => {
    render(<Markdown>{'## Titre\n\nUn **mot** important et un [lien](https://aedral.com).'}</Markdown>);
    expect(screen.getByRole('heading', { level: 2, name: 'Titre' })).toBeInTheDocument();
    expect(screen.getByText('mot')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'lien' })).toHaveAttribute('href', 'https://aedral.com');
  });
});
