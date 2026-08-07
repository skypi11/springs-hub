import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CountrySelect from './CountrySelect';

// Le 7 août 2026, un joueur suisse s'est retrouvé avec le drapeau français sur
// la liste publique de la Mania Cup. La chaîne complète : le champ retombait
// sur le premier pays de la liste quand rien n'était choisi, il affichait donc
// « France » ; le joueur a validé sans y toucher ; et comme l'inscription
// recopie le pays sur un profil qui n'en a pas, le défaut du formulaire a écrit
// « France » sur son profil.
//
// Un champ ne doit jamais afficher une valeur que personne n'a choisie.

describe('CountrySelect', () => {
  it('n’affiche aucun pays tant que rien n’est choisi', () => {
    render(<CountrySelect value="" onChange={vi.fn()} />);
    expect(screen.getByText('Choisis ton pays')).toBeInTheDocument();
    expect(screen.queryByText('France')).not.toBeInTheDocument();
  });

  it('affiche le pays choisi', () => {
    render(<CountrySelect value="CH" onChange={vi.fn()} />);
    expect(screen.getByText('Suisse')).toBeInTheDocument();
    expect(screen.queryByText('Choisis ton pays')).not.toBeInTheDocument();
  });

  it('ne retombe pas sur France quand le code est inconnu', () => {
    render(<CountrySelect value="ZZ" onChange={vi.fn()} />);
    expect(screen.getByText('Choisis ton pays')).toBeInTheDocument();
    expect(screen.queryByText('France')).not.toBeInTheDocument();
  });

  it('propose les pays de la scène européenne', () => {
    // La liste comptait 19 entrées taillées pour la francophonie : un Polonais
    // devait se déclarer « Autre », et le serveur validait contre cette même
    // liste.
    render(<CountrySelect value="FR" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button'));
    for (const pays of ['Pologne', 'Suède', 'Finlande', 'Tchéquie', 'Danemark']) {
      expect(screen.getByText(pays)).toBeInTheDocument();
    }
  });
});
