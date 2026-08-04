import { describe, it, expect } from 'vitest';
import { buildCsv } from './csv';

const BOM = '﻿';

describe('buildCsv', () => {
  it('entoure chaque cellule de guillemets', () => {
    expect(buildCsv([['a', 'b']])).toBe(`${BOM}"a","b"`);
  });

  it('sépare les lignes comme les tableurs l’attendent', () => {
    expect(buildCsv([['a'], ['b']])).toBe(`${BOM}"a"\r\n"b"`);
  });

  it('commence par le marqueur d’ordre des octets', () => {
    // Sans lui, Excel affiche « Amélie » en « AmÃ©lie ».
    expect(buildCsv([['Amélie']]).startsWith(BOM)).toBe(true);
  });

  it('double les guillemets présents dans une valeur', () => {
    expect(buildCsv([['il a dit "oui"']])).toBe(`${BOM}"il a dit ""oui"""`);
  });

  it('neutralise une cellule qui serait lue comme une formule', () => {
    // Le cas qui compte : un pseudo choisi par un joueur, exécuté chez la
    // personne qui ouvre l'export.
    expect(buildCsv([['=1+1']])).toBe(`${BOM}"'=1+1"`);
    expect(buildCsv([['+33612345678']])).toBe(`${BOM}"'+33612345678"`);
    expect(buildCsv([['-5']])).toBe(`${BOM}"'-5"`);
    expect(buildCsv([['@here']])).toBe(`${BOM}"'@here"`);
  });

  it('ne touche pas à une cellule ordinaire', () => {
    expect(buildCsv([['Dupont']])).toBe(`${BOM}"Dupont"`);
    // Le tiret au milieu n'a rien d'un début de formule.
    expect(buildCsv([['LAN-4B2C']])).toBe(`${BOM}"LAN-4B2C"`);
  });

  it('rend les valeurs absentes comme des cellules vides', () => {
    expect(buildCsv([[null, undefined, 0, false]])).toBe(`${BOM}"","","0","false"`);
  });

  it('accepte un tableau vide', () => {
    expect(buildCsv([])).toBe(BOM);
  });
});
