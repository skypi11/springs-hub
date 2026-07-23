// PROBE TEMPORAIRE — vérification adversariale du finding TOCTOU
// generate_next_round (console/route.ts l.623-694). À SUPPRIMER après exécution.
//
// Simule EXACTEMENT la séquence serveur au niveau pur + bracket-store :
//   1. lecture des matchs (l.631) → `stale` (comp.withdrawn = [] au moment T)
//   2. un withdraw_team concurrent COMMIT (applyEngineOp : comp.withdrawn += X,
//      cascade sur les docs EXISTANTS uniquement — la ronde N+1 n'existe pas)
//   3. la route appelle engine.generateNextRound(stale) — sans re-lecture
//   4. batch.set des nouveaux docs (l.679-690) — ils n'ont jamais été lus par
//      la tx du withdraw → AUCUN conflit Firestore, les deux commits passent
//   5. état persisté = docs ronde 1 (cascadés) ∪ docs ronde 2 (calculés SANS
//      le retrait) + comp.withdrawn = [X] → reconstruction

import { describe, it, expect } from 'vitest';
import {
  generateSwiss,
  generateSwissNextRound,
  canGenerateSwissRound,
  withdrawTeam,
  advanceMatch,
  type Bracket,
  type BoConfig,
  type GameScore,
} from './index';
import { materializeMatches, reconstructBracket } from '../competitions/bracket-store';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function sweep(winner: 'a' | 'b'): GameScore[] {
  return Array.from({ length: 3 }, () =>
    winner === 'a' ? { a: 1, b: 0 } : { a: 0, b: 1 });
}

function playAllPending(b: Bracket): Bracket {
  let next = b;
  for (const id of [...next.order]) {
    if (next.matches[id].status !== 'pending') continue;
    next = advanceMatch(next, id, { type: 'winner', winner: 'a', scores: sweep('a') });
  }
  return next;
}

const REGS = Object.fromEntries(
  ['t1', 't2', 't3', 't4', 't5'].map(t => [t, {
    display: { name: t.toUpperCase(), tag: t, logoUrl: null },
    rosterUids: [`uid_${t}`],
  }]),
);

/** Union persistée = docs de `base` (ids de base) + docs des newIds de `after`,
 *  reconstruite avec le withdrawn FRAIS — l'état Firestore post-course. */
function persistedReconstruction(base: Bracket, after: Bracket, withdrawnFresh: string[]): Bracket {
  const baseIds = [...base.order];
  const newIds = after.order.filter(id => !base.matches[id]);
  const baseDocs = materializeMatches({ competitionId: 'c1', bracket: base, matchIds: baseIds, registrations: REGS });
  const newDocs = materializeMatches({ competitionId: 'c1', bracket: after, matchIds: newIds, registrations: REGS });
  return reconstructBracket({
    withdrawn: withdrawnFresh,
    bo: BO,
    forfeitScore: FORFEIT,
    matches: [...baseDocs.matches, ...newDocs.matches].map(({ id, doc }) => ({ id, ...doc })),
    kind: 'swiss',
    swissRounds: base.swissRounds,
  });
}

describe('PROBE — TOCTOU generate_next_round vs withdraw concurrent', () => {
  it('n=5 : la ronde générée sur l\'état PÉRIMÉ donne le BYE (walkover points pleins) à l\'équipe retirée, et la reconstruction ne répare rien', () => {
    // Ronde 1 jouée (t1>t3, t2>t4, t5 bye).
    const stale = playAllPending(generateSwiss(['t1', 't2', 't3', 't4', 't5'], { bo: BO, forfeitScore: FORFEIT, rounds: 3 }));
    expect(canGenerateSwissRound(stale)).toBe(true);

    // La route : generateNextRound sur l'état lu — déterministe, trouvons le bye.
    const after = generateSwissNextRound(stale);
    const newIds = after.order.filter(id => !stale.matches[id]);
    const byeMatch = newIds.map(id => after.matches[id]).find(m => m.voidB);
    expect(byeMatch).toBeDefined(); // 5 actives (état périmé) → bye
    const X = byeMatch!.teamA!; // récipiendaire du bye ronde 2

    // Retrait CONCURRENT de X, commit entre la lecture et le batch : la
    // cascade withdrawTeam ne touche RIEN (ronde 1 100% terminale, la ronde 2
    // n'existe pas encore en docs).
    const fresh = withdrawTeam(stale, X);
    expect(Object.keys(fresh.matches).every(id => fresh.matches[id].status === stale.matches[id].status)).toBe(true);

    // Génération CORRECTE (état frais) : 4 actives → 2 matchs, AUCUN bye,
    // X absent — l'appariement diverge matériellement de ce qui a été écrit.
    const correct = generateSwissNextRound(fresh);
    const correctNewIds = correct.order.filter(id => !fresh.matches[id]);
    expect(correctNewIds.some(id => correct.matches[id].voidB)).toBe(false);
    expect(correctNewIds.some(id => correct.matches[id].teamA === X || correct.matches[id].teamB === X)).toBe(false);
    expect(correctNewIds.length).toBe(2);
    expect(newIds.length).toBe(3); // l'état périmé a écrit 3 docs (2 matchs + 1 bye)

    // Le bye écrit pour X est un WALKOVER terminal (victoire à points pleins).
    expect(byeMatch!.status).toBe('walkover');
    expect(byeMatch!.winner).toBe('a');

    // État persisté post-course (docs union + withdrawn frais) : la
    // reconstruction recopie les docs tels quels — le walkover de l'équipe
    // retirée SUBSISTE, rien ne le répare.
    const rec = persistedReconstruction(stale, after, [X]);
    expect(rec.withdrawn).toContain(X);
    const recBye = rec.matches[byeMatch!.id];
    expect(recBye.teamA).toBe(X);
    expect(recBye.status).toBe('walkover');
    expect(recBye.winner).toBe('a');
  });

  it('n=4 : l\'équipe retirée est APPARIÉE contre une vraie équipe — match pending fantôme que la reconstruction laisse pending (résolution manuelle obligatoire)', () => {
    const stale = playAllPending(generateSwiss(['t1', 't2', 't3', 't4'], { bo: BO, forfeitScore: FORFEIT, rounds: 3 }));
    expect(canGenerateSwissRound(stale)).toBe(true);

    // Retrait concurrent de t4 commit entre lecture et batch.
    const fresh = withdrawTeam(stale, 't4');

    // La route génère sur l'état PÉRIMÉ : t4 est appariée normalement.
    const after = generateSwissNextRound(stale);
    const newIds = after.order.filter(id => !stale.matches[id]);
    const ghost = newIds.map(id => after.matches[id]).find(m => m.teamA === 't4' || m.teamB === 't4');
    expect(ghost).toBeDefined();
    expect(ghost!.status).toBe('pending');

    // Génération correcte (3 actives) : t4 absente, 1 match + 1 bye.
    const correct = generateSwissNextRound(fresh);
    const correctNewIds = correct.order.filter(id => !fresh.matches[id]);
    expect(correctNewIds.some(id => correct.matches[id].teamA === 't4' || correct.matches[id].teamB === 't4')).toBe(false);

    // Reconstruction post-course : le match fantôme reste PENDING avec la
    // retirée assise dedans (withdrawn frais ou pas), et bloque la suite du
    // tournoi tant qu'un admin ne le forfait pas à la main.
    const rec = persistedReconstruction(stale, after, ['t4']);
    const recGhost = rec.matches[ghost!.id];
    expect(recGhost.status).toBe('pending');
    expect([recGhost.teamA, recGhost.teamB]).toContain('t4');
    expect(canGenerateSwissRound(rec)).toBe(false); // ronde « en cours » à cause du fantôme
  });
});
