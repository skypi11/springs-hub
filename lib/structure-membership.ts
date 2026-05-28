// ╔══════════════════════════════════════════════════════════════════════════╗
// ║   STRUCTURE MEMBERSHIP, Gestion de l'invariant "max 2 structures par   ║
// ║   jeu" (validé Matt 2026-05-25).                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Règle métier :
//   - Un joueur peut être MEMBRE de max 2 structures par jeu, tous rôles
//     confondus (fondateur, co-fondateur, responsable, coach structure,
//     manager/coach équipe, joueur).
//   - Les structures `active` ET `pending_validation` comptent dans le cap.
//     Les structures `archived` / `suspended` / `rejected` / `deletion_scheduled`
//     NE comptent PAS (≠ présence active).
//
// Schema :
//   users.structurePerGame: { [game: string]: string[] }   // max 2 par game
//
// Migration : les anciens docs ont `structurePerGame[game]: string` (single).
// Les helpers `getStructuresForGame` et `normalizeStructurePerGame` font une
// lecture défensive, toute valeur string est wrappée en array [string]. Au
// premier write, le champ devient un array proprement. Pas besoin de migration
// dump-and-restore.

const MAX_STRUCTURES_PER_GAME = 2;

export const STRUCTURE_MEMBERSHIP_CAP = MAX_STRUCTURES_PER_GAME;

// Type accepté en entrée, peut être string (legacy) ou string[] (nouveau)
type StructureValue = string | string[] | undefined;

// Renvoie toujours un array, wrappe les strings legacy, défensif sur undefined
export function getStructuresForGame(
  structurePerGame: Record<string, StructureValue> | undefined | null,
  game: string,
): string[] {
  if (!structurePerGame) return [];
  const v = structurePerGame[game];
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(s => typeof s === 'string' && s);
  if (typeof v === 'string') return [v];
  return [];
}

// Renvoie l'ensemble des structureIds toutes games confondues (utile pour
// reconstruire le state d'un user au backfill).
export function getAllStructureIds(
  structurePerGame: Record<string, StructureValue> | undefined | null,
): string[] {
  if (!structurePerGame) return [];
  const set = new Set<string>();
  for (const game of Object.keys(structurePerGame)) {
    for (const sid of getStructuresForGame(structurePerGame, game)) set.add(sid);
  }
  return Array.from(set);
}

// Test : l'user peut-il rejoindre `structureId` pour `game` ?
// Renvoie { ok: true } ou { ok: false, reason }.
export function canJoinStructure(
  structurePerGame: Record<string, StructureValue> | undefined | null,
  game: string,
  structureId: string,
): { ok: true } | { ok: false; reason: 'already_in_structure' | 'cap_reached'; current: string[] } {
  const current = getStructuresForGame(structurePerGame, game);
  if (current.includes(structureId)) {
    return { ok: false, reason: 'already_in_structure', current };
  }
  if (current.length >= MAX_STRUCTURES_PER_GAME) {
    return { ok: false, reason: 'cap_reached', current };
  }
  return { ok: true };
}

// Ajoute `structureId` au tableau (sans dépasser le cap). Renvoie le nouveau
// tableau pour ce game.
export function addStructureToGame(
  structurePerGame: Record<string, StructureValue> | undefined | null,
  game: string,
  structureId: string,
): string[] {
  const current = getStructuresForGame(structurePerGame, game);
  if (current.includes(structureId)) return current;
  if (current.length >= MAX_STRUCTURES_PER_GAME) {
    throw new Error(`Cap atteint : max ${MAX_STRUCTURES_PER_GAME} structures par jeu pour cet utilisateur.`);
  }
  return [...current, structureId];
}

// Retire `structureId` du tableau. Renvoie le nouveau tableau (peut être vide).
export function removeStructureFromGame(
  structurePerGame: Record<string, StructureValue> | undefined | null,
  game: string,
  structureId: string,
): string[] {
  const current = getStructuresForGame(structurePerGame, game);
  return current.filter(s => s !== structureId);
}

// Normalise le champ user.structurePerGame entier en array form (utile pour
// les routes qui lisent et veulent une API cohérente).
export function normalizeStructurePerGame(
  structurePerGame: Record<string, StructureValue> | undefined | null,
): Record<string, string[]> {
  if (!structurePerGame) return {};
  const out: Record<string, string[]> = {};
  for (const game of Object.keys(structurePerGame)) {
    out[game] = getStructuresForGame(structurePerGame, game);
  }
  return out;
}

// Statuts de structure qui COMPTENT dans le cap (présence active).
// `active` = en pleine activité.
// `pending_validation` = demande créée par fondateur, en attente admin.
// Tout autre statut (archived, suspended, rejected, deletion_scheduled) → exclu.
export const ACTIVE_STRUCTURE_STATUSES = new Set(['active', 'pending_validation']);

export function isStructureCountedInCap(status: string | undefined | null): boolean {
  return !!status && ACTIVE_STRUCTURE_STATUSES.has(status);
}
