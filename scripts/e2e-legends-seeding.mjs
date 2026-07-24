// E2E SEEDING MMR / CIRCUIT (design docs/registry-formats-design.md §10) :
// - seed_by 'mmr' : ordre par compo la plus forte (computed.worstLineupAvg) ;
// - seed_by 'circuit' : classées du circuit d'abord, puis les autres par MMR ;
// - reorder manuel par-dessus ; publish ;
// - transfert multi-étapes reseed 'mmr' : qualifiées AU CLASSEMENT, re-seedées
//   par MMR (demies 1v4 / 2v3 sur l'ordre MMR, pas l'ordre sportif).
// Données préfixées e2e-seeding*, cleanup TOUJOURS en finally (DB partagée).
// Run : node --env-file=.env.local scripts/e2e-legends-seeding.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const COMP = 'e2e-seeding';
const CIRCUIT = 'e2e-seeding-circuit';
const OLD_COMP = 'e2e-seeding-old';
const ADMIN = 'discord_e2e_seed_admin';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function tokenFor(uid) {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
  return json.idToken;
}

function makeApi(token) {
  return async (method, path, body, { expectStatus = 200 } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    if (res.status !== expectStatus) {
      throw new Error(`${method} ${path} → ${res.status} (attendu ${expectStatus}) ${JSON.stringify(json)?.slice(0, 300)}`);
    }
    return json;
  };
}

async function purge() {
  const ms = await db.collection('competition_matches').where('competitionId', '==', COMP).get();
  for (const d of ms.docs) {
    const priv = await d.ref.collection('private').get();
    for (const p of priv.docs) await p.ref.delete();
    await d.ref.delete();
  }
  const regs = await db.collection('competition_registrations').where('competitionId', '==', COMP).get();
  for (const d of regs.docs) await d.ref.delete();
  await db.collection('competitions').doc(COMP).delete();
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get();
  for (const d of notifs.docs) await d.ref.delete();
  const cts = await db.collection('circuit_teams').where('circuitId', '==', CIRCUIT).get();
  for (const d of cts.docs) await d.ref.delete();
  await db.collection('circuits').doc(CIRCUIT).delete();
}

const RR_FORMAT = {
  kind: 'round_robin', maxTeams: 8, groupCount: 2, doubleRound: false,
  points: { win: 3, draw: 1, loss: 0 },
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false, thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};
const SE_FORMAT = {
  kind: 'single_elim', maxTeams: 4, thirdPlace: true,
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};

const regId = i => `${COMP}_team${i}`;
const numOf = rid => Number(String(rid).split('team')[1]);
// MMR CROISSANT avec le numéro : t8 = la plus forte compo (1400), t1 = 1050 —
// l'inverse du classement sportif (t1 gagne tout), pour distinguer les ordres.
const mmrOf = i => 1000 + i * 50;

function gamesFor(winnerNum, winnerSide) {
  const total = 20 - winnerNum;
  const per = [Math.ceil(total / 3), Math.floor(total / 3), total - Math.ceil(total / 3) - Math.floor(total / 3)];
  return per.map(g => (winnerSide === 'a' ? { a: g, b: 0 } : { a: 0, b: g }));
}

async function playAllPending(api) {
  for (let guard = 0; guard < 10; guard++) {
    const state = await api('GET', `/api/admin/competitions/${COMP}/console`);
    const playable = state.matches.filter(m =>
      m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB);
    if (playable.length === 0) return state;
    await api('POST', `/api/admin/competitions/${COMP}/console`, {
      action: 'launch_phase', matchIds: playable.map(m => m.id),
    });
    for (const m of playable) {
      const a = numOf(m.teamA);
      const b = numOf(m.teamB);
      await api('POST', `/api/admin/competitions/${COMP}/console`, {
        action: 'force_score', matchId: m.id, games: gamesFor(Math.min(a, b), a < b ? 'a' : 'b'),
      });
    }
  }
  throw new Error('playAllPending : garde de boucle atteinte');
}

async function main() {
  console.log('Purge préalable…');
  await purge();

  await db.collection('users').doc(ADMIN).set({
    uid: ADMIN, displayName: 'E2E Seeding Admin', discordUsername: 'e2e_seed_admin',
    discordId: '999999999999999961', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN).set({ addedBy: 'e2e-seeding', addedAt: FieldValue.serverTimestamp() });
  const api = makeApi(await tokenFor(ADMIN));

  try {
    // ── Seed : circuit minimal (4 classées) + compét 2 étapes reseed MMR ──
    console.log('\n[1] Seed circuit + compétition…');
    await db.collection('circuits').doc(CIRCUIT).set({
      name: 'E2E Seeding Circuit', game: 'rocket_league',
      competitionIds: [OLD_COMP],
      pointsScale: { 1: 10, 2: 8, 3: 6, 4: 4 },
      bestResultsCount: 1, lanTeamCount: 2,
      tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
      status: 'draft', createdAt: Timestamp.now(),
    });
    // ct1..ct4 classées 1..4 sur l'ancien Qualif — rattachées à t5..t8 (les
    // plus faibles sportivement : l'ordre circuit ≠ l'ordre MMR ≠ le sportif).
    const ctBatch = db.batch();
    for (let k = 1; k <= 4; k++) {
      ctBatch.set(db.collection('circuit_teams').doc(`${CIRCUIT}-ct${k}`), {
        circuitId: CIRCUIT, name: `Seed Team ${k + 4}`, tag: `SD${k + 4}`,
        participations: [{ competitionId: OLD_COMP, registrationId: `${OLD_COMP}_x${k}`, placement: k, points: 12 - 2 * k, goalDiff: 5 - k, goalsFor: 10 - k }],
      });
    }
    await ctBatch.commit();

    await db.collection('competitions').doc(COMP).set({
      name: 'E2E — Seeding MMR/circuit',
      game: 'rocket_league', circuitId: CIRCUIT,
      format: RR_FORMAT,
      stages: [
        { kind: 'round_robin', format: RR_FORMAT, name: 'Poules', transfer: { advanceCount: 4, reseed: 'mmr' } },
        { kind: 'single_elim', format: SE_FORMAT, name: 'Phase finale' },
      ],
      eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: { opensAt: Timestamp.fromDate(new Date('2026-07-01')), closesAt: Timestamp.fromDate(new Date('2026-08-20')), waitlist: true },
      schedule: {
        days: [{ date: '2026-08-22', startsAt: '15:00', endsAt: '22:00' }],
        phasePlan: [1, 2, 3].map(d => ({ phase: d, day: 1, label: `J${d}`, rounds: [{ bracket: 'round_robin', round: d }] })),
        generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
      },
      discord: null, status: 'draft', isDev: true, approvedCount: 8, createdAt: Timestamp.now(),
    });
    const batch = db.batch();
    for (let i = 1; i <= 8; i++) {
      batch.set(db.collection('competition_registrations').doc(regId(i)), {
        competitionId: COMP, structureId: 'e2e-seed-struct', teamId: `e2e-seed-t${i}`,
        name: `Seed Team ${i}`, tag: `SD${i}`, logoUrl: null,
        captainUid: `discord_e2e_seed_cap${i}`,
        rosterUids: [`discord_e2e_seed_cap${i}`, `discord_e2e_seed_p${i}b`, `discord_e2e_seed_p${i}c`],
        roster: [1, 2, 3].map(k => ({ uid: `discord_e2e_seed_p${i}${k}`, refMmr: mmrOf(i) - 10 * k })),
        computed: { worstLineupAvg: mmrOf(i), worstLineupGap: 40, flags: [] },
        // t5..t8 rattachées au circuit (ct1..ct4, classées 1..4).
        circuitTeamId: i >= 5 ? `${CIRCUIT}-ct${i - 4}` : null,
        status: 'approved', createdAt: Timestamp.now(),
      });
    }
    await batch.commit();

    // ── Stratégies de seeding ──
    console.log('\n[2] Stratégies de seeding…');
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
    let bracketState = await api('GET', `/api/admin/competitions/${COMP}/bracket`);
    check('GET : stratégie circuit disponible (compét de circuit)',
      bracketState.strategies?.mmr === true && bracketState.strategies?.circuit === true,
      JSON.stringify(bracketState.strategies));
    check('GET : valeurs MMR exposées à l\'admin',
      bracketState.seeding.every(r => typeof r.mmrSeed === 'number' && r.mmrSeed > 0));

    const sbMmr = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'seed_by', strategy: 'mmr' });
    check('seed_by mmr : la compo la plus forte en seed 1 (t8 → t1)',
      JSON.stringify(sbMmr.seeding) === JSON.stringify([8, 7, 6, 5, 4, 3, 2, 1].map(regId)), JSON.stringify(sbMmr.seeding));

    const sbCircuit = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'seed_by', strategy: 'circuit' });
    check('seed_by circuit : classées du circuit d\'abord (t5..t8), puis les autres par MMR (t4..t1)',
      JSON.stringify(sbCircuit.seeding) === JSON.stringify([5, 6, 7, 8, 4, 3, 2, 1].map(regId)), JSON.stringify(sbCircuit.seeding));

    bracketState = await api('GET', `/api/admin/competitions/${COMP}/bracket`);
    check('GET : rang circuit exposé sur les classées',
      bracketState.seeding.find(r => r.registrationId === regId(5))?.circuitRank === 1
      && bracketState.seeding.find(r => r.registrationId === regId(1))?.circuitRank === null);

    // Reorder manuel par-dessus (ordre sportif t1..t8, rend la suite déterministe).
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
      action: 'reorder', order: [1, 2, 3, 4, 5, 6, 7, 8].map(regId),
    });
    const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
    check('publish après reorder manuel : 12 matchs de poule', pub.matchCount === 12, String(pub.matchCount));

    // ── Transfert reseed MMR ──
    console.log('\n[3] Poules jouées + transfert re-seedé par MMR…');
    await playAllPending(api);
    const adv = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'advance_stage' });
    // Qualifiées AU CLASSEMENT (t1..t4), ordre de seed par MMR desc (t4..t1).
    check('advance reseed mmr : qualification au classement, seed par MMR',
      JSON.stringify(adv.advanced) === JSON.stringify([4, 3, 2, 1].map(regId)), JSON.stringify(adv.advanced));
    const e2w11 = (await db.collection('competition_matches').doc(`${COMP}__E2_W1-1`).get()).data();
    check('demie 1 : seed MMR 1 (t4) vs seed MMR 4 (t1)',
      e2w11?.teamA === regId(4) && e2w11?.teamB === regId(1),
      `${e2w11?.teamA} vs ${e2w11?.teamB}`);
    const e2w12 = (await db.collection('competition_matches').doc(`${COMP}__E2_W1-2`).get()).data();
    check('demie 2 : seed MMR 2 (t3) vs seed MMR 3 (t2)',
      e2w12?.teamA === regId(3) && e2w12?.teamB === regId(2),
      `${e2w12?.teamA} vs ${e2w12?.teamB}`);
  } finally {
    console.log('\nCleanup…');
    await purge();
    await db.collection('aedral_admins').doc(ADMIN).delete();
    await db.collection('users').doc(ADMIN).delete();
    await auth.deleteUsers([ADMIN]).catch(() => {});
  }

  console.log(`\n${passed} ✔ / ${failed} ✘`);
  if (failed > 0) process.exit(1);
}

await main();
process.exit(0);
