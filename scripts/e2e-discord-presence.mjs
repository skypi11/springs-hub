// E2E présence : (1) NON-RÉGRESSION de la route présence du site après extraction
// du helper partagé writePresence — prouve le chemin end-to-end contre Firestore
// réel (present/maybe/absent, pas-invité→404, event terminé→403) ; (2) GARDE du
// endpoint d'interactions Discord (signature invalide / headers manquants → 401).
//
// Le chemin d'écriture (writePresence) est partagé par la route du site ET le
// handler Discord ; le prouver via la route du site couvre donc les deux.
// La signature Ed25519 est couverte par les tests unitaires (vraie keypair).
//
// Données préfixées e2e_dp, cleanup TOUJOURS en finally (DB PARTAGÉE avec la prod).
// Run : node --env-file=.env.local scripts/e2e-discord-presence.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_dp';
const FOUNDER = `discord_${P}_founder`;
const PLAYER = `discord_${P}_player`;     // invité à EVENT + EVENT_DONE
const OUTSIDER = `discord_${P}_out`;      // membre mais PAS invité
const STRUCT = `${P}-struct`;
const TEAM = `${P}-team`;
const EVENT = `${P}-event`;               // scheduled, futur
const EVENT_DONE = `${P}-eventDone`;      // terminé → réponse refusée
const PRES_EVENT_PLAYER = `${P}-pres1`;
const PRES_EVENT_FOUNDER = `${P}-pres2`;
const PRES_DONE_PLAYER = `${P}-pres3`;

function parseSA(raw) { try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`)); } }
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
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 140)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}
async function postPresence(uid, eventId, body) {
  const res = await fetch(`${BASE}/api/structures/${STRUCT}/events/${eventId}/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}
async function presenceStatus(presId) {
  const s = await db.collection('event_presences').doc(presId).get();
  return s.data()?.status ?? null;
}

async function setup() {
  const batch = db.batch();
  for (const uid of [FOUNDER, PLAYER, OUTSIDER]) {
    batch.set(db.collection('users').doc(uid), { uid, displayName: uid.slice(-10), discordUsername: uid.slice(-10), games: [], createdAt: Timestamp.now() });
  }
  batch.set(db.collection('structures').doc(STRUCT), {
    slug: STRUCT, name: 'E2E DP', tag: 'EDP', founderId: FOUNDER, coFounderIds: [],
    managerIds: [], coachIds: [], games: ['rocket_league'], status: 'active', createdAt: Timestamp.now(),
  });
  for (const uid of [FOUNDER, PLAYER, OUTSIDER]) {
    batch.set(db.collection('structure_members').doc(`${STRUCT}_${uid}_rocket_league`), {
      structureId: STRUCT, userId: uid, game: 'rocket_league', role: 'joueur', joinedAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('sub_teams').doc(TEAM), {
    structureId: STRUCT, name: 'Team', game: 'rocket_league', status: 'active',
    playerIds: [PLAYER], subIds: [], staffIds: [], captainId: null, createdAt: Timestamp.now(),
  });
  // Event scheduled dans le FUTUR (rejectPast ne mordra pas ; le site l'autorise).
  const inTwoDays = Timestamp.fromMillis(Date.now() + 2 * 24 * 3600 * 1000);
  batch.set(db.collection('structure_events').doc(EVENT), {
    structureId: STRUCT, title: 'Scrim', type: 'scrim', status: 'scheduled',
    target: { scope: 'teams', teamIds: [TEAM] }, createdBy: FOUNDER,
    startsAt: inTwoDays, endsAt: inTwoDays, createdAt: Timestamp.now(),
  });
  batch.set(db.collection('structure_events').doc(EVENT_DONE), {
    structureId: STRUCT, title: 'Scrim passé', type: 'scrim', status: 'done',
    target: { scope: 'teams', teamIds: [TEAM] }, createdBy: FOUNDER,
    startsAt: inTwoDays, endsAt: inTwoDays, createdAt: Timestamp.now(),
  });
  // Lignes de présence (preuve d'invitation). OUTSIDER n'en a AUCUNE.
  batch.set(db.collection('event_presences').doc(PRES_EVENT_PLAYER), {
    eventId: EVENT, structureId: STRUCT, userId: PLAYER, status: 'pending', wasStructureMember: true, respondedAt: null, updatedBy: null, history: [],
  });
  batch.set(db.collection('event_presences').doc(PRES_EVENT_FOUNDER), {
    eventId: EVENT, structureId: STRUCT, userId: FOUNDER, status: 'pending', wasStructureMember: true, respondedAt: null, updatedBy: null, history: [],
  });
  batch.set(db.collection('event_presences').doc(PRES_DONE_PLAYER), {
    eventId: EVENT_DONE, structureId: STRUCT, userId: PLAYER, status: 'pending', wasStructureMember: true, respondedAt: null, updatedBy: null, history: [],
  });
  await batch.commit();
}

async function cleanup() {
  await db.collection('sub_teams').doc(TEAM).delete().catch(() => {});
  for (const id of [EVENT, EVENT_DONE]) await db.collection('structure_events').doc(id).delete().catch(() => {});
  for (const id of [PRES_EVENT_PLAYER, PRES_EVENT_FOUNDER, PRES_DONE_PLAYER]) await db.collection('event_presences').doc(id).delete().catch(() => {});
  await db.collection('structures').doc(STRUCT).delete().catch(() => {});
  for (const uid of [FOUNDER, PLAYER, OUTSIDER]) await db.collection('structure_members').doc(`${STRUCT}_${uid}_rocket_league`).delete().catch(() => {});
  for (const uid of [FOUNDER, PLAYER, OUTSIDER]) await db.collection('users').doc(uid).delete().catch(() => {});
  await auth.deleteUsers([FOUNDER, PLAYER, OUTSIDER]).catch(() => {});
}

async function run() {
  // ── (1) Route présence du site (helper writePresence partagé) ──
  let r = await postPresence(PLAYER, EVENT, { status: 'present' });
  check('joueur invité → present : 200', r.status === 200, `${r.status} ${r.json?.error}`);
  check('present écrit en base', (await presenceStatus(PRES_EVENT_PLAYER)) === 'present');

  r = await postPresence(PLAYER, EVENT, { status: 'maybe' });
  check('joueur invité → maybe : 200 + écrit', r.status === 200 && (await presenceStatus(PRES_EVENT_PLAYER)) === 'maybe', `${r.status}`);

  r = await postPresence(PLAYER, EVENT, { status: 'absent' });
  check('joueur invité → absent : 200 + écrit', r.status === 200 && (await presenceStatus(PRES_EVENT_PLAYER)) === 'absent', `${r.status}`);

  r = await postPresence(PLAYER, EVENT, { status: 'bogus' });
  check('statut invalide → 400', r.status === 400, `${r.status}`);

  r = await postPresence(OUTSIDER, EVENT, { status: 'present' });
  check('membre NON invité → 404 (pas de ligne de présence)', r.status === 404, `${r.status} ${r.json?.error}`);

  r = await postPresence(PLAYER, EVENT_DONE, { status: 'present' });
  check('event terminé → 403', r.status === 403, `${r.status} ${r.json?.error}`);
  check('event terminé : présence NON modifiée', (await presenceStatus(PRES_DONE_PLAYER)) === 'pending');

  r = await postPresence(PLAYER, `${P}-nope`, { status: 'present' });
  check('event inexistant → 404', r.status === 404, `${r.status}`);

  // ── (2) Garde du endpoint Discord (signature) ──
  const ping = JSON.stringify({ type: 1 });
  let d = await fetch(`${BASE}/api/discord/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature-ed25519': 'ab'.repeat(64), 'x-signature-timestamp': '1700000000' },
    body: ping,
  });
  check('interactions : signature bidon → 401', d.status === 401, `${d.status}`);

  d = await fetch(`${BASE}/api/discord/interactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ping,
  });
  check('interactions : headers de signature absents → 401', d.status === 401, `${d.status}`);
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
  console.log('\n— Cleanup terminé.');
}
console.log(`\n${passed} ✓ / ${failed} ✗`);
process.exit(failed > 0 ? 1 : 0);
