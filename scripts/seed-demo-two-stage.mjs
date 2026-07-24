// Seed d'une compétition de DÉMO multi-étapes `demo-two-stage` (isDev :
// visible des seuls admins/testeurs) : poules round robin (2 × 4) JOUÉES,
// passage d'étape FAIT via l'action console advance_stage (flux réel), phase
// finale en cours — une demie jouée, l'autre EN COURS + castée.
// À voir : onglets Poules / Phase finale sur la fiche + console, classement
// des poules figé, CTA de passage déjà consommé.
// Idempotent : purge et re-crée à chaque run.
// Prérequis : dev server localhost:3000 (ou E2E_BASE_URL).
// Run : node --env-file=.env.local scripts/seed-demo-two-stage.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const COMP = 'demo-two-stage';
const ADMIN = 'discord_demo_2s_admin';

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

const RR_FORMAT = {
  kind: 'round_robin', maxTeams: 8, groupCount: 2, doubleRound: false,
  points: { win: 3, draw: 1, loss: 0 },
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false, thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};
const SE_FORMAT = {
  kind: 'single_elim', maxTeams: 4, thirdPlace: true,
  bo: { default: 5, overrides: [], grandFinal: 7 },
  bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};

const regId = i => `${COMP}_team${i}`;
const numOf = rid => Number(String(rid).split('team')[1]);

// Le plus petit numéro gagne, scores réalistes à diff DISTINCTE par gagnant
// (total gagnant 12 − n, perdant 2) : jamais d'égalité inter-poules au cut.
function gamesFor(winnerNum, winnerSide) {
  const total = 12 - winnerNum;
  const w = [Math.ceil(total / 3), Math.floor(total / 3), total - Math.ceil(total / 3) - Math.floor(total / 3)];
  const l = [1, 0, 1];
  return w.map((g, i) => (winnerSide === 'a' ? { a: g, b: l[i] } : { a: l[i], b: g }));
}

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

async function playAllPending(api) {
  for (let guard = 0; guard < 10; guard++) {
    const state = await api('GET', `/api/admin/competitions/${COMP}/console`);
    const playable = state.matches.filter(m =>
      m.status === 'pending' && m.teamA && m.teamB && !m.voidA && !m.voidB);
    if (playable.length === 0) return state;
    await api('POST', `/api/admin/competitions/${COMP}/console`, {
      action: 'launch_phase', matchIds: playable.map(m => m.id),
    });
    for (const m of playable) {
      const a = numOf(m.teamA);
      const b = numOf(m.teamB);
      await api('POST', `/api/admin/competitions/${COMP}/console`, {
        action: 'force_score', matchId: m.id, games: gamesFor(Math.min(a, b), a < b ? 'a' : 'b'),
      });
    }
  }
  throw new Error('playAllPending : garde de boucle atteinte');
}

async function main() {
  console.log('Purge de la démo précédente…');
  await purge();

  await db.collection('users').doc(ADMIN).set({
    uid: ADMIN, displayName: 'Demo TwoStage Admin', discordUsername: 'demo_2s_admin',
    discordId: '999999999999999951', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN).set({ addedBy: 'seed-demo', addedAt: FieldValue.serverTimestamp() });
  const api = makeApi(await tokenFor(ADMIN));

  try {
    console.log('\nSeed demo-two-stage (poules 2×4 → simple élim top-4)…');
    await db.collection('competitions').doc(COMP).set({
      name: 'Démo — Poules vers playoff',
      game: 'rocket_league', circuitId: null,
      format: RR_FORMAT,
      stages: [
        { kind: 'round_robin', format: RR_FORMAT, name: 'Poules', transfer: { advanceCount: 4, reseed: 'standings' } },
        { kind: 'single_elim', format: SE_FORMAT, name: 'Phase finale' },
      ],
      eligibility: { requireVerifiedAccounts: true, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: { opensAt: Timestamp.fromDate(new Date('2026-07-01')), closesAt: Timestamp.fromDate(new Date('2026-08-20')), waitlist: true },
      schedule: {
        days: [{ date: '2026-08-22', startsAt: '15:00', endsAt: '22:00' }],
        phasePlan: [1, 2, 3].map(d => ({ phase: d, day: 1, label: `J${d}`, rounds: [{ bracket: 'round_robin', round: d }] })),
        generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
      },
      discord: null, status: 'draft', isDev: true, approvedCount: TEAMS.length, createdAt: Timestamp.now(),
    });
    const batch = db.batch();
    TEAMS.forEach((t, idx) => {
      const i = idx + 1;
      batch.set(db.collection('competition_registrations').doc(regId(i)), {
        competitionId: COMP, structureId: 'demo-2s-struct', teamId: `demo-2s-t${i}`,
        name: t.name, tag: t.tag, logoUrl: null,
        captainUid: `discord_demo_2s_cap${i}`,
        rosterUids: [`discord_demo_2s_cap${i}`, `discord_demo_2s_p${i}b`, `discord_demo_2s_p${i}c`],
        status: 'approved', createdAt: Timestamp.now(),
      });
    });
    await batch.commit();

    await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
      action: 'reorder', order: TEAMS.map((_, idx) => regId(idx + 1)),
    });
    const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
    console.log(`  publié : ${pub.matchCount} matchs de poule (attendu 12).`);

    console.log('  poules jouées…');
    await playAllPending(api);

    console.log('  advance_stage (flux réel)…');
    const adv = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'advance_stage' });
    console.log(`  étape ${adv.stage} lancée : ${adv.matchCount} matchs, qualifiées ${adv.advanced.join(', ')}.`);

    // Demie 1 jouée ; demie 2 EN COURS + castée — la petite finale et la
    // finale attendent (l'état le plus parlant pour juger la vue).
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['E2_W1-1', 'E2_W1-2'] });
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'force_score', matchId: 'E2_W1-1', games: gamesFor(1, 'a') });
    await db.collection('competition_matches').doc(`${COMP}__E2_W1-2`).update({
      status: 'live', 'checkin.a.done': true, 'checkin.b.done': true, updatedAt: FieldValue.serverTimestamp(),
    });
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'set_cast', matchId: 'E2_W1-2', featured: true, streamUrl: 'https://twitch.tv/springsesport' });

    // Sanity : les deux étapes sortent bien sur les routes publiques.
    const matches = await api('GET', `/api/competitions/${COMP}/matches`);
    const standings = await api('GET', `/api/competitions/${COMP}/standings`);
    const s1 = standings.stages?.[0];
    if (matches.matches.length !== 16) throw new Error(`matches: ${matches.matches.length}`);
    if (!s1 || s1.concluded !== true) throw new Error(`standings étape 1: ${JSON.stringify(s1)}`);
    console.log(`  vérifs : ${matches.matches.length} matchs (12 poules + 4 arbre), classement étape 1 figé OK.`);
  } finally {
    await db.collection('aedral_admins').doc(ADMIN).delete();
    await db.collection('users').doc(ADMIN).delete();
    await auth.deleteUsers([ADMIN]).catch(() => {});
  }

  console.log(`\nDémo prête (visible admins/testeurs uniquement) :`);
  console.log(`  ${BASE}/competitions/demo-two-stage — onglets Poules / Phase finale, classement figé, demie EN COURS + EN STREAM.`);
  console.log(`  ${BASE}/admin/competitions/demo-two-stage/console — bracket par étape, phases des deux étapes.`);
}

await main();
process.exit(0);
