// Tests du classement ROUND ROBIN (round-robin-standings.ts) : points,
// mini-championnat entre ex æquo (confrontation directe généralisée),
// égalités strictes → arbitrage admin, placements compressés multi-poules,
// résolutions admin — scénarios JOUÉS À LA MAIN, résultats attendus exacts.

import { describe, it, expect } from 'vitest';
import {
  generateRoundRobin,
  generateDoubleElim,
  advanceMatch,
  replaceTeam,
  withdrawTeam,
  computeRoundRobinStandings,
  computeRoundRobinPlacements,
  type Bracket,
  type BoConfig,
  type GameScore,
} from './index';

const BO: BoConfig = { default: 5, overrides: [], grandFinal: 5 };
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}

function gen(n: number, groups = 1): Bracket {
  return generateRoundRobin(teams(n), { bo: BO, forfeitScore: FORFEIT, groups });
}

/** Joue le match (winner, loser) : le vainqueur prend 3 manches
 *  `goalsPerWin`-0 ; le perdant `loserGames` manches 1-0. */
function play(b: Bracket, winner: string, loser: string, goalsPerWin = 1, loserGames = 0): Bracket {
  const id = b.order.find(mid => {
    const m = b.matches[mid];
    return (m.teamA === winner && m.teamB === loser) || (m.teamA === loser && m.teamB === winner);
  });
  if (!id) throw new Error(`Match introuvable : ${winner} vs ${loser}`);
  const side: 'a' | 'b' = b.matches[id].teamA === winner ? 'a' : 'b';
  const scores: GameScore[] = [];
  for (let g = 0; g < loserGames; g++) {
    scores.push(side === 'a' ? { a: 0, b: 1 } : { a: 1, b: 0 });
  }
  for (let g = 0; g < 3; g++) {
    scores.push(side === 'a' ? { a: goalsPerWin, b: 0 } : { a: 0, b: goalsPerWin });
  }
  return advanceMatch(b, id, { type: 'winner', winner: side, scores });
}

function row(rows: ReturnType<typeof computeRoundRobinStandings>, teamId: string) {
  const r = rows.find(x => x.teamId === teamId);
  if (!r) throw new Error(`Ligne absente : ${teamId}`);
  return r;
}

describe('computeRoundRobinStandings — poule unique', () => {
  it('classement net d\'une poule de 4 entièrement jouée', () => {
    let b = gen(4);
    b = play(b, 't1', 't2');
    b = play(b, 't1', 't3', 1, 1);
    b = play(b, 't1', 't4');
    b = play(b, 't2', 't3', 1, 2);
    b = play(b, 't2', 't4');
    b = play(b, 't3', 't4', 1, 1);

    const rows = computeRoundRobinStandings(b);
    expect(rows.map(r => r.teamId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows.every(r => !r.needsAdminTiebreak)).toBe(true);

    const t1 = row(rows, 't1');
    expect(t1).toMatchObject({ played: 3, wins: 3, losses: 0, points: 9, gamesWon: 9, gamesLost: 1 });
    const t4 = row(rows, 't4');
    expect(t4).toMatchObject({ played: 3, wins: 0, losses: 3, points: 0 });
  });

  it('mini-championnat : la confrontation directe passe devant une meilleure diff', () => {
    // Poule de 5 : t1 bat tout le monde. t2 et t3 finissent à 2V-6 pts tous
    // les deux ; t3 écrase ses victimes (diff bien meilleure) MAIS t2 a gagné
    // leur duel → t2 devant (le mini-championnat prime sur la diff).
    let b = gen(5);
    b = play(b, 't1', 't2');
    b = play(b, 't1', 't3');
    b = play(b, 't1', 't4');
    b = play(b, 't1', 't5');
    b = play(b, 't2', 't3');          // le duel décisif
    b = play(b, 't2', 't4');
    b = play(b, 't5', 't2');          // t2 : 2V
    b = play(b, 't3', 't4', 5);       // t3 écrase (diff +15)
    b = play(b, 't3', 't5', 5);       // t3 : 2V
    b = play(b, 't4', 't5');          // t4 : 1V, t5 : 1V

    const rows = computeRoundRobinStandings(b);
    expect(row(rows, 't2').points).toBe(6);
    expect(row(rows, 't3').points).toBe(6);
    expect(row(rows, 't3').goalDiff).toBeGreaterThan(row(rows, 't2').goalDiff);
    // Le h2h (mini-championnat à 2) place t2 devant malgré la diff de t3.
    expect(row(rows, 't2').rank).toBe(2);
    expect(row(rows, 't3').rank).toBe(3);
    // Même mécanique sur t4/t5 (1V chacun, t4 a gagné le duel).
    expect(row(rows, 't4').rank).toBe(4);
    expect(row(rows, 't5').rank).toBe(5);
    expect(rows.every(r => !r.needsAdminTiebreak)).toBe(true);
  });

  it('triangle parfait : égalité stricte → needsAdminTiebreak, ordre déterministe', () => {
    // t1 bat t2, t2 bat t3, t3 bat t1 (tous 3-0, 1 but par manche), et tous
    // battent t4 3-0 : stats STRICTEMENT identiques pour t1/t2/t3.
    let b = gen(4);
    b = play(b, 't1', 't2');
    b = play(b, 't2', 't3');
    b = play(b, 't3', 't1');
    b = play(b, 't1', 't4');
    b = play(b, 't2', 't4');
    b = play(b, 't3', 't4');

    const rows = computeRoundRobinStandings(b);
    const top3 = rows.slice(0, 3);
    expect(top3.every(r => r.points === 6)).toBe(true);
    expect(top3.every(r => r.needsAdminTiebreak)).toBe(true);
    expect(top3.map(r => r.teamId)).toEqual(['t1', 't2', 't3']); // stable par id
    expect(row(rows, 't4').needsAdminTiebreak).toBe(false);
    expect(row(rows, 't4').rank).toBe(4);
  });

  it('forfait simple : défaite comptée, score conventionnel dérivé du BO', () => {
    let b = gen(4);
    const id = b.order.find(mid => {
      const m = b.matches[mid];
      return (m.teamA === 't1' && m.teamB === 't2') || (m.teamA === 't2' && m.teamB === 't1');
    })!;
    const forfeitTeam: 'a' | 'b' = b.matches[id].teamA === 't2' ? 'a' : 'b';
    b = advanceMatch(b, id, { type: 'forfeit', team: forfeitTeam });

    const rows = computeRoundRobinStandings(b);
    expect(row(rows, 't1')).toMatchObject({ played: 1, wins: 1, points: 3, gamesWon: 3, gamesLost: 0, goalsFor: 3 });
    expect(row(rows, 't2')).toMatchObject({ played: 1, wins: 0, losses: 1, points: 0, gamesWon: 0, gamesLost: 3, goalsAgainst: 3 });
  });

  it('double forfait : défaite et manches concédées des deux côtés, zéro point', () => {
    let b = gen(4);
    b = advanceMatch(b, b.order[0], { type: 'forfeit', team: 'both' });
    const m = b.matches[b.order[0]];
    const rows = computeRoundRobinStandings(b);
    for (const teamId of [m.teamA!, m.teamB!]) {
      expect(row(rows, teamId)).toMatchObject({ played: 1, losses: 1, points: 0, gamesWon: 0, gamesLost: 3 });
    }
  });

  it('walkover (siège vidé) : pas un match joué — played n\'augmente pas', () => {
    let b = gen(4);
    b = replaceTeam(b, 't3', null);
    const rows = computeRoundRobinStandings(b);
    for (const teamId of ['t1', 't2', 't4']) {
      expect(row(rows, teamId).played).toBe(0);
    }
    // Le siège vidé n'apparaît pas au classement.
    expect(rows.find(r => r.teamId === 't3')).toBeUndefined();
  });

  it('refuse un bracket qui n\'est pas un round robin', () => {
    const elim = generateDoubleElim(teams(4), { bo: BO, forfeitScore: FORFEIT });
    expect(() => computeRoundRobinStandings(elim)).toThrow();
  });
});

describe('computeRoundRobinPlacements — compression 1→N', () => {
  it('placement null tant que la poule n\'est pas conclue, numéroté ensuite', () => {
    let b = gen(4);
    b = play(b, 't1', 't2');
    const partial = computeRoundRobinPlacements(b);
    expect(partial.every(p => p.placement === null)).toBe(true);

    b = play(b, 't1', 't3');
    b = play(b, 't1', 't4');
    b = play(b, 't2', 't3');
    b = play(b, 't2', 't4');
    b = play(b, 't3', 't4');
    const done = computeRoundRobinPlacements(b);
    expect(done.map(p => p.placement)).toEqual([1, 2, 3, 4]);
    expect(done.map(p => p.teamId)).toEqual(['t1', 't2', 't3', 't4']);
    expect(done.map(p => p.group)).toEqual(['rank1', 'rank2', 'rank3', 'rank4']);
  });

  it('multi-poules : rangs de poule fusionnés, départage per-match, compression exacte', () => {
    // 8 équipes, 2 poules serpentines : {t1,t4,t5,t8} et {t2,t3,t6,t7}.
    // Poule 1 jouée avec 2 buts par manche, poule 2 avec 1 but. Le départage
    // per-match suit les STATS réelles : les gros scores de la poule 1 dopent
    // la diff de ses VAINQUEURS (t1 +2/match > t2 +1, t4 devant t3) mais
    // creusent celle de ses PERDANTS (t5 −2/match < t6 −1, t8 −6 < t7 −3) —
    // le classement inter-poules n'est pas un « rang de poule aveugle ».
    let b = gen(8, 2);
    const pool1 = ['t1', 't4', 't5', 't8'];
    const pool2 = ['t2', 't3', 't6', 't7'];
    for (const pool of [pool1, pool2]) {
      const goals = pool === pool1 ? 2 : 1;
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          b = play(b, pool[i], pool[j], goals); // le mieux seedé gagne
        }
      }
    }
    const placements = computeRoundRobinPlacements(b);
    expect(placements.map(p => p.teamId)).toEqual(
      ['t1', 't2', 't4', 't3', 't6', 't5', 't7', 't8']);
    expect(placements.map(p => p.placement)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(placements.map(p => p.group)).toEqual(
      ['rank1', 'rank1', 'rank2', 'rank2', 'rank3', 'rank3', 'rank4', 'rank4']);
    expect(placements.every(p => !p.needsAdminTiebreak)).toBe(true);
  });

  it('égalité stricte inter-poules (pas de face-à-face possible) → arbitrage admin', () => {
    // Deux poules jouées à l'IDENTIQUE (mêmes scores) : les deux premiers ont
    // des per-match strictement égaux → flagués, en attente d'admin.
    let b = gen(8, 2);
    const pool1 = ['t1', 't4', 't5', 't8'];
    const pool2 = ['t2', 't3', 't6', 't7'];
    for (const pool of [pool1, pool2]) {
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          b = play(b, pool[i], pool[j]);
        }
      }
    }
    const placements = computeRoundRobinPlacements(b);
    const rank1 = placements.filter(p => p.group === 'rank1');
    expect(rank1.map(p => p.teamId).sort()).toEqual(['t1', 't2']);
    expect(rank1.every(p => p.needsAdminTiebreak)).toBe(true);

    // La résolution admin du groupe tranche — et n'est acceptée que si elle
    // couvre exactement le groupe.
    const resolved = computeRoundRobinPlacements(b, undefined, { rank1: ['t2', 't1'] });
    const r1 = resolved.filter(p => p.group === 'rank1');
    expect(r1.map(p => p.teamId)).toEqual(['t2', 't1']);
    expect(r1.every(p => !p.needsAdminTiebreak)).toBe(true);
    expect(r1.map(p => p.placement)).toEqual([1, 2]);

    const badSet = computeRoundRobinPlacements(b, undefined, { rank1: ['t2', 't9'] });
    expect(badSet.filter(p => p.group === 'rank1').every(p => p.needsAdminTiebreak)).toBe(true);
  });

  it('une résolution sans égalité à trancher est ignorée', () => {
    let b = gen(4);
    b = play(b, 't1', 't2');
    b = play(b, 't1', 't3');
    b = play(b, 't1', 't4');
    b = play(b, 't2', 't3');
    b = play(b, 't2', 't4');
    b = play(b, 't3', 't4');
    // Classement net — un « arbitrage » qui tenterait d'inverser est refusé.
    const placements = computeRoundRobinPlacements(b, undefined, { rank1: ['t1'] });
    expect(placements[0]).toMatchObject({ teamId: 't1', placement: 1, needsAdminTiebreak: false });
  });

  it('paquet intra-poule irrésolu : bloc entier au meilleur rang commun', () => {
    // Triangle parfait t1/t2/t3 + t4 dernier : le paquet {t1,t2,t3} occupe les
    // rangs 1-3 → groupe rank1 à 3 équipes, t4 seul en rank4.
    let b = gen(4);
    b = play(b, 't1', 't2');
    b = play(b, 't2', 't3');
    b = play(b, 't3', 't1');
    b = play(b, 't1', 't4');
    b = play(b, 't2', 't4');
    b = play(b, 't3', 't4');
    const placements = computeRoundRobinPlacements(b);
    expect(placements.filter(p => p.group === 'rank1')).toHaveLength(3);
    expect(placements.find(p => p.teamId === 't4')?.group).toBe('rank4');
    expect(placements.find(p => p.teamId === 't4')?.placement).toBe(4);
    // Résolution du paquet : ordre admin appliqué, places 1-3 nettes.
    const resolved = computeRoundRobinPlacements(b, undefined, { rank1: ['t3', 't1', 't2'] });
    expect(resolved.slice(0, 3).map(p => p.teamId)).toEqual(['t3', 't1', 't2']);
    expect(resolved.slice(0, 3).map(p => p.placement)).toEqual([1, 2, 3]);
  });
});

// ── Régressions de la review adversariale (23/07) ───────────────────────────

describe('régressions review — placements inter-poules', () => {
  it('R5-4 : une équipe retirée ne gagne JAMAIS un départage per-match (dénominateur réduit)', () => {
    // Poule 1 : t1 gagne 2 matchs puis est retirée (3 pts/match sur 2 matchs
    // comptés) ; poule 2 : t3 est 2e net à 2 pts/match sur 3 matchs. Sans la
    // garde, le retrait AVANTAGERAIT t1 au groupe rank2.
    let b = gen(8, 2); // poules {t1,t4,t5,t8} et {t2,t3,t6,t7}
    b = play(b, 't1', 't5');
    b = play(b, 't1', 't8');
    b = withdrawTeam(b, 't1'); // le match t1-t4 restant → forfait crédité à t4
    b = play(b, 't4', 't5');
    b = play(b, 't4', 't8');
    b = play(b, 't5', 't8');
    for (const [w, l] of [['t2', 't3'], ['t2', 't6'], ['t2', 't7'], ['t3', 't6'], ['t3', 't7'], ['t6', 't7']] as const) {
      b = play(b, w, l);
    }
    const placements = computeRoundRobinPlacements(b);
    const rank2 = placements.filter(p => p.group === 'rank2').map(p => p.teamId);
    expect(rank2).toContain('t1');
    expect(rank2).toContain('t3');
    // t3 (non retirée) passe DEVANT t1 (retirée) malgré le per-match de t1.
    expect(rank2.indexOf('t3')).toBeLessThan(rank2.indexOf('t1'));
  });

  it('un paquet multi-rang FUSIONNE avec les rangs couverts des autres poules (jamais de sur-classement structurel)', () => {
    // 10 équipes, 2 poules de 5 : {t1,t4,t5,t8,t9} et {t2,t3,t6,t7,t10}.
    // Poule 1 : t1 net 1er, triangle parfait t4/t5/t8 (rangs 2-4), t9 dernier.
    // Poule 2 : classement net. Les rangs 2/3/4 de la poule 2 doivent rejoindre
    // le groupe du paquet (plages chevauchantes) — pas rester structurellement
    // en dessous du dernier du paquet.
    let b = gen(10, 2);
    b = play(b, 't1', 't4');
    b = play(b, 't1', 't5');
    b = play(b, 't1', 't8');
    b = play(b, 't1', 't9');
    b = play(b, 't4', 't5');   // triangle parfait (mêmes scores 3-0, 1 but)
    b = play(b, 't5', 't8');
    b = play(b, 't8', 't4');
    b = play(b, 't4', 't9');
    b = play(b, 't5', 't9');
    b = play(b, 't8', 't9');
    for (const [w, l] of [['t2', 't3'], ['t2', 't6'], ['t2', 't7'], ['t2', 't10'], ['t3', 't6'], ['t3', 't7'], ['t3', 't10'], ['t6', 't7'], ['t6', 't10'], ['t7', 't10']] as const) {
      b = play(b, w, l);
    }
    const placements = computeRoundRobinPlacements(b);
    // Le paquet {t4,t5,t8} occupe les rangs 2-4 → le groupe fusionné rank2
    // inclut AUSSI t3 (2e), t6 (3e) et t7 (4e) de la poule 2.
    const rank2 = placements.filter(p => p.group === 'rank2').map(p => p.teamId);
    for (const t of ['t4', 't5', 't8', 't3', 't6', 't7']) {
      expect(rank2).toContain(t);
    }
    expect(placements.some(p => p.group === 'rank3' || p.group === 'rank4')).toBe(false);
    // Compression totale intacte : 10 places, rank5 = {t9, t10}.
    expect(placements).toHaveLength(10);
    expect(placements.filter(p => p.group === 'rank5').map(p => p.teamId).sort()).toEqual(['t10', 't9']);
  });
});
