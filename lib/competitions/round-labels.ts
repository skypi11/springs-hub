// Noms consacrés des tours d'un arbre, par distance à la fin (0 = finale).
// SOURCE UNIQUE — trois consommateurs les partageaient en copies divergentes :
// le plan de phases par défaut (defaults.ts), les en-têtes du bracket public
// (TournamentBracket) et le déroulé des journées du formulaire de création.
// Module pur et client-safe (aucun import de moteur).

const NAMES_FROM_END = [
  'Finale',
  'Demi-finales',
  'Quarts',
  'Huitièmes',
  'Seizièmes',
  'Trente-deuxièmes',   // arbres de 64 : premier tour depuis le passage du cap
];

/**
 * Nom du tour situé à `fromEnd` rondes de la fin (0 = finale, 1 = demies…).
 * `null` au-delà des noms consacrés : l'appelant retombe alors sur « Tour N »
 * — un arbre de 128 aurait un premier tour sans nom d'usage établi, autant
 * l'afficher franchement que d'inventer « soixante-quatrièmes ».
 */
export function roundNameFromEnd(fromEnd: number): string | null {
  if (!Number.isInteger(fromEnd) || fromEnd < 0) return null;
  return NAMES_FROM_END[fromEnd] ?? null;
}

/** Nom du tour `round` dans un arbre de `totalRounds` tours, avec repli
 *  « Tour N » — la forme dont ont besoin les vues (jamais de libellé vide). */
export function roundLabel(round: number, totalRounds: number): string {
  return roundNameFromEnd(totalRounds - round) ?? `Tour ${round}`;
}
