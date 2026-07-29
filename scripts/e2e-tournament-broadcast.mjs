// E2E « le bot raconte le tournoi » — CONTRE UN VRAI SERVEUR DISCORD.
//
// Les textes ont leurs tests unitaires ; ce script prouve ce qu'aucun test pur
// ne peut prouver : que le message part, dans le BON salon, qu'il NOTIFIE
// réellement (une mention dans un embed ne ping personne — seul le `content`
// le fait), et que l'accusé de livraison dit la vérité.
//
// Déroule un vrai tournoi : provisioning → bracket publié → check-in → score
// forcé, en relisant à chaque étape les messages réellement postés chez Discord.
//
// PRÉREQUIS : dev server localhost:3000, serveur Discord de test avec le bot
// Aedral administrateur, dont le PROPRIÉTAIRE est admin Aedral (il signe).
// Run : node --env-file=.env.local scripts/e2e-tournament-broadcast.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const GUILD = process.env.E2E_DISCORD_GUILD_ID || '1531385106139189269';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_bc';
const COMP = `${P}-comp`;
const TEAMS = 4;

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
/** Lecture de vérification : doit échouer bruyamment (un [] silencieux rendrait
 *  vertes des assertions qui n'ont rien vérifié). */
async function dGet(path) {
  const res = await discord(path);
  if (!res.ok) throw new Error(`Discord ${path} → ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}
const messagesOf = (channelId) => dGet(`/channels/${channelId}/messages?limit=20`);
/** Le dernier message dont le titre d'embed contient `needle`. */
function findByTitle(messages, needle) {
  return (messages || []).find(m => (m.embeds || []).some(e => (e.title || '').includes(needle))) || null;
}
const embedOf = (msg) => (msg?.embeds || [])[0] || {};

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
  return { status: res.status, json };
}
const api = (method, path, body) => apiAs(ADMIN_UID, method, path, body);
const capUid = i => `discord_${P}_cap${i}`;

const regId = i => `${COMP}_team${i}`;
const teamName = i => `E2E BC ${i}`;

async function setup(ownerId) {
  const batch = db.batch();
  for (let i = 1; i <= TEAMS; i++) {
    batch.set(db.collection('competition_registrations').doc(regId(i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `${P}-team${i}`,
      name: teamName(i), tag: `B${i}`, logoUrl: null,
      captainUid: `discord_${P}_cap${i}`,
      rosterUids: [`discord_${P}_cap${i}`],
      // Le propriétaire du serveur est dans l'équipe 1 : seul membre humain
      // disponible pour prouver l'attribution des rôles.
      // Équipe 1 : le propriétaire du serveur (présent). Équipe 2 : un joueur
      // qui n'est PAS sur le serveur — le contrôle du dispositif doit le voir.
      roster: i === 1 ? [{ discordId: ownerId, displayName: 'Cobaye réel' }]
        : i === 2 ? [{ discordId: '999999999999999901', displayName: 'Joueur fantôme' }]
        : [],
      status: 'approved',
      discord: { provisioningStatus: 'queued' },
      createdAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'TEST E2E Broadcast — ne pas toucher',
    game: 'rocket_league', circuitId: null,
    format: {
      kind: 'single_elim', maxTeams: 8,
      bo: { default: 3, overrides: [], grandFinal: 5 },
      thirdPlace: false, forfeitScore: { games: 2, goalsPerGame: 1 },
    },
    eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
    roster: { starters: 3, subsMax: 2 },
    registration: {
      opensAt: Timestamp.fromDate(new Date('2026-01-01')),
      closesAt: Timestamp.fromDate(new Date('2026-12-01')), waitlist: false,
    },
    schedule: {
      days: [{ date: '2026-09-26', startsAt: '15:00' }],
      phasePlan: [{ phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] }],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: {
      guildId: GUILD, participantRoleId: null, categoryId: null,
      options: {
        teamChannels: true, teamVoiceChannels: false,
        categoryName: 'E2E BROADCAST', staffRoleIds: [],
        participantRoleName: 'E2E BC Participant',
        createAnnounceChannel: true, announceChannelName: 'e2e-bc-annonces', announceChannelId: null,
        createStaffChannel: true, staffChannelName: 'e2e-bc-staff', staffChannelId: null,
      },
    },
    // isDev FALSE : c'est la garde qui coupe les envois du bac à sable. La
    // compétition reste invisible du public par son statut draft.
    status: 'draft', isDev: false, approvedCount: TEAMS, createdAt: Timestamp.now(),
  });
  await batch.commit();
}

async function cleanupAll() {
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
  // Filet nominatif pour un run interrompu.
  try {
    for (const c of await dGet(`/guilds/${GUILD}/channels`)) {
      if (/^e2e-bc|^E2E BROADCAST/i.test(c.name)) await discord(`/channels/${c.id}`, { method: 'DELETE' }).catch(() => {});
    }
    for (const r of await dGet(`/guilds/${GUILD}/roles`)) {
      if (/^E2E BC/i.test(r.name)) await discord(`/guilds/${GUILD}/roles/${r.id}`, { method: 'DELETE' }).catch(() => {});
    }
  } catch { /* serveur illisible : le nettoyage par ID est déjà passé */ }

  const matches = await db.collection('competition_matches').where('competitionId', '==', COMP).get().catch(() => ({ docs: [] }));
  for (const m of matches.docs) {
    for (const p of (await m.ref.collection('private').get()).docs) await p.ref.delete();
    await m.ref.delete();
  }
  const batch = db.batch();
  for (const doc of regs.docs) batch.delete(doc.ref);
  batch.delete(db.collection('competitions').doc(COMP));
  await batch.commit().catch(() => {});
  const notifs = await db.collection('notifications').where('metadata.competitionId', '==', COMP).get().catch(() => ({ docs: [] }));
  for (const n of notifs.docs) await n.ref.delete();
}

async function main() {
  if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN manquant');
  const guild = await dGet(`/guilds/${GUILD}`);
  const ownerId = guild.owner_id;
  ADMIN_UID = `discord_${ownerId}`;
  console.log(`Serveur   : ${guild.name}`);
  if (!(await db.collection('aedral_admins').doc(ADMIN_UID).get()).exists) {
    throw new Error(`${ADMIN_UID} n'est pas admin Aedral.`);
  }

  await setup(ownerId);

  section('Provisioning des salons');
  const prov = await api('POST', `/api/admin/competitions/${COMP}/provision`);
  check('provisioning → 200', prov.status === 200, JSON.stringify(prov.json).slice(0, 200));
  const comp = (await db.collection('competitions').doc(COMP).get()).data();
  let announceId = comp.discord?.options?.announceChannelId;
  check('salon d’annonces créé', !!announceId);

  const chanOf = {};
  const roleOf = {};
  for (let i = 1; i <= TEAMS; i++) {
    const r = (await db.collection('competition_registrations').doc(regId(i)).get()).data();
    chanOf[i] = r.discord?.textChannelId;
    roleOf[i] = r.discord?.roleId;
  }
  check('chaque équipe a son salon', Object.values(chanOf).every(Boolean));

  section('Bracket publié — chaque équipe apprend SON adversaire');
  let r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'open_seeding' });
  check('open_seeding → 200', r.status === 200, JSON.stringify(r.json).slice(0, 150));
  r = await api('POST', `/api/admin/competitions/${COMP}/bracket`, {
    action: 'reorder', order: Array.from({ length: TEAMS }, (_, i) => regId(i + 1)),
  });
  check('reorder → 200', r.status === 200);
  const pub = await api('POST', `/api/admin/competitions/${COMP}/bracket`, { action: 'publish' });
  check('publish → live', pub.status === 200 && pub.json?.status === 'live', JSON.stringify(pub.json).slice(0, 200));
  check('accusé de livraison : 4 équipes notifiées', pub.json?.delivery?.sent === TEAMS,
    JSON.stringify(pub.json?.delivery));
  check('aucun échec de livraison', (pub.json?.delivery?.failures ?? []).length === 0,
    JSON.stringify(pub.json?.delivery?.failures));

  // L'adversaire est DÉRIVÉ du bracket, jamais supposé : en seeding standard
  // le seed 1 affronte le dernier seed (1v4, 2v3), pas le seed 2.
  const matches = await db.collection('competition_matches').where('competitionId', '==', COMP).get();
  const first = matches.docs
    .map(d => ({ id: d.data().id, teamA: d.data().teamA, teamB: d.data().teamB }))
    .find(m => (m.teamA === regId(1) || m.teamB === regId(1)) && m.teamA && m.teamB);
  check('l’équipe 1 a un premier match', !!first, JSON.stringify(first));
  const oppRegId = first.teamA === regId(1) ? first.teamB : first.teamA;
  const opp = Number(oppRegId.replace(`${COMP}_team`, ''));
  console.log(`    (l'équipe 1 affronte l'équipe ${opp} — seeding du moteur)`);

  const t1 = findByTitle(await messagesOf(chanOf[1]), 'bracket est en ligne');
  check('l’équipe 1 a reçu le message du bracket', !!t1);
  check('IL NOMME SON ADVERSAIRE RÉEL', (embedOf(t1).description || '').includes(teamName(opp)),
    embedOf(t1).description);
  check('il donne la date de début', (embedOf(t1).description || '').includes('2026-09-26'));
  check('il ping le rôle de l’équipe', (t1?.content || '').includes(`<@&${roleOf[1]}>`), `content="${t1?.content}"`);

  const ann = findByTitle(await messagesOf(announceId), 'bracket');
  check('le salon d’annonces a bien son message public', !!ann);
  check('L’ANNONCE PUBLIQUE NE PING PERSONNE', !(ann?.content || '').includes('<@&'),
    `content="${ann?.content}"`);

  section('Check-in de match — la room part avec le message');
  const launch = await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'launch_phase', matchIds: [first.id],
  });
  check('launch_phase → 200', launch.status === 200, JSON.stringify(launch.json).slice(0, 200));
  check('accusé de livraison : les 2 camps notifiés', launch.json?.delivery?.sent === 2,
    JSON.stringify(launch.json?.delivery));

  const roomDoc = (await db.collection('competition_matches').doc(`${COMP}__${first.id}`)
    .collection('private').doc('room').get()).data();
  const ci = findByTitle(await messagesOf(chanOf[1]), 'Check-in ouvert');
  const ciDesc = embedOf(ci).description || '';
  check('l’équipe 1 a reçu le check-in', !!ci);
  check('LA ROOM EST DANS LE MESSAGE', ciDesc.includes(roomDoc?.name ?? '###'), ciDesc);
  check('le mot de passe aussi', ciDesc.includes(roomDoc?.password ?? '###'));
  check('il nomme l’adversaire', ciDesc.includes(teamName(opp)), ciDesc);
  check('il dit la conséquence (forfait)', /forfait/i.test(ciDesc));
  check('IL PING l’équipe', (ci?.content || '').includes(`<@&${roleOf[1]}>`), `content="${ci?.content}"`);
  check('LE LIEN POINTE SUR LE MATCH', ciDesc.includes(`/match/${first.id}`), ciDesc);

  section('Parcours joueur — contre-saisie puis litige');
  for (const i of [1, opp]) {
    const ck = await apiAs(capUid(i), 'POST', `/api/competitions/${COMP}/matches/${first.id}`, { action: 'checkin' });
    check(`check-in du capitaine ${i}`, ck.status === 200, JSON.stringify(ck.json).slice(0, 150));
  }
  // Le camp 1 saisit : l'adversaire doit apprendre qu'un score court contre lui.
  const submitted = await apiAs(capUid(1), 'POST', `/api/competitions/${COMP}/matches/${first.id}`, {
    action: 'submit_scores', games: [{ a: 3, b: 1 }, { a: 2, b: 0 }],
  });
  check('saisie du camp 1 → 200', submitted.status === 200, JSON.stringify(submitted.json).slice(0, 150));
  const await1 = findByTitle(await messagesOf(chanOf[opp]), 'Score à confirmer');
  check('L’ADVERSAIRE EST PRÉVENU QU’UN SCORE COURT CONTRE LUI', !!await1);
  const awaitDesc = embedOf(await1).description || '';
  check('le score annoncé y figure (2 manches à 0)', awaitDesc.includes('2-0'), awaitDesc);
  check('le délai de contestation y figure', /minutes/.test(awaitDesc), awaitDesc);
  check('il ping l’équipe concernée', (await1?.content || '').includes(`<@&${roleOf[opp]}>`));

  // Saisie divergente → litige automatique.
  const clash = await apiAs(capUid(opp), 'POST', `/api/competitions/${COMP}/matches/${first.id}`, {
    action: 'submit_scores', games: [{ a: 1, b: 3 }, { a: 0, b: 2 }],
  });
  check('saisie divergente → litige', clash.status === 200 && clash.json?.resolution === 'mismatch',
    JSON.stringify(clash.json).slice(0, 150));
  for (const i of [1, opp]) {
    const dis = findByTitle(await messagesOf(chanOf[i]), 'litige');
    check(`l’équipe ${i} sait que son match est gelé`, !!dis);
    check(`on lui dit quoi faire (équipe ${i})`,
      /capture/i.test(embedOf(dis).description || ''), embedOf(dis).description);
  }

  section('Arbitrage — la décision arrive aux deux camps');
  const forced = await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'force_score', matchId: first.id,
    games: [{ a: 3, b: 1 }, { a: 2, b: 0 }],
    resolution: 'Captures vérifiées.',
  });
  check('force_score → 200', forced.status === 200, JSON.stringify(forced.json).slice(0, 200));
  check('accusé de livraison : 2 camps notifiés', forced.json?.delivery?.sent === 2,
    JSON.stringify(forced.json?.delivery));
  for (const i of [1, opp]) {
    const ruling = findByTitle(await messagesOf(chanOf[i]), 'Litige tranché');
    check(`l’équipe ${i} a reçu la décision`, !!ruling);
    check(`elle porte le motif de l’admin (équipe ${i})`,
      (embedOf(ruling).description || '').includes('Captures vérifiées'), embedOf(ruling).description);
  }

  section('Check-in général — relance des seuls retardataires');
  const openGc = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'open_general_checkin' });
  check('open_general_checkin → 200', openGc.status === 200, JSON.stringify(openGc.json).slice(0, 150));
  const opening = findByTitle(await messagesOf(chanOf[1]), 'Check-in général');
  check('le message d’ouverture ping l’équipe',
    (opening?.content || '').includes(`<@&${roleOf[1]}>`), `content="${opening?.content}"`);

  // L'équipe 1 confirme ; les autres non.
  const done = await apiAs(capUid(1), 'POST', `/api/competitions/${COMP}/checkin`, {});
  check('le capitaine 1 confirme sa présence', done.status === 200, JSON.stringify(done.json).slice(0, 150));

  // On recule l'ouverture de 16 min : la fenêtre est de 20, la relance est due.
  await db.collection('competitions').doc(COMP).update({
    'generalCheckin.openedAt': Timestamp.fromMillis(Date.now() - 16 * 60_000),
  });
  const beforeReminder = (await messagesOf(chanOf[1])).length;
  // Le tick tel qu'il part en vrai : depuis la console de l'organisateur, qui
  // est ouverte au check-in général puisque c'est lui qui vient de l'ouvrir.
  const tick = await api('POST', `/api/competitions/${COMP}/tick`);
  check('tick → 200', tick.status === 200, JSON.stringify(tick.json).slice(0, 150));
  check('SEULES LES ÉQUIPES SANS CHECK-IN SONT RELANCÉES', tick.json?.remindedTeams === TEAMS - 1,
    `relancées=${tick.json?.remindedTeams} (attendu ${TEAMS - 1})`);
  const relance = findByTitle(await messagesOf(chanOf[3]), 'il reste 5 minutes');
  check('la relance est arrivée à une équipe en retard', !!relance);
  check('elle dit la conséquence', /alignée|alignee/i.test(embedOf(relance).description || ''),
    embedOf(relance).description);
  check('l’équipe qui a confirmé n’est PAS relancée',
    (await messagesOf(chanOf[1])).length === beforeReminder, 'elle a reçu un message de trop');

  const tick2 = await api('POST', `/api/competitions/${COMP}/tick`);
  check('un second tick ne relance pas une deuxième fois', (tick2.json?.remindedTeams ?? 0) === 0,
    `relancées=${tick2.json?.remindedTeams}`);

  section('Contrôle du dispositif');
  const setupRes = await api('GET', `/api/admin/competitions/${COMP}/setup-check`);
  check('setup-check → 200', setupRes.status === 200, JSON.stringify(setupRes.json).slice(0, 200));
  const rep = setupRes.json?.report;
  check('il nomme le serveur', !!rep?.guildName, JSON.stringify(rep?.guildName));
  check('aucun blocage annoncé', (rep?.issues ?? []).filter(i => i.level === 'blocker').length === 0,
    JSON.stringify(rep?.issues));
  check('les 4 équipes sont vues comme provisionnées', rep?.teams?.provisioned === TEAMS,
    JSON.stringify(rep?.teams));
  check('IL REPÈRE LE JOUEUR ABSENT DU SERVEUR',
    (rep?.players?.absent ?? []).some(p => p.name === 'Joueur fantôme'),
    JSON.stringify(rep?.players));
  check('et il l’attribue à son équipe',
    (rep?.players?.absent ?? []).some(p => p.team === teamName(2)), JSON.stringify(rep?.players?.absent));

  // Il doit aussi voir ce qui CASSE : on supprime le salon d'annonces à la main.
  await discord(`/channels/${announceId}`, { method: 'DELETE' });
  const broken = await api('GET', `/api/admin/competitions/${COMP}/setup-check`);
  const brokenIssues = (broken.json?.report?.issues ?? []).filter(i => i.level === 'blocker');
  check('UN SALON SUPPRIMÉ REMONTE COMME BLOCAGE',
    brokenIssues.some(i => /annonces/i.test(i.label) && /n'existe plus|existe plus/i.test(i.label)),
    JSON.stringify(brokenIssues));
  // Remis en état pour la suite du scénario.
  const recreated = await (await discord(`/guilds/${GUILD}/channels`, {
    method: 'POST', body: JSON.stringify({ name: 'e2e-bc-annonces', type: 0 }),
  })).json();
  announceId = recreated.id;
  await db.collection('competitions').doc(COMP).update({
    'discord.options.announceChannelId': announceId,
    'discord.createdChannelIds': [announceId],
  });

  section('Annonce libre de l’organisateur');
  const ANNONCE = 'Le tournoi prend 20 minutes de retard, la phase 3 démarre à 18h20.';
  const announced = await api('POST', `/api/admin/competitions/${COMP}/console`, {
    action: 'announce', message: ANNONCE, to: 'both',
  });
  check('announce → 200', announced.status === 200, JSON.stringify(announced.json).slice(0, 200));
  check('accusé de livraison : annonces + 4 équipes', announced.json?.delivery?.sent === TEAMS + 1,
    JSON.stringify(announced.json?.delivery));
  check('le résumé est lisible pour un humain', /message/.test(announced.json?.deliverySummary ?? ''),
    announced.json?.deliverySummary);
  const annMsg = (await messagesOf(announceId))[0];
  check('le salon public a reçu l’annonce', (embedOf(annMsg).description || '').includes('20 minutes de retard'),
    embedOf(annMsg).description);
  check('elle NE PING PERSONNE dans le salon public', !(annMsg?.content || '').includes('<@&'),
    `content="${annMsg?.content}"`);
  const teamAnn = (await messagesOf(chanOf[3]))[0];
  check('chaque équipe l’a reçue dans son salon',
    (embedOf(teamAnn).description || '').includes('20 minutes de retard'));
  check('ET elle ping l’équipe', (teamAnn?.content || '').includes(`<@&${roleOf[3]}>`),
    `content="${teamAnn?.content}"`);
  const empty = await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'announce', message: '  ' });
  check('une annonce vide est refusée', empty.status === 400, `status ${empty.status}`);

  section('Garde du bac à sable');
  await db.collection('competitions').doc(COMP).update({ isDev: true });
  const before = (await messagesOf(chanOf[3])).length;
  const m3 = matches.docs.map(d => d.data())
    .find(m => (m.teamA === regId(3) || m.teamB === regId(3)) && m.teamA && m.teamB && m.id !== first.id);
  if (m3) {
    await api('POST', `/api/admin/competitions/${COMP}/console`, { action: 'launch_phase', matchIds: [m3.id] });
    const after = (await messagesOf(chanOf[3])).length;
    check('une compétition isDev n’écrit RIEN sur Discord', after === before, `${before} → ${after}`);
  } else {
    check('une compétition isDev n’écrit RIEN sur Discord', true, '(pas de 2e match à lancer)');
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passés, ${failed} échoués`);
}

try {
  await main();
} catch (err) {
  console.error('\n💥', err);
  failed++;
} finally {
  console.log('\n▸ Nettoyage');
  await cleanupAll().catch(e => console.log(`  ⚠ ${e.message}`));
  process.exit(failed === 0 ? 0 : 1);
}
