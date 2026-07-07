// E2E — ajout au planning à la validation d'une inscription (calendar-sync).
// Données synthétiques (préfixe e2e_plan), cleanup TOUJOURS en finally.
// Prérequis : dev server localhost:3000 FRAIS + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-planning.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_plan';
const ADMIN = `discord_${P}_admin`;
const STRUCT = `${P}-struct`;
const TEAM = `${P}-team`;
const COMP = `${P}-comp`;
const REG = `${COMP}_${TEAM}`;
const PLAYERS = [1, 2, 3].map(i => `discord_${P}_p${i}`);

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

async function token(uid) {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 120)}`);
  return json.idToken;
}
async function post(body) {
  const t = await token(ADMIN);
  const res = await fetch(`${BASE}/api/admin/competitions/${COMP}/registrations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const ALL_UIDS = [ADMIN, ...PLAYERS];

async function setup() {
  for (const uid of ALL_UIDS) { try { await auth.getUser(uid); } catch { try { await auth.createUser({ uid }); } catch { /* course */ } } }
  const batch = db.batch();
  batch.set(db.collection('aedral_admins').doc(ADMIN), { addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  for (const uid of ALL_UIDS) {
    batch.set(db.collection('users').doc(uid), { uid, displayName: uid.slice(-2).toUpperCase(), discordId: '999999990000000001', games: ['rocket_league'], createdAt: Timestamp.now() }, { merge: true });
  }
  batch.set(db.collection('structures').doc(STRUCT), {
    name: 'E2E Plan Struct', tag: 'PLN', status: 'active', founderId: PLAYERS[0],
    coFounderIds: [], managerIds: [], coachIds: [], games: ['rocket_league'], createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection('sub_teams').doc(TEAM), {
    structureId: STRUCT, game: 'rocket_league', name: 'Plan Team', status: 'active',
    playerIds: PLAYERS, subIds: [], captainId: PLAYERS[0], staffIds: [], staffRoles: {},
    createdAt: FieldValue.serverTimestamp(),
  });
  const now = Date.now();
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'E2E Plan Comp', game: 'rocket_league', circuitId: null,
    format: { kind: 'double_elim', maxTeams: 32, bo: { default: 5, overrides: [], grandFinal: 7 }, bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 } },
    eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromMillis(now - 86400000), closesAt: Timestamp.fromMillis(now + 86400000), waitlist: true },
    schedule: {
      days: [
        { date: '2026-09-26', startsAt: '15:00', endsAt: '22:00' },
        { date: '2026-09-27', startsAt: '15:00', endsAt: '22:00' },
      ],
      phasePlan: [], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    status: 'registration', approvedCount: 0, createdAt: FieldValue.serverTimestamp(),
  });
  // Inscription PENDING (posée directement, comme après le wizard).
  batch.set(db.collection('competition_registrations').doc(REG), {
    competitionId: COMP, circuitTeamId: null, structureId: STRUCT, teamId: TEAM,
    name: 'Plan Team', tag: 'PLN', logoUrl: null, captainUid: PLAYERS[0],
    rosterUids: PLAYERS,
    roster: PLAYERS.map((u, i) => ({ uid: u, role: 'titulaire', displayName: `P${i + 1}`, declaredCurrentMmr: 0, declaredPeakMmr: 0, refMmr: 0, epicId: null, epicName: null, steamId: null, trackerUrl: null, discordId: '1', discordUsername: null, country: null, age: null, verified: true, onDiscordGuild: null })),
    computed: { worstLineupAvg: null, worstLineupGap: null, flags: [] },
    status: 'pending', review: null, rulebookAccepted: null, generalCheckin: null,
    discord: { provisioningStatus: 'none', roleId: null, textChannelId: null, voiceChannelId: null },
    createdByOnDiscordGuild: null, seed: null, createdBy: PLAYERS[0], createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}

async function eventDocs() {
  return Promise.all([0, 1].map(i => db.collection('structure_events').doc(`legcomp_${COMP}_${TEAM}_d${i}`).get()));
}

async function cleanup() {
  for (const ref of [
    db.collection('structures').doc(STRUCT), db.collection('sub_teams').doc(TEAM),
    db.collection('competitions').doc(COMP), db.collection('competition_registrations').doc(REG),
    db.collection('aedral_admins').doc(ADMIN),
  ]) await ref.delete().catch(() => {});
  for (let i = 0; i < 2; i++) {
    const id = `legcomp_${COMP}_${TEAM}_d${i}`;
    const ps = await db.collection('event_presences').where('eventId', '==', id).get();
    for (const p of ps.docs) await p.ref.delete().catch(() => {});
    await db.collection('structure_events').doc(id).delete().catch(() => {});
  }
  const b = db.batch();
  for (const uid of ALL_UIDS) b.delete(db.collection('users').doc(uid));
  await b.commit().catch(() => {});
  await auth.deleteUsers(ALL_UIDS).catch(() => {});
}

async function run() {
  await setup();

  // 1) Approbation → les 2 créneaux calendrier sont créés.
  const approve = await post({ action: 'approve', registrationId: REG });
  check('approve 200', approve.status === 200, `status ${approve.status} ${JSON.stringify(approve.json)}`);
  const [d0, d1] = await eventDocs();
  check('créneau jour 1 créé', d0.exists && d0.data().type === 'tournoi' && d0.data().target?.scope === 'teams', d0.exists ? JSON.stringify(d0.data().target) : 'absent');
  check('créneau jour 2 créé', d1.exists, d1.exists ? '' : 'absent');
  check('heure de fin appliquée (22:00)', d0.exists && d0.data().endsAt?.toDate?.().getHours() === 22, d0.exists ? String(d0.data().endsAt?.toDate?.().getHours()) : '?');
  const pres = await db.collection('event_presences').where('eventId', '==', `legcomp_${COMP}_${TEAM}_d0`).get();
  check('présences créées (3 joueurs)', pres.size === 3, `n=${pres.size}`);

  // 2) Idempotence : re-approuver ne duplique pas (déjà approved → 409, mais les events restent uniques).
  const reApprove = await post({ action: 'approve', registrationId: REG });
  check('re-approve rejeté (déjà validée)', reApprove.status === 409, `status ${reApprove.status}`);

  // 3) Unapprove → les créneaux sont retirés.
  const unapprove = await post({ action: 'unapprove', registrationId: REG });
  check('unapprove 200', unapprove.status === 200, `status ${unapprove.status}`);
  const [u0, u1] = await eventDocs();
  check('créneaux retirés', !u0.exists && !u1.exists, `d0=${u0.exists} d1=${u1.exists}`);
  const presAfter = await db.collection('event_presences').where('eventId', '==', `legcomp_${COMP}_${TEAM}_d0`).get();
  check('présences retirées', presAfter.size === 0, `n=${presAfter.size}`);
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
