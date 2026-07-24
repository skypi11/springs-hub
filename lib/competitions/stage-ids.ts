// Ids de match préfixés par ÉTAPE (multi-étapes, design §9b) — primitives
// PURES et CLIENT-SAFE (aucun import moteur : l'adaptateur du viewer, côté
// client, en a besoin ; le runtime serveur les consomme via stages.ts qui les
// ré-exporte). Une seule source de vérité du format d'id.
//
// Étape 1 : id moteur NU (`W1-1`, `R2-3`, `GF`…) — rétrocompat totale.
// Étape N ≥ 2 : `E{N}_{engineId}`. AUCUN id moteur ne contient `_` — le
// parse est non-ambigu par construction.

const STAGE_ID_RE = /^E(\d+)_(.+)$/;

/** Id public d'un match : étape 1 = id moteur NU, étape N ≥ 2 = `E{N}_{id}`. */
export function stageMatchId(stage: number, engineId: string): string {
  return stage <= 1 ? engineId : `E${stage}_${engineId}`;
}

/** Parse inverse — un id sans préfixe (ou `E1_` théorique) = étape 1. */
export function parseStageMatchId(id: string): { stage: number; engineId: string } {
  const m = STAGE_ID_RE.exec(id);
  if (!m) return { stage: 1, engineId: id };
  const stage = Number(m[1]);
  return stage >= 2 ? { stage, engineId: m[2] } : { stage: 1, engineId: id };
}

/** Étape d'un doc de match (absent = 1 — docs d'avant le multi-étapes). */
export function stageOfMatch(doc: { stage?: number | null }): number {
  const n = doc.stage;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
}
