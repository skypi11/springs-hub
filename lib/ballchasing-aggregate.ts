// Agrégations de stats ballchasing, partagées entre :
// - le replay courant (ligne TEAM en bas de chaque table)
// - la moyenne du match (N replays d'un même event)
//
// Règle métier : les COUNTS se somment naturellement ; les RATES n'ont pas de
// sens en somme, donc toujours moyennés (sommer un BPM = absurde).

export interface PlayerStatsLite {
  name: string;
  platform: string;
  platformId: string;
  team: 'blue' | 'orange';
  // core
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  mvp: boolean;
  shootingPct?: number;
  shotsAgainst?: number;
  goalsAgainst?: number;
  boost?: {
    bpm: number; bcpm: number; avgAmount: number;
    amountCollected: number; amountStolen: number;
    amountCollectedBig: number; amountCollectedSmall: number;
    amountOverfill: number;
    timeZeroBoost: number; timeFullBoost: number;
    percentZeroBoost?: number; percentFullBoost?: number;
  };
  movement?: {
    avgSpeed: number; totalDistance: number;
    timeSupersonic: number; timeBoostSpeed: number; timeSlowSpeed: number;
    timeGround: number; timeLowAir: number; timeHighAir: number;
    powerslideCount: number; avgPowerslideDuration: number;
    percentSupersonic?: number; percentGround?: number;
  };
  positioning?: {
    avgDistanceToBall: number;
    avgDistanceToBallPossession: number;
    avgDistanceToBallNoPossession: number;
    timeDefensiveHalf: number; timeOffensiveHalf: number;
    timeBehindBall: number; timeInfrontBall: number;
    timeMostBack: number; timeMostForward: number;
    timeClosestToBall: number; timeFarthestFromBall: number;
    percentBehindBall?: number; percentDefensiveHalf?: number;
  };
  demo?: { inflicted: number; taken: number };
}

export type AggregationMode = 'sum' | 'mean';

// Moyenne ou somme d'un tableau de nombres. Pour `mean`, on ignore les NaN.
function reduce(values: number[], mode: AggregationMode): number {
  if (values.length === 0) return 0;
  const total = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  return mode === 'sum' ? total : total / values.length;
}
// Toujours moyenne (pour les rates), sum n'a pas de sens.
function meanOpt(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => typeof v === 'number');
  if (defined.length === 0) return undefined;
  return defined.reduce((s, v) => s + v, 0) / defined.length;
}
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Agrège un tableau de stats joueur en une seule entrée. `mode` ne s'applique
// qu'aux counts (goals, saves, score, shots, assists, demos).
// Tout le reste (rates, %, distance moyenne…) est toujours moyenné.
export function aggregatePlayers(
  entries: PlayerStatsLite[],
  mode: AggregationMode,
  fallbackTeam: 'blue' | 'orange' = 'blue',
): PlayerStatsLite {
  if (entries.length === 0) {
    return {
      name: '', platform: '', platformId: '', team: fallbackTeam,
      score: 0, goals: 0, assists: 0, saves: 0, shots: 0, mvp: false,
    };
  }

  const first = entries[0];
  const agg: PlayerStatsLite = {
    name: first.name,
    platform: first.platform,
    platformId: first.platformId,
    team: first.team,
    score: reduce(entries.map(p => p.score), mode),
    goals: reduce(entries.map(p => p.goals), mode),
    assists: reduce(entries.map(p => p.assists), mode),
    saves: reduce(entries.map(p => p.saves), mode),
    shots: reduce(entries.map(p => p.shots), mode),
    mvp: entries.some(p => p.mvp),
  };

  const shootingPct = meanOpt(entries.map(p => p.shootingPct));
  if (shootingPct !== undefined) agg.shootingPct = shootingPct;
  // shotsAgainst/goalsAgainst : counts → respectent le mode
  const sa = entries.map(p => p.shotsAgainst).filter((v): v is number => typeof v === 'number');
  if (sa.length > 0) agg.shotsAgainst = reduce(sa, mode);
  const ga = entries.map(p => p.goalsAgainst).filter((v): v is number => typeof v === 'number');
  if (ga.length > 0) agg.goalsAgainst = reduce(ga, mode);

  const boosts = entries.map(p => p.boost).filter((b): b is NonNullable<PlayerStatsLite['boost']> => !!b);
  if (boosts.length > 0) {
    agg.boost = {
      // Tous les boost.* sont des rates ou moyennes → toujours mean.
      bpm: mean(boosts.map(b => b.bpm)),
      bcpm: mean(boosts.map(b => b.bcpm)),
      avgAmount: mean(boosts.map(b => b.avgAmount)),
      // Counts → respectent le mode
      amountCollected: reduce(boosts.map(b => b.amountCollected), mode),
      amountStolen: reduce(boosts.map(b => b.amountStolen), mode),
      amountCollectedBig: reduce(boosts.map(b => b.amountCollectedBig), mode),
      amountCollectedSmall: reduce(boosts.map(b => b.amountCollectedSmall), mode),
      amountOverfill: reduce(boosts.map(b => b.amountOverfill), mode),
      timeZeroBoost: reduce(boosts.map(b => b.timeZeroBoost), mode),
      timeFullBoost: reduce(boosts.map(b => b.timeFullBoost), mode),
    };
    const pz = meanOpt(boosts.map(b => b.percentZeroBoost));
    if (pz !== undefined) agg.boost.percentZeroBoost = pz;
    const pf = meanOpt(boosts.map(b => b.percentFullBoost));
    if (pf !== undefined) agg.boost.percentFullBoost = pf;
  }

  const movements = entries.map(p => p.movement).filter((m): m is NonNullable<PlayerStatsLite['movement']> => !!m);
  if (movements.length > 0) {
    agg.movement = {
      avgSpeed: mean(movements.map(m => m.avgSpeed)),
      totalDistance: reduce(movements.map(m => m.totalDistance), mode),
      timeSupersonic: reduce(movements.map(m => m.timeSupersonic), mode),
      timeBoostSpeed: reduce(movements.map(m => m.timeBoostSpeed), mode),
      timeSlowSpeed: reduce(movements.map(m => m.timeSlowSpeed), mode),
      timeGround: reduce(movements.map(m => m.timeGround), mode),
      timeLowAir: reduce(movements.map(m => m.timeLowAir), mode),
      timeHighAir: reduce(movements.map(m => m.timeHighAir), mode),
      powerslideCount: reduce(movements.map(m => m.powerslideCount), mode),
      avgPowerslideDuration: mean(movements.map(m => m.avgPowerslideDuration)),
    };
    const ps = meanOpt(movements.map(m => m.percentSupersonic));
    if (ps !== undefined) agg.movement.percentSupersonic = ps;
    const pg = meanOpt(movements.map(m => m.percentGround));
    if (pg !== undefined) agg.movement.percentGround = pg;
  }

  const positions = entries.map(p => p.positioning).filter((p): p is NonNullable<PlayerStatsLite['positioning']> => !!p);
  if (positions.length > 0) {
    agg.positioning = {
      avgDistanceToBall: mean(positions.map(p => p.avgDistanceToBall)),
      avgDistanceToBallPossession: mean(positions.map(p => p.avgDistanceToBallPossession)),
      avgDistanceToBallNoPossession: mean(positions.map(p => p.avgDistanceToBallNoPossession)),
      timeDefensiveHalf: reduce(positions.map(p => p.timeDefensiveHalf), mode),
      timeOffensiveHalf: reduce(positions.map(p => p.timeOffensiveHalf), mode),
      timeBehindBall: reduce(positions.map(p => p.timeBehindBall), mode),
      timeInfrontBall: reduce(positions.map(p => p.timeInfrontBall), mode),
      timeMostBack: reduce(positions.map(p => p.timeMostBack), mode),
      timeMostForward: reduce(positions.map(p => p.timeMostForward), mode),
      timeClosestToBall: reduce(positions.map(p => p.timeClosestToBall), mode),
      timeFarthestFromBall: reduce(positions.map(p => p.timeFarthestFromBall), mode),
    };
    const pb = meanOpt(positions.map(p => p.percentBehindBall));
    if (pb !== undefined) agg.positioning.percentBehindBall = pb;
    const pd = meanOpt(positions.map(p => p.percentDefensiveHalf));
    if (pd !== undefined) agg.positioning.percentDefensiveHalf = pd;
  }

  const demos = entries.map(p => p.demo).filter((d): d is NonNullable<PlayerStatsLite['demo']> => !!d);
  if (demos.length > 0) {
    agg.demo = {
      inflicted: reduce(demos.map(d => d.inflicted), mode),
      taken: reduce(demos.map(d => d.taken), mode),
    };
  }

  return agg;
}

// Groupe N replays par joueur (clé = platform|platformId) puis agrège.
// Retourne 1 entrée par joueur unique, avec ses stats agrégées sur les N replays
// où il a participé.
export function aggregateByPlayer(
  allPlayers: PlayerStatsLite[],
  mode: AggregationMode,
): PlayerStatsLite[] {
  const groups = new Map<string, PlayerStatsLite[]>();
  for (const p of allPlayers) {
    const key = `${p.platform}|${p.platformId}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }
  return Array.from(groups.values()).map(entries =>
    aggregatePlayers(entries, mode, entries[0]?.team)
  );
}

// Agrège par équipe (Blue/Orange) en moyennant les joueurs de l'équipe.
// Utile pour la ligne TEAM en bas de chaque table.
export function aggregateByTeam(
  players: PlayerStatsLite[],
  mode: AggregationMode,
): { blue: PlayerStatsLite; orange: PlayerStatsLite } {
  const blues = players.filter(p => p.team === 'blue');
  const oranges = players.filter(p => p.team === 'orange');
  return {
    blue: { ...aggregatePlayers(blues, mode, 'blue'), name: 'ÉQUIPE BLUE' },
    orange: { ...aggregatePlayers(oranges, mode, 'orange'), name: 'ÉQUIPE ORANGE' },
  };
}
