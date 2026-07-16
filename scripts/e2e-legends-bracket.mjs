// E2E Lot 2 — seeding + matérialisation du bracket (données 100 % synthétiques,
// préfixe e2e_lot2, cleanup TOUJOURS en finally, comp dédiée jamais publique).
// Prérequis : dev server localhost:3000 + .env.local.
// Run : node --env-file=.env.local scripts/e2e-legends-bracket.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_lot2';
const ADMIN_UID = `discord_${P}_admin`;
const COMP = `${P}-comp`;
const TEAM_COUNT = 5; // size 8, 3 byes → 15 matchs

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
async function api(method, path, body) {
  const token = await tokenFor(ADMIN_UID);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

function regId(i) { return `${COMP}_team${i}`; }

async function setup() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E Bracket Admin', discordUsername: 'e2e_brk',
    discordId: '999999999999999999', games: [], createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({ addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  await db.collection('competitions').doc(COMP).set({
    name: 'TEST E2E Bracket — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'double_elim', maxTeams: 32,
      bo: { default: 5, overrides: [
        { bracket: 'winners', roundsFromEnd: 1, bo: 7 },
        { bracket: 'winners', roundsFromEnd: 2, bo: 7 },
        { bracket: 'losers', roundsFromEnd: 1, bo: 7 },
        { bracket: 'losers', roundsFromEnd: 2, bo: 7 },
      ], grandFinal: 7 },
      bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: true, minAge: 16, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-01-01')), closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: true },
    schedule: { days: [{ date: '2026-09-26', startsAt: '15:00' }], phasePlan: [
      { phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] },
    ], generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3 },
    discord: null, status: 'draft', approvedCount: TEAM_COUNT, createdAt: Timestamp.now(),
  });
  const batch = db.batch();
  for (let i = 1; i <= TEAM_COUNT; i++) {
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `team${i}`,
      name: `Team ${i}`, tag: `T${i}`, logoUrl: null,
      rosterUids: [`${P}_u${i}a`, `${P}_u${i}b`, `${P}_u${i}c`],
      status: 'approved', createdAt: Timestamp.now(),
    });
  }
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
  await db.collection('aedral_admins').doc(ADMIN_UID).delete();
  await db.collection('users').doc(ADMIN_UID).delete();
  const logs = await db.collection('admin_audit_logs').where('adminUid', '==', ADMIN_UID).get();
  for (const d of logs.docs) await d.ref.delete();
  await auth.deleteUsers([ADMIN_UID]).catch(() => {});
  console.log('  cleanup terminé.');
}

async function run() {
  // 1. GET initial : peut ouvrir le seeding, 5 validées
  let r = await api('GET', `/api/admin/competitions/${COMP}/bracket`);
  check('1. GET initial : canOpenSeeding, 5 équipes validées',
    r.status === 200 && r.json?.canOpenSeeding === true && r.json?.approvedCount === 5 && r.json?.status === 'draft',
    JSON.stringify({ s: r.status, open: r.json?.canOpenSeeding, n: r.json?.approvedCount }));

  // 2. open_seeding → statut seeding, 5 seeds
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  check('2. open_seeding → seeding, 5 seeds (permutation des validées)',
    r.status === 200 && r.json?.status === 'seeding' && r.json?.seeding?.length === 5
    && new Set(r.json.seeding).size === 5,
    JSON.stringify({ s: r.status, st: r.json?.status }));
  const seededOrder = r.json.seeding;

  // 3. reorder invalide (id inconnu) → 409
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'reorder', order: [...seededOrder.slice(0, 4), 'inconnu'] });
  check('3. reorder avec un id inconnu → 409', r.status === 409, `status ${r.status}`);

  // 4. reorder valide (inversion) → appliqué
  const reversed = [...seededOrder].reverse();
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'reorder', order: reversed });
  check('4. reorder valide → ordre appliqué', r.status === 200 && JSON.stringify(r.json?.seeding) === JSON.stringify(reversed),
    JSON.stringify(r.json?.seeding));

  // 5. publish → live, 15 matchs (size 8 : 7 winners + 6 losers + GF + GFR)
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  check('5. publish → live, 15 matchs matérialisés', r.status === 200 && r.json?.status === 'live' && r.json?.matchCount === 15,
    JSON.stringify({ s: r.status, st: r.json?.status, mc: r.json?.matchCount }));

  // 6. DB : docs matchs écrits, statut compétition live, withdrawn init, seeding figé
  const compSnap = await db.collection('competitions').doc(COMP).get();
  const matchSnap = await db.collection('competition_matches').where('competitionId', '==', COMP).get();
  check('6. DB : 15 docs matchs, statut live, withdrawn=[], bracketMaterializedAt posé',
    matchSnap.size === 15 && compSnap.data()?.status === 'live'
    && Array.isArray(compSnap.data()?.withdrawn) && compSnap.data()?.withdrawn.length === 0
    && !!compSnap.data()?.bracketMaterializedAt,
    JSON.stringify({ n: matchSnap.size, st: compSnap.data()?.status }));

  // 7. GF + GFR présents, doc id = comp__key, id field = key
  const gf = await db.collection('competition_matches').doc(`${COMP}__GF`).get();
  const gfr = await db.collection('competition_matches').doc(`${COMP}__GFR`).get();
  check('7. GF + reset présents, id field = clé moteur',
    gf.exists && gfr.exists && gf.data()?.id === 'GF' && gfr.data()?.id === 'GFR',
    JSON.stringify({ gf: gf.exists, gfr: gfr.exists }));

  // 8. Byes matérialisés en walkover sans score (3 byes attendus sur 5 équipes)
  const walkovers = matchSnap.docs.filter(d => d.data().status === 'walkover');
  const w1walk = walkovers.find(d => d.data().bracket === 'winners' && d.data().round === 1);
  check('8. byes → walkover round 1 sans score, un côté void',
    walkovers.length >= 1 && w1walk && w1walk.data().scores?.final === null
    && (w1walk.data().voidA || w1walk.data().voidB) && w1walk.data().winner !== null,
    JSON.stringify({ walk: walkovers.length }));

  // 9. Dénormalisation : un W1 avec 2 équipes connues porte teamAInfo/teamBInfo
  const w1full = matchSnap.docs.find(d => d.data().bracket === 'winners' && d.data().round === 1
    && d.data().teamA && d.data().teamB);
  check('9. match round 1 complet : teamAInfo/teamBInfo dénormalisés',
    !!w1full && !!w1full.data().teamAInfo?.name && !!w1full.data().teamBInfo?.name,
    w1full ? JSON.stringify(w1full.data().teamAInfo) : 'aucun W1 complet');

  // 10. ACL privée écrite pour un match round 1 aux équipes connues (6 uids)
  let aclOk = false;
  if (w1full) {
    const acl = await w1full.ref.collection('private').doc('acl').get();
    aclOk = acl.exists && acl.data()?.participantUids?.length === 6;
  }
  check('10. ACL privée round 1 : participantUids = 2 rosters (6 uids)', aclOk);

  // 11. republish → 409 (déjà matérialisé, seeding figé)
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  check('11. re-publish → 409 (bracket déjà publié)', r.status === 409, `status ${r.status}`);

  // 12. shuffle après publish → 409
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'shuffle' });
  check('12. shuffle après publish → 409', r.status === 409, `status ${r.status}`);

  // 13. accès refusé à un non-admin compét
  const outsider = `discord_${P}_outsider`;
  await auth.createUser({ uid: outsider }).catch(() => {});
  await db.collection('users').doc(outsider).set({ uid: outsider, displayName: 'x', games: [] });
  const t = await tokenFor(outsider);
  const res = await fetch(`${BASE}/api/admin/competitions/${COMP}/bracket`, { headers: { Authorization: `Bearer ${t}` } });
  check('13. GET bracket par un non-admin → 403', res.status === 403, `status ${res.status}`);
  await db.collection('users').doc(outsider).delete();
  await auth.deleteUsers([outsider]).catch(() => {});
}

await cleanup(); // préventif
await setup();
try {
  await run();
} catch (err) {
  failed++;
  console.error('\n✗ Exception :', err);
} finally {
  await cleanup();
}
console.log(`\n═══ Résultat : ${passed} ✓ / ${failed} ✗ ═══`);
process.exit(failed > 0 ? 1 : 0);
