// E2E — système de sanctions graduées (warn / ban) : création, cumul warn,
// anti-doublon ban, révocation, notif in-app. Données synthétiques (préfixe
// e2e_sanc), cleanup TOUJOURS en finally. Dev server FRAIS + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-sanctions.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_sanc';
const ADMIN = `discord_${P}_admin`;
const OWNER = `discord_${P}_owner`;
const PLAYER = `discord_${P}_player`;
const STRUCT = `${P}-struct`;
const TEAM = `${P}-team`;

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
  if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 120)}`);
  return json.idToken;
}
async function api(method, path, body) {
  const t = await token(ADMIN);
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const ALL = [ADMIN, OWNER, PLAYER];

async function setup() {
  for (const uid of ALL) { try { await auth.getUser(uid); } catch { try { await auth.createUser({ uid }); } catch { /**/ } } }
  const b = db.batch();
  b.set(db.collection('aedral_admins').doc(ADMIN), { addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  for (const uid of ALL) b.set(db.collection('users').doc(uid), { uid, displayName: uid.slice(-6), discordId: '999999990000000002', games: ['rocket_league'], createdAt: Timestamp.now() }, { merge: true });
  b.set(db.collection('structures').doc(STRUCT), { name: 'E2E Sanc Struct', tag: 'SNC', status: 'active', founderId: OWNER, coFounderIds: [], managerIds: [], coachIds: [], games: ['rocket_league'], createdAt: FieldValue.serverTimestamp() });
  b.set(db.collection('sub_teams').doc(TEAM), { structureId: STRUCT, game: 'rocket_league', name: 'Sanc Team', status: 'active', playerIds: [PLAYER], subIds: [], captainId: PLAYER, staffIds: [], staffRoles: {}, createdAt: FieldValue.serverTimestamp() });
  await b.commit();
}

async function cleanup() {
  // Sanctions créées.
  const snap = await db.collection('competition_sanctions').where('targetId', 'in', [TEAM, PLAYER, STRUCT]).get().catch(() => ({ docs: [] }));
  for (const d of snap.docs) await d.ref.delete().catch(() => {});
  // Notifs.
  for (const uid of ALL) {
    const ns = await db.collection('notifications').where('userId', '==', uid).get().catch(() => ({ docs: [] }));
    for (const n of ns.docs) await n.ref.delete().catch(() => {});
  }
  for (const ref of [db.collection('structures').doc(STRUCT), db.collection('sub_teams').doc(TEAM), db.collection('aedral_admins').doc(ADMIN)]) await ref.delete().catch(() => {});
  const ub = db.batch();
  for (const uid of ALL) ub.delete(db.collection('users').doc(uid));
  await ub.commit().catch(() => {});
  await auth.deleteUsers(ALL).catch(() => {});
}

async function run() {
  await setup();

  // 1) Avertissement sur l'ÉQUIPE.
  const warn1 = await api('POST', '/api/admin/competition-sanctions', {
    type: 'warn', targetType: 'team', targetId: TEAM, reasonCode: 'late_checkin',
    reason: 'Retard au check-in général', competitionName: 'E2E Cup',
  });
  check('warn équipe créé (200)', warn1.status === 200, `status ${warn1.status} ${JSON.stringify(warn1.json)}`);

  // 2) 2e avertissement même équipe → cumulable (pas de 409).
  const warn2 = await api('POST', '/api/admin/competition-sanctions', {
    type: 'warn', targetType: 'team', targetId: TEAM, reason: 'Comportement limite', competitionName: 'E2E Cup',
  });
  check('2e warn cumulable (200, pas 409)', warn2.status === 200, `status ${warn2.status}`);

  // 3) Notif in-app envoyée au dirigeant (founderId).
  const ownerNotifs = await db.collection('notifications').where('userId', '==', OWNER).where('type', '==', 'competition_sanction').get();
  check('dirigeant notifié in-app', ownerNotifs.size >= 1, `n=${ownerNotifs.size}`);

  // 4) Ban d'un joueur.
  const ban = await api('POST', '/api/admin/competition-sanctions', {
    type: 'ban', targetType: 'user', targetId: PLAYER, reasonCode: 'cheat_smurf', reason: 'Smurf avéré',
  });
  check('ban joueur créé (200)', ban.status === 200, `status ${ban.status}`);

  // 5) Ban doublon (même joueur) → 409.
  const banDup = await api('POST', '/api/admin/competition-sanctions', {
    type: 'ban', targetType: 'user', targetId: PLAYER, reason: 'Encore',
  });
  check('ban doublon refusé (409)', banDup.status === 409, `status ${banDup.status}`);

  // 6) Liste = 3 sanctions (2 warns + 1 ban).
  const list = await api('GET', '/api/admin/competition-sanctions');
  const mine = (list.json?.sanctions ?? []).filter(s => [TEAM, PLAYER].includes(s.targetId));
  check('liste contient 3 sanctions', mine.length === 3, `n=${mine.length}`);
  check('ban actif dans la liste', mine.some(s => s.type === 'ban' && s.active === true));

  // 7) Révocation du ban → actif=false.
  const banId = mine.find(s => s.type === 'ban')?.id;
  const revoke = await api('PATCH', `/api/admin/competition-sanctions/${banId}`, { action: 'revoke' });
  check('révocation ban (200)', revoke.status === 200, `status ${revoke.status}`);
  const list2 = await api('GET', '/api/admin/competition-sanctions');
  const banAfter = (list2.json?.sanctions ?? []).find(s => s.id === banId);
  check('ban révoqué inactif', banAfter && banAfter.active === false, `active=${banAfter?.active}`);
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
