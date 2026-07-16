// Seed d'une compétition de DÉMO simple élimination (`demo-single-elim`,
// isDev : visible des seuls admins/testeurs) — laissée AVANCÉE en base pour
// vérifier le rendu du viewer (arbre + petite finale + hints + cast) en local
// et sur preview. Idempotent : purge et re-crée à chaque run.
// Prérequis : dev server localhost:3000 (ou E2E_BASE_URL).
// Run : node --env-file=.env.local scripts/seed-demo-single-elim.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const COMP = 'demo-single-elim';
const SEED_ADMIN = 'discord_demo_se_admin';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

const TEAMS = [
  { name: 'Nova Legion', tag: 'NOVA' },
  { name: 'Crimson Peak', tag: 'CRIM' },
  { name: 'Void Runners', tag: 'VOID' },
  { name: 'Solar Flare', tag: 'SOLR' },
  { name: 'Iron Pulse', tag: 'IRON' },
  { name: 'Echo Storm', tag: 'ECHO' },
];
const regId = i => `${COMP}_team${i}`;

async function tokenFor(uid) {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
  return json.idToken;
}

async function purge() {
  const ms = await db.collection('competition_matches').where('competitionId', '==', COMP).get();
  for (const d of ms.docs) {
    const priv = await d.ref.collection('private').get();
    for (const p of priv.docs) await p.ref.delete();
    await d.ref.delete();
  }
  const regs = await db.collection('competition_registrations').where('competitionId', '==', COMP).get();
  for (const d of regs.docs) await d.ref.delete();
  await db.collection('competitions').doc(COMP).delete();
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get();
  for (const d of notifs.docs) await d.ref.delete();
}

async function main() {
  console.log('Purge de la démo précédente…');
  await purge();

  console.log('Seed compétition + inscriptions…');
  await db.collection('users').doc(SEED_ADMIN).set({
    uid: SEED_ADMIN, displayName: 'Demo SE Admin', discordUsername: 'demo_se_admin',
    discordId: '999999999999999921', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(SEED_ADMIN).set({ addedBy: 'seed-demo', addedAt: FieldValue.serverTimestamp() });
  await db.collection('competitions').doc(COMP).set({
    name: 'Démo — Tournoi simple élimination',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'single_elim', maxTeams: 16, thirdPlace: true,
      bo: { default: 5, overrides: [], grandFinal: 7 },
      bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-07-01')), closesAt: Timestamp.fromDate(new Date('2026-08-20')), waitlist: true },
    schedule: {
      days: [{ date: '2026-08-22', startsAt: '15:00', endsAt: '22:00' }],
      phasePlan: [
        { phase: 1, day: 1, label: 'P1 — Quarts', rounds: [{ bracket: 'winners', round: 1 }] },
        { phase: 2, day: 1, label: 'P2 — Demi-finales', rounds: [{ bracket: 'winners', round: 2 }] },
        { phase: 3, day: 1, label: 'P3 — Finale + petite finale', rounds: [{ bracket: 'winners', round: 3 }, { bracket: 'losers', round: 1 }] },
      ],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: null, status: 'draft', isDev: true, approvedCount: TEAMS.length, createdAt: Timestamp.now(),
  });
  const batch = db.batch();
  TEAMS.forEach((t, idx) => {
    const i = idx + 1;
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: 'demo-se-struct', teamId: `demo-se-t${i}`,
      name: t.name, tag: t.tag, logoUrl: null,
      captainUid: `discord_demo_se_cap${i}`,
      rosterUids: [`discord_demo_se_cap${i}`, `discord_demo_se_p${i}b`, `discord_demo_se_p${i}c`],
      status: 'approved', createdAt: Timestamp.now(),
    });
  });
  await batch.commit();

  console.log('Publication du bracket via l\'API…');
  const token = await tokenFor(SEED_ADMIN);
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    if (res.status !== 200) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
    action: 'reorder', order: TEAMS.map((_, idx) => regId(idx + 1)),
  });
  const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  console.log(`  publié : ${pub.matchCount} matchs.`);

  console.log('Avancement de la démo (quarts joués, une demie en cours + castée)…');
  const WIN_A = [{ a: 3, b: 1 }, { a: 2, b: 0 }, { a: 1, b: 0 }];
  const WIN_B = [{ a: 1, b: 3 }, { a: 0, b: 2 }, { a: 2, b: 3 }];
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W1-2', 'W1-4'] });
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W1-2', games: WIN_A });
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'W1-4', games: WIN_B });
  // Demi 1 lancée (live après check-ins simulés côté doc) + castée.
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W2-1'] });
  await db.collection('competition_matches').doc(`${COMP}__W2-1`).update({
    status: 'live',
    'checkin.a.done': true, 'checkin.b.done': true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'set_cast', matchId: 'W2-1', featured: true, streamUrl: 'https://twitch.tv/springsesport' });

  // L'admin de seed ne sert plus (skypi11 est admin réel).
  await db.collection('aedral_admins').doc(SEED_ADMIN).delete();
  await db.collection('users').doc(SEED_ADMIN).delete();
  await auth.deleteUsers([SEED_ADMIN]).catch(() => {});

  console.log(`\nDémo prête : ${BASE}/competitions/${COMP} (visible admins/testeurs uniquement).`);
  console.log('Attendu : quarts joués (2 byes), demi 1 EN COURS + EN STREAM, demi 2 prête,');
  console.log('finale BO7 et petite finale en attente avec hints « Vainqueur/Perdant demi ».');
}

await main();
process.exit(0);
