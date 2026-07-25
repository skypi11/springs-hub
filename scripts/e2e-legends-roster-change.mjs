// E2E CHANGEMENT DE ROSTER (dérogation admin au roster lock — spec §4) :
// replace / swap_roles / set_captain via la VRAIE route admin, avec tous les
// re-checks (membre de l'équipe, anti-doublon, compte vérifié, mineur →
// dérogation, MMR déclarés), les gates (match actif) et les effets (computed
// recalculé, ACL des matchs non terminaux, copie circuit state).
// Données préfixées e2e-rc*, cleanup TOUJOURS en finally (DB partagée).
// Run : node --env-file=.env.local scripts/e2e-legends-roster-change.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const COMP = 'e2e-rc';
const CIRCUIT = 'e2e-rc-circuit';
const ADMIN = 'discord_e2e_rc_admin';

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

const uidOf = n => `discord_e2e_rc_${n}`;

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
  const cts = await db.collection('circuit_teams').where('circuitId', '==', CIRCUIT).get();
  for (const d of cts.docs) {
    const priv = await d.ref.collection('private').get();
    for (const p of priv.docs) await p.ref.delete();
    await d.ref.delete();
  }
  await db.collection('circuits').doc(CIRCUIT).delete();
  // Users/secrets/équipes/structure de test.
  for (let t = 1; t <= 2; t++) {
    for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
      await db.collection('users').doc(uidOf(`t${t}${suffix}`)).delete();
      await db.collection('user_secrets').doc(uidOf(`t${t}${suffix}`)).delete();
    }
    await db.collection('sub_teams').doc(`e2e-rc-team${t}`).delete();
  }
  await db.collection('structures').doc('e2e-rc-struct').delete();
}

async function main() {
  console.log('Purge préalable…');
  await purge();

  await db.collection('users').doc(ADMIN).set({
    uid: ADMIN, displayName: 'E2E RC Admin', discordUsername: 'e2e_rc_admin',
    discordId: '999999999999999971', games: [], isDev: true, createdAt: Timestamp.now(),
  });
  await db.collection('aedral_admins').doc(ADMIN).set({ addedBy: 'e2e-rc', addedAt: FieldValue.serverTimestamp() });
  const api = makeApi(await tokenFor(ADMIN));

  try {
    console.log('\n[1] Seed : users vérifiés + équipes + compét 4 équipes…');
    // Équipe 1 : a,b,c au roster inscrit ; d = membre dispo VÉRIFIÉ majeur ;
    // e = membre dispo NON vérifié. Équipe 2 : a,b,c inscrits (pour le doublon).
    const mkUser = (n, { verified = true, adult = true } = {}) => Promise.all([
      db.collection('users').doc(uidOf(n)).set({
        uid: uidOf(n), displayName: `RC ${n.toUpperCase()}`, discordUsername: `rc_${n}`,
        discordId: uidOf(n).replace('discord_', ''), country: 'FR', games: ['rl'], isDev: true,
        ...(verified ? { rlEpicId: `epic-${n}`, rlEpicName: `Epic${n}` } : {}),
        createdAt: Timestamp.now(),
      }),
      db.collection('user_secrets').doc(uidOf(n)).set(
        adult ? { dateOfBirth: '2000-05-10' } : { dateOfBirth: '2012-05-10' }),
    ]);
    await Promise.all([
      ...['t1a', 't1b', 't1c', 't1d'].map(n => mkUser(n)),
      mkUser('t1e', { verified: false }),
      ...['t2a', 't2b', 't2c'].map(n => mkUser(n)),
      // t2d : membre équipe 1 AUSSI ? Non — t2d = mineur vérifié pour le test dérogation, membre équipe 1.
      mkUser('t1m', { verified: true, adult: false }),
    ]);
    await db.collection('structures').doc('e2e-rc-struct').set({
      name: 'E2E RC Struct', tag: 'RC', games: ['rl'], founderId: ADMIN,
      coFounderIds: [], managerIds: [], coachIds: [], status: 'active', isDev: true, createdAt: Timestamp.now(),
    });
    await db.collection('sub_teams').doc('e2e-rc-team1').set({
      structureId: 'e2e-rc-struct', game: 'rocket_league', name: 'RC One',
      playerIds: [uidOf('t1a'), uidOf('t1b'), uidOf('t1c')],
      subIds: [uidOf('t1d'), uidOf('t1e'), uidOf('t1m')],
      staffIds: [], createdAt: Timestamp.now(),
    });
    await db.collection('sub_teams').doc('e2e-rc-team2').set({
      structureId: 'e2e-rc-struct', game: 'rocket_league', name: 'RC Two',
      playerIds: [uidOf('t2a'), uidOf('t2b'), uidOf('t2c')], subIds: [], staffIds: [], createdAt: Timestamp.now(),
    });

    // Circuit minimal + équipe de circuit rattachée à l'inscription 1 (copie
    // du roster dans /private/state — la base de la règle noyau).
    await db.collection('circuits').doc(CIRCUIT).set({
      name: 'E2E RC Circuit', game: 'rocket_league', competitionIds: [COMP],
      pointsScale: { 1: 10, 2: 8 }, bestResultsCount: 1, lanTeamCount: 2,
      tieBreakers: ['best_placement', 'goal_diff_total', 'latest_event'],
      status: 'draft', createdAt: Timestamp.now(),
    });
    await db.collection('circuit_teams').doc('e2e-rc-ct1').set({
      circuitId: CIRCUIT, name: 'RC One', tag: 'RC1', participations: [],
    });

    const SE_FORMAT = {
      kind: 'single_elim', maxTeams: 4, thirdPlace: false,
      bo: { default: 1, overrides: [], grandFinal: 1 },
      bracketReset: false, forfeitScore: { games: 1, goalsPerGame: 1 },
    };
    await db.collection('competitions').doc(COMP).set({
      name: 'E2E — Changement de roster', game: 'rocket_league', circuitId: CIRCUIT,
      format: SE_FORMAT,
      eligibility: {
        requireVerifiedAccounts: true, minAge: 16,
        mmr: { weightCurrent: 0.7, maxAvg: 1850, maxGap: 150, maxPlayer: 1900 },
      },
      roster: { starters: 3, subsMax: 2 },
      registration: { opensAt: Timestamp.fromDate(new Date('2026-07-01')), closesAt: Timestamp.fromDate(new Date('2026-08-20')), waitlist: true },
      schedule: {
        days: [{ date: '2026-08-22', startsAt: '15:00' }],
        phasePlan: [{ phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] }, { phase: 2, day: 1, label: 'P2', rounds: [{ bracket: 'winners', round: 2 }] }],
        generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
      },
      discord: null, status: 'draft', isDev: true, approvedCount: 4, createdAt: Timestamp.now(),
    });

    const rosterEntry = (n, role, refMmr = 1500) => ({
      uid: uidOf(n), role, displayName: `RC ${n.toUpperCase()}`,
      declaredCurrentMmr: refMmr, declaredPeakMmr: refMmr, refMmr,
      epicId: `epic-${n}`, epicName: `Epic${n}`, steamId: null, trackerUrl: null,
      discordId: uidOf(n).replace('discord_', ''), discordUsername: `rc_${n}`, country: 'FR',
      age: 26, verified: true, onDiscordGuild: null,
    });
    const mkReg = (i, uids, extra = {}) => db.collection('competition_registrations').doc(`${COMP}_team${i}`).set({
      competitionId: COMP, structureId: 'e2e-rc-struct', teamId: `e2e-rc-team${i}`,
      name: `RC Team ${i}`, tag: `RC${i}`, logoUrl: null,
      captainUid: uids[0], rosterUids: uids,
      roster: uids.map((u, k) => rosterEntry(u.replace('discord_e2e_rc_', ''), k < 3 ? 'titulaire' : 'remplacant')),
      computed: { worstLineupAvg: 1500, worstLineupGap: 0, flags: [] },
      status: 'approved', createdAt: Timestamp.now(), ...extra,
    });
    await mkReg(1, ['t1a', 't1b', 't1c'].map(uidOf), { circuitTeamId: 'e2e-rc-ct1' });
    await mkReg(2, ['t2a', 't2b', 't2c'].map(uidOf));
    // Équipes 3 et 4 factices pour remplir le bracket.
    for (const i of [3, 4]) {
      await db.collection('competition_registrations').doc(`${COMP}_team${i}`).set({
        competitionId: COMP, structureId: 'e2e-rc-other', teamId: `e2e-rc-x${i}`,
        name: `RC Filler ${i}`, tag: `RF${i}`, logoUrl: null,
        captainUid: uidOf(`f${i}`), rosterUids: [uidOf(`f${i}`)],
        roster: [], computed: { worstLineupAvg: null, worstLineupGap: null, flags: [] },
        status: 'approved', createdAt: Timestamp.now(),
      });
    }
    await db.collection('circuit_teams').doc('e2e-rc-ct1').collection('private').doc('state').set({
      claims: { [COMP]: `${COMP}_team1` },
      rosterByCompetition: {
        [COMP]: { registrationId: `${COMP}_team1`, rosterUids: ['t1a', 't1b', 't1c'].map(uidOf), starterUids: ['t1a', 't1b', 't1c'].map(uidOf) },
      },
    });

    const REG = `${COMP}_team1`;
    const post = (change, opts) => api('POST', `/api/admin/competitions/${COMP}/registrations`,
      { action: 'change_roster', registrationId: REG, change }, opts);

    console.log('\n[2] Sélecteur + refus attendus…');
    const options = await api('GET', `/api/admin/competitions/${COMP}/registrations?rosterOptionsFor=${REG}`);
    check('sélecteur : membres de l\'équipe hors roster (d, e, m)',
      options.members.length === 3
      && options.members.some(m => m.uid === uidOf('t1d') && m.verified && m.ageStatus === 'ok')
      && options.members.some(m => m.uid === uidOf('t1e') && !m.verified)
      && options.members.some(m => m.uid === uidOf('t1m') && m.ageStatus === 'under'),
      JSON.stringify(options.members));
    check('sélecteur : mmrRequired exposé', options.mmrRequired === true);

    await post({ op: 'replace', outUid: uidOf('t1c'), inUid: 'discord_hors_equipe', declaredCurrentMmr: 1500, declaredPeakMmr: 1500 }, { expectStatus: 409 });
    check('replace refusé : entrant hors équipe Aedral', true);
    await post({ op: 'replace', outUid: uidOf('t1c'), inUid: uidOf('t1e'), declaredCurrentMmr: 1500, declaredPeakMmr: 1500 }, { expectStatus: 409 });
    check('replace refusé : entrant non vérifié (gate compét)', true);
    await post({ op: 'replace', outUid: uidOf('t1c'), inUid: uidOf('t1d') }, { expectStatus: 400 });
    check('replace refusé : MMR déclarés manquants (règles MMR actives)', true);
    const derog = await post({ op: 'replace', outUid: uidOf('t1c'), inUid: uidOf('t1m'), declaredCurrentMmr: 1500, declaredPeakMmr: 1500 }, { expectStatus: 422 });
    check('replace mineur sans note → 422 avec needsDerogationFor', Array.isArray(derog.needsDerogationFor) && derog.needsDerogationFor[0] === uidOf('t1m'));

    console.log('\n[3] Remplacement valide (rôle hérité + computed + circuit state)…');
    await post({ op: 'replace', outUid: uidOf('t1c'), inUid: uidOf('t1d'), declaredCurrentMmr: 1600, declaredPeakMmr: 1700 });
    let reg = (await db.collection('competition_registrations').doc(REG).get()).data();
    const entryD = reg.roster.find(r => r.uid === uidOf('t1d'));
    check('roster : t1d entre avec le rôle HÉRITÉ (titulaire)', entryD?.role === 'titulaire');
    check('roster : t1c sorti, effectif inchangé', reg.roster.length === 3 && !reg.rosterUids.includes(uidOf('t1c')));
    check('snapshot entrant : vérifié + refMmr recalculé (0.7×1600 + 0.3×1700 = 1630)',
      entryD?.verified === true && entryD?.refMmr === 1630, JSON.stringify(entryD));
    check('computed recalculé : moyenne de la compo la plus forte à jour',
      reg.computed.worstLineupAvg === Math.round((1500 + 1500 + 1630) / 3), String(reg.computed.worstLineupAvg));
    check('trace rosterChanges posée', Array.isArray(reg.rosterChanges) && reg.rosterChanges.length === 1);
    const ctState = (await db.collection('circuit_teams').doc('e2e-rc-ct1').collection('private').doc('state').get()).data();
    check('circuit state : copie du roster resynchronisée (règle noyau)',
      JSON.stringify([...ctState.rosterByCompetition[COMP].rosterUids].sort())
      === JSON.stringify([uidOf('t1a'), uidOf('t1b'), uidOf('t1d')].sort()),
      JSON.stringify(ctState.rosterByCompetition[COMP]));

    console.log('\n[4] Doublon inter-équipes + swap + capitanat…');
    await post({ op: 'replace', outUid: uidOf('t1a'), inUid: uidOf('t2a'), declaredCurrentMmr: 1500, declaredPeakMmr: 1500 }, { expectStatus: 409 });
    check('replace refusé : joueur déjà inscrit dans une autre équipe', true);
    // t1d titulaire ↔ ... il faut un remplaçant : replace de personne — swap impossible (pas de sub).
    // Ajoutons le cas swap via la dérogation mineur d'abord (t1m entre en remplaçant ? non — pas de sub au roster).
    // → set_captain d'abord, puis swap testé sur l'inscription 2 ? Team2 n'a pas de subs non plus.
    // Le swap exige un sub : on teste le refus explicite (mêmes rôles).
    await post({ op: 'swap_roles', uidA: uidOf('t1a'), uidB: uidOf('t1b') }, { expectStatus: 409 });
    check('swap refusé : deux joueurs du même rôle', true);
    await post({ op: 'set_captain', uid: uidOf('t1d') });
    reg = (await db.collection('competition_registrations').doc(REG).get()).data();
    check('capitanat transféré à t1d', reg.captainUid === uidOf('t1d'));

    console.log('\n[5] Après publication : gate match actif + ACL alignées…');
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
      action: 'reorder', order: [1, 2, 3, 4].map(i => `${COMP}_team${i}`),
    });
    await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
    // W1-1 = team1 vs team4 (seed 1 vs 4). Lancer le check-in → changement refusé.
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: ['W1-1'] });
    await post({ op: 'replace', outUid: uidOf('t1b'), inUid: uidOf('t1m'), declaredCurrentMmr: 1400, declaredPeakMmr: 1500, derogationNote: 'E2E : accord parental vérifié.' }, { expectStatus: 409 });
    check('replace refusé : match de l\'équipe en cours (check-in)', true);
    // Trancher le match (forfait de l'adversaire) → le changement passe.
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'validate_forfeit', matchId: 'W1-1', team: 'b' });
    await post({ op: 'replace', outUid: uidOf('t1b'), inUid: uidOf('t1m'), declaredCurrentMmr: 1400, declaredPeakMmr: 1500, derogationNote: 'E2E : accord parental vérifié.' });
    reg = (await db.collection('competition_registrations').doc(REG).get()).data();
    check('replace mineur AVEC note : accepté, dérogation journalisée',
      reg.rosterUids.includes(uidOf('t1m'))
      && (reg.review?.derogations ?? []).some(d => d.uid === uidOf('t1m')),
      JSON.stringify(reg.review?.derogations));
    check('flag underage recalculé sur le computed', reg.computed.flags.includes('underage'), JSON.stringify(reg.computed.flags));
    // ACL du match NON terminal (W2-1, où team1 est montée par le forfait).
    const acl = (await db.collection('competition_matches').doc(`${COMP}__W2-1`).collection('private').doc('acl').get()).data();
    check('ACL du match à venir : sortant retiré, entrant ajouté',
      !!acl && !acl.participantUids.includes(uidOf('t1b')) && acl.participantUids.includes(uidOf('t1m')),
      JSON.stringify(acl?.participantUids));
    // Le match TERMINAL (W1-1) garde son ACL d'époque (historique).
    const aclOld = (await db.collection('competition_matches').doc(`${COMP}__W1-1`).collection('private').doc('acl').get()).data();
    check('ACL du match joué : inchangée (historique)',
      !!aclOld && aclOld.participantUids.includes(uidOf('t1b')), JSON.stringify(aclOld?.participantUids));

    console.log('\n[6] Remplacer LE capitaine : le pilotage suit le siège…');
    // t1d est capitaine (transféré en [4]) ; t1c, sorti plus tôt mais toujours
    // membre de l'équipe, revient à sa place — et hérite du capitanat.
    await post({ op: 'replace', outUid: uidOf('t1d'), inUid: uidOf('t1c'), declaredCurrentMmr: 1500, declaredPeakMmr: 1500 });
    reg = (await db.collection('competition_registrations').doc(REG).get()).data();
    check('capitanat auto-transféré à l\'entrant (jamais un capitaine hors roster)',
      reg.captainUid === uidOf('t1c'), reg.captainUid);
    check('le sortant capitaine a bien quitté le roster', !reg.rosterUids.includes(uidOf('t1d')));
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
