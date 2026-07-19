// E2E accès aux stats de replay (§3.4). Prouve, contre les vraies routes :
//  - un JOUEUR d'une équipe lit les stats de SON équipe (meta + agg + stats/[id])
//    — avant, il recevait 403 partout ;
//  - un joueur d'une AUTRE équipe est refusé (403) → pas de fuite inter-équipes ;
//  - le joueur ne DÉCLENCHE jamais de parsing (ballchasingUploadedAt inchangé).
//
// En local, la clé ballchasing est absente → la route stats répond 'disabled'
// (avant tout forward), donc on prouve l'AUTH + la sûreté quota. La logique de
// déclenchement (canTriggerParse) est couverte par les tests unitaires.
//
// Données préfixées e2e_rst, cleanup TOUJOURS en finally (DB PARTAGÉE avec la prod).
// Run : node --env-file=.env.local scripts/e2e-replay-stats-access.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_rst';
const FOUNDER = `discord_${P}_founder`;
const PLAYER_A = `discord_${P}_playerA`;   // joueur de l'équipe ciblée
const PLAYER_B = `discord_${P}_playerB`;   // joueur d'une AUTRE équipe
const OUTSIDER = `discord_${P}_outsider`;  // pas membre du tout
const STRUCT = `${P}-struct`;
const TEAM_A = `${P}-teamA`;
const TEAM_B = `${P}-teamB`;
const EVENT = `${P}-event`;
const REPLAY = `${P}-replay`;
// Régression fix #5 (review Lot B) : event scope='structure' portant un replay
// de l'équipe A → le joueur de A doit accéder à /meta (avant : 403).
const EVENT_STRUCT = `${P}-eventStruct`;
const REPLAY_STRUCT = `${P}-replayStruct`;
// Régression fix #3 : event multi-équipes [A,B], replay de l'équipe B (2e de la
// liste) → le joueur de B doit lister ses replays sans passer teamId (avant, le
// client envoyait teamId=teamIds[0]=A → 403).
const EVENT_MULTI = `${P}-eventMulti`;
const REPLAY_MULTI_B = `${P}-replayMultiB`;

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
async function get(uid, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${await tokenFor(uid)}` } });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

async function setup() {
  const batch = db.batch();
  for (const uid of [FOUNDER, PLAYER_A, PLAYER_B, OUTSIDER]) {
    batch.set(db.collection('users').doc(uid), { uid, displayName: uid.slice(-8), discordUsername: uid.slice(-8), games: [], createdAt: Timestamp.now() });
  }
  batch.set(db.collection('structures').doc(STRUCT), {
    slug: STRUCT, name: 'E2E RST', tag: 'RST', founderId: FOUNDER, coFounderIds: [],
    managerIds: [], coachIds: [], games: ['rocket_league'], status: 'active',
    replayParsing: true, createdAt: Timestamp.now(),
  });
  // Membres de structure (PLAYER_A et B sont membres ; OUTSIDER non)
  for (const uid of [FOUNDER, PLAYER_A, PLAYER_B]) {
    batch.set(db.collection('structure_members').doc(`${STRUCT}_${uid}_rocket_league`), {
      structureId: STRUCT, userId: uid, game: 'rocket_league', role: 'joueur', joinedAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('sub_teams').doc(TEAM_A), {
    structureId: STRUCT, name: 'Team A', game: 'rocket_league', status: 'active',
    playerIds: [PLAYER_A], subIds: [], staffIds: [], captainId: null, createdAt: Timestamp.now(),
  });
  batch.set(db.collection('sub_teams').doc(TEAM_B), {
    structureId: STRUCT, name: 'Team B', game: 'rocket_league', status: 'active',
    playerIds: [PLAYER_B], subIds: [], staffIds: [], captainId: null, createdAt: Timestamp.now(),
  });
  batch.set(db.collection('structure_events').doc(EVENT), {
    structureId: STRUCT, title: 'Scrim A', type: 'scrim',
    target: { scope: 'teams', teamIds: [TEAM_A] },
    startsAt: Timestamp.now(), createdAt: Timestamp.now(),
  });
  // Replay non parsé (manual, pas de ballchasingId, jamais uploadé) sur l'event, équipe A.
  batch.set(db.collection('replays').doc(REPLAY), {
    structureId: STRUCT, eventId: EVENT, teamId: TEAM_A, status: 'ready',
    title: 'game1.replay', sizeBytes: 1024, uploadedBy: FOUNDER,
    ballchasingStatus: 'manual', ballchasingUploadedAt: null, createdAt: Timestamp.now(),
  });
  // Fix #5 : event scope='structure' (pas 'teams') portant un replay de l'équipe A.
  batch.set(db.collection('structure_events').doc(EVENT_STRUCT), {
    structureId: STRUCT, title: 'Bilan général', type: 'match',
    target: { scope: 'structure' },
    startsAt: Timestamp.now(), createdAt: Timestamp.now(),
  });
  batch.set(db.collection('replays').doc(REPLAY_STRUCT), {
    structureId: STRUCT, eventId: EVENT_STRUCT, teamId: TEAM_A, status: 'ready',
    title: 'struct.replay', sizeBytes: 1024, uploadedBy: FOUNDER,
    ballchasingStatus: 'manual', ballchasingUploadedAt: null, createdAt: Timestamp.now(),
  });
  // Fix #3 : event multi-équipes [A,B] avec un replay de l'équipe B (2e de la liste).
  batch.set(db.collection('structure_events').doc(EVENT_MULTI), {
    structureId: STRUCT, title: 'Scrim commun', type: 'scrim',
    target: { scope: 'teams', teamIds: [TEAM_A, TEAM_B] },
    startsAt: Timestamp.now(), createdAt: Timestamp.now(),
  });
  batch.set(db.collection('replays').doc(REPLAY_MULTI_B), {
    structureId: STRUCT, eventId: EVENT_MULTI, teamId: TEAM_B, status: 'ready',
    title: 'multiB.replay', sizeBytes: 1024, uploadedBy: FOUNDER,
    ballchasingStatus: 'manual', ballchasingUploadedAt: null, createdAt: Timestamp.now(),
  });
  await batch.commit();
}

async function replayUploadedAt() {
  const s = await db.collection('replays').doc(REPLAY).get();
  return s.data()?.ballchasingUploadedAt ?? null;
}

async function cleanup() {
  for (const id of [TEAM_A, TEAM_B]) await db.collection('sub_teams').doc(id).delete().catch(() => {});
  for (const id of [EVENT, EVENT_STRUCT, EVENT_MULTI]) await db.collection('structure_events').doc(id).delete().catch(() => {});
  for (const id of [REPLAY, REPLAY_STRUCT, REPLAY_MULTI_B]) await db.collection('replays').doc(id).delete().catch(() => {});
  await db.collection('structures').doc(STRUCT).delete().catch(() => {});
  for (const uid of [FOUNDER, PLAYER_A, PLAYER_B]) await db.collection('structure_members').doc(`${STRUCT}_${uid}_rocket_league`).delete().catch(() => {});
  for (const uid of [FOUNDER, PLAYER_A, PLAYER_B, OUTSIDER]) await db.collection('users').doc(uid).delete().catch(() => {});
  await auth.deleteUsers([FOUNDER, PLAYER_A, PLAYER_B, OUTSIDER]).catch(() => {});
}

async function run() {
  const metaPath = `/api/events/${EVENT}/meta`;
  const aggPath = `/api/structures/${STRUCT}/events/${EVENT}/replay-stats-agg`;
  const statsPath = `/api/structures/${STRUCT}/replays/${REPLAY}/stats`;

  // ── Joueur de l'équipe ciblée : LIT tout (avant : 403 partout) ──
  let r = await get(PLAYER_A, metaPath);
  check('joueur de l\'équipe → meta 200 (avant : 403)', r.status === 200, `${r.status} ${r.json?.error}`);
  r = await get(PLAYER_A, aggPath);
  check('joueur de l\'équipe → replay-stats-agg 200', r.status === 200, `${r.status} ${r.json?.error}`);
  const before = await replayUploadedAt();
  r = await get(PLAYER_A, statsPath);
  check('joueur de l\'équipe → stats pas 403 (auth passée)', r.status !== 403 && r.status !== 401, `${r.status}`);
  check('joueur → aucun parsing déclenché (ballchasingUploadedAt inchangé, quota intact)',
    String(await replayUploadedAt()) === String(before), 'uploadedAt a changé !');

  // ── Joueur d'une AUTRE équipe : refusé (pas de fuite inter-équipes) ──
  r = await get(PLAYER_B, metaPath);
  check('joueur d\'une autre équipe → meta 403', r.status === 403, `${r.status}`);
  r = await get(PLAYER_B, statsPath);
  check('joueur d\'une autre équipe → stats 403 (hors périmètre)', r.status === 403, `${r.status} ${r.json?.error}`);

  // ── Non-membre : refusé ──
  r = await get(OUTSIDER, metaPath);
  check('non-membre → meta refusé (403/404)', r.status === 403 || r.status === 404, `${r.status}`);

  // ── Dirigeant : lit tout (non-régression) ──
  r = await get(FOUNDER, metaPath);
  check('dirigeant → meta 200', r.status === 200, `${r.status}`);

  // ── Fix #5 : event scope='structure' portant un replay de l'équipe du joueur ──
  const metaStructPath = `/api/events/${EVENT_STRUCT}/meta`;
  r = await get(PLAYER_A, metaStructPath);
  check('joueur (équipe A) → meta d\'un event scope=structure avec replay de son équipe : 200 (avant : 403)',
    r.status === 200, `${r.status} ${r.json?.error}`);
  r = await get(PLAYER_B, metaStructPath);
  check('joueur (équipe B, aucun replay sur cet event) → meta scope=structure 403 (pas d\'ouverture large)',
    r.status === 403, `${r.status}`);
  r = await get(OUTSIDER, metaStructPath);
  check('non-membre → meta scope=structure refusé (403/404)', r.status === 403 || r.status === 404, `${r.status}`);

  // ── Fix #3 : event multi-équipes [A,B], replay de l'équipe B (2e), liste SANS teamId ──
  const multiListPath = `/api/structures/${STRUCT}/replays?eventId=${EVENT_MULTI}`;
  r = await get(PLAYER_B, multiListPath);
  const bReplays = Array.isArray(r.json?.replays) ? r.json.replays : [];
  check('joueur (équipe B) → liste event multi-équipes sans teamId : voit le replay de SON équipe (avant : 403)',
    r.status === 200 && bReplays.some(x => x.id === REPLAY_MULTI_B), `${r.status} [${bReplays.map(x => x.id).join(',')}]`);
  r = await get(PLAYER_A, multiListPath);
  const aReplays = Array.isArray(r.json?.replays) ? r.json.replays : [];
  check('joueur (équipe A) → même liste : ne voit PAS le replay de l\'équipe B (scoping intact)',
    r.status === 200 && !aReplays.some(x => x.id === REPLAY_MULTI_B), `${r.status} [${aReplays.map(x => x.id).join(',')}]`);

  // ── Sans auth ──
  const anon = await fetch(`${BASE}${metaPath}`);
  check('sans token → 401', anon.status === 401, `${anon.status}`);
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
