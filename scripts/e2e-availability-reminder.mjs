// E2E rappel de dispos — relance MANUELLE du staff. Couvre tous les chemins
// SANS poster sur Discord (403 / 404 / sans salon / tout-rempli / cooldown) :
// le vrai post exige un salon + le bot dans la guilde (comme R2, non testable
// en synthétique). Données préfixées e2e_avr, cleanup TOUJOURS en finally.
// Run : node --env-file=.env.local scripts/e2e-availability-reminder.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_avr';
const DIR = `discord_${P}_dir`;
const RESP = `discord_${P}_resp`;       // responsable RL (managerIds + managerGames)
const STRANGER = `discord_${P}_stranger`;
const P1 = `discord_${P}_p1`;
const P2 = `discord_${P}_p2`;
const STRUCT = `${P}-struct`;
const TEAM = `${P}-team`;          // avec salon
const TEAM_NOCHAN = `${P}-team-nochan`;

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

// ── Semaine ISO en cours (Europe/Paris), réplique de lib/availability ──
function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }
function addDays(ymd, n) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}
function isoDow(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const j = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return j === 0 ? 7 : j;
}
function mondayOf(ymd) { return addDays(ymd, -(isoDow(ymd) - 1)); }
function isoWeekId(mondayYmd) {
  const [y, mo, d] = mondayYmd.split('-').map(Number);
  const thu = new Date(Date.UTC(y, mo - 1, d + 3));
  const isoYear = thu.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((thu.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${isoYear}-W${pad2(weekNo)}`;
}
const parisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const CUR_WEEK = isoWeekId(mondayOf(parisToday));

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
  if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 120)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}
async function post(uid, teamId) {
  const res = await fetch(`${BASE}/api/structures/${STRUCT}/availability-reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ teamId }),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

async function setup() {
  const batch = db.batch();
  for (const uid of [DIR, RESP, STRANGER, P1, P2]) {
    batch.set(db.collection('users').doc(uid), {
      uid, displayName: uid.slice(-8), discordUsername: uid.slice(-8), games: [], createdAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('structures').doc(STRUCT), {
    name: 'E2E AVR', tag: 'AVR', founderId: DIR, coFounderIds: [],
    managerIds: [RESP], managerGames: { [RESP]: ['rocket_league'] },
    games: ['rocket_league'], status: 'active', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('sub_teams').doc(TEAM), {
    structureId: STRUCT, name: 'Équipe salon', game: 'rocket_league', status: 'active',
    discordChannelId: '123456789012345678', playerIds: [P1, P2], subIds: [], staffIds: [], createdAt: Timestamp.now(),
  });
  batch.set(db.collection('sub_teams').doc(TEAM_NOCHAN), {
    structureId: STRUCT, name: 'Équipe sans salon', game: 'rocket_league', status: 'active',
    discordChannelId: null, playerIds: [P1, P2], subIds: [], staffIds: [], createdAt: Timestamp.now(),
  });
  await batch.commit();
}

async function fillAvailability(uids) {
  for (const uid of uids) {
    await db.collection('user_availability').doc(`${uid}_${CUR_WEEK}`).set({
      uid, weekId: CUR_WEEK, slots: [`${mondayOf(parisToday)}T20:00`], updatedAt: Timestamp.now(),
    });
  }
}

async function cleanup() {
  console.log('\n— Cleanup…');
  for (const id of [TEAM, TEAM_NOCHAN]) await db.collection('sub_teams').doc(id).delete();
  await db.collection('structures').doc(STRUCT).delete();
  for (const uid of [DIR, RESP, STRANGER, P1, P2]) {
    await db.collection('users').doc(uid).delete();
    await db.collection('user_availability').doc(`${uid}_${CUR_WEEK}`).delete().catch(() => {});
  }
  await auth.deleteUsers([DIR, RESP, STRANGER, P1, P2]).catch(() => {});
  console.log('  cleanup terminé.');
}

async function run() {
  console.log(`— Semaine en cours ciblée : ${CUR_WEEK}`);

  let r = await post(STRANGER, TEAM);
  check('étranger à la structure → 403', r.status === 403, String(r.status));

  // Major review #2 : le responsable du jeu est AUTORISÉ (passe la permission ;
  // salon bidon → 502, jamais 403/401). Preuve que le droit dépasse le dirigeant.
  r = await post(RESP, TEAM);
  check('responsable du jeu autorisé (pas 403)', r.status !== 403 && r.status !== 401, String(r.status));
  await db.collection('sub_teams').doc(TEAM).update({ lastAvailabilityReminderAt: FieldValue.delete() }).catch(() => {});

  r = await post(DIR, `${P}-inconnu`);
  check('équipe inconnue → 404', r.status === 404, String(r.status));

  r = await post(DIR, TEAM_NOCHAN);
  check('équipe sans salon Discord → 409', r.status === 409 && /salon/i.test(r.json?.error ?? ''), `${r.status} ${r.json?.error}`);

  // Roster PAS rempli → le code atteint le post (salon bidon → échec Discord
  // capté = 502 post_failed). Preuve que le calcul « manquants » a bien tourné.
  r = await post(DIR, TEAM);
  check('roster incomplet → tentative de post (502 sur salon bidon)', r.status === 502 && r.json?.reason === 'post_failed', `${r.status} ${r.json?.reason}`);

  // Tout le roster rempli → court-circuit AVANT tout appel Discord.
  await fillAvailability([P1, P2]);
  r = await post(DIR, TEAM);
  check('tout le roster a rempli → all_filled, aucun post', r.status === 409 && r.json?.reason === 'all_filled', `${r.status} ${r.json?.reason}`);

  // Cooldown : on pose lastAvailabilityReminderAt = maintenant → 429.
  await db.collection('sub_teams').doc(TEAM).update({ lastAvailabilityReminderAt: Timestamp.now() });
  await db.collection('user_availability').doc(`${P1}_${CUR_WEEK}`).delete(); // re-crée un manquant
  r = await post(DIR, TEAM);
  check('cooldown actif → 429', r.status === 429, `${r.status} ${r.json?.error}`);

  // Minor review #4 : structure suspendue → aucune relance (cohérence calendrier).
  await db.collection('sub_teams').doc(TEAM).update({ lastAvailabilityReminderAt: FieldValue.delete() }).catch(() => {});
  await db.collection('structures').doc(STRUCT).update({ status: 'suspended' });
  r = await post(DIR, TEAM);
  check('structure suspendue → 409 (non active)', r.status === 409 && /active/i.test(r.json?.error ?? ''), `${r.status} ${r.json?.error}`);
  await db.collection('structures').doc(STRUCT).update({ status: 'active' });
}

await cleanup();
await setup();
try {
  await run();
} catch (e) {
  failed++;
  console.error('ERREUR:', e.message);
} finally {
  await cleanup();
}
console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed > 0 ? 1 : 0);
