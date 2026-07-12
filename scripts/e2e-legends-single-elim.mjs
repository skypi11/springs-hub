// E2E moteur SIMPLE élimination — publication + tournoi complet via les
// VRAIES routes (bracket publish, console launch/force_score/withdraw, API
// publique). Vérifie : matérialisation single (pas de GF, petite finale),
// byes, cascade de retrait, règle « fini seulement quand la petite finale est
// réglée », gating public. Données synthétiques (préfixe e2e_se), compétition
// isDev (jamais visible du public), cleanup TOUJOURS en finally.
// Run : node --env-file=.env.local scripts/e2e-legends-single-elim.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_se';
const ADMIN_UID = `discord_${P}_admin`;
const COMP = `${P}-comp`;
const TEAM_COUNT = 6; // size 8, 2 byes → 7 matchs d'arbre + petite finale

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const tokens = new Map();
async function tokenFor(uid) {
  if (tokens.has(uid)) return tokens.get(uid);
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}
async function api(method, path, body) {
  const token = await tokenFor(ADMIN_UID);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const regId = i => `${COMP}_team${i}`;
const matchRef = key => db.collection('competition_matches').doc(`${COMP}__${key}`);
// BO5 : 3 manches gagnées par A. BO7 (finale = bo.grandFinal) : 4 manches.
const WIN_A = [{ a: 1, b: 0 }, { a: 2, b: 0 }, { a: 3, b: 1 }];
const WIN_A_BO7 = [...WIN_A, { a: 2, b: 1 }];

async function setup() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E SingleElim Admin', discordUsername: 'e2e_se_admin',
    discordId: '999999999999999911', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({ addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  await db.collection('competitions').doc(COMP).set({
    name: 'TEST E2E Simple élim — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'single_elim', maxTeams: 16, thirdPlace: true,
      bo: { default: 5, overrides: [], grandFinal: 7 },
      bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-01-01')), closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: true },
    schedule: {
      days: [{ date: '2026-08-22', startsAt: '15:00' }],
      phasePlan: [{ phase: 1, day: 1, label: 'P1 — Quarts', rounds: [{ bracket: 'winners', round: 1 }] }],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    // isDev : reste masquée du public MÊME publiée (le publish flippe → live).
    discord: null, status: 'draft', isDev: true, approvedCount: TEAM_COUNT, createdAt: Timestamp.now(),
  });
  const batch = db.batch();
  for (let i = 1; i <= TEAM_COUNT; i++) {
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `team${i}`,
      name: `SE Team ${i}`, tag: `SE${i}`, logoUrl: null,
      captainUid: `discord_${P}_cap${i}`,
      rosterUids: [`discord_${P}_cap${i}`, `discord_${P}_p${i}b`, `discord_${P}_p${i}c`],
      status: 'approved', createdAt: Timestamp.now(),
    });
  }
  await batch.commit();
}

async function cleanup() {
  console.log('\n— Cleanup…');
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
  const logs = await db.collection('admin_audit_logs').where('adminUid', '==', ADMIN_UID).get();
  for (const d of logs.docs) await d.ref.delete();
  await db.collection('aedral_admins').doc(ADMIN_UID).delete();
  await db.collection('users').doc(ADMIN_UID).delete();
  await auth.deleteUsers([ADMIN_UID]).catch(() => {});
  console.log('  cleanup terminé.');
}

async function run() {
  console.log('— Publication (seeding → publish)…');
  let r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  check('open_seeding : 6 seeds', r.status === 200 && r.json?.seeding?.length === 6, JSON.stringify(r.json));
  // Ordre déterministe pour un scénario reproductible : team1 → team6 par seed.
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
    action: 'reorder', order: Array.from({ length: 6 }, (_, i) => regId(i + 1)),
  });
  check('reorder par numéro d\'équipe', r.status === 200);
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  check('publish → live, 8 matchs (7 d\'arbre + petite finale)',
    r.status === 200 && r.json?.status === 'live' && r.json?.matchCount === 8,
    JSON.stringify({ s: r.status, mc: r.json?.matchCount }));

  console.log('— Structure single matérialisée…');
  const gf = await matchRef('GF').get();
  const p3 = await matchRef('P3').get();
  check('pas de grande finale ; petite finale présente (bracket losers, hidden isDev)',
    !gf.exists && p3.exists && p3.data().bracket === 'losers' && p3.data().hidden === true);
  // Seeds 7-8 absents → W1-1 (1v8) et W1-3 (2v7) en walkover, sans score.
  const w11 = (await matchRef('W1-1').get()).data();
  const w13 = (await matchRef('W1-3').get()).data();
  check('byes : W1-1 et W1-3 en walkover sans score',
    w11.status === 'walkover' && w13.status === 'walkover'
    && w11.scores.final === null && w11.winner === 'a');
  const w21 = (await matchRef('W2-1').get()).data();
  check('walkover propagé : la tête de série 1 attend en demie',
    w21.teamA === regId(1) && w21.teamAInfo?.name === 'SE Team 1');

  console.log('— API publique (masquée isDev)…');
  r = await api('GET', `/api/competitions/${COMP}/matches`);
  const pub = r.json?.matches ?? [];
  check('API matches (admin) : 8 matchs, aucun grand_final, sources exposées',
    r.status === 200 && pub.length === 8
    && !pub.some(m => m.bracket === 'grand_final')
    && pub.every(m => m.sourceA && m.sourceB));
  const anon = await fetch(`${BASE}/api/competitions/${COMP}/matches`, { headers: bypassHeaders });
  check('anonyme sur compét masquée → 404', anon.status === 404, String(anon.status));

  console.log('— Quarts (launch + scores forcés + retrait)…');
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W1-2', 'W1-4'] });
  check('launch_phase quarts jouables', r.status === 200 && r.json.launched?.length === 2, JSON.stringify(r.json));
  r = await api('GET', `/api/admin/competitions/${COMP}/console`);
  check('rooms générées pour les 2 quarts', r.status === 200 && !!r.json.rooms?.['W1-2'] && !!r.json.rooms?.['W1-4']);

  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W1-2', games: WIN_A });
  const w12 = (await matchRef('W1-2').get()).data();
  check('force_score W1-2 → completed + demie peuplée', r.status === 200 && w12.status === 'completed');

  // Retrait AVANT le match : cascade single élim — l'adversaire est crédité
  // d'un forfait conventionnel, le délta du retiré est figé.
  const w14Before = (await matchRef('W1-4').get()).data();
  const dqTarget = w14Before.teamA;
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'withdraw_team', registrationId: dqTarget, reason: 'Test retrait e2e.' });
  const w14 = (await matchRef('W1-4').get()).data();
  const dqReg = (await db.collection('competition_registrations').doc(dqTarget).get()).data();
  check('withdraw_team → forfait conventionnel cascade + inscription withdrawn',
    r.status === 200 && w14.status === 'completed' && w14.forfeit?.team === 'a'
    && w14.statsCountA === false && w14.statsCountB === true && dqReg.status === 'withdrawn',
    JSON.stringify({ st: w14.status, ff: w14.forfeit }));

  console.log('— Demies → finale + petite finale…');
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W2-1', games: WIN_A });
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W2-2', games: WIN_A });
  const final = (await matchRef('W3-1').get()).data();
  const p3After = (await matchRef('P3').get()).data();
  check('finale ET petite finale peuplées par les demies',
    !!final.teamA && !!final.teamB && !!p3After.teamA && !!p3After.teamB
    && p3After.teamA !== final.teamA && p3After.teamB !== final.teamB);

  console.log('— Règle de fin : la petite finale compte…');
  // La finale hérite du BO « grandFinal » (7) — une saisie BO5 y est refusée.
  check('finale en BO7 (bo.grandFinal appliqué à la dernière ronde)', final.bo === 7, String(final.bo));
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W3-1', games: WIN_A });
  check('saisie BO5 refusée sur une finale BO7', r.status === 409, String(r.status));
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W3-1', games: WIN_A_BO7 });
  check('finale forcée en BO7 (champion connu)', r.status === 200, JSON.stringify(r.json));
  r = await api('GET', `/api/admin/competitions/${COMP}/console`);
  check('console : PAS fini tant que la petite finale est en attente',
    r.status === 200 && r.json.finished === false, JSON.stringify({ f: r.json?.finished }));
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'P3', games: WIN_A });
  check('petite finale forcée', r.status === 200);
  r = await api('GET', `/api/admin/competitions/${COMP}/console`);
  check('console : fini une fois la petite finale réglée',
    r.status === 200 && r.json.finished === true && r.json.needsAdminDecision === false,
    JSON.stringify({ f: r.json?.finished }));

  // Champion mécanique cohérent : vainqueur de W3-1 côté A (WIN_A partout).
  const champ = (await matchRef('W3-1').get()).data();
  check('champion = vainqueur de la finale (winner a, non retiré)',
    champ.winner === 'a' && champ.teamA !== dqTarget);
}

await cleanup(); // préventif
await setup();
try {
  await run();
} catch (err) {
  failed++;
  console.error('\n✗ Exception :', err);
} finally {
  await cleanup();
}
console.log(`\n═══ Résultat : ${passed} ✓ / ${failed} ✗ ═══`);
process.exit(failed > 0 ? 1 : 0);
