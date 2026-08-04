// Fabrication de fichiers CSV destinés à être ouverts dans un tableur.
//
// Deux pièges, et les deux mordent en silence.
//
// 1. L'INJECTION DE FORMULE. Une cellule qui commence par `=`, `+`, `-` ou `@`
//    est interprétée comme une formule à l'ouverture dans Excel ou Sheets. Un
//    pseudo comme `=cmd|...` devient alors du code exécuté chez la personne qui
//    ouvre l'export. Tout ce qui vient d'une saisie utilisateur — un pseudo, un
//    nom, une note — doit être neutralisé.
//
// 2. L'ENCODAGE. Sans marqueur d'ordre des octets en tête de fichier, Excel lit
//    l'UTF-8 comme du latin-1 : « Amélie » devient « AmÃ©lie ». Le fichier est
//    juste, l'affichage est faux, et c'est l'export qu'on accuse.

/** Neutralise une cellule qui pourrait être lue comme une formule. */
function neutralize(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

function quote(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${neutralize(s).replace(/"/g, '""')}"`;
}

/**
 * Assemble un CSV prêt à télécharger : lignes échappées, séparateur de ligne
 * Windows (celui qu'attendent les tableurs) et marqueur d'ordre des octets.
 */
export function buildCsv(rows: readonly (readonly unknown[])[]): string {
  const body = rows.map((row) => row.map(quote).join(',')).join('\r\n');
  return `﻿${body}`;
}

/**
 * Déclenche le téléchargement d'un CSV depuis le navigateur.
 * Sans effet côté serveur — la garde évite un plantage si le module est
 * importé par une route.
 */
export function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
