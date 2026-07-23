// Types du moteur de bracket (double ET simple élimination) — PURS, aucune
// I/O (archi §3). Ce module est le cœur critique du jour de tournoi : toute la
// logique est testée en Vitest, la matérialisation Firestore
// (competition_matches) est une couche séparée qui consomme ces structures.
//
// Vocabulaire :
// - « void » : un côté de match qui ne recevra JAMAIS d'équipe (bye de
//   seeding, double forfait en amont, slot de waitlist resté vide). Un match
//   avec un côté void et une équipe présente se résout en walkover SANS score
//   conventionnel (un walkover/bye n'est pas un match joué — le délta est
//   normalisé par match réellement joué, archi §3). Un match avec deux côtés
//   void est annulé et propage void.
// - « forfait » : défaite administrative d'un match avec score CONVENTIONNEL
//   (spec §11 : 3-0 manches 1-0 en BO5, 4-0 en BO7). Le forfaitaire simple
//   descend chez les losers comme une défaite normale ; le DOUBLE forfait
//   élimine les deux équipes (R5-1) ; la cascade de retrait (R5-4) donne le
//   score conventionnel à l'adversaire mais fige le délta du retiré.

export type BracketSide = 'winners' | 'losers' | 'grand_final' | 'round_robin';

/** Format du bracket. En simple élimination : uniquement des matchs winners
 *  (l'arbre) + éventuellement une petite finale `P3` portée par le bracket
 *  `losers` round 1 (mappée « consolation final » côté viewer). Pas de GF/GFR.
 *  En round robin : uniquement des matchs `round_robin` (poules, toutes les
 *  équipes posées dès la génération — aucun `winner_of`/`loser_of`). */
export type BracketKind = 'double_elim' | 'single_elim' | 'round_robin';

export type MatchSource =
  | { type: 'seed'; ref: number }               // position de seed (1-based)
  | { type: 'winner_of'; ref: string }          // id de match amont
  | { type: 'loser_of'; ref: string }
  | { type: 'none' };                           // pas de source (slot bye structurel)

export type PureMatchStatus =
  | 'pending'      // équipes pas toutes connues, ou connues mais non joué
  | 'completed'    // joué (scores réels ou conventionnels de forfait)
  | 'walkover'     // résolu sans jeu : un côté void (bye, double forfait amont)
  | 'cancelled';   // aucun participant possible (2 côtés void, reset non joué)

export interface GameScore { a: number; b: number }

export interface PureMatch {
  id: string;                    // "W2-3" | "L5-1" | "GF" | "GFR" | "R3-2" (RR : journée 3, slot 2)
  bracket: BracketSide;
  round: number;                 // 1-based dans son bracket (GF/GFR : 1 et 2 ; RR : journée)
  slot: number;                  // 1-based, haut → bas (RR : GLOBAL dans la journée, toutes poules)
  /** Round robin uniquement : poule 1-based. Absent sur les matchs d'arbre. */
  group?: number;
  bo: number;
  phase: number | null;          // rattachement au phasePlan (null = hors plan)
  sourceA: MatchSource;
  sourceB: MatchSource;
  teamA: string | null;
  teamB: string | null;
  /** Ce côté ne recevra jamais d'équipe. */
  voidA: boolean;
  voidB: boolean;
  status: PureMatchStatus;
  winner: 'a' | 'b' | null;
  /** Manches finales — réelles ou conventionnelles (forfait). Null si non joué / walkover. */
  scores: GameScore[] | null;
  /** Camp(s) forfaitaire(s) — null si match joué normalement. */
  forfeit: 'a' | 'b' | 'both' | null;
  /** Le score conventionnel compte-t-il dans les stats de chaque camp ?
   *  Forfait simple : oui des deux côtés (spec §11). Double forfait : oui des
   *  deux côtés, −délta chacun (R5-1). Cascade de retrait : oui pour
   *  l'adversaire, NON pour le retiré (délta figé, R5-4). Sans objet hors
   *  forfait. */
  statsCountA: boolean;
  statsCountB: boolean;
}

export interface BoConfig {
  default: number;
  overrides: Array<{ bracket: 'winners' | 'losers'; roundsFromEnd: number; bo: number }>;
  grandFinal: number;
}

export interface PhasePlanRound { bracket: BracketSide; round: number }
export interface PhasePlanEntryLike { phase: number; rounds: PhasePlanRound[] }

export interface Bracket {
  kind: BracketKind;
  /** Équipes par seed (index 0 = seed 1). */
  teams: string[];
  /** Taille nominale : puissance de 2 (4→32) pour les élims ; effectif RÉEL
   *  d'équipes en round robin (aucune contrainte de puissance de 2). */
  size: number;
  /** Nombre de rondes winners (log2(size)). 0 en round robin (sans objet). */
  winnersRounds: number;
  /** Rondes losers : 2·(winnersRounds − 1) en double élim ; 1 en simple élim
   *  avec petite finale (`P3`), 0 sinon. 0 en round robin. */
  losersRounds: number;
  /** Round robin uniquement : nombre de poules (1 = ligue simple). */
  groups?: number;
  /** Round robin uniquement : journées au total (legs compris). */
  matchdays?: number;
  /** Round robin uniquement : true = aller-retour (chaque paire joue 2 fois). */
  doubleRound?: boolean;
  bo: BoConfig;
  /** Score conventionnel de forfait : le nombre de manches est TOUJOURS dérivé
   *  du BO du match (ceil(bo/2), soit 3 en BO5 / 4 en BO7), chaque manche
   *  `goalsPerGame`-0. Le champ `games` vient de la config compétition (Lot 0)
   *  et n'est pas lu par le moteur — informatif uniquement. */
  forfeitScore: { games: number; goalsPerGame: number };
  matches: Record<string, PureMatch>;
  /** Ids dans l'ordre déterministe de création (winners, losers, GF, GFR). */
  order: string[];
  /** Équipes retirées du tournoi (withdrawTeam, R5-4). */
  withdrawn: string[];
}

export type MatchOutcome =
  | { type: 'winner'; winner: 'a' | 'b'; scores: GameScore[] }
  | { type: 'forfeit'; team: 'a' | 'b' | 'both' };

export interface TeamStats {
  teamId: string;
  /** Matchs comptés dans la normalisation (joués + forfaits comptés). */
  matchesCounted: number;
  goalDiff: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Délta normalisé par match compté (0 si aucun match). */
  normalizedDiff: number;
}

export interface Placement {
  teamId: string;
  /** Place compressée 1→N — null tant que le tournoi n'est pas fini (seuls le
   *  groupe et le flag de départage sont fiables en cours de bracket). */
  placement: number | null;
  /** Clé du groupe d'élimination (ex. "champion", "gf_loser", "L3"). */
  group: string;
  /** Le départage intra-groupe a besoin d'un arbitrage admin. */
  needsAdminTiebreak: boolean;
}
