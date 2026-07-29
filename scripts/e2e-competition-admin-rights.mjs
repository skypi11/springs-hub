// E2E droits d'un ADMIN DE COMPÉTITION (rôle scopé).
//
// Depuis le 28/07 il organise : il crée, édite et supprime des tournois. Deux
// portes doivent rester fermées, et c'est ce que ce script vérifie surtout :
//   - les CIRCUITS (barème, résultats retenus, places en LAN) : le contrat passé
//     avec les équipes sur plusieurs mois, il ne doit pas bouger sous elles ;
//   - la NOMINATION d'admins, qui serait une escalade de privilèges.
//
// Le compte de test est dans `competition_admins` et PAS dans `aedral_admins` :
// c'est toute la subtilité, `isCompetitionAdmin` est vrai pour les deux rôles.
//
// Données préfixées e2e_car, cleanup TOUJOURS en finally (DB PARTAGÉE avec la prod).
// Run : node --env-file=.env.local scripts/e2e-competition-admin-rights.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_car';
const SCOPED_UID = `discord_${P}_scoped`;
const COMP = `${P}-comp`;
const CIRCUIT = `${P}-circuit`;

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
    const custom = await auth.createCustomToken(SCOPED_UID);
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 140)}`);
    idToken = json.idToken;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

const CIRCUIT_PAYLOAD = {
  name: 'TEST E2E Circuit interdit',
  game: 'rocket_league',
  pointsScale: { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 },
  bestResultsCount: 3,
  lanTeamCount: 16,
  prizePool: null,
  organizer: null,
  tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
};

async function setup() {
  await db.collection('users').doc(SCOPED_UID).set({
    uid: SCOPED_UID, displayName: 'E2E Admin compét', discordUsername: `${P}_scoped`,
    games: [], isDev: true, createdAt: Timestamp.now(),
  });
  // Rôle SCOPÉ uniquement : surtout pas dans aedral_admins.
  await db.collection('competition_admins').doc(SCOPED_UID).set({
    addedBy: 'e2e', addedAt: FieldValue.serverTimestamp(),
  });
  // Une compétition en brouillon, sans inscription : supprimable par l'API.
  await db.collection('competitions').doc(COMP).set({
    name: 'TEST E2E Compét supprimable', game: 'rocket_league', circuitId: null,
    status: 'draft', isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('circuits').doc(CIRCUIT).set({
    ...CIRCUIT_PAYLOAD, name: 'TEST E2E Circuit existant',
    competitionIds: [], discord: null, status: 'draft', isDev: true, createdAt: Timestamp.now(),
  });
}

async function cleanup() {
  const batch = db.batch();
  batch.delete(db.collection('competitions').doc(COMP));
  batch.delete(db.collection('circuits').doc(CIRCUIT));
  batch.delete(db.collection('competition_admins').doc(SCOPED_UID));
  batch.delete(db.collection('users').doc(SCOPED_UID));
  await batch.commit().catch(() => {});
  // Une création qui aurait abouti pendant le run ne doit pas rester en base.
  const strays = await db.collection('circuits').where('name', '==', CIRCUIT_PAYLOAD.name).get().catch(() => ({ docs: [] }));
  for (const d of strays.docs) await d.ref.delete().catch(() => {});
  await auth.deleteUser(SCOPED_UID).catch(() => {});
}

async function main() {
  await setup();
  const isAedralAdmin = (await db.collection('aedral_admins').doc(SCOPED_UID).get()).exists;
  check('le compte de test n’est PAS admin Aedral', !isAedralAdmin);

  section('Ce qu’il peut faire : organiser');
  // Payload volontairement incomplet : on teste la PORTE, pas la validation.
  // Un 403 signifierait la porte fermée ; un 400 prouve qu'elle est franchie.
  const create = await api('POST', '/api/admin/competitions', { name: 'E2E sonde', game: 'rocket_league' });
  check('la création lui est ouverte (pas de 403)', create.status !== 403, `status ${create.status}`);
  check('il est bien arrivé jusqu’à la validation du contenu', create.status === 400,
    `status ${create.status} · ${JSON.stringify(create.json).slice(0, 120)}`);

  const del = await api('DELETE', `/api/admin/competitions/${COMP}`);
  check('SUPPRESSION D’UN BROUILLON RÉUSSIE (mutation réelle)', del.status === 200,
    `status ${del.status} · ${JSON.stringify(del.json).slice(0, 150)}`);
  check('la compétition a bien disparu de la base',
    !(await db.collection('competitions').doc(COMP).get()).exists);

  const list = await api('GET', '/api/admin/competitions');
  check('il continue de voir la liste', list.status === 200, `status ${list.status}`);

  // Le couloir derrière la porte : créer un tournoi sans pouvoir choisir son
  // serveur Discord, ses salons et ses rôles ne sert à rien. Le compte de test
  // n'ayant pas d'identifiant Discord, ces routes répondent 400 après la garde —
  // c'est justement ce 400 (et non un 403) qui prouve l'accès.
  const guildList = await api('GET', '/api/admin/competitions/discord-guilds');
  check('LA LISTE DES SERVEURS DISCORD lui est ouverte', guildList.status !== 403, `status ${guildList.status}`);
  const guildCheck = await api('POST', '/api/admin/competitions/discord-guild', { guildId: '123456789012345678' });
  check('l’inspection d’un serveur (salons, rôles) lui est ouverte', guildCheck.status !== 403,
    `status ${guildCheck.status}`);

  section('Ce qui lui reste fermé : le contrat du circuit');
  const newCircuit = await api('POST', '/api/admin/circuits', CIRCUIT_PAYLOAD);
  check('créer un circuit → refusé', newCircuit.status === 403, `status ${newCircuit.status}`);
  const editCircuit = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, {
    ...CIRCUIT_PAYLOAD, bestResultsCount: 4,
  });
  check('changer les règles d’un circuit → refusé', editCircuit.status === 403, `status ${editCircuit.status}`);
  const publishCircuit = await api('PATCH', `/api/admin/circuits/${CIRCUIT}`, { action: 'publish' });
  check('publier un circuit → refusé', publishCircuit.status === 403, `status ${publishCircuit.status}`);
  const stillDraft = (await db.collection('circuits').doc(CIRCUIT).get()).data();
  check('le circuit est resté en brouillon', stillDraft?.status === 'draft', stillDraft?.status);
  check('ses règles sont intactes', stillDraft?.bestResultsCount === 3, String(stillDraft?.bestResultsCount));

  section('Ce qui lui reste fermé : nommer des admins');
  const promote = await api('POST', '/api/admin/competition-admins', { uid: SCOPED_UID });
  check('NOMMER UN ADMIN DE COMPÉTITION → REFUSÉ (pas d’escalade)', promote.status === 403,
    `status ${promote.status} · ${JSON.stringify(promote.json).slice(0, 120)}`);
  const users = await api('GET', '/api/admin/users');
  check('l’administration des utilisateurs lui reste fermée', users.status === 403, `status ${users.status}`);

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
