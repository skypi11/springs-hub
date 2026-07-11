// Adaptateur PUR : documents publics `competition_matches` (shape servie par
// `/api/competitions/[id]/matches`) → données `brackets-viewer` (format
// brackets-model). C'est la couche qui rend la VUE de tournoi agnostique du
// format : le viewer (Drarig29) sait déjà rendre round robin / simple / double
// élimination — quand un moteur Swiss ou round robin arrivera, seul cet
// adaptateur grandit, pas la vue.
//
// Sémantique brackets-model (vérifiée sur le bundle 1.9.1) :
// - opponent `null`            = BYE (côté qui ne recevra jamais d'équipe → nos `void`).
// - opponent `{ id: null }`    = à déterminer (source pas encore résolue).
// - groupes du double élim     = splitBy(group_id) dans l'ordre 1 winners,
//                                2 losers, 3 finale — ids numériques croissants.
// - matchs du groupe finale    : `number === 1` = grande finale (GF1 + reset,
//                                distingués par leur round), `number === 2` =
//                                consolation. Ne JAMAIS émettre le reset en
//                                number 2 — il serait pris pour une consolante.
// - affichage du reset         : la condition du viewer est EXACTEMENT
//                                `GF1.opponent1.id === null || result === 'win'`
//                                → masqué tant que le champion winners est
//                                inconnu, masqué s'il gagne GF1 (« si
//                                nécessaire », spec §2). Elle NE couvre PAS les
//                                fins dégénérées (double forfait en GF → GFR
//                                cancelled ; GF en walkover → GFR walkover) :
//                                un GFR terminal-sans-jeu est donc OMIS de
//                                l'émission (review adversariale, prouvé par
//                                exécution).

import { Status } from 'brackets-model';
import type { Match, MatchGame, Participant, ParticipantResult, Stage } from 'brackets-model';

/** Sources publiques d'un côté de match (seed ou match amont — jamais de PII). */
export type PublicMatchSource =
  | { type: 'seed'; ref: number }
  | { type: 'winner_of'; ref: string }
  | { type: 'loser_of'; ref: string }
  | { type: 'bye'; ref: null };

/** Match tel que servi par l'API publique du bracket. */
export interface PublicBracketMatch {
  id: string;                               // clé moteur ("W1-1", "L2-3", "GF", "GFR")
  bracket: 'winners' | 'losers' | 'grand_final';
  round: number;
  slot: number;
  bo: number;
  teamA: string | null;                     // registrationId (public, pas un uid)
  teamB: string | null;
  voidA: boolean;
  voidB: boolean;
  teamAInfo: { name: string; tag: string; logoUrl: string | null } | null;
  teamBInfo: { name: string; tag: string; logoUrl: string | null } | null;
  sourceA?: PublicMatchSource;
  sourceB?: PublicMatchSource;
  status: string;                           // MatchStatus riche (jour de match inclus)
  winner: 'a' | 'b' | null;
  scores: { final: Array<{ a: number; b: number }> | null } | null;
  forfeit: { team: 'a' | 'b' | 'both' } | null;
  cast: { featured: boolean; streamUrl: string | null } | null;
}

/** Décorations hors modèle viewer, greffées sur le DOM après render. */
export interface MatchDecoration {
  /** Match en cours (live / saisie / vérification des scores). */
  live: boolean;
  /** Match casté : badge EN STREAM (+ lien si fourni). */
  stream: string | null;
  /** Hints de provenance des slots encore vides, dérivés de NOS sources
   *  (« Vainqueur demi WB 2 »). Appliqués uniquement sur un slot vide ou déjà
   *  en hint — jamais sur le nom d'une équipe réelle. */
  hints?: { side1?: string; side2?: string };
}

export interface AdaptedBracket {
  data: {
    stages: Stage[];
    matches: Match[];
    matchGames: MatchGame[];
    participants: Participant[];
  };
  /** Logos d'équipe pour bracketsViewer.setParticipantImages(). */
  images: Array<{ participantId: string; imageUrl: string }>;
  /** Par id de match moteur (data-match-id du DOM rendu). */
  decorations: Record<string, MatchDecoration>;
}

const GROUP_IDS = { winners: 1, losers: 2, grand_final: 3 } as const;

// Ids de ronde globalement croissants dans l'ordre winners → losers → GF :
// splitBy ordonne les clés numériques en croissant, l'ordre visuel en dépend.
function roundId(bracket: PublicBracketMatch['bracket'], round: number): number {
  if (bracket === 'winners') return round;
  if (bracket === 'losers') return 100 + round;
  return 200 + round;
}

/** Manches gagnées par camp, depuis les scores finaux (réels ou conventionnels). */
function gamesWon(final: Array<{ a: number; b: number }>): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of final) {
    if (g.a > g.b) a++;
    else if (g.b > g.a) b++;
  }
  return { a, b };
}

// Position d'origine au sens brackets-model : uniquement les seeds (préfixe
// « #n » du round 1 winners). Les provenances des autres slots passent par NOS
// hints (décorations) — donner une position aux drops ferait afficher au
// viewer des préfixes cryptiques (« P1 ») sur des équipes connues.
function positionOf(src: PublicMatchSource | undefined): number | undefined {
  return src?.type === 'seed' ? src.ref : undefined;
}

// Libellé français d'un match amont, calqué sur les étiquettes de cartes
// (FR_STRINGS du wrapper) : « finale WB », « demi WB 2 », « WB 1.3 »…
function matchLabel(ref: string, winnersRounds: number, losersRounds: number): string {
  if (ref === 'GF') return 'grande finale';
  const m = /^([WL])(\d+)-(\d+)$/.exec(ref);
  if (!m) return ref;
  const side = m[1] === 'W' ? 'WB' : 'LB';
  const round = Number(m[2]);
  const slot = Number(m[3]);
  const last = m[1] === 'W' ? winnersRounds : losersRounds;
  if (round === last) return `finale ${side}`;
  if (round === last - 1) return `demi ${side} ${slot}`;
  return `${side} ${round}.${slot}`;
}

// Hint de provenance d'un slot encore vide (« Vainqueur demi WB 2 »,
// « Perdant finale WB »…) — remplace les hints du viewer, qui sont incomplets
// (rien sur les rondes winners) et faux sur la grande finale (même clé i18n
// des deux côtés).
function sourceHint(
  src: PublicMatchSource | undefined,
  winnersRounds: number,
  losersRounds: number,
): string | undefined {
  if (!src || (src.type !== 'winner_of' && src.type !== 'loser_of')) return undefined;
  const prefix = src.type === 'winner_of' ? 'Vainqueur' : 'Perdant';
  return `${prefix} ${matchLabel(src.ref, winnersRounds, losersRounds)}`;
}

function viewerStatus(m: PublicBracketMatch): Status {
  switch (m.status) {
    case 'completed':
    case 'walkover':
      return Status.Completed;
    case 'cancelled':
      return Status.Locked;
    case 'live':
    case 'awaiting_scores':
    case 'score_review':
    case 'disputed':
    case 'awaiting_forfeit_validation':
      return Status.Running;
    default: {
      // pending / checkin / ready : dépend des côtés résolus (équipe présente
      // OU void — un void est « résolu », il ne viendra jamais personne).
      const aResolved = m.teamA !== null || m.voidA;
      const bResolved = m.teamB !== null || m.voidB;
      if (aResolved && bResolved) return Status.Ready;
      if (aResolved || bResolved) return Status.Waiting;
      return Status.Locked;
    }
  }
}

function opponentOf(m: PublicBracketMatch, side: 'a' | 'b'): ParticipantResult | null {
  const isVoid = side === 'a' ? m.voidA : m.voidB;
  if (isVoid) return null; // BYE

  const regId = side === 'a' ? m.teamA : m.teamB;
  const position = positionOf(side === 'a' ? m.sourceA : m.sourceB);
  if (!regId) {
    return position !== undefined ? { id: null, position } : { id: null };
  }

  const opp: ParticipantResult = { id: regId };
  if (position !== undefined) opp.position = position;

  const concluded = m.status === 'completed' || m.status === 'walkover';
  const final = m.scores?.final ?? null;
  if (m.status === 'completed' && final && final.length > 0) {
    const wins = gamesWon(final);
    opp.score = side === 'a' ? wins.a : wins.b;
  }
  if (concluded && m.winner) {
    opp.result = m.winner === side ? 'win' : 'loss';
  }
  if (m.forfeit && (m.forfeit.team === side || m.forfeit.team === 'both')) {
    opp.forfeit = true;
  }
  return opp;
}

/**
 * Convertit les matchs publics d'une compétition double élim en données
 * viewer + logos + décorations. Pur et déterministe : testé en Vitest sur du
 * vrai output moteur (generateDoubleElim → pureMatchToDoc → adapter).
 */
export function adaptBracketForViewer(input: PublicBracketMatch[]): AdaptedBracket {
  const matches = [...input]
    // Reset (GF round 2) terminal SANS jeu (annulé par double forfait en GF,
    // walkover d'une GF elle-même walkover…) : jamais affiché — la condition
    // de masquage du viewer ne couvre pas ces fins dégénérées.
    .filter(m => !(m.bracket === 'grand_final' && m.round === 2
      && (m.status === 'cancelled' || m.status === 'walkover')))
    .sort(
      (x, y) =>
        GROUP_IDS[x.bracket] - GROUP_IDS[y.bracket] ||
        x.round - y.round ||
        x.slot - y.slot,
    );

  const winnersR1 = matches.filter(m => m.bracket === 'winners' && m.round === 1);
  const size = winnersR1.length * 2;
  // Miroir de la garde de reconstructBracket : un jeu de docs incohérent doit
  // se voir (le wrapper catch → état d'erreur), pas se rendre à moitié faux.
  if (size < 4 || (size & (size - 1)) !== 0) {
    throw new Error(`Bracket incohérent : ${size} sièges round 1 (attendu puissance de 2 ≥ 4).`);
  }
  const winnersRounds = Math.log2(size);
  const losersRounds = 2 * (winnersRounds - 1);
  const hasReset = matches.some(m => m.bracket === 'grand_final' && m.round === 2);

  const participants: Participant[] = [];
  const images: AdaptedBracket['images'] = [];
  const seen = new Set<string>();
  const collect = (regId: string | null, info: PublicBracketMatch['teamAInfo']): void => {
    if (!regId || seen.has(regId)) return;
    seen.add(regId);
    participants.push({
      id: regId,
      tournament_id: 0,
      name: info?.name || info?.tag || 'Équipe',
    });
    if (info?.logoUrl) images.push({ participantId: regId, imageUrl: info.logoUrl });
  };

  const viewerMatches: Match[] = [];
  const decorations: AdaptedBracket['decorations'] = {};

  for (const m of matches) {
    collect(m.teamA, m.teamAInfo);
    collect(m.teamB, m.teamBInfo);

    viewerMatches.push({
      id: m.id,
      stage_id: 0,
      group_id: GROUP_IDS[m.bracket],
      round_id: roundId(m.bracket, m.round),
      // Dans le groupe finale, number===2 = consolante pour le viewer : GF et
      // reset restent en number 1 (nos slots valent déjà 1, on le force par
      // sécurité — le reset est distingué par sa ronde).
      number: m.bracket === 'grand_final' ? 1 : m.slot,
      child_count: m.bo,
      status: viewerStatus(m),
      opponent1: opponentOf(m, 'a'),
      opponent2: opponentOf(m, 'b'),
    });

    const live =
      m.status === 'live' || m.status === 'awaiting_scores' || m.status === 'score_review';
    const concluded =
      m.status === 'completed' || m.status === 'walkover' || m.status === 'cancelled';
    const stream = m.cast?.featured && !concluded ? (m.cast.streamUrl ?? '') : null;
    let hints: MatchDecoration['hints'];
    const hintA = !m.teamA && !m.voidA ? sourceHint(m.sourceA, winnersRounds, losersRounds) : undefined;
    const hintB = !m.teamB && !m.voidB ? sourceHint(m.sourceB, winnersRounds, losersRounds) : undefined;
    if (hintA || hintB) {
      hints = {};
      if (hintA) hints.side1 = hintA;
      if (hintB) hints.side2 = hintB;
    }
    if (live || stream !== null || hints) {
      decorations[m.id] = { live, stream, ...(hints ? { hints } : {}) };
    }
  }

  const stage: Stage = {
    id: 0,
    tournament_id: 0,
    name: '',
    type: 'double_elimination',
    number: 1,
    settings: {
      size,
      grandFinal: hasReset ? 'double' : 'simple',
      matchesChildCount: 0,
      skipFirstRound: false,
    },
  };

  return {
    data: { stages: [stage], matches: viewerMatches, matchGames: [], participants },
    images,
    decorations,
  };
}
