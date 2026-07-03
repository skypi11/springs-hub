// E2E du bac à sable compétitions (lib/competitions/sandbox) — vérifie le
// flux complet : seed → wizard déroulé par un dirigeant FICTIF sur une
// compétition draft (bypass isDev) → validation admin → cleanup total
// (compteurs recalés). Un admin Aedral synthétique temporaire est créé puis
// retiré. Prérequis : dev server localhost:3000 + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-sandbox.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';

function parseServiceAccount(raw) {
  try { return JSON.parse(raw); } catch {
    const fixed = raw.replace(/"private_key":\s*"([^"]+)"/,
      (_m, key) => `"private_key": "${key.replace(/\r?\n/g, '\\n')}"`);
    return JSON.parse(fixed);
  }
}
if (!getApps().length) {
  initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();
const auth = getAuth();

const ADMIN_UID = 'discord_e2e_sbx_admin';
const COMP = 'e2e-sbx-comp';
const WOLVES_OWNER = 'discord_dev_lgd_wolves_owner';
const TEAM_ALPHA = 'dev-lgd-wolves-alpha';
const REG_ID = `${COMP}_${TEAM_ALPHA}`;

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

async function apiCall(method, path, uid, body) {
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

async function setupHarness() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E Sandbox Admin', discordUsername: 'e2e_sbx',
    discordId: '999999999999999999', games: [], createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({
    addedBy: 'e2e', addedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('competitions').doc(COMP).set({
    name: 'TEST E2E Sandbox Comp — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'double_elim', maxTeams: 8,
      bo: { default: 5, overrides: [], grandFinal: 7 },
      bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: {
      requireVerifiedAccounts: true, minAge: 16,
      mmr: { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 },
    },
    roster: { starters: 3, subsMax: 2 },
    registration: {
      opensAt: Timestamp.fromDate(new Date('2026-01-01')),
      closesAt: Timestamp.fromDate(new Date('2026-12-01')),
      waitlist: true,
    },
    schedule: {
      days: [{ date: '2026-09-26', startsAt: '15:00' }], phasePlan: [],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: null, status: 'draft', createdAt: Timestamp.now(),
  });
}

async function teardownHarness() {
  await db.collection('aedral_admins').doc(ADMIN_UID).delete();
  await db.collection('users').doc(ADMIN_UID).delete();
  await db.collection('competitions').doc(COMP).delete();
  const logs = await db.collection('admin_audit_logs').where('adminUid', '==', ADMIN_UID).get();
  for (const d of logs.docs) await d.ref.delete();
  await auth.deleteUsers([ADMIN_UID]).catch(() => {});
}

async function run() {
  // 1. Seed du bac à sable (admin Aedral)
  let r = await apiCall('POST', '/api/admin/competitions/sandbox', ADMIN_UID, { action: 'seed' });
  check('1. seed → 200 (17 comptes, 2 structures, 4 équipes)',
    r.status === 200 && r.json?.users === 17 && r.json?.structures === 2 && r.json?.teams === 4,
    JSON.stringify(r.json));

  // 2. GET état
  r = await apiCall('GET', '/api/admin/competitions/sandbox', ADMIN_UID);
  check('2. GET état → exists + dirigeants impersonables',
    r.status === 200 && r.json?.exists === true
    && r.json?.structures?.[0]?.owner?.uid === WOLVES_OWNER,
    JSON.stringify(r.json?.structures?.[0]?.owner));

  // 3. Accès refusé aux non-admins (le dirigeant fictif lui-même)
  r = await apiCall('GET', '/api/admin/competitions/sandbox', WOLVES_OWNER);
  check('3. GET sandbox par un compte fictif → 403', r.status === 403, `status ${r.status}`);

  // 4. Annuaire public : structures fictives invisibles
  const pub = await fetch(`${BASE}/api/structures`);
  const pubJson = await pub.json();
  const visible = (pubJson.structures ?? []).some(s => s.id?.startsWith('dev-lgd-'));
  check('4. annuaire public : structures TEST absentes', pub.status === 200 && !visible,
    `visible=${visible}`);

  // 5. Wizard GET par le dirigeant fictif sur la compétition DRAFT (bypass isDev)
  r = await apiCall('GET', `/api/competitions/${COMP}/register`, WOLVES_OWNER);
  const wolvesStruct = r.json?.structures?.find(s => s.id === 'dev-lgd-wolves');
  check('5. wizard GET (draft) par le dirigeant fictif → 200 + ses équipes',
    r.status === 200 && !!wolvesStruct && wolvesStruct.teams.length === 2,
    `status ${r.status} teams ${wolvesStruct?.teams?.length}`);

  // 6. Soumission du wizard par le dirigeant fictif (Wolves Alpha : mineur +
  //    non-vérifié + smurf dans le roster → drapeaux attendus)
  const roster = [
    { uid: 'discord_dev_lgd_wolves_p1', role: 'titulaire', declaredCurrentMmr: 1400, declaredPeakMmr: 1500 },
    { uid: 'discord_dev_lgd_wolves_p2', role: 'titulaire', declaredCurrentMmr: 1350, declaredPeakMmr: 1450 },
    { uid: 'discord_dev_lgd_wolves_p3', role: 'titulaire', declaredCurrentMmr: 1200, declaredPeakMmr: 1300 },
    { uid: 'discord_dev_lgd_wolves_p4', role: 'remplacant', declaredCurrentMmr: 1300, declaredPeakMmr: 1400 },
  ];
  r = await apiCall('POST', `/api/competitions/${COMP}/register`, WOLVES_OWNER, {
    structureId: 'dev-lgd-wolves', teamId: TEAM_ALPHA, name: 'Wolves Alpha', roster,
  });
  check('6. wizard POST par le dirigeant fictif → 200 + flags underage/unverified',
    r.status === 200 && r.json?.flags?.includes('underage') && r.json?.flags?.includes('unverified_account'),
    `status ${r.status} ${JSON.stringify(r.json)}`);

  // 7. File de validation : agrégat smurf du joueur fictif signalé
  r = await apiCall('GET', `/api/admin/competitions/${COMP}/registrations`, ADMIN_UID);
  const row = r.json?.registrations?.find(x => x.id === REG_ID);
  const minorRow = row?.roster?.find(p => p.uid === 'discord_dev_lgd_wolves_p3');
  check('7. file de validation : inscription fictive visible, mineur détecté (15 ans)',
    r.status === 200 && !!row && minorRow?.age !== null && minorRow?.age < 16,
    JSON.stringify({ status: r.status, age: minorRow?.age }));

  // 8. Validation avec dérogation → approved
  r = await apiCall('POST', `/api/admin/competitions/${COMP}/registrations`, ADMIN_UID, {
    action: 'approve', registrationId: REG_ID,
    derogations: [{ uid: 'discord_dev_lgd_wolves_p3', note: 'Accord parental fictif (e2e sandbox)' }],
  });
  const compSnap = await db.collection('competitions').doc(COMP).get();
  check('8. approve avec dérogation → approved, compteur 1',
    r.status === 200 && r.json?.status === 'approved' && compSnap.data()?.approvedCount === 1,
    `status ${r.status} ${JSON.stringify(r.json)}`);

  // 9. Cleanup : tout disparaît, compteur recalé
  r = await apiCall('POST', '/api/admin/competitions/sandbox', ADMIN_UID, { action: 'cleanup' });
  const [regSnap, structSnap, userSnap, compAfter] = await Promise.all([
    db.collection('competition_registrations').doc(REG_ID).get(),
    db.collection('structures').doc('dev-lgd-wolves').get(),
    db.collection('users').doc(WOLVES_OWNER).get(),
    db.collection('competitions').doc(COMP).get(),
  ]);
  check('9. cleanup → inscriptions/structures/comptes supprimés, approvedCount recalé à 0',
    r.status === 200 && !regSnap.exists && !structSnap.exists && !userSnap.exists
    && compAfter.data()?.approvedCount === 0,
    JSON.stringify({ status: r.status, reg: regSnap.exists, struct: structSnap.exists, cnt: compAfter.data()?.approvedCount }));

  // 10. GET état après cleanup
  r = await apiCall('GET', '/api/admin/competitions/sandbox', ADMIN_UID);
  check('10. GET état après cleanup → exists false', r.status === 200 && r.json?.exists === false,
    JSON.stringify(r.json));
}

await setupHarness();
try {
  await run();
} catch (err) {
  failed++;
  console.error('\n✗ Exception :', err);
  // best-effort : purge du bac à sable si le run a échoué en cours de route
  const admin = await tokenFor(ADMIN_UID).catch(() => null);
  if (admin) {
    await fetch(`${BASE}/api/admin/competitions/sandbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ action: 'cleanup' }),
    }).catch(() => {});
  }
} finally {
  await teardownHarness();
}
console.log(`\n═══ Résultat : ${passed} ✓ / ${failed} ✗ ═══`);
process.exit(failed > 0 ? 1 : 0);
