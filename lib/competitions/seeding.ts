// Stratégies de SEEDING — fonctions PURES (design docs/registry-formats-design.md §10).
// Le différenciateur Aedral : seeder par la force RÉELLE (MMR de référence
// anti-smurf) ou par le classement du circuit, au lieu du tirage manuel/aléa
// des plateformes concurrentes. Utilisées par l'action `seed_by` (seeding
// initial) et par le re-seeding des transferts multi-étapes (`advance_stage`).
//
// Convention : l'ORDRE retourné est l'ordre de seed (index 0 = seed 1 = la
// plus forte) — `seedOrder` du moteur étale ensuite les têtes de série.

export interface SeedableTeam {
  registrationId: string;
  /** Départage final stable (auditable — jamais d'ordre dépendant de l'insertion). */
  name: string;
  /** Force de la MEILLEURE compo alignable, calculée serveur à la soumission
   *  (spec §3, `computed.worstLineupAvg` — « worst » au sens anti-smurf = la
   *  plus haute). null = non calculée (roster incomplet, données legacy). */
  worstLineupAvg: number | null;
  /** MMR de référence de chaque joueur du roster (fallback si l'analyse de
   *  compos manque). */
  rosterRefMmrs: number[];
  /** Identité circuit de l'inscription — null si jamais rattachée. */
  circuitTeamId?: string | null;
}

/** Valeur de seed MMR d'une équipe (plus haut = plus fort). 0 = aucune donnée
 *  MMR → fin de liste, jamais une exclusion. */
export function mmrSeedValue(team: SeedableTeam): number {
  if (typeof team.worstLineupAvg === 'number' && Number.isFinite(team.worstLineupAvg)) {
    return team.worstLineupAvg;
  }
  const mmrs = team.rosterRefMmrs.filter(m => Number.isFinite(m) && m > 0);
  if (mmrs.length === 0) return 0;
  return Math.round(mmrs.reduce((a, b) => a + b, 0) / mmrs.length);
}

/** Moyenne du roster COMPLET — départage entre deux valeurs de seed égales
 *  (deux compos fortes identiques, rosters de profondeur différente). */
function rosterAvg(team: SeedableTeam): number {
  const mmrs = team.rosterRefMmrs.filter(m => Number.isFinite(m) && m > 0);
  if (mmrs.length === 0) return 0;
  return mmrs.reduce((a, b) => a + b, 0) / mmrs.length;
}

/** Ordre de seed par MMR : valeur de seed décroissante, départages moyenne du
 *  roster puis nom (stable et auditable). */
export function orderByMmr(teams: SeedableTeam[]): string[] {
  return [...teams]
    .sort((a, b) =>
      mmrSeedValue(b) - mmrSeedValue(a)
      || rosterAvg(b) - rosterAvg(a)
      || a.name.localeCompare(b.name))
    .map(t => t.registrationId);
}

/**
 * Ordre de seed par classement de circuit : rang croissant (1er du circuit =
 * seed 1). Les inscriptions SANS rang (jamais rattachées au circuit, ou
 * jamais classées) viennent APRÈS les classées, ordonnées par MMR puis nom —
 * une nouvelle équipe n'est jamais avantagée par son absence d'historique.
 */
export function orderByCircuitRank(
  teams: SeedableTeam[],
  rankByCircuitTeamId: Map<string, number>,
): string[] {
  const rankOf = (t: SeedableTeam): number =>
    (t.circuitTeamId ? rankByCircuitTeamId.get(t.circuitTeamId) : undefined) ?? Number.MAX_SAFE_INTEGER;
  return [...teams]
    .sort((a, b) =>
      rankOf(a) - rankOf(b)
      || mmrSeedValue(b) - mmrSeedValue(a)
      || rosterAvg(b) - rosterAvg(a)
      || a.name.localeCompare(b.name))
    .map(t => t.registrationId);
}

/** Ordre de seed → rang par registrationId (0-based) — le `seedRank` consommé
 *  par computeStageAdvance pour le re-seeding des transferts. */
export function seedRankOf(order: string[]): Map<string, number> {
  return new Map(order.map((id, i) => [id, i]));
}
