// E2E — vitrine circuit (page /competitions/circuit/[id] + API gatées).
// Données 100 % synthétiques (préfixe e2e_circuit), cleanup TOUJOURS en finally.
// Prérequis : dev server localhost:3000 (FRAIS — redémarrer avant) + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-circuit.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_circuit';
const ADMIN_UID = `discord_${P}_admin`;
const CIRCUIT = `${P}-circuit`;
const Q1 = `${P}-q1`;
const Q2 = `${P}-q2`;

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

async function idToken(uid) {
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
async function get(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const format = {
  kind: 'double_elim', maxTeams: 32,
  bo: { default: 5, overrides: [], grandFinal: 7 }, bracketReset: true,
  forfeitScore: { games: 3, goalsPerGame: 1 },
};
const eligibility = { requireVerifiedAccounts: true, minAge: 16, mmr: { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 } };
const roster = { starters: 3, subsMax: 2 };
const now = Date.now();

async function setup() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E Circuit Admin', discordUsername: 'e2e_circ',
    discordId: '999999999999999998', games: [], createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({ addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });

  await db.collection('circuits').doc(CIRCUIT).set({
    name: 'TEST E2E Circuit — ne pas toucher',
    game: 'rocket_league',
    competitionIds: [Q1, Q2],
    pointsScale: { '1': 40, '2': 34, '3': 30, '4': 26 },
    bestResultsCount: 3,
    lanTeamCount: 2,
    prizePool: { amount: 1200, currency: 'EUR', note: 'Remis à la LAN finale' },
    tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
    status: 'draft',
    createdAt: FieldValue.serverTimestamp(),
  });

  // Q1 terminé, Q2 inscriptions ouvertes (fenêtre courante).
  await db.collection('competitions').doc(Q1).set({
    name: 'E2E Qualif 1', game: 'rocket_league', circuitId: CIRCUIT,
    format, eligibility, roster,
    registration: { opensAt: Timestamp.fromMillis(now - 30 * 86400000), closesAt: Timestamp.fromMillis(now - 20 * 86400000), waitlist: true },
    schedule: { days: [{ date: '2026-09-26', startsAt: '15:00' }, { date: '2026-09-27', startsAt: '15:00' }], phasePlan: [], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
    status: 'finished', approvedCount: 3, createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('competitions').doc(Q2).set({
    name: 'E2E Qualif 2', game: 'rocket_league', circuitId: CIRCUIT,
    format, eligibility, roster,
    registration: { opensAt: Timestamp.fromMillis(now - 86400000), closesAt: Timestamp.fromMillis(now + 86400000), waitlist: true },
    schedule: { days: [{ date: '2026-10-10', startsAt: '15:00' }], phasePlan: [], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
    status: 'registration', approvedCount: 1, createdAt: FieldValue.serverTimestamp(),
  });

  // circuit_teams (public-safe : nom/tag/participations, PAS d'uid) pour le classement.
  // A : q1(1er,40,gd10) + q2(3e,30,gd6) = 70, gd16.  C : q1(3e,30,gd5) + q2(1er,40,gd9) = 70, gd14.  B : q1(2e,34,gd8) = 34.
  await db.collection('circuit_teams').doc(`${P}-A`).set({
    circuitId: CIRCUIT, name: 'Team A', tag: 'AAA',
    participations: [
      { competitionId: Q1, placement: 1, points: 40, goalDiff: 10, goalsFor: 20 },
      { competitionId: Q2, placement: 3, points: 30, goalDiff: 6, goalsFor: 16 },
    ],
  });
  await db.collection('circuit_teams').doc(`${P}-B`).set({
    circuitId: CIRCUIT, name: 'Team B', tag: 'BBB',
    participations: [{ competitionId: Q1, placement: 2, points: 34, goalDiff: 8, goalsFor: 18 }],
  });
  await db.collection('circuit_teams').doc(`${P}-C`).set({
    circuitId: CIRCUIT, name: 'Team C', tag: 'CCC',
    participations: [
      { competitionId: Q1, placement: 3, points: 30, goalDiff: 5, goalsFor: 14 },
      { competitionId: Q2, placement: 1, points: 40, goalDiff: 9, goalsFor: 22 },
    ],
  });
}

async function cleanup() {
  const dels = [
    db.collection('circuits').doc(CIRCUIT),
    db.collection('competitions').doc(Q1),
    db.collection('competitions').doc(Q2),
    db.collection('circuit_teams').doc(`${P}-A`),
    db.collection('circuit_teams').doc(`${P}-B`),
    db.collection('circuit_teams').doc(`${P}-C`),
    db.collection('users').doc(ADMIN_UID),
    db.collection('aedral_admins').doc(ADMIN_UID),
  ];
  for (const ref of dels) await ref.delete().catch(() => {});
  await auth.deleteUser(ADMIN_UID).catch(() => {});
}

async function run() {
  await setup();
  const token = await idToken(ADMIN_UID);

  // 1) Détail circuit (testeur) : structure complète.
  const detail = await get(`/api/competitions/circuit/${CIRCUIT}`, token);
  check('détail circuit 200', detail.status === 200, `status ${detail.status}`);
  const d = detail.json ?? {};
  check('nom + prizepool exposés', d.circuit?.name?.includes('E2E Circuit') && d.circuit?.prizePool?.amount === 1200);
  check('2 étapes listées', d.events?.length === 2, `events=${d.events?.length}`);
  check('formatSample présent (BO7 GF)', d.formatSample?.format?.bo?.grandFinal === 7);
  check('cible inscription = Q2 (fenêtre ouverte)', d.registrationTargetId === Q2 && d.registrationTargetOpen === true, `target=${d.registrationTargetId}`);

  // 2) Classement : A (70,gd16) > C (70,gd14) > B (34) ; cutline 2 → A,C qualifiés.
  const st = d.standings ?? [];
  check('3 équipes classées', st.length === 3, `n=${st.length}`);
  check('ordre A > C > B', st[0]?.name === 'Team A' && st[1]?.name === 'Team C' && st[2]?.name === 'Team B',
    st.map(r => r.name).join(','));
  check('totaux points corrects', st[0]?.totalPoints === 70 && st[2]?.totalPoints === 34);
  check('cutline LAN sur 2 équipes', st.filter(r => r.qualifiedForLan).length === 2 && st[2]?.qualifiedForLan === false);

  // 3) Gate : circuit draft invisible pour un anonyme.
  const anon = await get(`/api/competitions/circuit/${CIRCUIT}`, null);
  check('anon → 404 sur circuit draft', anon.status === 404, `status ${anon.status}`);

  // 4) Liste circuits : testeur voit (hidden), anon ne voit pas.
  const listViewer = await get('/api/competitions/circuits', token);
  check('liste testeur contient le circuit (hidden)', (listViewer.json?.circuits ?? []).some(c => c.id === CIRCUIT && c.hidden === true));
  const listAnon = await get('/api/competitions/circuits', null);
  check('liste anon exclut le circuit draft', !(listAnon.json?.circuits ?? []).some(c => c.id === CIRCUIT));

  // 5) La fiche Qualif expose bien le rattachement circuit (pour le lien retour).
  const q2 = await get(`/api/competitions/${Q2}`, token);
  check('fiche Qualif renvoie circuitId', q2.json?.competition?.circuitId === CIRCUIT, `circuitId=${q2.json?.competition?.circuitId}`);
}

try {
  await run();
} catch (e) {
  failed++;
  console.log(`  ✗ exception — ${e.message}`);
} finally {
  await cleanup();
  console.log(`\n${passed}/${passed + failed} checks OK`);
  process.exit(failed ? 1 : 0);
}
