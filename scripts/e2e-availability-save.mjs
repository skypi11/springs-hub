// E2E sauvegarde des dispos — PUT multi-semaines (auto-save).
//
// Le test central est `2 semaines en un appel` : c'est la NON-RÉGRESSION du bug
// où sauvegarder une semaine effaçait l'autre (docs/chantier-ux-site-juillet-2026 §1.1).
//
// Données préfixées e2e_avm, cleanup TOUJOURS en finally (la DB est PARTAGÉE avec la prod).
// Run : node --env-file=.env.local scripts/e2e-availability-save.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const UID = 'discord_e2e_avm_player';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

// ── Semaines ISO (Europe/Paris) — réplique de lib/availability ──
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
const CUR_MON = mondayOf(parisToday);
const NEXT_MON = addDays(CUR_MON, 7);
const PREV_MON = addDays(CUR_MON, -7);
const CUR_WEEK = isoWeekId(CUR_MON);
const NEXT_WEEK = isoWeekId(NEXT_MON);

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

let token = null;
async function getToken() {
  if (token) return token;
  const custom = await auth.createCustomToken(UID);
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

async function put(body) {
  const res = await fetch(`${BASE}/api/availability/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}` },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

async function slotsInDb(weekId) {
  const snap = await db.collection('user_availability').doc(`${UID}_${weekId}`).get();
  return snap.exists ? (snap.data().slots ?? []) : null;
}

async function cleanup() {
  for (const w of [isoWeekId(PREV_MON), CUR_WEEK, NEXT_WEEK]) {
    await db.collection('user_availability').doc(`${UID}_${w}`).delete().catch(() => {});
  }
  await db.collection('users').doc(UID).delete().catch(() => {});
  await auth.deleteUser(UID).catch(() => {});
}

async function setup() {
  await db.collection('users').doc(UID).set({
    uid: UID, displayName: 'E2E AVM', discordUsername: 'e2e_avm', games: [], createdAt: Timestamp.now(),
  });
}

// Un créneau du soir, toujours dans la plage 8h→2h, sur un jour à venir de la semaine.
const curEvening = `${addDays(CUR_MON, 6)}T20:00`;   // dimanche de la semaine courante
const curEvening2 = `${addDays(CUR_MON, 6)}T20:30`;
const nextEvening = `${addDays(NEXT_MON, 2)}T21:00`; // mercredi de la semaine suivante
const nextEvening2 = `${addDays(NEXT_MON, 2)}T21:30`;

async function run() {
  console.log(`— Semaines ciblées : ${CUR_WEEK} (${CUR_MON}) et ${NEXT_WEEK} (${NEXT_MON})\n`);

  // ── LE test de non-régression du bug §1.1 ────────────────────────────────
  let r = await put({ weeks: [
    { mondayYmd: CUR_MON, slots: [curEvening, curEvening2] },
    { mondayYmd: NEXT_MON, slots: [nextEvening, nextEvening2] },
  ] });
  check('2 semaines en un appel → 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  check('la réponse renvoie les 2 semaines', Array.isArray(r.json?.weeks) && r.json.weeks.length === 2,
    JSON.stringify(r.json?.weeks));

  const curDb = await slotsInDb(CUR_WEEK);
  const nextDb = await slotsInDb(NEXT_WEEK);
  check('semaine COURANTE écrite en base', curDb?.includes(curEvening) && curDb?.includes(curEvening2), JSON.stringify(curDb));
  check('semaine SUIVANTE écrite en base (LE bug de Matt)', nextDb?.includes(nextEvening) && nextDb?.includes(nextEvening2), JSON.stringify(nextDb));

  // ── Un 2e save ne doit pas amputer l'autre semaine ────────────────────────
  r = await put({ weeks: [
    { mondayYmd: CUR_MON, slots: [curEvening] },            // on retire un slot
    { mondayYmd: NEXT_MON, slots: [nextEvening, nextEvening2] }, // inchangé
  ] });
  check('2e save → 200', r.status === 200, String(r.status));
  const nextDb2 = await slotsInDb(NEXT_WEEK);
  check('la semaine suivante SURVIT au save de la courante', nextDb2?.length === 2, JSON.stringify(nextDb2));

  // ── Atomicité : une semaine invalide ⇒ AUCUNE écriture ────────────────────
  r = await put({ weeks: [
    { mondayYmd: CUR_MON, slots: [] },                 // viderait la semaine courante…
    { mondayYmd: PREV_MON, slots: [`${PREV_MON}T20:00`] }, // …mais celle-ci est passée → refus
  ] });
  check('semaine passée dans le lot → 400', r.status === 400, `${r.status} ${r.json?.error}`);
  const curDb3 = await slotsInDb(CUR_WEEK);
  check('rien n’a été écrit malgré le refus (atomicité)', curDb3?.includes(curEvening), JSON.stringify(curDb3));

  // ── Garde-fous ────────────────────────────────────────────────────────────
  r = await put({ weeks: [
    { mondayYmd: CUR_MON, slots: [curEvening] },
    { mondayYmd: CUR_MON, slots: [curEvening2] },
  ] });
  check('même semaine en double → 400', r.status === 400 && /double/i.test(r.json?.error ?? ''), `${r.status} ${r.json?.error}`);

  r = await put({ weeks: [] });
  check('weeks vide → 400', r.status === 400, String(r.status));

  r = await put({ weeks: [1, 2, 3, 4].map(i => ({ mondayYmd: addDays(CUR_MON, 7 * i), slots: [] })) });
  check('trop de semaines → 400', r.status === 400, `${r.status} ${r.json?.error}`);

  r = await put({ weeks: [{ mondayYmd: addDays(CUR_MON, 1), slots: [] }] });
  check('mondayYmd qui n’est pas un lundi → 400', r.status === 400, `${r.status} ${r.json?.error}`);

  // ── Rétrocompat mono-semaine (l'ancien contrat ne doit pas casser) ────────
  r = await put({ mondayYmd: NEXT_MON, slots: [nextEvening] });
  check('contrat mono-semaine → 200', r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  check('mono-semaine renvoie encore `slots`', Array.isArray(r.json?.slots), JSON.stringify(r.json));
  const nextDb3 = await slotsInDb(NEXT_WEEK);
  check('mono-semaine a bien écrit', nextDb3?.length === 1 && nextDb3[0] === nextEvening, JSON.stringify(nextDb3));

  // ── Non authentifié ───────────────────────────────────────────────────────
  const anon = await fetch(`${BASE}/api/availability/me`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeks: [{ mondayYmd: CUR_MON, slots: [] }] }),
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
