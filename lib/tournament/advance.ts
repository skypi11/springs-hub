// Progression du bracket : résolution des matchs, propagation, forfaits,
// retraits et remplacements (archi §3, décisions R5). PUR : chaque fonction
// retourne un NOUVEAU bracket (clone profond), l'original n'est jamais muté.
//
// Invariant central : un match se résout quand ses deux côtés sont FIXÉS —
// équipe présente, ou « void » (côté qui ne recevra jamais d'équipe). La
// propagation transporte équipes ET voids : byes, doubles forfaits et slots
// vides suivent le même chemin que les victoires.

import type { Bracket, GameScore, MatchOutcome, PureMatch } from './types';

function clone(bracket: Bracket): Bracket {
  return structuredClone(bracket);
}

function gamesToWin(bo: number): number {
  return Math.ceil(bo / 2);
}

/** Score conventionnel d'un forfait, dérivé du BO du match (spec §11 :
 *  3 manches 1-0 en BO5, 4 en BO7 — `goalsPerGame` vient de la config). */
export function forfeitScores(bracket: Bracket, bo: number, winner: 'a' | 'b'): GameScore[] {
  const games = gamesToWin(bo);
  const g = bracket.forfeitScore.goalsPerGame;
  return Array.from({ length: games }, () =>
    winner === 'a' ? { a: g, b: 0 } : { a: 0, b: g });
}

// ── Propagation ─────────────────────────────────────────────────────────────

/** Matchs aval qui consomment le résultat de `matchId`. */
function consumers(bracket: Bracket, matchId: string): Array<{ match: PureMatch; side: 'a' | 'b'; kind: 'winner_of' | 'loser_of' }> {
  const out: Array<{ match: PureMatch; side: 'a' | 'b'; kind: 'winner_of' | 'loser_of' }> = [];
  for (const id of bracket.order) {
    const m = bracket.matches[id];
    for (const side of ['a', 'b'] as const) {
      const src = side === 'a' ? m.sourceA : m.sourceB;
      if ((src.type === 'winner_of' || src.type === 'loser_of') && src.ref === matchId) {
        out.push({ match: m, side, kind: src.type });
      }
    }
  }
  return out;
}

function setSide(m: PureMatch, side: 'a' | 'b', teamId: string | null): void {
  if (side === 'a') {
    if (teamId === null) m.voidA = true; else m.teamA = teamId;
  } else {
    if (teamId === null) m.voidB = true; else m.teamB = teamId;
  }
}

/** Résultat propagé d'un match terminal : équipe (ou null=void) pour chaque débouché. */
function outputsOf(m: PureMatch): { winner: string | null; loser: string | null } {
  if (m.status === 'cancelled') return { winner: null, loser: null };
  if (m.forfeit === 'both') return { winner: null, loser: null }; // R5-1 : les deux éliminées
  if (m.status === 'walkover') {
    const w = m.winner === 'a' ? m.teamA : m.winner === 'b' ? m.teamB : null;
    return { winner: w, loser: null }; // le côté void ne descend nulle part
  }
  // completed
  const w = m.winner === 'a' ? m.teamA : m.teamB;
  const l = m.winner === 'a' ? m.teamB : m.teamA;
  return { winner: w, loser: l };
}

function isTerminal(m: PureMatch): boolean {
  return m.status === 'completed' || m.status === 'walkover' || m.status === 'cancelled';
}

/** Propage le résultat d'un match terminal vers ses consommateurs, puis tente
 *  de résoudre ceux-ci (walkovers en cascade). */
function propagate(bracket: Bracket, matchId: string): void {
  const m = bracket.matches[matchId];
  if (!isTerminal(m)) return;

  // Reset de grande finale : pré-créé, annulé si le champion winners (côté A
  // de la GF par construction) remporte la GF1 — y compris par walkover.
  if (m.id === 'GF') {
    const reset = bracket.matches['GFR'];
    if (reset && !isTerminal(reset) && m.winner === 'a') {
      reset.status = 'cancelled';
      reset.voidA = true;
      reset.voidB = true;
    }
  }

  const { winner, loser } = outputsOf(m);
  for (const c of consumers(bracket, matchId)) {
    if (isTerminal(c.match)) continue;
    const value = c.kind === 'winner_of' ? winner : loser;
    setSide(c.match, c.side, value);
    tryResolve(bracket, c.match.id);
  }
}

/** Résout un match dont les deux côtés sont fixés : walkover si un côté est
 *  void, annulation si les deux le sont, forfait conventionnel automatique si
 *  un camp est retiré du tournoi (cascade R5-4). */
function tryResolve(bracket: Bracket, matchId: string): void {
  const m = bracket.matches[matchId];
  if (isTerminal(m)) return;

  const aFixed = m.teamA !== null || m.voidA;
  const bFixed = m.teamB !== null || m.voidB;
  if (!aFixed || !bFixed) return;

  if (m.voidA && m.voidB) {
    m.status = 'cancelled';
    propagate(bracket, m.id);
    return;
  }
  if (m.voidA || m.voidB) {
    // Walkover : pas un match joué — aucun score conventionnel, aucune stat
    // (le délta est normalisé par match réellement joué, archi §3).
    m.status = 'walkover';
    m.winner = m.voidA ? 'b' : 'a';
    propagate(bracket, m.id);
    return;
  }

  // Cascade de retrait (R5-4) : l'adversaire gagne par forfait conventionnel
  // compté ; le délta du retiré est figé (ses stats ne comptent pas).
  const aWithdrawn = bracket.withdrawn.includes(m.teamA!);
  const bWithdrawn = bracket.withdrawn.includes(m.teamB!);
  if (aWithdrawn && bWithdrawn) {
    m.status = 'completed';
    m.forfeit = 'both';
    m.winner = null;
    m.statsCountA = false;
    m.statsCountB = false;
    propagate(bracket, m.id);
    return;
  }
  if (aWithdrawn || bWithdrawn) {
    const winnerSide: 'a' | 'b' = aWithdrawn ? 'b' : 'a';
    m.status = 'completed';
    m.forfeit = aWithdrawn ? 'a' : 'b';
    m.winner = winnerSide;
    m.scores = forfeitScores(bracket, m.bo, winnerSide);
    m.statsCountA = !aWithdrawn;
    m.statsCountB = !bWithdrawn;
    propagate(bracket, m.id);
    return;
  }
  // Deux équipes présentes : le match attend son résultat (advanceMatch).
}

/** Résolution initiale post-génération (byes de seeding). Interne à generate. */
export function resolveInitialVoids(bracket: Bracket): void {
  for (const id of bracket.order) {
    tryResolve(bracket, id);
  }
}

// ── Progression ─────────────────────────────────────────────────────────────

/**
 * Applique le résultat d'un match : victoire avec scores réels, forfait simple
 * (score conventionnel compté des deux côtés, le forfaitaire descend chez les
 * losers comme une défaite normale — la disqualification totale est
 * `withdrawTeam`), ou double forfait (R5-1 : les deux éliminées, délta
 * conventionnel négatif chacune, walkover pour l'adversaire d'aval).
 */
export function advanceMatch(bracket: Bracket, matchId: string, outcome: MatchOutcome): Bracket {
  const next = clone(bracket);
  const m = next.matches[matchId];
  if (!m) throw new Error(`Match inconnu : ${matchId}.`);
  if (isTerminal(m)) throw new Error(`Match déjà terminé : ${matchId}.`);
  if (m.teamA === null || m.teamB === null) {
    throw new Error(`Match incomplet (équipes non déterminées) : ${matchId}.`);
  }

  if (outcome.type === 'winner') {
    validateScores(outcome.scores, outcome.winner, m.bo, matchId);
    m.status = 'completed';
    m.winner = outcome.winner;
    m.scores = outcome.scores.map(s => ({ ...s }));
    m.statsCountA = true;
    m.statsCountB = true;
  } else if (outcome.team === 'both') {
    m.status = 'completed';
    m.forfeit = 'both';
    m.winner = null;
    m.scores = null;
    m.statsCountA = true;   // R5-1 : délta conventionnel négatif pour chacune
    m.statsCountB = true;
  } else {
    const winnerSide: 'a' | 'b' = outcome.team === 'a' ? 'b' : 'a';
    m.status = 'completed';
    m.forfeit = outcome.team;
    m.winner = winnerSide;
    m.scores = forfeitScores(next, m.bo, winnerSide);
    m.statsCountA = true;   // spec §11 : le forfait compte des deux côtés
    m.statsCountB = true;
  }

  propagate(next, matchId);
  return next;
}

function validateScores(scores: GameScore[], winner: 'a' | 'b', bo: number, matchId: string): void {
  const needed = gamesToWin(bo);
  let winsA = 0;
  let winsB = 0;
  for (const [i, s] of scores.entries()) {
    if (!Number.isInteger(s.a) || !Number.isInteger(s.b) || s.a < 0 || s.b < 0) {
      throw new Error(`Scores invalides (${matchId}, manche ${i + 1}).`);
    }
    if (s.a === s.b) {
      throw new Error(`Manche sans vainqueur (${matchId}, manche ${i + 1}) — pas d'égalité en Rocket League.`);
    }
    if (winsA >= needed || winsB >= needed) {
      throw new Error(`Manche jouée après la décision (${matchId}, manche ${i + 1}).`);
    }
    if (s.a > s.b) winsA += 1; else winsB += 1;
  }
  const winnerWins = winner === 'a' ? winsA : winsB;
  const loserWins = winner === 'a' ? winsB : winsA;
  if (winnerWins !== needed || loserWins >= needed) {
    throw new Error(`Le score ne donne pas la victoire annoncée (${matchId} : ${winsA}-${winsB} en BO${bo}).`);
  }
}

// ── Retrait & remplacement ──────────────────────────────────────────────────

/**
 * Disqualification / abandon en cours de tournoi (R5-4) : tous les matchs
 * restants de l'équipe deviennent des forfaits conventionnels en cascade
 * (l'adversaire est crédité, le délta du retiré est figé), son placement se
 * fige au groupe atteint. Idempotent.
 */
export function withdrawTeam(bracket: Bracket, teamId: string): Bracket {
  if (!bracket.teams.includes(teamId)) throw new Error(`Équipe inconnue : ${teamId}.`);
  const next = clone(bracket);
  if (!next.withdrawn.includes(teamId)) next.withdrawn.push(teamId);

  // Re-résout les matchs en attente où l'équipe figure déjà ; les matchs où
  // elle arriverait plus tard se résoudront à l'arrivée (flag permanent).
  // La cascade (forfait → descente losers → forfait) converge en ≤ 2 tours.
  for (let guard = 0; guard < 4; guard++) {
    let touched = false;
    for (const id of next.order) {
      const m = next.matches[id];
      if (isTerminal(m)) continue;
      if (m.teamA === teamId || m.teamB === teamId) {
        const before = m.status;
        tryResolve(next, id);
        if (next.matches[id].status !== before) touched = true;
      }
    }
    if (!touched) break;
  }
  return next;
}

/**
 * Remplacement avant le début du tournoi (spec §8 : promotion waitlist avant
 * le round 1). Autorisé tant que l'équipe sortante n'a joué AUCUN match réel
 * (les walkovers de bye ne comptent pas). `newTeamId: null` = personne en
 * waitlist : le slot devient un bye — l'adversaire avance sans score
 * conventionnel (sinon iniquité au départage, archi §3).
 */
export function replaceTeam(bracket: Bracket, oldTeamId: string, newTeamId: string | null): Bracket {
  const seatIndex = bracket.teams.indexOf(oldTeamId);
  if (seatIndex === -1) throw new Error(`Équipe inconnue : ${oldTeamId}.`);
  if (newTeamId !== null && bracket.teams.includes(newTeamId)) {
    throw new Error(`${newTeamId} est déjà dans le bracket.`);
  }
  const played = bracket.order.some(id => {
    const m = bracket.matches[id];
    return m.status === 'completed' && (m.teamA === oldTeamId || m.teamB === oldTeamId);
  });
  if (played) {
    throw new Error(`${oldTeamId} a déjà joué : remplacement impossible (utiliser withdrawTeam).`);
  }

  const next = clone(bracket);
  if (newTeamId === null) {
    next.teams[seatIndex] = '';
  } else {
    next.teams[seatIndex] = newTeamId;
  }

  for (const id of next.order) {
    const m = next.matches[id];
    let changed = false;
    if (m.teamA === oldTeamId) {
      m.teamA = newTeamId;
      if (newTeamId === null) { m.voidA = true; }
      changed = true;
    }
    if (m.teamB === oldTeamId) {
      m.teamB = newTeamId;
      if (newTeamId === null) { m.voidB = true; }
      changed = true;
    }
    if (changed && newTeamId === null && m.status === 'walkover') {
      // L'équipe retirée avait avancé par bye : le walkover amont reste
      // terminal, la place devient void en aval — déjà couvert par les
      // affectations ci-dessus (le match aval se re-résout ci-dessous).
    }
  }
  // Re-résolution : les matchs dont un côté vient de devenir void basculent
  // en walkover/cancelled et propagent.
  for (const id of next.order) tryResolve(next, id);
  return next;
}

export { isTerminal };
