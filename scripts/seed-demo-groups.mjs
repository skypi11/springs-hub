// Seed de DEUX compétitions de DÉMO (isDev : visibles des seuls
// admins/testeurs) pour la vue des groupes :
// - `demo-round-robin` : 8 équipes en 2 poules, journée 1 jouée, un match de
//   journée 2 EN COURS + casté.
// - `demo-swiss` : 8 équipes, 3 rondes — ronde 1 jouée, ronde 2 APPARIÉE VIA
//   L'ACTION CONSOLE generate_next_round (le flux réel de bout en bout), un
//   match de ronde 2 en cours + casté.
// Vérifie aussi /matches et /standings avant cleanup (mini e2e serveur).
// Idempotent : purge et re-crée à chaque run.
// Prérequis : dev server localhost:3000 (ou E2E_BASE_URL).
// Run : node --env-file=.env.local scripts/seed-demo-groups.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const SEED_ADMIN = 'discord_demo_grp_admin';

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
  { name: 'Azure Drift', tag: 'AZUR' },
  { name: 'Ember Rise', tag: 'EMBR' },
];

const WIN_A = [{ a: 3, b: 1 }, { a: 2, b: 0 }, { a: 1, b: 0 }];
const WIN_B = [{ a: 1, b: 3 }, { a: 0, b: 2 }, { a: 2, b: 3 }];

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

async function purge(comp) {
  const ms = await db.collection('competition_matches').where('competitionId', '==', comp).get();
  for (const d of ms.docs) {
    const priv = await d.ref.collection('private').get();
    for (const p of priv.docs) await p.ref.delete();
    await d.ref.delete();
  }
  const regs = await db.collection('competition_registrations').where('competitionId', '==', comp).get();
  for (const d of regs.docs) await d.ref.delete();
  await db.collection('competitions').doc(comp).delete();
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', comp).get();
  for (const d of notifs.docs) await d.ref.delete();
}

async function seedCompetition(comp, name, format, phasePlan, structPrefix) {
  await db.collection('competitions').doc(comp).set({
    name,
    game: 'rocket_league', circuitId: null,
    format,
    eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: { opensAt: Timestamp.fromDate(new Date('2026-07-01')), closesAt: Timestamp.fromDate(new Date('2026-08-20')), waitlist: true },
    schedule: {
      days: [{ date: '2026-08-22', startsAt: '15:00', endsAt: '22:00' }],
      phasePlan,
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: null, status: 'draft', isDev: true, approvedCount: TEAMS.length, createdAt: Timestamp.now(),
  });
  const batch = db.batch();
  TEAMS.forEach((t, idx) => {
    const i = idx + 1;
    batch.set(db.collection('competition_registrations').doc(`${comp}_team${i}`), {
      competitionId: comp, structureId: `${structPrefix}-struct`, teamId: `${structPrefix}-t${i}`,
      name: t.name, tag: t.tag, logoUrl: null,
      captainUid: `discord_${structPrefix}_cap${i}`,
      rosterUids: [`discord_${structPrefix}_cap${i}`, `discord_${structPrefix}_p${i}b`, `discord_${structPrefix}_p${i}c`],
      status: 'approved', createdAt: Timestamp.now(),
    });
  });
  await batch.commit();
}

function makeApi(token) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    if (res.status !== 200) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`);
    return json;
  };
}

async function main() {
  console.log('Purge des démos précédentes…');
  await purge('demo-round-robin');
  await purge('demo-swiss');

  await db.collection('users').doc(SEED_ADMIN).set({
    uid: SEED_ADMIN, displayName: 'Demo Groups Admin', discordUsername: 'demo_grp_admin',
    discordId: '999999999999999931', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(SEED_ADMIN).set({ addedBy: 'seed-demo', addedAt: FieldValue.serverTimestamp() });
  const api = makeApi(await tokenFor(SEED_ADMIN));

  try {
    // ── Démo ROUND ROBIN : 8 équipes, 2 poules de 4 ──
    console.log('\nSeed demo-round-robin (2 poules de 4)…');
    await seedCompetition('demo-round-robin', 'Démo — Poules round robin', {
      kind: 'round_robin', maxTeams: 8, groupCount: 2, doubleRound: false,
      points: { win: 3, draw: 1, loss: 0 },
      bo: { default: 5, overrides: [], grandFinal: 5 },
      bracketReset: false, thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
    }, [1, 2, 3].map(d => ({ phase: d, day: 1, label: `J${d}`, rounds: [{ bracket: 'round_robin', round: d }] })), 'demo-rr');

    await api('POST', '/api/admin/competitions/demo-round-robin/bracket', { action: 'open_seeding' });
    await api('POST', '/api/admin/competitions/demo-round-robin/bracket', {
      action: 'reorder', order: TEAMS.map((_, idx) => `demo-round-robin_team${idx + 1}`),
    });
    const pubRR = await api('POST', '/api/admin/competitions/demo-round-robin/bracket', { action: 'publish' });
    console.log(`  publié : ${pubRR.matchCount} matchs (attendu 12).`);

    // Journée 1 jouée (slots globaux R1-1..R1-4), un match de J2 en cours + casté.
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'launch_phase', matchIds: ['R1-1', 'R1-2', 'R1-3', 'R1-4'] });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'force_score', matchId: 'R1-1', games: WIN_A });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'force_score', matchId: 'R1-2', games: WIN_B });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'force_score', matchId: 'R1-3', games: WIN_A });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'force_score', matchId: 'R1-4', games: WIN_A });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'launch_phase', matchIds: ['R2-1'] });
    await db.collection('competition_matches').doc('demo-round-robin__R2-1').update({
      status: 'live', 'checkin.a.done': true, 'checkin.b.done': true, updatedAt: FieldValue.serverTimestamp(),
    });
    await api('POST', '/api/admin/competitions/demo-round-robin/console', { action: 'set_cast', matchId: 'R2-1', featured: true, streamUrl: 'https://twitch.tv/springsesport' });

    // ── Démo SUISSE : 8 équipes, 3 rondes ──
    console.log('\nSeed demo-swiss (3 rondes, génération incrémentale)…');
    await seedCompetition('demo-swiss', 'Démo — Système suisse', {
      kind: 'swiss', maxTeams: 8, swissRounds: 3,
      points: { win: 3, draw: 1, loss: 0 },
      bo: { default: 5, overrides: [], grandFinal: 5 },
      bracketReset: false, thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
    }, [1, 2, 3].map(r => ({ phase: r, day: 1, label: `Ronde ${r}`, rounds: [{ bracket: 'swiss', round: r }] })), 'demo-sw');

    await api('POST', '/api/admin/competitions/demo-swiss/bracket', { action: 'open_seeding' });
    await api('POST', '/api/admin/competitions/demo-swiss/bracket', {
      action: 'reorder', order: TEAMS.map((_, idx) => `demo-swiss_team${idx + 1}`),
    });
    const pubSW = await api('POST', '/api/admin/competitions/demo-swiss/bracket', { action: 'publish' });
    console.log(`  publié : ${pubSW.matchCount} matchs (attendu 4 — ronde 1 seule).`);

    // Ronde 1 jouée, puis RONDE 2 APPARIÉE PAR L'ACTION CONSOLE (flux réel).
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'launch_phase', matchIds: ['S1-1', 'S1-2', 'S1-3', 'S1-4'] });
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'force_score', matchId: 'S1-1', games: WIN_A });
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'force_score', matchId: 'S1-2', games: WIN_B });
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'force_score', matchId: 'S1-3', games: WIN_A });
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'force_score', matchId: 'S1-4', games: WIN_B });
    const gen = await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'generate_next_round' });
    console.log(`  ronde ${gen.round} appariée : ${gen.matchCount} matchs.`);
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'launch_phase', matchIds: ['S2-1'] });
    await db.collection('competition_matches').doc('demo-swiss__S2-1').update({
      status: 'live', 'checkin.a.done': true, 'checkin.b.done': true, updatedAt: FieldValue.serverTimestamp(),
    });
    await api('POST', '/api/admin/competitions/demo-swiss/console', { action: 'set_cast', matchId: 'S2-1', featured: true, streamUrl: 'https://twitch.tv/springsesport' });

    // ── Vérifications API (avant cleanup de l'admin de seed) ──
    console.log('\nVérifications /matches + /standings…');
    for (const [comp, expectKind, expectGroups] of [
      ['demo-round-robin', 'round_robin', 2],
      ['demo-swiss', 'swiss', 1],
    ]) {
      const matches = await api('GET', `/api/competitions/${comp}/matches`);
      const standings = await api('GET', `/api/competitions/${comp}/standings`);
      if (standings.kind !== expectKind) throw new Error(`${comp}: kind ${standings.kind}`);
      if (standings.groups.length !== expectGroups) throw new Error(`${comp}: ${standings.groups.length} groupes`);
      const total = standings.groups.reduce((s, g) => s + g.rows.length, 0);
      if (total !== TEAMS.length) throw new Error(`${comp}: ${total} lignes de classement`);
      console.log(`  ${comp} : ${matches.matches.length} matchs, ${standings.groups.length} groupe(s), ${total} lignes OK.`);
    }
  } finally {
    // L'admin de seed ne sert plus (skypi11 est admin réel).
    await db.collection('aedral_admins').doc(SEED_ADMIN).delete();
    await db.collection('users').doc(SEED_ADMIN).delete();
    await auth.deleteUsers([SEED_ADMIN]).catch(() => {});
  }

  console.log(`\nDémos prêtes (visibles admins/testeurs uniquement) :`);
  console.log(`  ${BASE}/competitions/demo-round-robin — 2 poules, J1 jouée, un match J2 EN COURS + EN STREAM, classement par poule.`);
  console.log(`  ${BASE}/competitions/demo-swiss — ronde 1 jouée, ronde 2 appariée AU SCORE, classement Buchholz.`);
}

await main();
process.exit(0);
