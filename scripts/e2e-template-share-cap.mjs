// E2E cap des templates PARTAGÉS (freemium §2.1). Prouve que le cap free (15)
// est respecté sur les DEUX chemins — création directe ET promotion perso→structure
// (le trou : ce 2e chemin ignorait le plan et plafonnait à 50) — et qu'un plan pro
// débloque bien 50 (le plan est consulté, pas un 15 en dur).
//
// Données préfixées e2e_tsc, cleanup TOUJOURS en finally (DB PARTAGÉE avec la prod).
// Prérequis : dev server (ou E2E_BASE_URL). Run :
//   node --env-file=.env.local scripts/e2e-template-share-cap.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_tsc';
const FOUNDER = `discord_${P}_founder`;
const STRUCT = `${P}-struct`;

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

let token = null;
async function getToken() {
  if (token) return token;
  const custom = await auth.createCustomToken(FOUNDER);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 160)}`);
  token = json.idToken;
  return token;
}

function tplPayload(scope) {
  return {
    scope,
    name: `${P} tpl ${Math.random().toString(36).slice(2, 8)}`,
    type: 'free',
    titleTemplate: '',
    descriptionTemplate: '',
    config: {},
    steps: [{ id: `s-${Math.random().toString(36).slice(2, 8)}`, type: 'free', config: {} }],
  };
}
async function postTemplate(scope) {
  const res = await fetch(`${BASE}/api/structures/${STRUCT}/todo-templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify(tplPayload(scope)),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}
async function shareTemplate(templateId, scope) {
  const res = await fetch(`${BASE}/api/structures/${STRUCT}/todo-templates/${templateId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify({ action: 'share', scope }),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

async function seedSharedTemplates(n) {
  const batch = db.batch();
  for (let i = 0; i < n; i++) {
    const ref = db.collection('structure_todo_templates').doc(`${P}_seed_${i}`);
    batch.set(ref, {
      structureId: STRUCT, ownerId: FOUNDER, scope: 'structure',
      name: `${P} seed ${i}`, type: 'free', titleTemplate: '', descriptionTemplate: '',
      config: {}, steps: [{ id: `s${i}`, type: 'free', config: {} }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
  await batch.commit();
}
async function countShared() {
  const snap = await db.collection('structure_todo_templates')
    .where('structureId', '==', STRUCT).where('scope', '==', 'structure').get();
  return snap.size;
}

async function cleanup() {
  const snap = await db.collection('structure_todo_templates').where('structureId', '==', STRUCT).get();
  for (const d of snap.docs) await d.ref.delete();
  await db.collection('structures').doc(STRUCT).delete().catch(() => {});
  await db.collection('users').doc(FOUNDER).delete().catch(() => {});
  await auth.deleteUser(FOUNDER).catch(() => {});
}

async function setup() {
  await db.collection('users').doc(FOUNDER).set({
    uid: FOUNDER, displayName: 'E2E TSC', discordUsername: 'e2e_tsc', games: [], createdAt: Timestamp.now(),
  });
  await db.collection('structures').doc(STRUCT).set({
    // slug = docId : les routes /api/structures/[id]/* passent par resolveStructureId,
    // qui traite un id non-20-chars comme un slug → il faut ce champ pour le lookup.
    slug: STRUCT,
    name: 'E2E TSC', tag: 'TSC', founderId: FOUNDER, coFounderIds: [],
    managerIds: [], coachIds: [], games: ['rocket_league'], status: 'active',
    createdAt: Timestamp.now(), // pas de plan → free (cap 15)
  });
}

async function run() {
  // Free : 15 templates partagés déjà en place = cap atteint.
  await seedSharedTemplates(15);
  check('cap free = 15 (préparé)', (await countShared()) === 15);

  // ── Chemin 1 : création directe d'un 16e partagé → refus.
  let r = await postTemplate('structure');
  check('création d’un 16e partagé (free) → 400', r.status === 400, `${r.status} ${r.json?.error}`);

  // ── Chemin 2 (LE trou) : créer un perso puis le PROMOUVOIR → refus.
  r = await postTemplate('personal');
  check('création d’un template perso → 200 (cap perso séparé)', r.status === 200, `${r.status} ${r.json?.error}`);
  const persoId = r.json?.id;
  r = await shareTemplate(persoId, 'structure');
  check('promotion perso→structure au-delà du cap free → 400 (LE trou §2.1)',
    r.status === 400, `${r.status} ${r.json?.error}`);
  check('la promotion refusée n’a PAS augmenté le compte partagé', (await countShared()) === 15);

  // ── Sous le cap : la promotion repasse.
  await db.collection('structure_todo_templates').doc(`${P}_seed_0`).delete(); // → 14
  r = await shareTemplate(persoId, 'structure');
  check('sous le cap (14) → promotion autorisée → 200', r.status === 200, `${r.status} ${r.json?.error}`);
  check('le compte partagé est revenu à 15', (await countShared()) === 15);

  // ── Plan pro : le cap suit le plan (50), pas un 15 en dur.
  await db.collection('structures').doc(STRUCT).update({ plan: 'pro' });
  r = await postTemplate('structure');
  check('structure PRO : 16e partagé accepté → 200 (le plan est bien consulté)',
    r.status === 200, `${r.status} ${r.json?.error}`);

  // ── Régression review #3/#6 : un dirigeant SANS aucune équipe doit tout de
  //    même être vu comme dirigeant par l'overview (sinon le bouton Supprimer du
  //    ménage est caché). Cette structure de test n'a AUCUNE sub_team.
  const ov = await fetch(`${BASE}/api/structures/${STRUCT}/todos/overview`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  const ovJson = await ov.json().catch(() => ({}));
  check('overview d’un dirigeant sans équipe → isDirigeant:true (régression #3/#6)',
    ov.status === 200 && ovJson?.isDirigeant === true, `${ov.status} isDirigeant=${ovJson?.isDirigeant}`);

  // ── Sans auth.
  const anon = await fetch(`${BASE}/api/structures/${STRUCT}/todo-templates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tplPayload('structure')),
  });
  check('sans token → 401', anon.status === 401, String(anon.status));
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
