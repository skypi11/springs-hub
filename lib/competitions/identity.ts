// Résolution d'identité d'équipe de circuit (spec Legends §4, archi §2) —
// fonctions PURES, aucune I/O. Utilisées par la file de validation admin :
// le serveur recalcule TOUJOURS la résolution avant d'appliquer une décision.
//
// Règle noyau (conservation des points) : une équipe conserve ses points de
// circuit si au moins 2 de ses 3 titulaires figuraient dans le roster
// (titulaires OU subs) de sa précédente participation ; sinon elle repart à 0.
// Le nom d'équipe ne peut pas changer entre deux participations, sauf accord
// des admins de compétition.
//
// Contrainte dure (archi §2) : JAMAIS de rattachement silencieux en cas
// d'ambiguïté — 2 inscriptions qui matchent le même historique (split
// d'équipe), 1 inscription qui matche 2 circuit_teams, ou un nom repris sans
// continuité de roster → arbitrage admin explicite, journalisé.

/** Candidat au rattachement : une circuit_team existante du même circuit. */
export interface IdentityCandidate {
  circuitTeamId: string;
  name: string;
  /**
   * Roster (titulaires + subs) de la PRÉCÉDENTE participation de cette équipe
   * dans le circuit — la plus récente dans l'ordre de circuit.competitionIds.
   * Vide si l'équipe n'a encore aucun roster enregistré.
   */
  lastRosterUids: string[];
  /** Une autre inscription de LA MÊME compétition est déjà rattachée à cette équipe. */
  claimedByOther: boolean;
}

export type IdentityFlag = 'name_mismatch' | 'identity_conflict';

export interface IdentityMatch {
  circuitTeamId: string;
  name: string;
  nameMatch: boolean;
  coreMatch: boolean;
  /** Nombre de titulaires actuels retrouvés dans la précédente participation. */
  coreOverlap: number;
  claimedByOther: boolean;
}

export type IdentityResolution =
  | { kind: 'new'; matches: IdentityMatch[]; flags: IdentityFlag[] }
  | { kind: 'attach'; circuitTeamId: string; matches: IdentityMatch[]; flags: IdentityFlag[] }
  | { kind: 'choice_required'; matches: IdentityMatch[]; flags: IdentityFlag[] };

// Normalisation de nom pour la comparaison d'identité : casse, accents et
// espaces multiples ignorés (l'identité de circuit est la continuité de nom,
// pas sa typographie exacte).
export function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Slug utilisé comme id de document circuit_team : déterministe depuis le nom
// normalisé → deux créations concurrentes du même nom entrent en collision de
// doc id et sont détectées en transaction (jamais deux teams silencieusement
// homonymes).
export function circuitTeamSlug(circuitId: string, name: string): string {
  const slug = normalizeTeamName(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'equipe';
  return `${circuitId}__${slug}`;
}

/** Seuil du noyau : 2 titulaires sur 3 en RL, généralisé en ⌈2n/3⌉. */
export function coreThreshold(starterCount: number): number {
  return Math.max(1, Math.ceil((starterCount * 2) / 3));
}

/**
 * Résout le rattachement d'une inscription à une circuit_team.
 *
 * - Aucun candidat (ni nom ni noyau) → `new` (automatique, points à zéro).
 * - Exactement un candidat qui matche nom ET noyau, non réclamé par une autre
 *   inscription → `attach` (automatique, points conservés).
 * - Tout le reste → `choice_required` : l'admin tranche explicitement.
 *   Flags posés : `name_mismatch` (noyau retrouvé sous un autre nom — un
 *   rattachement vaudra accord de changement de nom), `identity_conflict`
 *   (nom repris sans noyau, plusieurs candidats, ou candidat déjà réclamé).
 */
export function resolveCircuitIdentity(input: {
  name: string;
  starterUids: string[];
  candidates: IdentityCandidate[];
}): IdentityResolution {
  const normName = normalizeTeamName(input.name);
  const threshold = coreThreshold(input.starterUids.length);

  const matches: IdentityMatch[] = [];
  for (const c of input.candidates) {
    const roster = new Set(c.lastRosterUids);
    const coreOverlap = input.starterUids.filter(u => roster.has(u)).length;
    const nameMatch = normalizeTeamName(c.name) === normName;
    const coreMatch = coreOverlap >= threshold && c.lastRosterUids.length > 0;
    if (nameMatch || coreMatch) {
      matches.push({
        circuitTeamId: c.circuitTeamId,
        name: c.name,
        nameMatch,
        coreMatch,
        coreOverlap,
        claimedByOther: c.claimedByOther,
      });
    }
  }

  if (matches.length === 0) {
    return { kind: 'new', matches, flags: [] };
  }

  const flags = new Set<IdentityFlag>();
  for (const m of matches) {
    if (m.coreMatch && !m.nameMatch) flags.add('name_mismatch');
    if (m.nameMatch && !m.coreMatch) flags.add('identity_conflict');
    if (m.claimedByOther) flags.add('identity_conflict');
  }
  if (matches.length > 1) flags.add('identity_conflict');

  const only = matches[0];
  if (matches.length === 1 && only.nameMatch && only.coreMatch && !only.claimedByOther) {
    return { kind: 'attach', circuitTeamId: only.circuitTeamId, matches, flags: [] };
  }

  return { kind: 'choice_required', matches, flags: Array.from(flags) };
}
