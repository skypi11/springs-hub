// E2E Lot 3G — retrait d'inscription par l'équipe + effet d'une sanction
// exclusion (retrait auto pré-bracket, refus après publication).
// Données 100 % synthétiques (préfixe e2e_wd), cleanup TOUJOURS en finally.
// Prérequis : dev server localhost:3000.
// Run : node --env-file=.env.local scripts/e2e-legends-withdraw.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_wd';
const ADMIN_UID = `discord_${P}_admin`;
const FOUNDER_UID = `discord_${P}_founder`;
const STRANGER_UID = `discord_${P}_stranger`;
const COMP = `${P}-comp`;
const STRUCT = `${P}-struct`;

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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenFor(uid)}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const regId = n => `${COMP}_team${n}`;

async function setup() {
  const batch = db.batch();
  for (const [uid, name] of [[ADMIN_UID, 'E2E WD Admin'], [FOUNDER_UID, 'E2E WD Founder'], [STRANGER_UID, 'E2E WD Stranger']]) {
    batch.set(db.collection('users').doc(uid), {
      uid, displayName: name, discordUsername: name.toLowerCase().replace(/\s/g, '_'),
      discordId: `9999999999999${String(Math.abs(hash(uid))).slice(0, 5)}`, games: [], isDev: true, createdAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('aedral_admins').doc(ADMIN_UID), { addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  batch.set(db.collection('structures').doc(STRUCT), {
    name: 'E2E WD Struct', tag: 'EWD', founderId: FOUNDER_UID, coFounderIds: [], managerIds: [],
    games: ['rocket_league'], status: 'active', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'TEST E2E Withdraw — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: { kind: 'double_elim', maxTeams: 32, bo: { default: 5, overrides: [], grandFinal: 7 }, bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 } },
    eligibility: { requireVerifiedAccounts: true, minAge: 16, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-01-01')), closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: true },
    schedule: { days: [{ date: '2026-09-26', startsAt: '15:00' }], phasePlan: [], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
    discord: null, status: 'registration', isDev: true, approvedCount: 2, createdAt: Timestamp.now(),
  });
  for (const [n, status] of [[1, 'approved'], [2, 'waitlisted'], [3, 'approved']]) {
    batch.set(db.collection('competition_registrations').doc(regId(n)), {
      competitionId: COMP, structureId: STRUCT, teamId: `${P}-t${n}`,
      name: `WD Team ${n}`, tag: `WD${n}`, logoUrl: null,
      captainUid: FOUNDER_UID, rosterUids: [FOUNDER_UID, `discord_${P}_p${n}b`, `discord_${P}_p${n}c`],
      status, circuitTeamId: null, createdAt: Timestamp.now(),
    });
  }
  await batch.commit();
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

async function cleanup() {
  console.log('\n— Cleanup…');
  for (const n of [1, 2, 3]) await db.collection('competition_registrations').doc(regId(n)).delete();
  await db.collection('competitions').doc(COMP).delete();
  await db.collection('structures').doc(STRUCT).delete();
  const sanctions = await db.collection('competition_sanctions').where('targetId', '==', STRUCT).get();
  for (const d of sanctions.docs) await d.ref.delete();
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get();
  for (const d of notifs.docs) await d.ref.delete();
  const logs = await db.collection('admin_audit_logs').where('adminUid', '==', ADMIN_UID).get();
  for (const d of logs.docs) await d.ref.delete();
  const uids = [ADMIN_UID, FOUNDER_UID, STRANGER_UID];
  for (const u of uids) await db.collection('users').doc(u).delete();
  await db.collection('aedral_admins').doc(ADMIN_UID).delete();
  await auth.deleteUsers(uids).catch(() => {});
  console.log('  cleanup terminé.');
}

async function run() {
  console.log('— Retrait par l\'équipe (dirigeant)…');
  let r = await apiAs(STRANGER_UID, 'POST', `/api/structures/${STRUCT}/registrations`, { action: 'withdraw', registrationId: regId(2) });
  check('étranger à la structure → 403', r.status === 403, String(r.status));
  r = await apiAs(FOUNDER_UID, 'POST', `/api/structures/${STRUCT}/registrations`, { action: 'withdraw', registrationId: regId(2) });
  const reg2 = (await db.collection('competition_registrations').doc(regId(2)).get()).data();
  check('retrait waitlisted par le dirigeant → withdrawn', r.status === 200 && reg2.status === 'withdrawn');
  const countAfterWaitlist = (await db.collection('competitions').doc(COMP).get()).data().approvedCount;
  check('compteur intact (waitlisted ne comptait pas)', countAfterWaitlist === 2, String(countAfterWaitlist));
  r = await apiAs(FOUNDER_UID, 'POST', `/api/structures/${STRUCT}/registrations`, { action: 'withdraw', registrationId: regId(2) });
  check('doublon → 409', r.status === 409, String(r.status));

  console.log('— Effet d\'une exclusion (structure, scope compétition)…');
  r = await apiAs(ADMIN_UID, 'POST', '/api/admin/competition-sanctions', {
    type: 'exclusion', targetType: 'structure', targetId: STRUCT,
    reason: 'Test e2e effet exclusion.', scopeCompetitionId: COMP, competitionId: COMP,
  });
  const reg1 = (await db.collection('competition_registrations').doc(regId(1)).get()).data();
  const reg3 = (await db.collection('competition_registrations').doc(regId(3)).get()).data();
  const compAfter = (await db.collection('competitions').doc(COMP).get()).data();
  check('sanction créée + inscriptions actives retirées automatiquement',
    r.status === 200 && (r.json.effect?.withdrawn ?? []).length === 2 && reg1.status === 'withdrawn' && reg3.status === 'withdrawn');
  check('compteur décrémenté pour chaque approved retirée', compAfter.approvedCount === 0, String(compAfter.approvedCount));

  console.log('— Garde bracket publié…');
  await db.collection('competition_registrations').doc(regId(2)).update({ status: 'approved' });
  await db.collection('competitions').doc(COMP).update({ bracketMaterializedAt: Timestamp.now(), approvedCount: 1 });
  r = await apiAs(FOUNDER_UID, 'POST', `/api/structures/${STRUCT}/registrations`, { action: 'withdraw', registrationId: regId(2) });
  check('retrait refusé après publication du bracket (→ admin console)', r.status === 409 && /bracket/i.test(r.json?.error ?? ''), `${r.status} ${r.json?.error}`);
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
