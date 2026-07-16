import { describe, it, expect } from 'vitest';
import { Status } from 'brackets-model';
import {
  generateDoubleElim,
  generateSingleElim,
  advanceMatch,
  isTerminal,
  type Bracket,
  type BoConfig,
  type GameScore,
} from '@/lib/tournament';
import { pureMatchToDoc } from './bracket-store';
import {
  adaptBracketForViewer,
  type PublicBracketMatch,
} from './brackets-viewer-adapter';

// Config BO Legends (spec R5-3) — la même que bracket-store.test.ts.
const LEGENDS_BO: BoConfig = {
  default: 5,
  overrides: [
    { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
    { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
    { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
    { bracket: 'losers', roundsFromEnd: 2, bo: 7 },
  ],
  grandFinal: 7,
};
const FORFEIT = { games: 3, goalsPerGame: 1 };

function teams(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `reg${i + 1}`);
}

function gen(n: number): Bracket {
  return generateDoubleElim(teams(n), { bo: LEGENDS_BO, forfeitScore: FORFEIT });
}

// Sérialise un Bracket pur vers la shape publique de l'API /matches — même
// chemin que la prod (pureMatchToDoc), y compris les sources.
function publicDocs(bracket: Bracket): PublicBracketMatch[] {
  return bracket.order.map(id => {
    const m = bracket.matches[id];
    const info = (regId: string | null) =>
      regId
        ? {
            name: `Team ${regId}`,
            tag: regId.toUpperCase().slice(0, 4),
            logoUrl: regId === 'reg1' ? 'https://cdn.test/reg1.webp' : null,
          }
        : null;
    const doc = pureMatchToDoc('comp1', m, { a: info(m.teamA), b: info(m.teamB) });
    return { id, ...doc } as unknown as PublicBracketMatch;
  });
}

function winScores(bo: number): GameScore[] {
  return Array.from({ length: Math.ceil(bo / 2) }, () => ({ a: 1, b: 0 }));
}

/** Joue tout le bracket : le camp indiqué par `pick` gagne chaque match. */
function playAll(bracket: Bracket, pick: (id: string) => 'a' | 'b'): Bracket {
  let b = bracket;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of b.order) {
      const m = b.matches[id];
      if (!isTerminal(m) && m.teamA && m.teamB) {
        const winner = pick(id);
        const scores = winScores(m.bo).map(g => (winner === 'a' ? g : { a: g.b, b: g.a }));
        b = advanceMatch(b, id, { type: 'winner', winner, scores });
        progressed = true;
      }
    }
  }
  return b;
}

describe('adaptBracketForViewer — structure', () => {
  it('mappe groupes/rondes/numéros au format brackets-model (8 équipes)', () => {
    const out = adaptBracketForViewer(publicDocs(gen(8)));
    const [stage] = out.data.stages;
    expect(stage.type).toBe('double_elimination');
    expect(stage.settings.size).toBe(8);
    expect(stage.settings.grandFinal).toBe('double');

    const byGroup = (g: number) => out.data.matches.filter(m => m.group_id === g);
    expect(byGroup(1)).toHaveLength(7);   // winners : 4 + 2 + 1
    expect(byGroup(2)).toHaveLength(6);   // losers : 2 + 2 + 1 + 1
    expect(byGroup(3)).toHaveLength(2);   // GF + reset pré-créé

    // Le reset DOIT rester number 1 (number 2 = consolante pour le viewer).
    for (const m of byGroup(3)) expect(m.number).toBe(1);
    const roundIds = byGroup(3).map(m => m.round_id);
    expect(new Set(roundIds).size).toBe(2);

    // round_ids strictement croissants dans l'ordre winners → losers → GF
    // (splitBy ordonne les clés numériques en croissant).
    const ordered = out.data.matches.map(m => Number(m.round_id));
    const sorted = [...ordered].sort((a, b) => a - b);
    const groups = out.data.matches.map(m => Number(m.group_id));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    for (let i = 1; i < ordered.length; i++) {
      if (groups[i] === groups[i - 1]) expect(ordered[i]).toBeGreaterThanOrEqual(ordered[i - 1]);
    }
    expect(sorted[0]).toBeGreaterThan(0);
  });

  it('expose seeds en position, équipes prêtes en Ready, aval en Locked', () => {
    const out = adaptBracketForViewer(publicDocs(gen(8)));
    const w1 = out.data.matches.filter(m => m.group_id === 1 && Number(m.round_id) === 1);
    for (const m of w1) {
      expect(m.status).toBe(Status.Ready);
      expect(m.opponent1?.id).toBeTruthy();
      expect(typeof m.opponent1?.position).toBe('number');
      expect(typeof m.opponent2?.position).toBe('number');
    }
    // Les 8 seeds 1..8 couvrent exactement le round 1.
    const positions = w1.flatMap(m => [m.opponent1?.position, m.opponent2?.position]);
    expect([...positions].sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const w2 = out.data.matches.filter(m => m.group_id === 1 && Number(m.round_id) === 2);
    for (const m of w2) {
      expect(m.status).toBe(Status.Locked);
      expect(m.opponent1).toEqual(expect.objectContaining({ id: null }));
    }
  });

  it('produit participants uniques + images uniquement pour les logos présents', () => {
    const out = adaptBracketForViewer(publicDocs(gen(8)));
    expect(out.data.participants).toHaveLength(8);
    const ids = out.data.participants.map(p => p.id);
    expect(new Set(ids).size).toBe(8);
    expect(out.data.participants.every(p => p.name.startsWith('Team '))).toBe(true);
    expect(out.images).toEqual([{ participantId: 'reg1', imageUrl: 'https://cdn.test/reg1.webp' }]);
  });

  it('child_count = BO du match (BO7 relatif Legends inclus)', () => {
    const out = adaptBracketForViewer(publicDocs(gen(8)));
    const w1 = out.data.matches.find(m => m.group_id === 1 && Number(m.round_id) === 1);
    // Bracket de 8 : W1 est à 3 rondes de la fin → BO5 ; demi/finale → BO7.
    expect(w1?.child_count).toBe(5);
    const wf = out.data.matches.find(m => m.group_id === 1 && Number(m.round_id) === 3);
    expect(wf?.child_count).toBe(7);
    const gf = out.data.matches.find(m => m.group_id === 3);
    expect(gf?.child_count).toBe(7);
  });
});

describe('adaptBracketForViewer — byes et voids', () => {
  it('void = BYE (opponent null), walkover = Completed avec vainqueur sans score', () => {
    const out = adaptBracketForViewer(publicDocs(gen(6)));   // 6 équipes → bracket 8, 2 byes
    const walkovers = out.data.matches.filter(
      m => m.group_id === 1 && Number(m.round_id) === 1 && (m.opponent1 === null || m.opponent2 === null),
    );
    expect(walkovers.length).toBe(2);
    for (const m of walkovers) {
      expect(m.status).toBe(Status.Completed);
      const present = m.opponent1 ?? m.opponent2;
      expect(present?.result).toBe('win');
      expect(present?.score).toBeUndefined();   // un walkover n'a pas de score
    }
  });

  it('double void (losers creusé par les byes) = deux BYE, match verrouillé', () => {
    // 5 équipes → bracket 8 avec 3 byes : deux matchs W1 adjacents sont des
    // walkovers → leur match losers d'aval ne recevra jamais personne.
    const out = adaptBracketForViewer(publicDocs(gen(5)));
    const l1 = out.data.matches.filter(m => m.group_id === 2 && Number(m.round_id) === 101);
    const cancelled = l1.filter(m => m.opponent1 === null && m.opponent2 === null);
    expect(cancelled.length).toBeGreaterThan(0);
    for (const m of cancelled) expect(m.status).toBe(Status.Locked);
  });
});

describe('adaptBracketForViewer — résultats', () => {
  it('match joué : score = manches gagnées, result win/loss', () => {
    let b = gen(8);
    const w11 = b.matches['W1-1'];
    b = advanceMatch(b, 'W1-1', {
      type: 'winner',
      winner: 'a',
      scores: [{ a: 2, b: 1 }, { a: 0, b: 1 }, { a: 3, b: 0 }, { a: 1, b: 0 }],
    });
    expect(w11).toBeDefined();
    const out = adaptBracketForViewer(publicDocs(b));
    const m = out.data.matches.find(x => x.id === 'W1-1');
    expect(m?.status).toBe(Status.Completed);
    expect(m?.opponent1).toEqual(expect.objectContaining({ score: 3, result: 'win' }));
    expect(m?.opponent2).toEqual(expect.objectContaining({ score: 1, result: 'loss' }));
  });

  it('forfait simple : score conventionnel affiché + drapeau forfeit du bon côté', () => {
    let b = gen(8);
    b = advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'b' });
    const out = adaptBracketForViewer(publicDocs(b));
    const m = out.data.matches.find(x => x.id === 'W1-1');
    expect(m?.opponent1).toEqual(expect.objectContaining({ score: 3, result: 'win' }));
    expect(m?.opponent1?.forfeit).toBeUndefined();
    expect(m?.opponent2).toEqual(expect.objectContaining({ score: 0, result: 'loss', forfeit: true }));
  });

  it('double forfait : drapeau des deux côtés, aucun vainqueur', () => {
    let b = gen(8);
    b = advanceMatch(b, 'W1-1', { type: 'forfeit', team: 'both' });
    const out = adaptBracketForViewer(publicDocs(b));
    const m = out.data.matches.find(x => x.id === 'W1-1');
    expect(m?.opponent1?.forfeit).toBe(true);
    expect(m?.opponent2?.forfeit).toBe(true);
    expect(m?.opponent1?.result).toBeUndefined();
    expect(m?.opponent2?.result).toBeUndefined();
  });
});

describe('adaptBracketForViewer — grande finale et reset', () => {
  it('GF gagnée par le champion winners : reset annulé OMIS de l\'émission', () => {
    // Le côté A gagne partout → le champion winners (côté A de la GF par
    // construction) remporte GF1, le reset est annulé → jamais affiché.
    const b = playAll(gen(4), () => 'a');
    const out = adaptBracketForViewer(publicDocs(b));
    const gf = out.data.matches.find(x => x.id === 'GF');
    expect(gf?.opponent1?.result).toBe('win');
    expect(out.data.matches.find(x => x.id === 'GFR')).toBeUndefined();
    expect(out.data.stages[0].settings.grandFinal).toBe('simple');
  });

  it('double forfait en GF (R5-1) : pas de reset fantôme (la condition du viewer ne couvre pas ce cas)', () => {
    // Tout jouer sauf la GF, puis double forfait en GF : GF completed sans
    // result 'win' côté 1 → le viewer AFFICHERAIT le reset annulé si on
    // l'émettait (prouvé par exécution en review adversariale).
    let b = gen(4);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const id of b.order) {
        const m = b.matches[id];
        if (id !== 'GF' && id !== 'GFR' && !isTerminal(m) && m.teamA && m.teamB) {
          b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: winScores(m.bo) });
          progressed = true;
        }
      }
    }
    b = advanceMatch(b, 'GF', { type: 'forfeit', team: 'both' });
    const out = adaptBracketForViewer(publicDocs(b));
    const gf = out.data.matches.find(x => x.id === 'GF');
    expect(gf?.opponent1?.forfeit).toBe(true);
    expect(gf?.opponent1?.result).toBeUndefined();
    expect(out.data.matches.find(x => x.id === 'GFR')).toBeUndefined();
  });

  it('double forfait en finale WB : GF en walkover, pas de reset fantôme teamB vs BYE', () => {
    let b = gen(4);
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: winScores(b.matches['W1-1'].bo) });
    b = advanceMatch(b, 'W1-2', { type: 'winner', winner: 'a', scores: winScores(b.matches['W1-2'].bo) });
    b = advanceMatch(b, 'W2-1', { type: 'forfeit', team: 'both' });   // finale WB : les 2 éliminées
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const id of b.order) {
        const m = b.matches[id];
        if (!isTerminal(m) && m.teamA && m.teamB) {
          b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: winScores(m.bo) });
          progressed = true;
        }
      }
    }
    const out = adaptBracketForViewer(publicDocs(b));
    const gf = out.data.matches.find(x => x.id === 'GF');
    // GF gagnée par walkover côté losers (le côté winners n'existe plus).
    expect(gf?.opponent1).toBeNull();
    expect(gf?.opponent2?.result).toBe('win');
    expect(out.data.matches.find(x => x.id === 'GFR')).toBeUndefined();
  });

  it('docs incohérents (round 1 non puissance de 2) : erreur explicite, pas de rendu à moitié faux', () => {
    const docs = publicDocs(gen(8)).filter(d => d.id !== 'W1-2');
    expect(() => adaptBracketForViewer(docs)).toThrow(/Bracket incohérent/);
  });

  it('slots vides : hints de provenance dérivés des sources (WB, LB, GF)', () => {
    const out = adaptBracketForViewer(publicDocs(gen(8)));
    // GF : le viewer natif met « finale LB » des DEUX côtés — nos hints corrigent.
    expect(out.decorations['GF']?.hints).toEqual({
      side1: 'Vainqueur finale WB',
      side2: 'Vainqueur finale LB',
    });
    expect(out.decorations['W2-1']?.hints).toEqual({
      side1: 'Vainqueur WB 1.1',
      side2: 'Vainqueur WB 1.2',
    });
    expect(out.decorations['W3-1']?.hints).toEqual({
      side1: 'Vainqueur demi WB 1',
      side2: 'Vainqueur demi WB 2',
    });
    expect(out.decorations['L1-1']?.hints).toEqual({
      side1: 'Perdant WB 1.1',
      side2: 'Perdant WB 1.2',
    });
    // Une fois les équipes connues, plus de hint à réécrire.
    const done = adaptBracketForViewer(publicDocs(playAll(gen(8), () => 'a')));
    expect(done.decorations['GF']).toBeUndefined();
  });

  it('GF perdue par le champion winners : reset visible et peuplé', () => {
    // Tout le monde gagne côté A sauf la GF1 → bracket reset (R5).
    const b = playAll(gen(4), id => (id === 'GF' ? 'b' : 'a'));
    const out = adaptBracketForViewer(publicDocs(b));
    const gf = out.data.matches.find(x => x.id === 'GF');
    expect(gf?.opponent1?.result).toBe('loss');
    const gfr = out.data.matches.find(x => x.id === 'GFR');
    expect(gfr?.number).toBe(1);
    expect(gfr?.opponent1?.id).toBeTruthy();
    expect(gfr?.opponent2?.id).toBeTruthy();
    expect(gfr?.status).toBe(Status.Completed);
  });
});

describe('adaptBracketForViewer — statuts jour de match et décorations', () => {
  function withStatus(status: string, cast: PublicBracketMatch['cast'] = null): PublicBracketMatch[] {
    const docs = publicDocs(gen(4));
    return docs.map(d => (d.id === 'W1-1' ? { ...d, status, cast } : d));
  }

  it('statuts riches → Running/Ready, et décoration live posée', () => {
    for (const s of ['live', 'awaiting_scores', 'score_review'] as const) {
      const out = adaptBracketForViewer(withStatus(s));
      expect(out.data.matches.find(m => m.id === 'W1-1')?.status).toBe(Status.Running);
      expect(out.decorations['W1-1']).toEqual({ live: true, stream: null });
    }
    const disputed = adaptBracketForViewer(withStatus('disputed'));
    expect(disputed.data.matches.find(m => m.id === 'W1-1')?.status).toBe(Status.Running);
    const checkin = adaptBracketForViewer(withStatus('checkin'));
    expect(checkin.data.matches.find(m => m.id === 'W1-1')?.status).toBe(Status.Ready);
  });

  it('match casté non conclu → badge stream ; conclu → aucun badge', () => {
    const cast = { featured: true, streamUrl: 'https://twitch.tv/springs' };
    const out = adaptBracketForViewer(withStatus('pending', cast));
    expect(out.decorations['W1-1']).toEqual({ live: false, stream: 'https://twitch.tv/springs' });

    let b = gen(4);
    // Piège BO relatif : dans un bracket de 4, W1 est déjà en BO7 (R5-3).
    b = advanceMatch(b, 'W1-1', { type: 'winner', winner: 'a', scores: winScores(b.matches['W1-1'].bo) });
    const docs = publicDocs(b).map(d => (d.id === 'W1-1' ? { ...d, cast } : d));
    const done = adaptBracketForViewer(docs);
    expect(done.decorations['W1-1']).toBeUndefined();
  });
});

describe('adaptBracketForViewer — toutes tailles 4→32', () => {
  it.each([4, 5, 8, 13, 16, 20, 27, 32])('%i équipes : données cohérentes', n => {
    const bracket = gen(n);
    const out = adaptBracketForViewer(publicDocs(bracket));
    // Tous les matchs du moteur sont émis (le viewer gère l'affichage).
    expect(out.data.matches).toHaveLength(bracket.order.length);
    expect(out.data.participants).toHaveLength(n);
    // GF et reset : toujours number 1 (number 2 = consolante pour le viewer).
    for (const m of out.data.matches.filter(x => x.group_id === 3)) {
      expect(m.number).toBe(1);
    }
    // Statuts tous dans l'enum viewer.
    for (const m of out.data.matches) {
      expect([Status.Locked, Status.Waiting, Status.Ready, Status.Running, Status.Completed]).toContain(m.status);
    }
    expect(out.data.stages[0].settings.size).toBe(bracket.size);
    // Fin de tournoi : le champion (côté A gagne tout) a result=win en GF.
    const done = adaptBracketForViewer(publicDocs(playAll(bracket, () => 'a')));
    const gf = done.data.matches.find(m => m.id === 'GF');
    expect(gf?.opponent1?.result).toBe('win');
  });
});

describe('adaptBracketForViewer — invariants publics', () => {
  it("n'émet aucun uid/snowflake : ids = registrationId, rien d'autre", () => {
    const out = adaptBracketForViewer(publicDocs(playAll(gen(8), () => 'a')));
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/discord_\d/);
    for (const p of out.data.participants) {
      expect(String(p.id)).toMatch(/^reg\d+$/);
    }
  });
});

// ── Simple élimination ───────────────────────────────────────────────────────

const SINGLE_BO: BoConfig = { default: 5, overrides: [], grandFinal: 7 };
function genSingle(n: number, thirdPlace = false): Bracket {
  return generateSingleElim(teams(n), { bo: SINGLE_BO, forfeitScore: FORFEIT, thirdPlace });
}

describe('adaptBracketForViewer — simple élimination', () => {
  it('stage single_elimination inféré (pas de grande finale), arbre en groupe 1', () => {
    const out = adaptBracketForViewer(publicDocs(genSingle(8)));
    const [stage] = out.data.stages;
    expect(stage.type).toBe('single_elimination');
    expect(stage.settings.size).toBe(8);
    expect((stage.settings as { consolationFinal?: boolean }).consolationFinal).toBe(false);
    expect(out.data.matches).toHaveLength(7);
    expect(out.data.matches.every(m => m.group_id === 1)).toBe(true);
  });

  it('petite finale : groupe 2, consolationFinal true, number 1', () => {
    const out = adaptBracketForViewer(publicDocs(genSingle(8, true)));
    expect((out.data.stages[0].settings as { consolationFinal?: boolean }).consolationFinal).toBe(true);
    const p3 = out.data.matches.find(m => m.id === 'P3');
    expect(p3).toBeDefined();
    expect(p3!.group_id).toBe(2);
    expect(p3!.number).toBe(1);
    // Elle arrive APRÈS tout l'arbre (splitBy positionnel du viewer).
    const groups = out.data.matches.map(m => Number(m.group_id));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it('petite finale terminale sans jeu (walkover/annulée) : omise du rendu', () => {
    // Double forfait des deux demies → P3 annulée (personne à y envoyer).
    let b = genSingle(8, true);
    b = playRound1(b);
    b = advanceMatch(b, 'W2-1', { type: 'forfeit', team: 'both' });
    b = advanceMatch(b, 'W2-2', { type: 'forfeit', team: 'both' });
    const out = adaptBracketForViewer(publicDocs(b));
    expect(out.data.matches.find(m => m.id === 'P3')).toBeUndefined();
    expect((out.data.stages[0].settings as { consolationFinal?: boolean }).consolationFinal).toBe(false);
  });

  it('hints sans préfixe WB/LB : « Vainqueur demi 2 », « Perdant demi 1 » sur la petite finale', () => {
    let b = genSingle(8, true);
    b = playRound1(b);
    const out = adaptBracketForViewer(publicDocs(b));
    const final = out.decorations['W3-1'];
    expect(final?.hints?.side1).toBe('Vainqueur demi 1');
    expect(final?.hints?.side2).toBe('Vainqueur demi 2');
    const p3 = out.decorations['P3'];
    expect(p3?.hints?.side1).toBe('Perdant demi 1');
    expect(p3?.hints?.side2).toBe('Perdant demi 2');
  });

  it.each([4, 5, 11, 16, 23, 32])('%i équipes : données cohérentes, champion result=win en finale', n => {
    for (const thirdPlace of [false, true]) {
      const bracket = genSingle(n, thirdPlace);
      const out = adaptBracketForViewer(publicDocs(bracket));
      expect(out.data.participants).toHaveLength(n);
      for (const m of out.data.matches) {
        expect([Status.Locked, Status.Waiting, Status.Ready, Status.Running, Status.Completed]).toContain(m.status);
      }
      const done = playAll(bracket, () => 'a');
      const outDone = adaptBracketForViewer(publicDocs(done));
      const final = outDone.data.matches.find(m => m.id === `W${bracket.winnersRounds}-1`);
      expect(final?.opponent1?.result).toBe('win');
      const json = JSON.stringify(outDone);
      expect(json).not.toMatch(/discord_\d/);
    }
  });
});

/** Joue toutes les rencontres jouables du round 1 (camp A gagne). */
function playRound1(bracket: Bracket): Bracket {
  let b = bracket;
  for (const id of b.order) {
    const m = b.matches[id];
    if (m.round === 1 && m.bracket === 'winners' && !isTerminal(m) && m.teamA && m.teamB) {
      b = advanceMatch(b, id, { type: 'winner', winner: 'a', scores: winScores(m.bo) });
    }
  }
  return b;
}
