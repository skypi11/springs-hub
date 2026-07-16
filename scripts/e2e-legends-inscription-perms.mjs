// E2E — permissions d'inscription (manager d'équipe scopé à SES équipes).
// Données synthétiques (préfixe e2e_perm), cleanup TOUJOURS en finally.
// Prérequis : dev server localhost:3000 FRAIS + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-inscription-perms.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_perm';
const STRUCT = `${P}-struct`;
const TEAM_A = `${P}-teamA`;
const TEAM_B = `${P}-teamB`;
const COMP = `${P}-comp`;
const FOUNDER = `discord_${P}_founder`;
const MANAGER = `discord_${P}_manager`;   // manager d'équipe A
const COACH = `discord_${P}_coach`;       // coach d'équipe A (ne doit PAS inscrire)
const A_PLAYERS = [1, 2, 3].map(i => `discord_${P}_a${i}`);
const B_PLAYERS = [1, 2, 3].map(i => `discord_${P}_b${i}`);

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
async function req(method, path, asUid, body) {
  const token = await tokenFor(asUid);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const ALL_UIDS = [FOUNDER, MANAGER, COACH, ...A_PLAYERS, ...B_PLAYERS];

async function setup() {
  for (const uid of ALL_UIDS) {
    try { await auth.getUser(uid); } catch { try { await auth.createUser({ uid }); } catch { /* course */ } }
  }
  const batch = db.batch();
  for (const uid of ALL_UIDS) {
    batch.set(db.collection('users').doc(uid), {
      uid, displayName: uid.replace(`discord_${P}_`, 'PERM ').toUpperCase(),
      discordId: '999999990000000000', games: ['rocket_league'], createdAt: Timestamp.now(),
    }, { merge: true });
  }
  batch.set(db.collection('structures').doc(STRUCT), {
    name: 'E2E Perm Struct', tag: 'PRM', status: 'active', founderId: FOUNDER,
    coFounderIds: [], managerIds: [], coachIds: [], games: ['rocket_league'],
    createdAt: FieldValue.serverTimestamp(),
  });
  // Équipe A : MANAGER est staff manager, COACH est staff coach.
  batch.set(db.collection('sub_teams').doc(TEAM_A), {
    structureId: STRUCT, game: 'rocket_league', name: 'Team A', status: 'active',
    playerIds: A_PLAYERS, subIds: [], captainId: A_PLAYERS[0],
    staffIds: [MANAGER, COACH], staffRoles: { [MANAGER]: 'manager', [COACH]: 'coach' },
    createdAt: FieldValue.serverTimestamp(),
  });
  // Équipe B : ni MANAGER ni COACH n'y sont staff.
  batch.set(db.collection('sub_teams').doc(TEAM_B), {
    structureId: STRUCT, game: 'rocket_league', name: 'Team B', status: 'active',
    playerIds: B_PLAYERS, subIds: [], captainId: B_PLAYERS[0],
    staffIds: [], staffRoles: {},
    createdAt: FieldValue.serverTimestamp(),
  });
  // Compétition ouverte, sans MMR / sans vérif / sans règlement (isole la permission).
  const now = Date.now();
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'E2E Perm Comp', game: 'rocket_league', circuitId: null,
    format: { kind: 'double_elim', maxTeams: 32, bo: { default: 5, overrides: [], grandFinal: 7 }, bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 } },
    eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromMillis(now - 86400000), closesAt: Timestamp.fromMillis(now + 86400000), waitlist: true },
    schedule: { days: [{ date: '2026-09-26', startsAt: '15:00' }], phasePlan: [], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
    status: 'registration', approvedCount: 0, createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function cleanup() {
  for (const id of [STRUCT]) await db.collection('structures').doc(id).delete().catch(() => {});
  for (const id of [TEAM_A, TEAM_B]) await db.collection('sub_teams').doc(id).delete().catch(() => {});
  for (const id of [COMP]) await db.collection('competitions').doc(id).delete().catch(() => {});
  for (const tid of [TEAM_A, TEAM_B]) await db.collection('competition_registrations').doc(`${COMP}_${tid}`).delete().catch(() => {});
  const batch = db.batch();
  for (const uid of ALL_UIDS) batch.delete(db.collection('users').doc(uid));
  await batch.commit().catch(() => {});
  await auth.deleteUsers(ALL_UIDS).catch(() => {});
}

async function run() {
  await setup();

  // 1) GET wizard : le manager d'équipe A ne voit QUE l'équipe A.
  const gMgr = await req('GET', `/api/competitions/${COMP}/register`, MANAGER);
  const mgrTeams = (gMgr.json?.structures ?? []).flatMap(s => s.teams.map(t => t.id));
  check('manager voit son équipe A', mgrTeams.includes(TEAM_A), `teams=${mgrTeams.join(',')}`);
  check('manager ne voit PAS l\'équipe B', !mgrTeams.includes(TEAM_B), `teams=${mgrTeams.join(',')}`);

  // 2) GET wizard : le coach d'équipe A n'a aucune équipe inscriptible.
  const gCoach = await req('GET', `/api/competitions/${COMP}/register`, COACH);
  const coachTeams = (gCoach.json?.structures ?? []).flatMap(s => s.teams.map(t => t.id));
  check('coach d\'équipe ne voit aucune équipe', coachTeams.length === 0, `teams=${coachTeams.join(',')}`);

  // 3) GET wizard : le dirigeant voit les 2 équipes.
  const gFounder = await req('GET', `/api/competitions/${COMP}/register`, FOUNDER);
  const founderTeams = (gFounder.json?.structures ?? []).flatMap(s => s.teams.map(t => t.id));
  check('dirigeant voit A et B', founderTeams.includes(TEAM_A) && founderTeams.includes(TEAM_B), `teams=${founderTeams.join(',')}`);

  // 4) POST : le manager inscrit SON équipe A → OK.
  const postA = await req('POST', `/api/competitions/${COMP}/register`, MANAGER, {
    structureId: STRUCT, teamId: TEAM_A, name: 'Team A',
    roster: A_PLAYERS.map(u => ({ uid: u, role: 'titulaire', declaredCurrentMmr: 0, declaredPeakMmr: 0 })),
  });
  check('manager inscrit son équipe A (200)', postA.status === 200, `status ${postA.status} ${JSON.stringify(postA.json)}`);

  // 5) POST : le manager tente d'inscrire l'équipe B → 403.
  const postB = await req('POST', `/api/competitions/${COMP}/register`, MANAGER, {
    structureId: STRUCT, teamId: TEAM_B, name: 'Team B',
    roster: B_PLAYERS.map(u => ({ uid: u, role: 'titulaire', declaredCurrentMmr: 0, declaredPeakMmr: 0 })),
  });
  check('manager NE PEUT PAS inscrire l\'équipe B (403)', postB.status === 403, `status ${postB.status}`);

  // 6) POST : le coach tente d'inscrire l'équipe A → 403.
  const postCoach = await req('POST', `/api/competitions/${COMP}/register`, COACH, {
    structureId: STRUCT, teamId: TEAM_A, name: 'Team A',
    roster: A_PLAYERS.map(u => ({ uid: u, role: 'titulaire', declaredCurrentMmr: 0, declaredPeakMmr: 0 })),
  });
  check('coach d\'équipe NE PEUT PAS inscrire (403)', postCoach.status === 403, `status ${postCoach.status}`);

  // 7) Onglet Inscriptions : le manager voit l'inscription de SON équipe.
  const regMgr = await req('GET', `/api/structures/${STRUCT}/registrations`, MANAGER);
  const mgrRegTeams = (regMgr.json?.registrations ?? []).map(r => r.teamId);
  check('onglet manager : voit l\'inscription de A', regMgr.status === 200 && mgrRegTeams.includes(TEAM_A), `status ${regMgr.status} teams=${mgrRegTeams.join(',')}`);

  // 8) Onglet Inscriptions : le coach est refusé (403).
  const regCoach = await req('GET', `/api/structures/${STRUCT}/registrations`, COACH);
  check('onglet coach : 403', regCoach.status === 403, `status ${regCoach.status}`);

  // 9) Onglet Inscriptions : le dirigeant voit l'inscription.
  const regFounder = await req('GET', `/api/structures/${STRUCT}/registrations`, FOUNDER);
  check('onglet dirigeant : voit l\'inscription', regFounder.status === 200 && (regFounder.json?.registrations ?? []).length >= 1, `status ${regFounder.status}`);
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
