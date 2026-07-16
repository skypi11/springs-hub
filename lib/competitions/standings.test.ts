import { describe, it, expect } from 'vitest';
import { computeCircuitStandings, type StandingTeam } from './standings';

const CONFIG = {
  competitionIds: ['q1', 'q2', 'q3', 'q4'],
  bestResultsCount: 3,
  lanTeamCount: 2,
  tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
};

function team(id: string, parts: Array<[string, number, number, number, number]>): StandingTeam {
  return {
    id,
    name: id.toUpperCase(),
    tag: id.slice(0, 3).toUpperCase(),
    participations: parts.map(([competitionId, placement, points, goalDiff, goalsFor]) => ({
      competitionId, placement, points, goalDiff, goalsFor,
    })),
  };
}

describe('computeCircuitStandings', () => {
  it('ne garde que les bestResultsCount meilleurs résultats (points)', () => {
    // 4 Qualifs : 40 + 34 + 30 + 3 → on ne compte que les 3 meilleurs = 104.
    const rows = computeCircuitStandings(CONFIG, [
      team('a', [['q1', 1, 40, 10, 20], ['q2', 2, 34, 8, 18], ['q3', 3, 30, 6, 16], ['q4', 30, 3, -5, 4]]),
    ]);
    expect(rows[0].totalPoints).toBe(104);
    expect(rows[0].countedCount).toBe(3);
    expect(rows[0].playedCount).toBe(4);
  });

  it('trie par points décroissants', () => {
    const rows = computeCircuitStandings(CONFIG, [
      team('low', [['q1', 8, 19, 1, 10]]),
      team('high', [['q1', 1, 40, 10, 20]]),
    ]);
    expect(rows.map(r => r.teamId)).toEqual(['high', 'low']);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it('départage à points égaux par meilleur placement du circuit', () => {
    // Même total (40) mais l'une a un 1er, l'autre un 2e comme meilleur.
    const rows = computeCircuitStandings(CONFIG, [
      team('second', [['q1', 3, 30, 5, 12], ['q2', 5, 10, 2, 8]]),   // total 40, best 3
      team('first', [['q1', 4, 26, 3, 10], ['q2', 6, 14, 1, 9]]),    // total 40, best 4
    ]);
    // second (meilleur placement 3) passe devant first (meilleur placement 4).
    expect(rows.map(r => r.teamId)).toEqual(['second', 'first']);
  });

  it('départage par délta cumulé quand points ET meilleur placement sont égaux', () => {
    const rows = computeCircuitStandings(CONFIG, [
      team('lowdiff', [['q1', 2, 34, 3, 12]]),
      team('highdiff', [['q1', 2, 34, 9, 18]]),
    ]);
    expect(rows.map(r => r.teamId)).toEqual(['highdiff', 'lowdiff']);
  });

  it('marque la cutline LAN sur les lanTeamCount premières', () => {
    const rows = computeCircuitStandings(CONFIG, [
      team('a', [['q1', 1, 40, 10, 20]]),
      team('b', [['q1', 2, 34, 8, 18]]),
      team('c', [['q1', 3, 30, 6, 16]]),
    ]);
    expect(rows.filter(r => r.qualifiedForLan).map(r => r.teamId)).toEqual(['a', 'b']);
    expect(rows[2].qualifiedForLan).toBe(false);
  });

  it('exclut les équipes sans participation', () => {
    const rows = computeCircuitStandings(CONFIG, [
      team('a', [['q1', 1, 40, 10, 20]]),
      { id: 'ghost', name: 'GHOST', tag: 'GHO', participations: [] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].teamId).toBe('a');
  });

  it('goalDiffCounted ne cumule que les résultats retenus', () => {
    const rows = computeCircuitStandings(CONFIG, [
      // 3 comptés (delta 10+8+6=24), le 4e (delta -5) est écarté.
      team('a', [['q1', 1, 40, 10, 20], ['q2', 2, 34, 8, 18], ['q3', 3, 30, 6, 16], ['q4', 30, 3, -5, 4]]),
    ]);
    expect(rows[0].goalDiffCounted).toBe(24);
  });

  it('est vide quand aucune équipe', () => {
    expect(computeCircuitStandings(CONFIG, [])).toEqual([]);
  });

  it('départage par le Qualif le plus récent quand points, placement et delta sont égaux', () => {
    // Même total (60), même meilleur placement (2), même delta compté (8) :
    // seul le placement au Qualif le plus récent (q4) départage.
    const rows = computeCircuitStandings(CONFIG, [
      team('recent', [['q1', 6, 34, 5, 12], ['q4', 2, 26, 3, 10]]),  // latest q4 → 2e
      team('old', [['q1', 2, 34, 5, 12], ['q4', 6, 26, 3, 10]]),     // latest q4 → 6e
    ]);
    expect(rows.map(r => r.teamId)).toEqual(['recent', 'old']);
  });

  it('exclut les participations rattachées à une compétition hors du circuit', () => {
    // La 2e participation référence 'q_extern' (absent de competitionIds) : elle
    // ne doit compter ni dans les points ni dans le delta.
    const rows = computeCircuitStandings(CONFIG, [
      team('a', [['q1', 1, 40, 10, 20], ['q_extern', 1, 40, 10, 20]]),
    ]);
    expect(rows[0].totalPoints).toBe(40);
    expect(rows[0].playedCount).toBe(1);
    expect(rows[0].goalDiffCounted).toBe(10);
  });

  it('gère un bestResultsCount supérieur au nombre de participations', () => {
    const rows = computeCircuitStandings(CONFIG, [
      team('solo', [['q1', 5, 24, 2, 9]]),   // bestResultsCount=3, une seule participation
    ]);
    expect(rows[0].countedCount).toBe(1);
    expect(rows[0].totalPoints).toBe(24);
  });

  it('retombe en ordre stable (nom) sans tiebreakers configurés', () => {
    const rows = computeCircuitStandings({ ...CONFIG, tieBreakers: [] }, [
      team('zeta', [['q1', 1, 40, 5, 12]]),
      team('alpha', [['q1', 1, 40, 5, 12]]),
    ]);
    expect(rows.map(r => r.teamId)).toEqual(['alpha', 'zeta']);
  });
});
