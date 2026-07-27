// E2E publication d'un circuit — le chemin qui manquait pour rendre la Legends
// Springs Cup visible du public.
//
// Prouve : un circuit naît invisible, se publie, devient réellement lisible par
// un anonyme, reste corrigeable sur ce qui ne fausse pas le classement, refuse
// les changements de barème une fois public, et ne peut pas être remasqué dès
// qu'une étape est terminée (son classement est sous les yeux des équipes).
//
// Données préfixées e2e_cp, cleanup TOUJOURS en finally (DB PARTAGÉE avec la prod).
// Run : node --env-file=.env.local scripts/e2e-circuit-publish.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_cp';
const ADMIN_UID = `discord_${P}_admin`;
const CIRCUIT = `${P}-circuit`;
const COMP = `${P}-etape`;

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
function section(t) { console.log(`\n▸ ${t}`); }

let idToken = null;
async function api(method, path, body) {
  if (!idToken) {
    const custom = await auth.createCustomToken(ADMIN_UID);
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
    idToken = json.idToken;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...bypassHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

/** Lecture ANONYME : c'est elle qui prouve la visibilité réelle. */
async function publicCircuits() {
  const res = await fetch(`${BASE}/api/competitions/circuits`, { headers: bypassHeaders });
  const json = await res.json().catch(() => ({}));
  return (json.circuits ?? []).map(c => c.id);
}

// Barème : Record "1".."N" (places compressées, archi §3), pas un tableau.
const SCALE = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
const PAYLOAD = {
  name: 'TEST E2E Circuit publication',
  game: 'rocket_league',
  pointsScale: SCALE,
  bestResultsCount: 3,
  lanTeamCount: 16,
  prizePool: null,
  organizer: null,
  // Permutation COMPLÈTE des 3 clés exigée par la validation (ordre de la spec).
  tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
};

async function setup() {
  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID, displayName: 'E2E Circuit Admin', discordUsername: `${P}_admin`,
    games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN_UID).set({ addedBy: 'e2e', addedAt: FieldValue.serverTimestamp() });
  await db.collection('circuits').doc(CIRCUIT).set({
    ...PAYLOAD, competitionIds: [], discord: null,
    status: 'draft', createdAt: Timestamp.now(),
  });
}

async function cleanup() {
  const batch = db.batch();
  batch.delete(db.collection('circuits').doc(CIRCUIT));
  batch.delete(db.collection('competitions').doc(COMP));
  batch.delete(db.collection('aedral_admins').doc(ADMIN_UID));
  batch.delete(db.collection('users').doc(ADMIN_UID));
  await batch.commit().catch(() => {});
}

async function main() {
  await setup();

  section('Un circuit naît invisible');
  check('absent des circuits publics', !(await publicCircuits()).includes(CIRCUIT));

  section('Publication');
  const pub = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'publish' });
  check('PATCH publish → 200', pub.status === 200, JSON.stringify(pub.json).slice(0, 200));
  check('statut passé à active', pub.json?.status === 'active', JSON.stringify(pub.json));
  check('VISIBLE PAR UN ANONYME', (await publicCircuits()).includes(CIRCUIT));
  const again = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'publish' });
  check('republier est sans effet (double-clic)', again.status === 200);

  section('Ce qui reste corrigeable une fois public');
  const rename = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { ...PAYLOAD, name: 'TEST E2E Circuit renommé' });
  check('le nom peut être corrigé', rename.status === 200, JSON.stringify(rename.json).slice(0, 200));
  const renamed = (await db.collection('circuits').doc(CIRCUIT).get()).data();
  check('le nouveau nom est écrit', renamed?.name === 'TEST E2E Circuit renommé', renamed?.name);
  const dotation = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, {
    ...PAYLOAD, name: 'TEST E2E Circuit renommé', prizePool: { amount: 500, currency: 'EUR' },
  });
  check('la dotation peut être ajoutée', dotation.status === 200, JSON.stringify(dotation.json).slice(0, 200));

  section('Ce qui est figé une fois public');
  const bareme = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, {
    ...PAYLOAD, name: 'TEST E2E Circuit renommé', pointsScale: { 1: 30, 2: 20, 3: 10 },
  });
  check('changer le barème est refusé', bareme.status === 409, `status ${bareme.status}`);
  check('le refus dit ce qui reste modifiable', /dotation|modifiable/i.test(bareme.json?.error ?? ''), bareme.json?.error);
  const kept = (await db.collection('circuits').doc(CIRCUIT).get()).data();
  check('le barème d’origine est intact', JSON.stringify(kept?.pointsScale) === JSON.stringify(PAYLOAD.pointsScale));
  const best = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, {
    ...PAYLOAD, name: 'TEST E2E Circuit renommé', bestResultsCount: 4,
  });
  check('changer le nombre de résultats retenus est refusé', best.status === 409, `status ${best.status}`);

  section('Retour en brouillon');
  const unpub = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'unpublish' });
  check('PATCH unpublish → 200', unpub.status === 200, JSON.stringify(unpub.json).slice(0, 200));
  check('redevenu invisible', !(await publicCircuits()).includes(CIRCUIT));
  await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'publish' });

  section('Une étape terminée verrouille la visibilité');
  await db.collection('competitions').doc(COMP).set({
    name: 'TEST E2E Étape terminée', game: 'rocket_league', circuitId: CIRCUIT,
    status: 'finished', isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('circuits').doc(CIRCUIT).update({ competitionIds: [COMP] });
  const locked = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'unpublish' });
  check('impossible de remasquer un circuit dont une étape est jouée', locked.status === 409, `status ${locked.status}`);
  check('le refus explique pourquoi', /classement|terminée/i.test(locked.json?.error ?? ''), locked.json?.error);
  check('le circuit est resté public', (await publicCircuits()).includes(CIRCUIT));

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passés, ${failed} échoués`);
}

try {
  await main();
} catch (err) {
  console.error('\n💥', err);
  failed++;
} finally {
  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
