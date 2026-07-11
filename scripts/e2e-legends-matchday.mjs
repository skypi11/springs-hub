// E2E Lot 3 — jour de match : lancement de phase + rooms, check-ins, saisies
// des deux camps (accord / divergence), litige, force-score, tick (check-in
// expiré, saisie unique), forfait validé, progression du bracket.
// Données 100 % synthétiques (préfixe e2e_md), cleanup TOUJOURS en finally
// (la DB est PARTAGÉE avec la prod). Prérequis : dev server localhost:3000.
// Run : node --env-file=.env.local scripts/e2e-legends-matchday.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_md';
const ADMIN_UID = `discord_${P}_admin`;
const COMP = `${P}-comp`;
const TEAM_COUNT = 4;

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
async function apiAs(uid, method, path, body) {
  const token = await tokenFor(uid);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}
const api = (m, p, b) => apiAs(ADMIN_UID, m, p, b);

const regId = i => `${COMP}_team${i}`;
const capOfReg = new Map();   // registrationId → captain uid
const matchRef = key => db.collection('competition_matches').doc(`${COMP}__${key}`);

async function setup() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E Matchday Admin', discordUsername: 'e2e_md_admin',
    discordId: '999999999999999901', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({ addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });

  const batch = db.batch();
  for (let i = 1; i <= TEAM_COUNT; i++) {
    const cap = `discord_${P}_cap${i}`;
    capOfReg.set(regId(i), cap);
    // isDev : passe le gate des compétitions masquées (bac à sable).
    batch.set(db.collection('users').doc(cap), {
      uid: cap, displayName: `E2E Cap ${i}`, discordUsername: `e2e_md_cap${i}`,
      discordId: `9999999999999999${10 + i}`, games: ['rl'], isDev: true, createdAt: Timestamp.now(),
    });
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `${P}-team${i}`,
      name: `MD Team ${i}`, tag: `MD${i}`, logoUrl: null,
      captainUid: cap,
      rosterUids: [cap, `discord_${P}_p${i}b`, `discord_${P}_p${i}c`],
      status: 'approved', createdAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'TEST E2E Matchday — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'double_elim', maxTeams: 32,
      // BO5 plat : saisies simples, le BO relatif a ses tests moteur dédiés.
      bo: { default: 5, overrides: [], grandFinal: 7 },
      bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: true, minAge: 16, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-01-01')), closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: true },
    schedule: {
      days: [{ date: '2026-09-26', startsAt: '15:00' }],
      phasePlan: [{ phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] }],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    // isDev : reste masquée du public MÊME publiée en live (le publish flippe
    // draft → live — mine documentée du Lot 2).
    discord: null, status: 'draft', isDev: true, approvedCount: TEAM_COUNT, createdAt: Timestamp.now(),
  });
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
  // Notifications d'alerte générées vers les VRAIS admins pendant le run.
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get();
  for (const d of notifs.docs) await d.ref.delete();
  const logs = await db.collection('admin_audit_logs').where('adminUid', '==', ADMIN_UID).get();
  for (const d of logs.docs) await d.ref.delete();
  const uids = [ADMIN_UID];
  for (let i = 1; i <= TEAM_COUNT; i++) uids.push(`discord_${P}_cap${i}`);
  for (const u of uids) await db.collection('users').doc(u).delete();
  await db.collection('aedral_admins').doc(ADMIN_UID).delete();
  await auth.deleteUsers(uids).catch(() => {});
  console.log('  cleanup terminé.');
}

const WIN_A = [{ a: 3, b: 1 }, { a: 1, b: 0 }, { a: 2, b: 0 }];
const WIN_B = [{ a: 1, b: 3 }, { a: 0, b: 1 }, { a: 0, b: 2 }];

async function sidesOf(key) {
  const snap = await matchRef(key).get();
  const m = snap.data();
  return { a: m.teamA, b: m.teamB, capA: capOfReg.get(m.teamA), capB: capOfReg.get(m.teamB), data: m };
}

async function run() {
  console.log('— Publication du bracket (routes Lot 2)…');
  let r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  if (r.status !== 200) throw new Error(`open_seeding: ${r.status} ${JSON.stringify(r.json)}`);
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  if (r.status !== 200) throw new Error(`publish: ${r.status} ${JSON.stringify(r.json)}`);
  const count = (await db.collection('competition_matches').where('competitionId', '==', COMP).get()).size;
  check('bracket publié (7 matchs pour 4 équipes)', count === 7, `${count}`);

  console.log('— Lancement de phase (console admin)…');
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W1-1', 'W1-2'] });
  check('launch_phase W1-1+W1-2', r.status === 200 && r.json.launched?.length === 2, JSON.stringify(r.json));
  r = await api('GET', `/api/admin/competitions/${COMP}/console`);
  check('console GET : rooms générées pour les 2 matchs', r.status === 200 && !!r.json.rooms?.['W1-1'] && !!r.json.rooms?.['W1-2']);

  console.log('— Accès & check-ins (W1-1)…');
  const w11 = await sidesOf('W1-1');
  const anon = await fetch(`${BASE}/api/competitions/${COMP}/matches/W1-1`);
  check('anonyme sur compét masquée → 404', anon.status === 404, String(anon.status));
  const w12 = await sidesOf('W1-2');
  r = await apiAs(w12.capA, 'POST', `/api/competitions/${COMP}/matches/W1-1`, { action: 'checkin' });
  check('capitaine étranger au match → 403', r.status === 403, String(r.status));
  r = await apiAs(w11.capA, 'POST', `/api/competitions/${COMP}/matches/W1-1`, { action: 'checkin' });
  check('check-in capitaine A', r.status === 200, JSON.stringify(r.json));
  r = await apiAs(w11.capA, 'GET', `/api/competitions/${COMP}/matches/W1-1`);
  check('room visible du participant', r.status === 200 && !!r.json.room?.name && !!r.json.room?.password);
  check('camp dérivé serveur (side a, capitaine)', r.json.access?.side === 'a' && r.json.access?.isCaptain === true);
  r = await apiAs(w11.capB, 'POST', `/api/competitions/${COMP}/matches/W1-1`, { action: 'checkin' });
  check('check-in capitaine B → match live', r.status === 200 && (await matchRef('W1-1').get()).data().status === 'live');

  console.log('— Scores concordants (W1-1)…');
  r = await apiAs(w11.capA, 'POST', `/api/competitions/${COMP}/matches/W1-1`, { action: 'submit_scores', games: WIN_A });
  const afterFirst = (await matchRef('W1-1').get()).data();
  check('1re saisie → score_review + compteur 3 min', r.status === 200 && afterFirst.status === 'score_review' && !!afterFirst.scores.counterDeadline);
  r = await apiAs(w11.capB, 'POST', `/api/competitions/${COMP}/matches/W1-1`, { action: 'submit_scores', games: WIN_A });
  const done11 = (await matchRef('W1-1').get()).data();
  check('contre-saisie concordante → completed (progression)', r.json?.resolution === 'agreement' && done11.status === 'completed' && done11.winner === 'a' && done11.scores.validatedBy === 'auto');
  const w21AfterA = (await matchRef('W2-1').get()).data();
  check('vainqueur propagé en finale winners', w21AfterA.teamA === w11.a && w21AfterA.teamAInfo?.name === 'MD Team ' + w11.a.slice(-1));
  const acl21 = await matchRef('W2-1').collection('private').doc('acl').get();
  check('ACL fusionnée (arrayUnion) sur le match aval', acl21.exists && (acl21.data().participantUids ?? []).includes(w11.capA));

  console.log('— Scores divergents (W1-2) → litige → force-score…');
  await apiAs(w12.capA, 'POST', `/api/competitions/${COMP}/matches/W1-2`, { action: 'checkin' });
  await apiAs(w12.capB, 'POST', `/api/competitions/${COMP}/matches/W1-2`, { action: 'checkin' });
  await apiAs(w12.capA, 'POST', `/api/competitions/${COMP}/matches/W1-2`, { action: 'submit_scores', games: WIN_A });
  r = await apiAs(w12.capB, 'POST', `/api/competitions/${COMP}/matches/W1-2`, { action: 'submit_scores', games: WIN_B });
  const disputed = (await matchRef('W1-2').get()).data();
  check('divergence → litige automatique', r.json?.resolution === 'mismatch' && disputed.status === 'disputed' && disputed.dispute?.auto === true);
  r = await apiAs(w12.capA, 'POST', `/api/competitions/${COMP}/matches/W1-2`, { action: 'submit_scores', games: WIN_A });
  check('saisie refusée pendant un litige', r.status === 409);
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W1-2', games: WIN_B, resolution: 'Captures vérifiées : victoire B.' });
  const resolved = (await matchRef('W1-2').get()).data();
  check('force-score → completed + litige résolu (admin, pas d\'uid public)', r.status === 200 && resolved.status === 'completed' && resolved.winner === 'b' && resolved.dispute?.resolvedBy === 'admin' && resolved.scores.validatedBy === 'admin');
  const l11 = (await matchRef('L1-1').get()).data();
  check('perdants descendus chez les losers', !!l11.teamA && !!l11.teamB);

  console.log('— Tick : check-in expiré → validation de forfait…');
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['L1-1'] });
  await matchRef('L1-1').update({ 'checkin.deadline': Timestamp.fromMillis(Date.now() - 60_000) });
  r = await api('POST', `/api/competitions/${COMP}/tick`);
  const expired = (await matchRef('L1-1').get()).data();
  check('tick → awaiting_forfeit_validation (jamais de forfait auto)', r.status === 200 && expired.status === 'awaiting_forfeit_validation');
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'validate_forfeit', matchId: 'L1-1', team: 'b', reason: 'Non présentée au check-in.' });
  const forfeited = (await matchRef('L1-1').get()).data();
  check('forfait validé → score conventionnel 3-0 + progression', r.status === 200 && forfeited.status === 'completed' && forfeited.forfeit?.team === 'b' && (forfeited.scores.final ?? []).length === 3);

  console.log('— Tick : saisie unique retenue à l\'échéance…');
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W2-1'] });
  const w21 = await sidesOf('W2-1');
  await apiAs(w21.capA, 'POST', `/api/competitions/${COMP}/matches/W2-1`, { action: 'checkin' });
  await apiAs(w21.capB, 'POST', `/api/competitions/${COMP}/matches/W2-1`, { action: 'checkin' });
  await apiAs(w21.capA, 'POST', `/api/competitions/${COMP}/matches/W2-1`, { action: 'submit_scores', games: WIN_A });
  await matchRef('W2-1').update({ 'scores.counterDeadline': Timestamp.fromMillis(Date.now() - 60_000) });
  r = await api('POST', `/api/competitions/${COMP}/tick`);
  const single = (await matchRef('W2-1').get()).data();
  check('saisie unique finalisée par le tick', r.status === 200 && single.status === 'completed' && single.winner === 'a' && single.scores.validatedBy === 'auto');
  const gf = (await matchRef('GF').get()).data();
  check('grande finale peuplée côté winners', gf.teamA === w21.teamA || gf.teamA === single.teamA);

  console.log('— Cast…');
  r = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'set_cast', matchId: 'GF', featured: true, streamUrl: 'https://twitch.tv/springsesport' });
  const cast = (await matchRef('GF').get()).data();
  check('match casté (EN STREAM + lien)', r.status === 200 && cast.cast?.featured === true && cast.cast?.streamUrl === 'https://twitch.tv/springsesport');
}

try {
  await setup();
  await run();
} catch (e) {
  failed++;
  console.error('ERREUR:', e.message);
} finally {
  await cleanup();
}
console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed > 0 ? 1 : 0);
