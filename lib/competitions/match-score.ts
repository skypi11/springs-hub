// Gestion des manches d'un match BO — PUR, partagé par la saisie participant
// (ScoreEntryForm, page match) et l'imposition admin (ForceScoreModal, console).
// Auto-gère les rangées pour qu'on ne puisse PAS construire un score impossible
// (4-0 en BO5) ni oublier une manche décisive (2-1 → la 3e manche apparaît).

export interface ScoreGame { a: number; b: number }

/** Manches à gagner pour remporter un BO (BO5 → 3, BO7 → 4). */
export function winsNeeded(bo: number): number {
  return Math.ceil(bo / 2);
}

/** Manches gagnées de chaque côté (une manche nulle ne compte pour personne). */
export function winsOf(games: ScoreGame[]): { a: number; b: number } {
  const w = { a: 0, b: 0 };
  for (const g of games) { if (g.a > g.b) w.a++; else if (g.b > g.a) w.b++; }
  return w;
}

/**
 * Rangées de manches auto-gérées : le formulaire montre TOUJOURS le bon nombre.
 * - On COUPE dès qu'un camp atteint le nombre requis (match plié → aucune manche
 *   en trop possible : un 4-0 en BO5 est ramené à 3-0, on ne peut pas le construire).
 * - Sinon on garantit au moins `needed` rangées, PLUS une rangée vide à remplir
 *   tant que la dernière est décisive et qu'on n'a pas atteint `bo` (un 2-1 fait
 *   donc apparaître la manche suivante tout seul).
 * Idempotent : normalizeGameRows(normalizeGameRows(x, bo), bo) === normalizeGameRows(x, bo).
 */
export function normalizeGameRows(games: ScoreGame[], bo: number): ScoreGame[] {
  const needed = winsNeeded(bo);
  const kept: ScoreGame[] = [];
  let wa = 0, wb = 0;
  for (const g of games) {
    kept.push({ a: g.a, b: g.b });
    if (g.a > g.b) wa++; else if (g.b > g.a) wb++;
    if (wa === needed || wb === needed) return kept; // décidé → on s'arrête ici
  }
  while (kept.length < needed) kept.push({ a: 0, b: 0 });
  const last = kept[kept.length - 1];
  if (last && last.a !== last.b && kept.length < bo) kept.push({ a: 0, b: 0 });
  return kept;
}

/** Score complet et valide : un camp a exactement `needed` manches, aucune manche nulle. */
export function isScoreValid(games: ScoreGame[], bo: number): boolean {
  const needed = winsNeeded(bo);
  const w = winsOf(games);
  return (w.a === needed || w.b === needed) && games.every(g => g.a !== g.b);
}
