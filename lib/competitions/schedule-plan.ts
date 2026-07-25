// Déroulé d'un tournoi : la suite ORDONNÉE de blocs de matchs, en langage
// d'organisateur. Module PUR et client-safe (aucun import de moteur) — il
// alimente le formulaire de création (répartition sur les journées), et
// produit le `PhasePlanEntry[]` attendu par la validation et la console.
//
// Pourquoi ce module : le plan de phases se saisissait jusqu'ici en jargon de
// bracket (« P2 — WR2 + LR1 »), illisible sans avoir l'arbre sous les yeux —
// y compris pour l'admin qui l'a écrit. Ici, un bloc porte son nom d'usage
// (« Huitièmes », « Journée 3 »), son volume (« 8 matchs ») et, quand ce n'est
// pas évident, la phrase qui explique d'où sortent les équipes.
//
// Vocabulaire (fixé avec Matt le 25/07) : une ÉTAPE est une étape de format
// (poules → phase finale) ; un BLOC est un groupe de rondes lancées ensemble ;
// une JOURNÉE est un jour de compétition. Ce module ne traite que les blocs.

import type { CompetitionFormat, PhasePlanEntry } from '@/types/competitions';
import { roundLabel } from './round-labels';

export type PlanRound = PhasePlanEntry['rounds'][number];

export interface PlanBlock {
  /** 1-based : ordre de lancement, jamais l'index d'une journée. */
  phase: number;
  /** Nom d'usage — « Quarts de finale », « Journée 3 », « Grande finale ». */
  label: string;
  /** Explication affichée quand la provenance des équipes n'est pas évidente. */
  hint?: string;
  /** Matchs de ce bloc pour l'effectif NOMINAL du format (le champ réel peut
   *  être plus petit : les rondes vides sont alors simplement sans match). */
  matchCount: number;
  rounds: PlanRound[];
  /** Étape de format (1-based). Absent = étape 1 / tournoi mono-étape. */
  stage?: number;
  /** Nom de l'étape, pour les séparateurs du déroulé multi-étapes. */
  stageLabel?: string;
}

function pow2AtLeast(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Tailles des poules réparties en serpentin (les plus grandes d'abord) —
 *  même règle que le moteur, recalculée ici pour rester client-safe. */
export function poolSizes(teamCount: number, groupCount: number): number[] {
  const groups = Math.max(1, groupCount);
  const n = Math.max(2, teamCount);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Journées d'un leg pour une poule de `size` équipes (méthode du cercle :
 *  un effectif impair fait tourner un bye, d'où une journée de plus). */
function legDays(size: number): number {
  return size % 2 === 0 ? size - 1 : size;
}

// ── Élimination directe ─────────────────────────────────────────────────────

function singleElimBlocks(format: CompetitionFormat): PlanBlock[] {
  const size = pow2AtLeast(Math.max(4, Math.min(64, format.maxTeams)));
  const rounds = Math.log2(size);
  const blocks: PlanBlock[] = [];
  for (let r = 1; r <= rounds; r++) {
    const isFinal = r === rounds;
    const thirdPlace = isFinal && format.thirdPlace === true;
    blocks.push({
      phase: r,
      label: roundLabel(r, rounds) + (thirdPlace ? ' + petite finale' : ''),
      hint: thirdPlace
        ? 'Les deux équipes battues en demi-finale jouent la 3e place.'
        : undefined,
      matchCount: size / 2 ** r + (thirdPlace ? 1 : 0),
      rounds: thirdPlace
        ? [{ bracket: 'winners', round: r }, { bracket: 'losers', round: 1 }]
        : [{ bracket: 'winners', round: r }],
    });
  }
  return blocks;
}

// ── Double élimination ──────────────────────────────────────────────────────
// Ordonnancement par DÉPENDANCES, winners placées au plus tard :
//   · le tour perdants `i` se joue au bloc `i + 1` ;
//   · le tour vainqueurs `j` (j ≥ 2) au bloc `2(j − 1)`, soit juste avant le
//     tour perdants qui accueillera ses battus (LR 2(j−1) en a besoin) ;
//   · la grande finale ferme la marche.
// Les deux brackets avancent ainsi en alternance, sans qu'un camp attende la
// fin de l'autre — et les dépendances sont vérifiées par test sur 4→64.

function doubleElimBlocks(format: CompetitionFormat): PlanBlock[] {
  const size = pow2AtLeast(Math.max(4, Math.min(64, format.maxTeams)));
  const winnersRounds = Math.log2(size);
  const losersRounds = 2 * (winnersRounds - 1);

  const byPhase = new Map<number, PlanRound[]>();
  const push = (phase: number, round: PlanRound) => {
    const list = byPhase.get(phase) ?? [];
    list.push(round);
    byPhase.set(phase, list);
  };

  push(1, { bracket: 'winners', round: 1 });
  for (let j = 2; j <= winnersRounds; j++) push(2 * (j - 1), { bracket: 'winners', round: j });
  for (let i = 1; i <= losersRounds; i++) push(i + 1, { bracket: 'losers', round: i });
  const finalPhase = losersRounds + 2;
  push(finalPhase, { bracket: 'grand_final', round: 1 });
  // Le reset est PRÉ-CRÉÉ par le moteur et partage la phase de la grande
  // finale : il ne se joue que si le finaliste venu des perdants l'emporte.
  if (format.bracketReset) push(finalPhase, { bracket: 'grand_final', round: 2 });

  const matchesOfWinners = (round: number) => size / 2 ** round;
  // Perdants : les tours impairs regroupent les rescapés entre eux, les tours
  // pairs les confrontent aux battus du tour vainqueurs correspondant — même
  // volume dans les deux cas.
  const matchesOfLosers = (round: number) => size / 2 ** (Math.floor((round + 1) / 2) + 1);

  return [...byPhase.keys()].sort((a, b) => a - b).map((phase, index) => {
    const rounds = byPhase.get(phase)!;
    return {
      phase: index + 1,
      label: doubleElimLabel(rounds, winnersRounds, losersRounds),
      hint: doubleElimHint(rounds, winnersRounds),
      matchCount: rounds.reduce((sum, r) => {
        if (r.bracket === 'winners') return sum + matchesOfWinners(r.round);
        if (r.bracket === 'losers') return sum + matchesOfLosers(r.round);
        // La belle (grand_final round 2) est pré-créée mais ne se joue qu'une
        // fois sur deux : l'annoncer dans le volume serait mentir. Elle est
        // signalée par le commentaire du bloc.
        return sum + (r.round === 1 ? 1 : 0);
      }, 0),
      rounds,
    };
  });
}

function winnersLabel(round: number, total: number): string {
  if (round === total) return 'Finale vainqueurs';
  if (round === total - 1) return 'Demi-finales vainqueurs';
  return `Tour ${round} vainqueurs`;
}

// Pas de « demi-finales perdants » : l'avant-dernier tour du bracket perdants
// ne compte qu'un match, le pluriel ferait croire à une vraie ronde.
function losersLabel(round: number, total: number): string {
  return round === total ? 'Finale perdants' : `Tour ${round} perdants`;
}

function doubleElimLabel(rounds: PlanRound[], winnersRounds: number, losersRounds: number): string {
  return rounds
    .filter(r => !(r.bracket === 'grand_final' && r.round === 2))
    .map(r => {
      if (r.bracket === 'grand_final') return 'Grande finale';
      if (r.bracket === 'winners') return winnersLabel(r.round, winnersRounds);
      return losersLabel(r.round, losersRounds);
    })
    .join(' + ');
}

function doubleElimHint(rounds: PlanRound[], winnersRounds: number): string | undefined {
  if (rounds.some(r => r.bracket === 'grand_final')) {
    return rounds.length > 1
      ? 'Le vainqueur du bracket perdants défie celui du bracket vainqueurs. S’il gagne, une belle se joue dans la foulée.'
      : 'Le vainqueur du bracket perdants défie celui du bracket vainqueurs.';
  }
  const winners = rounds.find(r => r.bracket === 'winners');
  const losers = rounds.find(r => r.bracket === 'losers');
  if (winners && losers) {
    return winners.round === winnersRounds
      ? 'Dernier tour du bracket vainqueurs : le battu bascule chez les perdants.'
      : 'Les deux brackets avancent en parallèle ; les battus du tour vainqueurs basculent chez les perdants.';
  }
  if (losers && losers.round === 1) {
    return 'Les équipes battues au premier tour s’affrontent : une seconde défaite élimine.';
  }
  if (losers && losers.round % 2 === 1) {
    return 'Les rescapés du bracket perdants s’affrontent entre eux — une défaite élimine.';
  }
  if (losers) {
    return 'Les rescapés affrontent les équipes qui viennent d’être battues côté vainqueurs.';
  }
  return undefined;
}

// ── Poules et suisse ────────────────────────────────────────────────────────

function roundRobinBlocks(format: CompetitionFormat): PlanBlock[] {
  const sizes = poolSizes(format.maxTeams, format.groupCount ?? 1);
  const legs = format.doubleRound === true ? 2 : 1;
  const daysPerLeg = Math.max(...sizes.map(legDays));
  const blocks: PlanBlock[] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let d = 1; d <= daysPerLeg; d++) {
      const phase = leg * daysPerLeg + d;
      blocks.push({
        phase,
        label: `Journée ${phase}`,
        hint: leg === 1 && d === 1
          ? 'Début des matchs retour : les mêmes rencontres, camps inversés.'
          : undefined,
        // Une poule à l'effectif impair fait tourner un bye : ce jour-là elle
        // joue une rencontre de moins que sa taille ne le laisse croire.
        matchCount: sizes.reduce((sum, s) => sum + (d <= legDays(s) ? Math.floor(s / 2) : 0), 0),
        rounds: [{ bracket: 'round_robin', round: phase }],
      });
    }
  }
  return blocks;
}

function swissBlocks(format: CompetitionFormat): PlanBlock[] {
  const rounds = Math.max(1, format.swissRounds ?? 1);
  // Matchs RÉELLEMENT joués : à effectif impair, une équipe reçoit un bye —
  // il occupe une ligne du bracket mais aucun créneau. Compter le bye comme un
  // match annonçait une rencontre de plus que le résumé du format.
  const perRound = Math.floor(Math.max(2, format.maxTeams) / 2);
  const odd = format.maxTeams % 2 === 1;
  return Array.from({ length: rounds }, (_, i) => ({
    phase: i + 1,
    label: `Ronde ${i + 1}`,
    hint: i === 0
      ? 'Première ronde appariée au seed. Les suivantes se composent au fil des résultats.'
      : odd
        ? 'Équipes de score voisin, jamais deux fois le même adversaire. L’effectif étant impair, une équipe reçoit un bye.'
        : 'Équipes de score voisin, jamais deux fois le même adversaire.',
    matchCount: perRound,
    rounds: [{ bracket: 'swiss', round: i + 1 }],
  }));
}

// ── BO par tour ─────────────────────────────────────────────────────────────

export interface BoRoundRef {
  bracket: 'winners' | 'losers' | 'grand_final';
  round: number;
  /** Distance à la fin de son bracket (1 = dernier tour) — la clé des
   *  exceptions, qui restent valables quelle que soit la taille du champ. */
  roundsFromEnd: number;
  label: string;
  /** BO réellement appliqué par le moteur en l'état de la configuration. */
  bo: number;
  /** La petite finale suit le BO par défaut sans exception possible (le
   *  générateur ne lit aucun override pour elle) : affichée, non réglable. */
  editable: boolean;
}

/**
 * Les tours d'un format à élimination avec leur BO effectif — de quoi régler
 * « demi-finales en BO7 » sans parler de « bracket winners, roundsFromEnd 2 ».
 * Poules et suisse : liste vide (BO unique, les exceptions y sont refusées).
 */
export function listBoRounds(format: CompetitionFormat): BoRoundRef[] {
  const kind = format.kind;
  if (kind === 'round_robin' || kind === 'swiss') return [];

  const size = pow2AtLeast(Math.max(4, Math.min(64, format.maxTeams)));
  const winnersRounds = Math.log2(size);
  const overrideFor = (bracket: 'winners' | 'losers', roundsFromEnd: number) =>
    format.bo.overrides.find(o => o.bracket === bracket && o.roundsFromEnd === roundsFromEnd)?.bo;

  const out: BoRoundRef[] = [];
  for (let r = 1; r <= winnersRounds; r++) {
    const roundsFromEnd = winnersRounds - r + 1;
    const override = overrideFor('winners', roundsFromEnd);
    // Simple élim : la finale prend le « BO de finale » sauf exception
    // explicite — c'est ce que fait generateSingleElim, à la lettre.
    const isSingleFinal = kind === 'single_elim' && r === winnersRounds;
    out.push({
      bracket: 'winners',
      round: r,
      roundsFromEnd,
      label: kind === 'single_elim' ? roundLabel(r, winnersRounds) : winnersLabel(r, winnersRounds),
      bo: override ?? (isSingleFinal ? format.bo.grandFinal : format.bo.default),
      editable: true,
    });
  }

  if (kind === 'single_elim') {
    if (format.thirdPlace === true && winnersRounds >= 2) {
      out.push({
        bracket: 'losers', round: 1, roundsFromEnd: 1,
        label: 'Petite finale', bo: format.bo.default, editable: false,
      });
    }
    return out;
  }

  const losersRounds = 2 * (winnersRounds - 1);
  for (let r = 1; r <= losersRounds; r++) {
    const roundsFromEnd = losersRounds - r + 1;
    out.push({
      bracket: 'losers',
      round: r,
      roundsFromEnd,
      label: losersLabel(r, losersRounds),
      bo: overrideFor('losers', roundsFromEnd) ?? format.bo.default,
      editable: true,
    });
  }
  out.push({
    bracket: 'grand_final', round: 1, roundsFromEnd: 1,
    label: format.bracketReset ? 'Grande finale (et belle)' : 'Grande finale',
    bo: format.bo.grandFinal, editable: true,
  });
  return out;
}

// ── API ─────────────────────────────────────────────────────────────────────

/** Blocs de matchs d'un format, dans l'ordre de lancement. */
export function buildPlanBlocks(format: CompetitionFormat): PlanBlock[] {
  switch (format.kind) {
    case 'single_elim': return singleElimBlocks(format);
    case 'round_robin': return roundRobinBlocks(format);
    case 'swiss': return swissBlocks(format);
    default: return doubleElimBlocks(format);
  }
}

/**
 * Répartit les blocs sur `dayCount` journées en équilibrant le NOMBRE DE
 * MATCHS (une journée de 16 matchs et une de 2, c'est une journée de trop) —
 * l'ordre des blocs est préservé et chaque journée reçoit au moins un bloc.
 * Renvoie le numéro de journée (1-based) de chaque bloc.
 */
export function spreadOverDays(blocks: PlanBlock[], dayCount: number): number[] {
  const days = Math.max(1, Math.min(dayCount, blocks.length));
  const total = blocks.reduce((sum, b) => sum + b.matchCount, 0);
  const target = total / days;

  const assignment: number[] = [];
  let day = 1;
  let running = 0;
  for (let i = 0; i < blocks.length; i++) {
    const remainingBlocks = blocks.length - i;
    const daysToFill = days - day + 1;
    // Une journée sans aucun bloc n'aurait pas de sens sur le planning : quand
    // il ne reste que juste assez de blocs pour les journées restantes, on
    // avance d'une journée par bloc, charge ou pas.
    const mustAdvance = remainingBlocks < daysToFill;
    // Sinon on bascule à la charge visée — mais jamais si cela viderait une
    // des journées suivantes.
    const canAdvance = remainingBlocks >= daysToFill - 1;
    if (day < days && (mustAdvance || (running >= target * day && canAdvance))) {
      day++;
    }
    assignment.push(day);
    running += blocks[i].matchCount;
  }
  return assignment;
}

/**
 * Blocs de TOUTES les étapes d'un tournoi, numérotés 1..N d'affilée.
 *
 * La structure d'une phase finale est connue dès la création (8 qualifiées →
 * quarts, demies, finale) : seuls les NOMS des équipes manquent, ce qui
 * n'empêche pas de planifier « poules le samedi, phase finale le dimanche ».
 */
export function buildStagedBlocks(
  stages: Array<{ format: CompetitionFormat; name?: string }>,
  stageLabelOf: (stage: { format: CompetitionFormat; name?: string }, index: number) => string,
): PlanBlock[] {
  const out: PlanBlock[] = [];
  stages.forEach((stage, index) => {
    const single = stages.length === 1;
    for (const block of buildPlanBlocks(stage.format)) {
      out.push({
        ...block,
        phase: out.length + 1,
        ...(single ? {} : { stage: index + 1, stageLabel: stageLabelOf(stage, index) }),
      });
    }
  });
  return out;
}

/**
 * Les entrées de déroulé d'UNE étape.
 *
 * INDISPENSABLE avant de passer un plan à un moteur : le rattachement des
 * phases se fait par (bracket, round) SANS notion d'étape. Un plan complet
 * ferait écraser les phases de l'étape 1 par celles de l'étape 2, qui portent
 * les mêmes numéros de ronde — les matchs de poule héritaient des phases de la
 * phase finale, et la console lançait n'importe quoi.
 */
export function phasePlanForStage<T>(plan: T[] | undefined | null, stage: number): T[] {
  // `stage` absent = étape 1 (toutes les compétitions d'avant le multi-étapes).
  return (plan ?? []).filter(e => (((e as { stage?: number } | null)?.stage) ?? 1) === stage);
}

/** Blocs + journée par bloc → le `phasePlan` stocké et validé. */
export function blocksToPhasePlan(blocks: PlanBlock[], dayByPhase: number[]): PhasePlanEntry[] {
  return blocks.map((b, i) => ({
    phase: b.phase,
    day: Math.max(1, dayByPhase[i] ?? 1),
    label: b.label.slice(0, 60),
    ...(b.stage && b.stage > 1 ? { stage: b.stage } : {}),
    rounds: b.rounds,
  }));
}

/** Plan par défaut d'un format sur `dayCount` journées (répartition auto). */
export function buildDefaultPlan(format: CompetitionFormat, dayCount = 1): PhasePlanEntry[] {
  const blocks = buildPlanBlocks(format);
  return blocksToPhasePlan(blocks, spreadOverDays(blocks, dayCount));
}
