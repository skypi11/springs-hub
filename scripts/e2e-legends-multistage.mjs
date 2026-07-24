// E2E RUNTIME MULTI-ÉTAPES (design docs/registry-formats-design.md §9) :
// déroule un tournoi POULES → PLAYOFF complet via les VRAIES routes —
// publish (étape 1 round robin 2 poules), 3 journées jouées, advance_stage
// (top-4 re-seedé au classement), simple élim + petite finale jouée, clôture.
// Vérifie : préfixes d'ids E2_, stageResults figés, idempotence du passage,
// gates (replace_team, withdraw hors étape), classement final concaténé.
// Données préfixées e2e-multistage*, cleanup TOUJOURS en finally (DB partagée).
// Prérequis : dev server localhost:3000 (ou E2E_BASE_URL).
// Run : node --env-file=.env.local scripts/e2e-legends-multistage.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const COMP = 'e2e-multistage';
const ADMIN = 'discord_e2e_ms_admin';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
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
  return async (method, path, body, { expectStatus = 200 } = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => null);
    if (res.status !== expectStatus) {
      throw new Error(`${method} ${path} → ${res.status} (attendu ${expectStatus}) ${JSON.stringify(json)?.slice(0, 300)}`);
    }
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

const RR_FORMAT = {
  kind: 'round_robin', maxTeams: 8, groupCount: 2, doubleRound: false,
  points: { win: 3, draw: 1, loss: 0 },
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false, thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};
const SE_FORMAT = {
  kind: 'single_elim', maxTeams: 4, thirdPlace: true,
  bo: { default: 5, overrides: [], grandFinal: 5 },
  bracketReset: false, forfeitScore: { games: 3, goalsPerGame: 1 },
};

const regId = i => `${COMP}_team${i}`;
const numOf = rid => Number(String(rid).split('team')[1]);

// Le plus petit numéro gagne TOUJOURS, avec un total de buts décroissant par
// numéro (20 − n) : diff per-match toutes distinctes → fusion inter-poules
// sans aucune égalité, classement d'étape 1 attendu = t1..t8.
function gamesFor(winnerNum, winnerSide) {
  const total = 20 - winnerNum;
  const per = [Math.ceil(total / 3), Math.floor(total / 3), total - Math.ceil(total / 3) - Math.floor(total / 3)];
  return per.map(g => (winnerSide === 'a' ? { a: g, b: 0 } : { a: 0, b: g }));
}

// Joue tous les matchs jouables de l'état console courant (launch + force).
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
      const winnerSide = a < b ? 'a' : 'b';
      await api('POST', `/api/admin/competitions/${COMP}/console`, {
        action: 'force_score', matchId: m.id, games: gamesFor(Math.min(a, b), winnerSide),
      });
    }
  }
  throw new Error('playAllPending : garde de boucle atteinte');
}

async function main() {
  console.log('Purge préalable…');
  await purge();

  await db.collection('users').doc(ADMIN).set({
    uid: ADMIN, displayName: 'E2E Multistage Admin', discordUsername: 'e2e_ms_admin',
    discordId: '999999999999999941', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN).set({ addedBy: 'e2e-multistage', addedAt: FieldValue.serverTimestamp() });
  const api = makeApi(await tokenFor(ADMIN));

  try {
    // ── Seed : compét 2 étapes (RR 2 poules top-4 → simple élim) ──
    console.log('\n[1] Seed compétition deux étapes…');
    await db.collection('competitions').doc(COMP).set({
      name: 'E2E — Poules vers playoff',
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
      discord: null, status: 'draft', isDev: true, approvedCount: 8, createdAt: Timestamp.now(),
    });
    const batch = db.batch();
    for (let i = 1; i <= 8; i++) {
      batch.set(db.collection('competition_registrations').doc(regId(i)), {
        competitionId: COMP, structureId: 'e2e-ms-struct', teamId: `e2e-ms-t${i}`,
        name: `MS Team ${i}`, tag: `MS${i}`, logoUrl: null,
        captainUid: `discord_e2e_ms_cap${i}`,
        rosterUids: [`discord_e2e_ms_cap${i}`, `discord_e2e_ms_p${i}b`, `discord_e2e_ms_p${i}c`],
        status: 'approved', createdAt: Timestamp.now(),
      });
    }
    await batch.commit();

    // ── Publish étape 1 ──
    console.log('\n[2] Seeding + publish (étape 1)…');
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
      action: 'reorder', order: [1, 2, 3, 4, 5, 6, 7, 8].map(regId),
    });
    const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
    check('publish : 12 matchs de poule', pub.matchCount === 12, String(pub.matchCount));
    const compAfterPub = (await db.collection('competitions').doc(COMP).get()).data();
    check('publish : currentStage = 1', compAfterPub.currentStage === 1);

    let state = await api('GET', `/api/admin/competitions/${COMP}/console`);
    check('console : 2 étapes déclarées', state.stages?.length === 2);
    check('console : passage indisponible avant la fin des poules', state.canAdvanceStage === false);
    check('console : clôture indisponible (étape intermédiaire)', state.finished === false);

    // Gate replace_team : autorisé étape 1 seulement — vérifié plus tard.

    // ── Étape 1 jouée ──
    console.log('\n[3] Journées de poule jouées…');
    state = await playAllPending(api);
    check('poules finies : canAdvanceStage', state.canAdvanceStage === true);
    check('poules finies : pas encore clôturable', state.finished === false);
    check('poules finies : aucune égalité à arbitrer', state.unresolvedTiebreaks.length === 0,
      JSON.stringify(state.unresolvedTiebreaks));
    const p1 = (state.placements ?? []).filter(p => p.placement !== null)
      .sort((a, b) => a.placement - b.placement).map(p => p.registrationId);
    check('classement étape 1 = t1..t8 (scores construits)',
      JSON.stringify(p1) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8].map(regId)), JSON.stringify(p1));

    // ── Passage d'étape ──
    console.log('\n[4] advance_stage…');
    const adv = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'advance_stage' });
    check('advance : étape 2 lancée', adv.stage === 2);
    check('advance : top-4 dans l\'ordre du classement',
      JSON.stringify(adv.advanced) === JSON.stringify([1, 2, 3, 4].map(regId)), JSON.stringify(adv.advanced));
    check('advance : 4 matchs créés (demies + finale + petite finale)', adv.matchCount === 4, String(adv.matchCount));

    const compAfterAdv = (await db.collection('competitions').doc(COMP).get()).data();
    check('doc : currentStage = 2', compAfterAdv.currentStage === 2);
    check('doc : stageResults figé (8 placements, 4 qualifiées)',
      compAfterAdv.stageResults?.length === 1
      && compAfterAdv.stageResults[0].placements?.length === 8
      && compAfterAdv.stageResults[0].advanced?.length === 4);
    check('doc : tiebreakResolutions remis à zéro',
      JSON.stringify(compAfterAdv.tiebreakResolutions ?? {}) === '{}');
    check('doc : phasePlan étendu (entries étape 2)',
      (compAfterAdv.schedule?.phasePlan ?? []).some(e => e.stage === 2));

    const e2w11 = (await db.collection('competition_matches').doc(`${COMP}__E2_W1-1`).get()).data();
    check('docs étape 2 : id préfixé E2_ + champ stage', !!e2w11 && e2w11.stage === 2);
    const e2final = (await db.collection('competition_matches').doc(`${COMP}__E2_W2-1`).get()).data();
    check('docs étape 2 : refs winner_of préfixées',
      e2final?.sourceA?.ref === 'E2_W1-1' && e2final?.sourceB?.ref === 'E2_W1-2',
      JSON.stringify([e2final?.sourceA, e2final?.sourceB]));
    // Seeding standard 4 équipes : W1-1 = seed1 vs seed4, W1-2 = seed2 vs seed3.
    check('re-seeding au classement : demies 1v4 et 2v3',
      e2w11?.teamA === regId(1) && e2w11?.teamB === regId(4),
      `${e2w11?.teamA} vs ${e2w11?.teamB}`);

    // Idempotence : rejouer le passage → 409, pas de double étape.
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'advance_stage' }, { expectStatus: 409 });
    check('advance rejoué → 409 (aucun doublon)', true);

    // Gates étape 2 : repêchage waitlist refusé ; retrait d'une éliminée OK sans cascade.
    await api('POST', `/api/admin/competitions/${COMP}/console`, {
      action: 'replace_team', oldRegistrationId: regId(4), newRegistrationId: null,
    }, { expectStatus: 409 });
    check('replace_team en étape 2 → 409', true);
    const wd = await api('POST', `/api/admin/competitions/${COMP}/console`, {
      action: 'withdraw_team', registrationId: regId(8), reason: 'E2E : retrait post-élimination',
    });
    check('withdraw d\'une équipe éliminée en poules : aucun match touché',
      Array.isArray(wd.changedMatchIds) && wd.changedMatchIds.length === 0, JSON.stringify(wd.changedMatchIds));

    // ── Vue publique ──
    console.log('\n[5] Routes publiques…');
    const pub2 = await api('GET', `/api/competitions/${COMP}/matches`);
    const stage2Matches = pub2.matches.filter(m => m.stage === 2);
    check('/matches : 12 + 4 matchs, champ stage exposé',
      pub2.matches.length === 16 && stage2Matches.length === 4, `${pub2.matches.length}/${stage2Matches.length}`);
    const standings = await api('GET', `/api/competitions/${COMP}/standings`);
    check('/standings : étape 1 servie close (ordre figé)',
      standings.stages?.length === 1 && standings.stages[0].stage === 1 && standings.stages[0].concluded === true,
      JSON.stringify(standings.stages?.map(s => ({ s: s.stage, c: s.concluded }))));
    const poolRows = standings.stages?.[0]?.groups?.flatMap(g => g.rows) ?? [];
    check('/standings : aucune « égalité » après arbitrage figé',
      poolRows.every(r => r.needsAdminTiebreak === false));
    const matchPage = await api('GET', `/api/competitions/${COMP}/matches/E2_W1-1`);
    check('page match : stage 2 exposé', matchPage.match?.stage === 2);

    // ── Étape 2 jouée + clôture ──
    console.log('\n[6] Phase finale jouée + clôture…');
    state = await playAllPending(api);
    check('étape finale finie : clôturable', state.finished === true);
    check('étape finale finie : plus de passage possible', state.canAdvanceStage === false);
    const close = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'close_competition' });
    const places = close.finalPlacements.map(p => p.registrationId);
    check('clôture : permutation complète 1..8', new Set(places).size === 8 && close.finalPlacements.length === 8);
    check('clôture : podium = bracket final (t1, t2, t3 petite finale)',
      JSON.stringify(places.slice(0, 4)) === JSON.stringify([1, 2, 3, 4].map(regId)), JSON.stringify(places.slice(0, 4)));
    const frozen = compAfterAdv.stageResults[0].placements
      .filter(p => p.placement >= 5).sort((a, b) => a.placement - b.placement)
      .map(p => p.registrationId);
    check('clôture : places 5-8 = éliminées des poules à leur classement d\'étape',
      JSON.stringify(places.slice(4)) === JSON.stringify(frozen), JSON.stringify(places.slice(4)));
    check('clôture : places toutes uniques 1..8',
      JSON.stringify(close.finalPlacements.map(p => p.placement)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]));
    // Stats cumulées : t1 = 3 matchs de poule + 2 d'arbre, tous gagnés 19-0 →
    // délta normalisé +19, 5 × 19 buts marqués.
    const t1 = close.finalPlacements.find(p => p.registrationId === regId(1));
    check('clôture : stats cumulées poules + phase finale (t1 : 95 buts)',
      t1?.goalsFor === 95 && t1?.goalDiff === 19, JSON.stringify(t1));

    const closedComp = (await db.collection('competitions').doc(COMP).get()).data();
    check('doc : status finished', closedComp.status === 'finished');
  } finally {
    console.log('\nCleanup…');
    await purge();
    await db.collection('aedral_admins').doc(ADMIN).delete();
    await db.collection('users').doc(ADMIN).delete();
    await auth.deleteUsers([ADMIN]).catch(() => {});
  }

  console.log(`\n${passed} ✔ / ${failed} ✘`);
  if (failed > 0) process.exit(1);
}

await main();
process.exit(0);
