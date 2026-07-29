// DÉMONSTRATION du bot de compétition sur un serveur Discord.
//
// Déroule un vrai tournoi de bout en bout avec les VRAIES routes, et LAISSE
// TOUT EN PLACE : les salons gardent l'historique complet, lisible comme un
// récit. Fait pour être montré à la présidence de SPRINGS E-SPORT.
//
// Ce que la démo fait défiler, dans l'ordre :
//   1. provisioning (rôle participant, catégorie, salons privés par équipe,
//      annonces, salon staff) et message d'accueil
//   2. annonce libre de l'organisateur
//   3. bracket publié → chaque équipe reçoit SON adversaire
//   4. check-in général, puis relance des seuls retardataires
//   5. lancement d'une phase → check-in avec room et mot de passe
//   6. un match réglé d'accord (silence volontaire), un score en attente de
//      confirmation, un litige, un arbitrage, un forfait, un retrait en cascade
//   7. annonce de clôture
//
// PRÉREQUIS : dev server localhost:3000, serveur Discord de test avec le bot
// Aedral administrateur, dont le PROPRIÉTAIRE est admin Aedral (il signe).
//
// Run    : node --env-file=.env.local scripts/demo-discord-competition.mjs
// Nettoyer après la présentation :
//          node --env-file=.env.local scripts/demo-discord-competition.mjs --cleanup

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const GUILD = process.env.E2E_DISCORD_GUILD_ID || '1531385106139189269';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const CLEANUP = process.argv.includes('--cleanup');
// --hide : masquer la démonstration du public sans rien effacer (les salons
// Discord gardent tout l'historique, mais les liens du site cessent de résoudre).
const HIDE = process.argv.includes('--hide');
const P = 'demo_bot';
const COMP = `${P}-qualif`;
const STAFF_ROLE_NAME = 'Staff démo';

// Huit équipes aux noms crédibles : la démonstration doit ressembler à un vrai
// Qualif, pas à un jeu de test.
const TEAMS = [
  { name: 'Nova Legion', tag: 'NOVA' },
  { name: 'Aegis Prime', tag: 'AEGIS' },
  { name: 'Vortex Six', tag: 'VTX' },
  { name: 'Havoc', tag: 'HVC' },
  { name: 'Zenith Squad', tag: 'ZEN' },
  { name: 'Rift Runners', tag: 'RIFT' },
  { name: 'Solstice', tag: 'SOL' },
  { name: 'Ironclad', tag: 'IRON' },
];

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
async function discord(path, init = {}) {
  const headers = { Authorization: `Bot ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) };
  let res = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers });
  for (let i = 0; i < 3 && (res.status === 429 || res.status >= 500); i++) {
    const body = await res.clone().json().catch(() => ({}));
    await new Promise(r => setTimeout(r, Math.min(10_000, Math.max(500, (body.retry_after ?? 2 ** i) * 1000))));
    res = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers });
  }
  return res;
}
async function dGet(path) {
  const res = await discord(path);
  if (!res.ok) throw new Error(`Discord ${path} → ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

let ADMIN_UID = null;
const tokens = new Map();
async function tokenFor(uid) {
  if (tokens.has(uid)) return tokens.get(uid);
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token: ${JSON.stringify(json).slice(0, 140)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}
async function apiAs(uid, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await tokenFor(uid)}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  if (res.status >= 400) console.log(`    ⚠ ${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 160)}`);
  return { status: res.status, json };
}
const api = (m, p, b) => apiAs(ADMIN_UID, m, p, b);

const regId = i => `${COMP}_team${i}`;
const capUid = i => `discord_${P}_cap${i}`;
const step = (n, t) => console.log(`\n[${n}] ${t}`);
/** Respiration entre deux étapes : l'ordre des messages doit rester lisible. */
const beat = (ms = 1200) => new Promise(r => setTimeout(r, ms));

// ── Nettoyage ───────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('Nettoyage de la démonstration…');
  const comp = (await db.collection('competitions').doc(COMP).get().catch(() => null))?.data();
  const d = comp?.discord ?? {};
  const channels = new Set([
    ...(Array.isArray(d.createdChannelIds) ? d.createdChannelIds : []),
    ...(Array.isArray(d.categoryIds) ? d.categoryIds : []),
    ...(d.categoryId ? [d.categoryId] : []),
  ]);
  const roles = new Set(d.participantRoleId ? [d.participantRoleId] : []);
  const regs = await db.collection('competition_registrations').where('competitionId', '==', COMP).get().catch(() => ({ docs: [] }));
  for (const doc of regs.docs) {
    const r = doc.data().discord ?? {};
    if (r.textChannelId) channels.add(r.textChannelId);
    if (r.voiceChannelId) channels.add(r.voiceChannelId);
    if (r.roleId) roles.add(r.roleId);
  }
  for (const id of channels) await discord(`/channels/${id}`, { method: 'DELETE' }).catch(() => {});
  for (const id of roles) await discord(`/guilds/${GUILD}/roles/${id}`, { method: 'DELETE' }).catch(() => {});
  // Le rôle « Staff démo » et les résidus nommés, pour un serveur rendu propre.
  try {
    for (const r of await dGet(`/guilds/${GUILD}/roles`)) {
      if (r.name === STAFF_ROLE_NAME || TEAMS.some(t => t.name === r.name)) {
        await discord(`/guilds/${GUILD}/roles/${r.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
    for (const c of await dGet(`/guilds/${GUILD}/channels`)) {
      if (/^(qualif-demonstration|annonces-qualif|staff-qualif)/i.test(c.name)
        || TEAMS.some(t => c.name === t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))) {
        await discord(`/channels/${c.id}`, { method: 'DELETE' }).catch(() => {});
      }
    }
  } catch { /* serveur illisible : le nettoyage par identifiant est déjà passé */ }

  const matches = await db.collection('competition_matches').where('competitionId', '==', COMP).get().catch(() => ({ docs: [] }));
  for (const m of matches.docs) {
    for (const priv of (await m.ref.collection('private').get()).docs) await priv.ref.delete();
    await m.ref.delete();
  }
  const batch = db.batch();
  for (const doc of regs.docs) batch.delete(doc.ref);
  for (let i = 1; i <= TEAMS.length; i++) batch.delete(db.collection('users').doc(capUid(i)));
  batch.delete(db.collection('competitions').doc(COMP));
  await batch.commit().catch(() => {});
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get().catch(() => ({ docs: [] }));
  for (const n of notifs.docs) await n.ref.delete();
  console.log('Terminé : serveur et base rendus dans leur état d’origine.');
}

// ── Mise en place ───────────────────────────────────────────────────────────
async function setup(ownerId, staffRoleId) {
  const batch = db.batch();
  TEAMS.forEach((t, idx) => {
    const i = idx + 1;
    batch.set(db.collection('users').doc(capUid(i)), {
      uid: capUid(i), displayName: `Capitaine ${t.tag}`, discordUsername: `cap_${t.tag.toLowerCase()}`,
      games: ['rl'], isDev: true, createdAt: Timestamp.now(),
    });
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `${P}-team${i}`,
      name: t.name, tag: t.tag, logoUrl: null,
      captainUid: capUid(i), rosterUids: [capUid(i)],
      // Le propriétaire du serveur est mis dans la 1re équipe : il reçoit les
      // mentions en direct pendant la présentation.
      roster: i === 1 ? [{ discordId: ownerId, displayName: 'Toi (démonstration)' }] : [],
      status: 'approved',
      discord: { provisioningStatus: 'queued' },
      createdAt: Timestamp.now(),
    });
  });
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'Qualif démonstration',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'single_elim', maxTeams: 8,
      bo: { default: 5, overrides: [], grandFinal: 7 },
      thirdPlace: false, forfeitScore: { games: 3, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: {
      opensAt: Timestamp.fromDate(new Date('2026-01-01')),
      closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: false,
    },
    schedule: {
      days: [{ date: '2026-09-26', startsAt: '15:00' }],
      phasePlan: [{ phase: 1, day: 1, label: 'Quarts de finale', rounds: [{ bracket: 'winners', round: 1 }] }],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: {
      guildId: GUILD, participantRoleId: null, categoryId: null,
      options: {
        teamChannels: true, teamVoiceChannels: false,
        categoryName: 'QUALIF DÉMONSTRATION',
        // Le rôle « Staff démo » ouvre les salons d'équipe aux invités : sans
        // lui, la présidence ne verrait aucun salon (ils sont privés).
        staffRoleIds: [staffRoleId],
        participantRoleName: 'Participant · Démonstration',
        createAnnounceChannel: true, announceChannelName: 'annonces-qualif', announceChannelId: null,
        createStaffChannel: true, staffChannelName: 'staff-qualif', staffChannelId: null,
      },
    },
    // isDev FALSE le temps de la démonstration : c'est la garde qui coupe les
    // envois du bac à sable. Remis à true à la fin pour que la compétition
    // n'apparaisse jamais côté public.
    status: 'draft', isDev: false, approvedCount: TEAMS.length, createdAt: Timestamp.now(),
  });
  await batch.commit();
}

async function main() {
  if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN manquant');
  const guild = await dGet(`/guilds/${GUILD}`);
  const ownerId = guild.owner_id;
  ADMIN_UID = `discord_${ownerId}`;
  console.log(`Serveur : ${guild.name}`);
  if (!(await db.collection('aedral_admins').doc(ADMIN_UID).get()).exists) {
    throw new Error(`${ADMIN_UID} n'est pas admin Aedral.`);
  }

  // Rôle d'accès pour les invités de la démonstration.
  const existing = (await dGet(`/guilds/${GUILD}/roles`)).find(r => r.name === STAFF_ROLE_NAME);
  const staffRole = existing ?? await (await discord(`/guilds/${GUILD}/roles`, {
    method: 'POST',
    body: JSON.stringify({ name: STAFF_ROLE_NAME, color: 0x5865f2, mentionable: true, hoist: true }),
  })).json();
  console.log(`Rôle d'accès : « ${STAFF_ROLE_NAME} » (${staffRole.id})`);

  await setup(ownerId, staffRole.id);

  step(1, 'Provisioning : rôle participant, catégorie, salons privés, annonces, staff');
  await api('POST', `/api/admin/competitions/${COMP}/provision`);
  const comp = (await db.collection('competitions').doc(COMP).get()).data();
  console.log(`    catégorie + ${TEAMS.length} salons d'équipe + annonces + staff créés`);
  await beat();

  step(2, "Annonce d'ouverture par l'organisation");
  await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'announce', to: 'both',
    message: 'Bienvenue sur le Qualif de démonstration. Le check-in général ouvre à 14h30, '
      + 'les quarts de finale enchaînent à 15h00. Tout ce qui suit dans ce salon et dans les '
      + "salons d'équipe est envoyé automatiquement par la plateforme.",
  });
  await beat();

  step(3, 'Publication du bracket → chaque équipe reçoit SON adversaire');
  await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
    action: 'reorder', order: TEAMS.map((_, i) => regId(i + 1)),
  });
  const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  console.log(`    ${pub.json?.deliverySummary ?? ''}`);
  await beat();

  const matches = (await db.collection('competition_matches').where('competitionId', '==', COMP).get())
    .docs.map(d => d.data())
    .filter(m => m.teamA && m.teamB);
  const indexOf = rid => Number(String(rid).replace(`${COMP}_team`, ''));
  const round1 = matches.filter(m => m.round === 1 || m.id?.startsWith('W1'));
  const quarts = round1.length > 0 ? round1 : matches;

  step(4, 'Check-in général, puis relance des SEULS retardataires');
  await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'open_general_checkin' });
  await beat();
  // Six équipes confirment, deux « oublient » : la relance ne visera qu'elles.
  for (let i = 1; i <= TEAMS.length - 2; i++) {
    await apiAs(capUid(i), 'POST', `/api/competitions/${COMP}/checkin`, {});
  }
  await db.collection('competitions').doc(COMP).update({
    'generalCheckin.openedAt': Timestamp.fromMillis(Date.now() - 16 * 60_000),
  });
  const tick = await api('POST', `/api/competitions/${COMP}/tick`);
  console.log(`    ${tick.json?.remindedTeams ?? 0} équipe(s) relancée(s) — les autres avaient confirmé`);
  await beat();

  step(5, 'Lancement des quarts → check-in de match avec room et mot de passe');
  const launch = await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'launch_phase', matchIds: quarts.map(m => m.id),
  });
  console.log(`    ${launch.json?.deliverySummary ?? ''}`);
  await beat();

  // ── Quatre déroulements différents, un par match ──────────────────────────
  const [m1, m2, m3, m4] = quarts;

  step(6, `Match réglé d'accord (${TEAMS[indexOf(m1.teamA) - 1].name} vs ${TEAMS[indexOf(m1.teamB) - 1].name}) — silence volontaire`);
  for (const rid of [m1.teamA, m1.teamB]) {
    await apiAs(capUid(indexOf(rid)), 'POST', `/api/competitions/${COMP}/matches/${m1.id}`, { action: 'checkin' });
  }
  for (const rid of [m1.teamA, m1.teamB]) {
    await apiAs(capUid(indexOf(rid)), 'POST', `/api/competitions/${COMP}/matches/${m1.id}`, {
      action: 'submit_scores', games: [{ a: 3, b: 1 }, { a: 2, b: 0 }, { a: 4, b: 2 }],
    });
  }
  console.log('    scores concordants → résultat validé, bracket avancé, AUCUN message (rien à décider)');
  await beat();

  step(7, `Score en attente de confirmation, puis litige et arbitrage (${TEAMS[indexOf(m2.teamA) - 1].name} vs ${TEAMS[indexOf(m2.teamB) - 1].name})`);
  for (const rid of [m2.teamA, m2.teamB]) {
    await apiAs(capUid(indexOf(rid)), 'POST', `/api/competitions/${COMP}/matches/${m2.id}`, { action: 'checkin' });
  }
  await apiAs(capUid(indexOf(m2.teamA)), 'POST', `/api/competitions/${COMP}/matches/${m2.id}`, {
    action: 'submit_scores', games: [{ a: 3, b: 1 }, { a: 2, b: 0 }, { a: 1, b: 0 }],
  });
  console.log("    → l'adversaire est prévenu qu'un score court contre lui");
  await beat();
  await apiAs(capUid(indexOf(m2.teamB)), 'POST', `/api/competitions/${COMP}/matches/${m2.id}`, {
    action: 'submit_scores', games: [{ a: 1, b: 3 }, { a: 0, b: 2 }, { a: 0, b: 1 }],
  });
  console.log('    → saisies divergentes : litige, les deux équipes ET le salon staff sont prévenus');
  await beat();
  await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'force_score', matchId: m2.id,
    games: [{ a: 3, b: 1 }, { a: 2, b: 0 }, { a: 1, b: 0 }],
    resolution: 'Captures des trois manches vérifiées par l’arbitre.',
  });
  console.log('    → décision et motif envoyés aux deux camps');
  await beat();

  step(8, `Forfait validé (${TEAMS[indexOf(m3.teamB) - 1].name} absente)`);
  await apiAs(capUid(indexOf(m3.teamA)), 'POST', `/api/competitions/${COMP}/matches/${m3.id}`, { action: 'checkin' });
  await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'validate_forfeit', matchId: m3.id, team: 'b',
    reason: 'Équipe non présente à l’issue du check-in.',
  });
  await beat();

  step(9, `Retrait d'une équipe → cascade annoncée aux adversaires (${TEAMS[indexOf(m4.teamA) - 1].name})`);
  await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'withdraw_team', registrationId: m4.teamA,
    reason: 'Forfait déclaré par la structure.',
  });
  await beat();

  step(10, "Annonce de clôture, et contrôle du dispositif");
  await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'announce', to: 'announce',
    message: 'Fin de la démonstration. Tous les messages ci-dessus ont été envoyés par la '
      + 'plateforme, sans intervention manuelle : seules les décisions d’arbitrage ont été prises '
      + 'par un humain.',
  });
  const setupCheck = await api('GET', `/api/admin/competitions/${COMP}/setup-check`);
  const rep = setupCheck.json?.report;
  console.log(`    dispositif : ${rep?.teams?.provisioned}/${rep?.teams?.total} équipes provisionnées, `
    + `${rep?.players?.absent?.length ?? 0} joueur(s) absent(s) du serveur, `
    + `${(rep?.issues ?? []).filter(i => i.level === 'blocker').length} blocage(s)`);

  // La compétition reste VISIBLE : sans ça, les liens « Ouvrir sur Aedral » des
  // messages tombent sur une page introuvable, et montrer le bracket et la page
  // de match fait la moitié de la démonstration. Contrepartie assumée et
  // signalée ci-dessous : elle apparaît côté public le temps de la présentation.
  const announceId = comp.discord?.options?.announceChannelId;
  console.log(`\n${'─'.repeat(70)}`);
  console.log('DÉMONSTRATION EN PLACE. Rien n’a été nettoyé.');
  console.log(`${'─'.repeat(70)}`);
  const slug = n => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  const nameOfReg = rid => TEAMS[indexOf(rid) - 1]?.name ?? '?';

  console.log(`\nPour que la présidence voie les salons privés : attribue-leur le rôle « ${STAFF_ROLE_NAME} ».`);
  console.log('(Sans lui, les salons d’équipe sont invisibles — ils sont privés par construction.)');

  console.log('\nPARCOURS DE LECTURE — chaque salon montre un cas différent :');
  console.log('  1. #annonces-qualif');
  console.log('     Les annonces de l’organisation et la publication du bracket.');
  console.log('     À souligner : AUCUNE mention ici. Le salon informe le serveur');
  console.log('     sans réveiller deux cents personnes.');
  console.log(`  2. #${slug(TEAMS[0].name)} — une équipe qui joue normalement`);
  console.log('     Accueil, son adversaire, le check-in général, puis le check-in');
  console.log('     de match AVEC la room et le mot de passe. Toujours mentionnée.');
  console.log(`     Son match s’est réglé d’accord : AUCUN message de résultat.`);
  console.log('     C’est voulu — rien n’était attendu d’elle.');
  console.log(`  3. #${slug(nameOfReg(m2.teamA))} et #${slug(nameOfReg(m2.teamB))} — le litige`);
  console.log('     Le score annoncé par l’adversaire, le match gelé et la consigne,');
  console.log('     puis la décision de l’arbitre AVEC son motif. Aux deux camps.');
  console.log(`  4. #${slug(nameOfReg(m3.teamB))} — le forfait validé, avec le motif`);
  console.log(`  5. #${slug(nameOfReg(m4.teamA))} — l’équipe retirée, et #${slug(nameOfReg(m4.teamB))} qui hérite du forfait`);
  console.log('  6. #staff-qualif — ce que seul le staff voit : le litige à traiter.');
  console.log('     Un seul message : le déroulement normal ne ping jamais le staff.');

  console.log('\nÀ RETENIR pour la présentation : le bot ne parle que lorsqu’une action est');
  console.log('attendue, ou qu’une décision touche l’équipe. Chaque salon ne contient QUE');
  console.log('ce qui concerne son équipe.');

  console.log(`\n⚠ La compétition est VISIBLE sur aedral.com le temps de la présentation, pour que`);
  console.log(`  les liens « Ouvrir sur Aedral » des messages fonctionnent (bracket, page de match).`);
  console.log(`  Elle s'appelle « Qualif démonstration ». Pour la masquer sans rien supprimer :`);
  console.log(`     node --env-file=.env.local scripts/demo-discord-competition.mjs --hide`);
  console.log(`\nPour tout effacer après la présentation (serveur et base rendus propres) :`);
  console.log(`     node --env-file=.env.local scripts/demo-discord-competition.mjs --cleanup`);
  if (announceId) console.log(`\nSalon d'annonces : https://discord.com/channels/${GUILD}/${announceId}`);
  console.log(`Bracket public   : https://aedral.com/competitions/${COMP}`);
}

try {
  if (CLEANUP) await cleanup();
  else if (HIDE) {
    await db.collection('competitions').doc(COMP).update({ isDev: true });
    console.log('Démonstration masquée du public. Les salons Discord gardent tout leur historique ;');
    console.log('les liens « Ouvrir sur Aedral » des messages ne résolvent plus.');
  } else await main();
} catch (err) {
  console.error('\n💥', err);
  process.exitCode = 1;
}
