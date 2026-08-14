import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RegistrationRow, { matchesSearch, type Row } from './RegistrationRow';
import { baseRow } from './RegistrationRow.fixture';

// Un joueur s'inscrit sous son pseudo Trackmania, et on lui parle sous son
// pseudo Discord. Les deux n'ont souvent aucun rapport : « YannexTM » d'un
// côté, un tout autre nom de l'autre. La console ne montrait que le snowflake,
// replié dans le dossier — identifier un nouvel inscrit demandait de le
// recopier dans la recherche de Discord, et son profil Aedral n'était
// accessible de nulle part.
//
// Ces tests verrouillent les trois chemins : la colonne, la recherche, le lien.

function poser(row: Partial<Row> = {}) {
  const onAct = vi.fn();
  render(
    <table>
      <tbody>
        <RegistrationRow
          row={{ ...baseRow, ...row }}
          rank={1}
          onAct={onAct}
          onOpenDocument={vi.fn()}
          pending={false}
        />
      </tbody>
    </table>
  );
  return { onAct };
}

/** Le dossier déplié se reconnaît à ses en-têtes de colonnes. */
function dossierOuvert() {
  return screen.queryByText('Le jour J') !== null;
}

describe('RegistrationRow — identité', () => {
  it('montre le pseudo Discord sans qu’il faille déplier quoi que ce soit', () => {
    poser();
    expect(dossierOuvert()).toBe(false);
    expect(screen.getByText('@romainpjt')).toBeInTheDocument();
  });

  it('dit « inconnu » plutôt que de laisser une case vide', () => {
    // Un compte qui ne s'est pas reconnecté depuis longtemps peut n'avoir aucun
    // pseudo enregistré. Une case blanche se lit comme un bug ; le mot dit que
    // c'est la donnée qui manque, pas l'affichage.
    poser({ discordUsername: null });
    expect(screen.getByText('inconnu')).toBeInTheDocument();
  });

  it('mène au profil Aedral par son slug', () => {
    poser();
    expect(screen.getByRole('link', { name: 'Fan2SkandeaR' })).toHaveAttribute(
      'href',
      '/profile/fan2skandear'
    );
  });

  it('retombe sur l’uid quand le compte est antérieur aux slugs', () => {
    poser({ profileSlug: null });
    expect(screen.getByRole('link', { name: 'Fan2SkandeaR' })).toHaveAttribute(
      'href',
      '/profile/discord_1'
    );
  });

  it('n’ouvre pas le dossier quand on clique le lien du profil', () => {
    // La ligne entière est cliquable : sans arrêt de la propagation, aller voir
    // un profil déplierait le dossier au passage, et le referme au retour.
    poser();
    fireEvent.click(screen.getByRole('link', { name: 'Fan2SkandeaR' }));
    expect(dossierOuvert()).toBe(false);
  });

  it('ouvre le dossier quand on clique ailleurs sur la ligne', () => {
    poser();
    fireEvent.click(screen.getByText('Romain Pajot'));
    expect(dossierOuvert()).toBe(true);
    // Le snowflake reste lisible dans le dossier : c'est lui qui sert à citer
    // quelqu'un sur Discord.
    expect(screen.getByText('179161896883060736')).toBeInTheDocument();
  });

  it('copie le pseudo Discord sans déplier le dossier', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    poser();
    fireEvent.click(screen.getByTitle('Copier le pseudo Discord'));
    expect(writeText).toHaveBeenCalledWith('@romainpjt');
    expect(dossierOuvert()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('garde la structure lisible à côté du joueur', () => {
    // Régression : la colonne Discord s'insère entre le joueur et la structure.
    poser({ appartenance: { structure: 'Nyxar Esport', tag: 'NYX', team: null, logoUrl: null } });
    const ligne = screen.getByText('Nyxar Esport').closest('tr');
    expect(ligne).not.toBeNull();
    expect(within(ligne as HTMLElement).getByText('NYX')).toBeInTheDocument();
  });
});

describe('matchesSearch', () => {
  const row = baseRow;

  it('trouve par pseudo Discord — le motif de tout ce chantier', () => {
    expect(matchesSearch(row, 'romainpjt')).toBe(true);
    expect(matchesSearch(row, 'pjt')).toBe(true);
  });

  it('trouve toujours par pseudo Trackmania, nom, e-mail et code', () => {
    expect(matchesSearch(row, 'skandear')).toBe(true);
    expect(matchesSearch(row, 'pajot')).toBe(true);
    expect(matchesSearch(row, 'romain@example.org')).toBe(true);
    expect(matchesSearch(row, 'lan-rjdc')).toBe(true);
  });

  it('trouve par structure — la colonne existe, on tape forcément dedans', () => {
    const avecClub = {
      ...row,
      appartenance: { structure: 'Nyxar Esport', tag: 'NYX', team: 'Alpha', logoUrl: null },
    };
    expect(matchesSearch(avecClub, 'nyxar')).toBe(true);
    expect(matchesSearch(avecClub, 'nyx')).toBe(true);
  });

  it('ne trouve rien qui ne corresponde', () => {
    expect(matchesSearch(row, 'inconnu')).toBe(false);
  });

  it('laisse tout passer quand la recherche est vide', () => {
    expect(matchesSearch(row, '')).toBe(true);
    expect(matchesSearch({ ...row, discordUsername: null }, '')).toBe(true);
  });

  it('ne plante pas sur un dossier sans pseudo Discord', () => {
    expect(matchesSearch({ ...row, discordUsername: null }, 'romainpjt')).toBe(false);
  });
});
