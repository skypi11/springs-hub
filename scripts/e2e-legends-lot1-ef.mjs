// E2E Lot 1 E+F — file de validation + provisioning Discord (données 100 %
// synthétiques, préfixe e2e_lot1ef, cleanup TOUJOURS exécuté en fin de run).
// Prérequis : dev server sur localhost:3000, .env.local du repo.
// Run : node --env-file=.env.local "<scratchpad>/e2e-lot1-ef.mjs"  (depuis le repo)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_lot1ef';

function parseServiceAccount(raw) {
  try { return JSON.parse(raw); } catch {
    const fixed = raw.replace(/"private_key":\s*"([^"]+)"/,
      (_m, key) => `"private_key": "${key.replace(/\r?\n/g, '\\n')}"`);
    return JSON.parse(fixed);
  }
}
if (!getApps().length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}
const db = getFirestore();
const auth = getAuth();

// ── IDs synthétiques ─────────────────────────────────────────────────────────
const U = {};
for (const name of ['admin', 'dirigeant', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']) {
  U[name] = `discord_${P}_${name}`;
}
const CIRCUIT = `${P}-circuit`;
const COMP1 = `${P}-comp1`;
const COMP2 = `${P}-comp2`;
const STRUCT = `${P}-struct`;
const TEAM_A = `${P}-teamA`;
const TEAM_B = `${P}-teamB`;
const TEAM_C = `${P}-teamC`;
const TEAM_D = `${P}-teamD`;
const ALL_UIDS = Object.values(U);

// ── Framework de checks ──────────────────────────────────────────────────────
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
  if (!json.idToken) throw new Error(`signInWithCustomToken failed: ${JSON.stringify(json).slice(0, 200)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}

async function apiCall(method, path, uid, body) {
  const token = await tokenFor(uid);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
async function deleteQuery(q) {
  const snap = await q.get();
  for (const d of snap.docs) {
    const priv = await d.ref.collection('private').get().catch(() => null);
    if (priv) for (const p of priv.docs) await p.ref.delete();
    await d.ref.delete();
  }
  return snap.size;
}

async function cleanup(label) {
  console.log(`\n— Cleanup (${label})…`);
  for (const compId of [COMP1, COMP2]) {
    await deleteQuery(db.collection('competition_registrations').where('competitionId', '==', compId));
  }
  await deleteQuery(db.collection('circuit_teams').where('circuitId', '==', CIRCUIT));
  for (const id of [COMP1, COMP2]) await db.collection('competitions').doc(id).delete();
  await db.collection('circuits').doc(CIRCUIT).delete();
  for (const id of [TEAM_A, TEAM_B, TEAM_C, TEAM_D]) await db.collection('sub_teams').doc(id).delete();
  await db.collection('structures').doc(STRUCT).delete();
  await deleteQuery(db.collection('rank_reports').where('targetUid', '==', U.p1));
  for (const uid of ALL_UIDS) {
    await db.collection('users').doc(uid).delete();
    await db.collection('user_secrets').doc(uid).delete();
    await db.collection('user_admin_flags').doc(uid).delete();
    await db.collection('competition_admins').doc(uid).delete();
  }
  for (let i = 0; i < ALL_UIDS.length; i += 10) {
    await deleteQuery(db.collection('notifications').where('userId', 'in', ALL_UIDS.slice(i, i + 10)));
  }
  for (const uid of [U.admin, U.dirigeant]) {
    await deleteQuery(db.collection('admin_audit_logs').where('adminUid', '==', uid));
  }
  await auth.deleteUsers(ALL_UIDS).catch(() => {});
  console.log('  cleanup terminé.');
}

// ── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('— Seed des données synthétiques…');
  const batch = db.batch();
  const adults = ['admin', 'dirigeant', 'p1', 'p2', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'];
  for (const name of Object.keys(U)) {
    const uid = U[name];
    batch.set(db.collection('users').doc(uid), {
      uid,
      discordId: '999999999999999999',
      discordUsername: `${P}_${name}`,
      displayName: `E2E ${name.toUpperCase()}`,
      games: ['rocket_league'],
      rlEpicId: `e2e-epic-${name}`,
      rlEpicName: `E2E-${name}`,
      country: 'FR',
      createdAt: Timestamp.now(),
    });
    batch.set(db.collection('user_secrets').doc(uid), {
      dateOfBirth: adults.includes(name) ? '2000-05-10' : '2012-03-01',
    });
  }
  // Signalements smurf p1 : 2 pending comptent, resolved + rank_lie ne comptent pas.
  batch.set(db.collection('rank_reports').doc(`${P}-r1`), {
    targetUid: U.p1, targetName: 'E2E P1', game: 'rocket_league', motif: 'smurf',
    status: 'pending', reporterUid: 'e2e', reporterName: 'e2e', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('rank_reports').doc(`${P}-r2`), {
    targetUid: U.p1, targetName: 'E2E P1', game: 'rocket_league', motif: 'smurf',
    status: 'pending', reporterUid: 'e2e2', reporterName: 'e2e2', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('rank_reports').doc(`${P}-r3`), {
    targetUid: U.p1, targetName: 'E2E P1', game: 'rocket_league', motif: 'smurf',
    status: 'resolved', reporterUid: 'e2e3', reporterName: 'e2e3', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('rank_reports').doc(`${P}-r4`), {
    targetUid: U.p1, targetName: 'E2E P1', game: 'rocket_league', motif: 'rank_lie',
    status: 'pending', reporterUid: 'e2e4', reporterName: 'e2e4', createdAt: Timestamp.now(),
  });
  batch.set(db.collection('user_admin_flags').doc(U.p1), {
    suspectedSmurf: { flaggedAt: Timestamp.now(), flaggedBy: 'e2e', reportId: 'x', note: 'note interne e2e' },
  });
  batch.set(db.collection('structures').doc(STRUCT), {
    name: 'TEST E2E Lot1 — ne pas toucher', tag: 'E2E', status: 'active',
    founderId: U.dirigeant, coFounderIds: [], managerIds: [], coachIds: [],
    games: ['rocket_league'], createdAt: Timestamp.now(),
  });
  const teams = [
    [TEAM_A, 'Team Alpha E2E', [U.p1, U.p2, U.p3]],
    [TEAM_B, 'Team Bravo E2E', [U.p4, U.p5, U.dirigeant]],
    [TEAM_C, 'Team Charlie E2E', [U.p6, U.p7, U.p8]],
    [TEAM_D, 'Team Delta E2E', [U.p9, U.p10, U.p11]],
  ];
  for (const [id, name, playerIds] of teams) {
    batch.set(db.collection('sub_teams').doc(id), {
      structureId: STRUCT, game: 'rocket_league', name, playerIds, subIds: [],
      createdAt: Timestamp.now(),
    });
  }
  const mmrRules = { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 };
  const mkComp = (name, date, maxTeams) => ({
    name, game: 'rocket_league', circuitId: CIRCUIT,
    format: {
      kind: 'double_elim', maxTeams,
      bo: { default: 5, overrides: [], grandFinal: 7 },
      bracketReset: true, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: true, minAge: 16, mmr: mmrRules },
    roster: { starters: 3, subsMax: 2 },
    registration: {
      opensAt: Timestamp.fromDate(new Date('2026-01-01')),
      closesAt: Timestamp.fromDate(new Date('2026-12-01')),
      waitlist: true,
    },
    schedule: {
      days: [{ date, startsAt: '15:00' }], phasePlan: [],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: null,
    status: 'draft',
    createdAt: Timestamp.now(),
  });
  batch.set(db.collection('competitions').doc(COMP1), mkComp('TEST E2E Qualif 1 — ne pas toucher', '2026-09-26', 8));
  batch.set(db.collection('competitions').doc(COMP2), mkComp('TEST E2E Qualif 2 — ne pas toucher', '2026-10-10', 2));
  batch.set(db.collection('circuits').doc(CIRCUIT), {
    name: 'TEST E2E Circuit — ne pas toucher', game: 'rocket_league',
    competitionIds: [COMP1, COMP2], pointsScale: { 1: 40, 2: 34 },
    bestResultsCount: 3, lanTeamCount: 16,
    tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
    status: 'draft', createdAt: Timestamp.now(),
  });
  for (const uid of [U.admin, U.dirigeant]) {
    batch.set(db.collection('competition_admins').doc(uid), {
      displayName: 'E2E admin', addedBy: 'e2e', addedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  console.log('  seed OK.');
}

// ── Helpers scénario ─────────────────────────────────────────────────────────
function rosterPayload(uids, mmrs) {
  return uids.map((uid, i) => ({
    uid, role: 'titulaire',
    declaredCurrentMmr: mmrs[i][0], declaredPeakMmr: mmrs[i][1],
  }));
}

async function register(compId, teamId, name, uids, mmrs) {
  return apiCall('POST', `/api/competitions/${compId}/register`, U.dirigeant, {
    structureId: STRUCT, teamId, name,
    roster: rosterPayload(uids, mmrs),
  });
}

const regAction = (compId, body) =>
  apiCall('POST', `/api/admin/competitions/${compId}/registrations`, U.admin, body);
const getRegs = (compId, uid = U.admin) =>
  apiCall('GET', `/api/admin/competitions/${compId}/registrations`, uid);

const MMR_A = [[1900, 2000], [1700, 1800], [1600, 1700]]; // cap joueur + gap dépassés
const MMR_OK = [[1600, 1700], [1600, 1700], [1600, 1700]];

// ── Scénario ─────────────────────────────────────────────────────────────────
async function run() {
  const regA2 = `${COMP2}_${TEAM_A}`;
  const regB2 = `${COMP2}_${TEAM_B}`;
  const regC2 = `${COMP2}_${TEAM_C}`;
  const regA1 = `${COMP1}_${TEAM_A}`;
  const regB1 = `${COMP1}_${TEAM_B}`;
  const regC1 = `${COMP1}_${TEAM_C}`;
  const regD1 = `${COMP1}_${TEAM_D}`;

  console.log('\n— Phase 1 : file de validation sur COMP2 (cap 2, waitlist)…');

  // 1. Inscription équipe A : flags MMR + underage
  let r = await register(COMP2, TEAM_A, 'Team Alpha E2E', [U.p1, U.p2, U.p3], MMR_A);
  check('1. register A comp2 → 200 + flags underage/mmr', r.status === 200
    && r.json.flags?.includes('underage')
    && r.json.flags?.includes('mmr_player_cap_exceeded')
    && r.json.flags?.includes('mmr_gap_exceeded'),
    `status ${r.status} flags ${JSON.stringify(r.json?.flags)}`);

  // 2. GET admin : smurf agrégé anonymisé + identité 'new'
  r = await getRegs(COMP2);
  const rowA = r.json?.registrations?.find(x => x.id === regA2);
  const p1row = rowA?.roster?.find(x => x.uid === U.p1);
  const p2row = rowA?.roster?.find(x => x.uid === U.p2);
  check('2. GET regs : agrégat smurf p1 (2 pending + flag admin), p2 clean, identity new',
    r.status === 200 && p1row?.smurf?.pendingReports === 2 && p1row?.smurf?.adminFlag === true
    && p2row?.smurf?.pendingReports === 0 && p2row?.smurf?.adminFlag === false
    && rowA?.identity?.proposal === 'new'
    && r.json?.counts?.approved === 0 && r.json?.counts?.maxTeams === 2,
    JSON.stringify({ status: r.status, p1: p1row?.smurf, id: rowA?.identity?.proposal, counts: r.json?.counts }));

  // 3. Accès refusé à un non-admin compét
  r = await getRegs(COMP2, U.p2);
  check('3. GET regs par un joueur → 403', r.status === 403, `status ${r.status}`);

  // 4. Approve sans dérogation → 422
  r = await regAction(COMP2, { action: 'approve', registrationId: regA2 });
  check('4. approve A sans dérogation → 422 + needsDerogationFor p3',
    r.status === 422 && r.json?.needsDerogationFor?.includes(U.p3),
    `status ${r.status} ${JSON.stringify(r.json)}`);

  // 5. Approve avec dérogation
  r = await regAction(COMP2, {
    action: 'approve', registrationId: regA2,
    derogations: [{ uid: U.p3, note: 'Accord parental reçu par mail le 03/07 (e2e)' }],
  });
  const slugA = `${CIRCUIT}__team-alpha-e2e`;
  check('5. approve A avec dérogation → approved + circuit_team slug',
    r.status === 200 && r.json?.status === 'approved' && r.json?.circuitTeamId === slugA,
    `status ${r.status} ${JSON.stringify(r.json)}`);

  // 6. Vérifs DB
  let regSnap = await db.collection('competition_registrations').doc(regA2).get();
  let compSnap = await db.collection('competitions').doc(COMP2).get();
  let ctSnap = await db.collection('circuit_teams').doc(slugA).get();
  let stateSnap = await db.collection('circuit_teams').doc(slugA).collection('private').doc('state').get();
  check('6. DB : reg approved + review + approvedCount 1 + claim + roster history',
    regSnap.data()?.status === 'approved'
    && regSnap.data()?.review?.by === U.admin
    && regSnap.data()?.review?.derogations?.length === 1
    && compSnap.data()?.approvedCount === 1
    && ctSnap.exists && ctSnap.data()?.name === 'Team Alpha E2E'
    && stateSnap.data()?.claims?.[COMP2] === regA2
    && JSON.stringify(stateSnap.data()?.rosterByCompetition?.[COMP2]?.starterUids?.slice().sort())
       === JSON.stringify([U.p1, U.p2, U.p3].sort()),
    JSON.stringify({ st: regSnap.data()?.status, cnt: compSnap.data()?.approvedCount, ct: ctSnap.exists }));

  // 7. Notifications in-app pour le roster
  let notifSnap = await db.collection('notifications').where('userId', '==', U.p3).get();
  check('7. notification in-app créée pour p3 (decision approved)',
    notifSnap.docs.some(d => d.data().type === 'competition_registration' && d.data().metadata?.decision === 'approved'),
    `notifs p3: ${notifSnap.size}`);

  // 8. B validée → cap atteint
  r = await register(COMP2, TEAM_B, 'Team Bravo E2E', [U.p4, U.p5, U.dirigeant], MMR_OK);
  const cleanFlags = r.status === 200 && (r.json.flags ?? []).length === 0;
  r = await regAction(COMP2, { action: 'approve', registrationId: regB2 });
  compSnap = await db.collection('competitions').doc(COMP2).get();
  check('8. register B sans flag + approve → approved, approvedCount 2',
    cleanFlags && r.status === 200 && r.json?.status === 'approved' && compSnap.data()?.approvedCount === 2,
    `flags clean ${cleanFlags} status ${r.status} ${r.json?.status} cnt ${compSnap.data()?.approvedCount}`);

  // 9. C → waitlist (cap plein) avec claim circuit posé
  r = await register(COMP2, TEAM_C, 'Team Charlie E2E', [U.p6, U.p7, U.p8], MMR_OK);
  r = await regAction(COMP2, { action: 'approve', registrationId: regC2 });
  const slugC = `${CIRCUIT}__team-charlie-e2e`;
  stateSnap = await db.collection('circuit_teams').doc(slugC).collection('private').doc('state').get();
  compSnap = await db.collection('competitions').doc(COMP2).get();
  check('9. approve C → waitlisted (cap plein), claim posé SANS roster fantôme, count inchangé',
    r.status === 200 && r.json?.status === 'waitlisted'
    && stateSnap.exists && stateSnap.data()?.claims?.[COMP2] === regC2
    && stateSnap.data()?.rosterByCompetition?.[COMP2] === undefined
    && compSnap.data()?.approvedCount === 2,
    `status ${r.status} ${r.json?.status} cnt ${compSnap.data()?.approvedCount}`);

  // 10. Re-approve C sans place → 409
  r = await regAction(COMP2, { action: 'approve', registrationId: regC2 });
  check('10. approve C sans place libre → 409', r.status === 409, `status ${r.status}`);

  // 11. Unapprove A : place libérée + circuit_team orpheline supprimée
  r = await regAction(COMP2, { action: 'unapprove', registrationId: regA2 });
  regSnap = await db.collection('competition_registrations').doc(regA2).get();
  compSnap = await db.collection('competitions').doc(COMP2).get();
  ctSnap = await db.collection('circuit_teams').doc(slugA).get();
  stateSnap = await db.collection('circuit_teams').doc(slugA).collection('private').doc('state').get();
  check('11. unapprove A → pending, count 1, circuit_team orpheline supprimée',
    r.status === 200 && regSnap.data()?.status === 'pending'
    && regSnap.data()?.review === null && regSnap.data()?.circuitTeamId === null
    && compSnap.data()?.approvedCount === 1
    && !ctSnap.exists && !stateSnap.exists,
    JSON.stringify({ st: regSnap.data()?.status, cnt: compSnap.data()?.approvedCount, ct: ctSnap.exists }));

  // 12. Promotion de C (waitlisted → approved, claim conservé)
  r = await regAction(COMP2, { action: 'approve', registrationId: regC2 });
  regSnap = await db.collection('competition_registrations').doc(regC2).get();
  compSnap = await db.collection('competitions').doc(COMP2).get();
  stateSnap = await db.collection('circuit_teams').doc(slugC).collection('private').doc('state').get();
  check('12. promotion C → approved, circuitTeamId conservé, roster de référence écrit, count 2',
    r.status === 200 && r.json?.status === 'approved'
    && regSnap.data()?.circuitTeamId === slugC
    && stateSnap.data()?.rosterByCompetition?.[COMP2]?.registrationId === regC2
    && compSnap.data()?.approvedCount === 2,
    `status ${r.status} ${r.json?.status} ctid ${regSnap.data()?.circuitTeamId}`);

  // 13. Reject sans motif → 400
  r = await regAction(COMP2, { action: 'reject', registrationId: regA2 });
  check('13. reject A sans motif → 400', r.status === 400, `status ${r.status}`);

  // 14. Reject avec motif → notification avec le motif
  r = await regAction(COMP2, { action: 'reject', registrationId: regA2, reason: 'MMR incohérent avec le tracker (e2e)' });
  notifSnap = await db.collection('notifications').where('userId', '==', U.p1).get();
  const rejectNotif = notifSnap.docs.find(d =>
    d.data().type === 'competition_registration' && d.data().metadata?.decision === 'rejected');
  check('14. reject A avec motif → rejected + notif p1 contenant le motif',
    r.status === 200 && !!rejectNotif && rejectNotif.data().message.includes('MMR incohérent'),
    `status ${r.status} notif ${rejectNotif?.data()?.message?.slice(0, 60)}`);

  console.log('\n— Phase 2 : identité circuit (COMP1 ↔ COMP2)…');

  // 15. A s'inscrit à COMP1 → new (sa circuit_team a été supprimée au 11)
  r = await register(COMP1, TEAM_A, 'Team Alpha E2E', [U.p1, U.p2, U.p3], MMR_A);
  let g = await getRegs(COMP1);
  const rowA1 = g.json?.registrations?.find(x => x.id === regA1);
  r = await regAction(COMP1, {
    action: 'approve', registrationId: regA1,
    derogations: [{ uid: U.p3, note: 'Accord parental (e2e, comp1)' }],
  });
  check('15. register+approve A comp1 → identity new, approved, circuit_team recréée',
    rowA1?.identity?.proposal === 'new' && r.status === 200 && r.json?.status === 'approved'
    && r.json?.circuitTeamId === slugA,
    JSON.stringify({ id: rowA1?.identity?.proposal, status: r.status, ct: r.json?.circuitTeamId }));

  // 16. Re-soumission de A sur COMP2 (rejected → réécrite) → attach AUTO via noyau comp1
  r = await register(COMP2, TEAM_A, 'Team Alpha E2E', [U.p1, U.p2, U.p3], MMR_A);
  g = await getRegs(COMP2);
  const rowA2b = g.json?.registrations?.find(x => x.id === regA2);
  r = await regAction(COMP2, {
    action: 'approve', registrationId: regA2,
    derogations: [{ uid: U.p3, note: 'Accord parental (e2e, comp2 bis)' }],
  });
  stateSnap = await db.collection('circuit_teams').doc(slugA).collection('private').doc('state').get();
  check('16. re-register A comp2 → attach auto (nom+noyau), waitlisted (cap), claim posé',
    rowA2b?.identity?.proposal === 'attach' && rowA2b?.identity?.circuitTeamId === slugA
    && r.status === 200 && r.json?.status === 'waitlisted' && r.json?.circuitTeamId === slugA
    && stateSnap.data()?.claims?.[COMP2] === regA2,
    JSON.stringify({ id: rowA2b?.identity, status: r.status, json: r.json }));

  // 17. C s'inscrit à COMP1 sous un NOUVEAU nom → name_mismatch, attach = rename
  r = await register(COMP1, TEAM_C, 'Nouvelle Ere E2E', [U.p6, U.p7, U.p8], MMR_OK);
  g = await getRegs(COMP1);
  const rowC1 = g.json?.registrations?.find(x => x.id === regC1);
  const noChoice = await regAction(COMP1, { action: 'approve', registrationId: regC1 });
  r = await regAction(COMP1, {
    action: 'approve', registrationId: regC1,
    circuitTeam: { choice: 'attach', circuitTeamId: slugC },
  });
  ctSnap = await db.collection('circuit_teams').doc(slugC).get();
  check('17. name_mismatch : choix requis (409 sans choix), attach → circuit_team renommée',
    rowC1?.identity?.proposal === 'choice_required'
    && rowC1?.identity?.flags?.includes('name_mismatch')
    && noChoice.status === 409
    && r.status === 200 && r.json?.status === 'approved' && r.json?.circuitTeamId === slugC
    && ctSnap.data()?.name === 'Nouvelle Ere E2E',
    JSON.stringify({ id: rowC1?.identity?.flags, noChoice: noChoice.status, status: r.status, name: ctSnap.data()?.name }));

  // 18. B s'inscrit à COMP1 sous le nom de la circuit_team de C → conflit + claim refusé + new
  r = await register(COMP1, TEAM_B, 'Nouvelle Ere E2E', [U.p4, U.p5, U.dirigeant], MMR_OK);
  g = await getRegs(COMP1);
  const rowB1 = g.json?.registrations?.find(x => x.id === regB1);
  const claimTry = await regAction(COMP1, {
    action: 'approve', registrationId: regB1,
    circuitTeam: { choice: 'attach', circuitTeamId: slugC },
  });
  r = await regAction(COMP1, {
    action: 'approve', registrationId: regB1,
    circuitTeam: { choice: 'new' },
  });
  const slugNouvelle = `${CIRCUIT}__nouvelle-ere-e2e`;
  check('18. identity_conflict (nom repris, claimé) : attach → 409, new → nouvelle circuit_team',
    rowB1?.identity?.proposal === 'choice_required'
    && rowB1?.identity?.flags?.includes('identity_conflict')
    && claimTry.status === 409
    && r.status === 200 && r.json?.status === 'approved' && r.json?.circuitTeamId === slugNouvelle,
    JSON.stringify({ id: rowB1?.identity, claimTry: claimTry.status, status: r.status, ct: r.json?.circuitTeamId }));

  // 19. D s'inscrit à COMP1 sous « Team Alpha E2E » (slug primaire PRIS par la team de A)
  //     → conflit, new → slug suffixé déterministe
  r = await register(COMP1, TEAM_D, 'Team Alpha E2E', [U.p9, U.p10, U.p11], MMR_OK);
  g = await getRegs(COMP1);
  const rowD1 = g.json?.registrations?.find(x => x.id === regD1);
  r = await regAction(COMP1, {
    action: 'approve', registrationId: regD1,
    circuitTeam: { choice: 'new' },
  });
  const slugSuffixed = `${slugA}--${TEAM_D}`;
  const ctSuffixed = await db.collection('circuit_teams').doc(slugSuffixed).get();
  check('19. homonyme volontaire : new → slug suffixé, doc créé',
    rowD1?.identity?.proposal === 'choice_required'
    && r.status === 200 && r.json?.circuitTeamId === slugSuffixed && ctSuffixed.exists,
    JSON.stringify({ id: rowD1?.identity?.proposal, status: r.status, ct: r.json?.circuitTeamId }));

  // 20. Provision sans serveur Discord configuré → 400
  r = await apiCall('POST', `/api/admin/competitions/${COMP2}/provision`, U.admin);
  check('20. provision sans guildId → 400', r.status === 400, `status ${r.status}`);

  // 21. Compteurs finaux COMP1
  g = await getRegs(COMP1);
  compSnap = await db.collection('competitions').doc(COMP1).get();
  check('21. counts COMP1 : 4 validées (A, C, B-new, D-new)',
    g.json?.counts?.approved === 4 && compSnap.data()?.approvedCount === 4,
    JSON.stringify(g.json?.counts));

  // 22. GET final COMP2 : sections cohérentes (approved B+C, waitlisted A)
  g = await getRegs(COMP2);
  const statuses = Object.fromEntries((g.json?.registrations ?? []).map(x => [x.id, x.status]));
  check('22. états finaux COMP2 : B approved, C approved, A waitlisted',
    statuses[regB2] === 'approved' && statuses[regC2] === 'approved' && statuses[regA2] === 'waitlisted',
    JSON.stringify(statuses));
}

// ── Main ─────────────────────────────────────────────────────────────────────
await cleanup('préventif');
await seed();
try {
  await run();
} catch (err) {
  failed++;
  console.error('\n✗ Exception pendant le scénario :', err);
} finally {
  await cleanup('final');
}
console.log(`\n═══ Résultat : ${passed} ✓ / ${failed} ✗ ═══`);
process.exit(failed > 0 ? 1 : 0);
