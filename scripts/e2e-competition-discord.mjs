// E2E provisioning Discord d'une compétition — CONTRE UN VRAI SERVEUR DISCORD.
//
// C'est le seul pan du module compétition qui ne peut pas être prouvé par des
// tests purs : rôles, salons, permissions et mentions n'existent que chez
// Discord. Ce script déroule le chemin réel (console → route → API Discord),
// puis RELIT l'état chez Discord pour vérifier que ce qui a été créé est
// conforme — un 200 ne prouve rien sur les permissions posées.
//
// Couvre : ressources partagées (rôle participant, catégorie, salon d'annonces,
// salon staff), salons privés d'équipe + overwrites, message d'accueil et son
// PING (une mention dans un embed ne notifie personne), assignation des rôles,
// joueur absent du serveur (warning non bloquant), idempotence de la relance,
// déprovisionnement au refus, nettoyage de fin (et non-suppression d'un salon
// désigné par l'organisateur).
//
// PRÉREQUIS
//   - dev server sur localhost:3000
//   - un serveur Discord de test où le bot Aedral est administrateur
//   - le propriétaire de ce serveur doit être admin Aedral (il signe les appels)
//   - E2E_DISCORD_GUILD_ID=<id du serveur>  (sinon valeur par défaut ci-dessous)
//
// Run : node --env-file=.env.local scripts/e2e-competition-discord.mjs
//       node --env-file=.env.local scripts/e2e-competition-discord.mjs --overflow
//         (--overflow : prouve en plus le débordement au-delà de 50 salons par
//          catégorie — long, ~50 salons créés puis supprimés)
//
// Données préfixées e2e_dg, cleanup TOUJOURS en finally (DB PARTAGÉE avec la
// prod, et le serveur Discord doit être rendu propre).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};
const GUILD = process.env.E2E_DISCORD_GUILD_ID || '1531385106139189269';
const WITH_OVERFLOW = process.argv.includes('--overflow');
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_dg';
const COMP = `${P}-comp`;

const PERM = {
  VIEW_CHANNEL: 1 << 10,
  SEND_MESSAGES: 1 << 11,
  READ_MESSAGE_HISTORY: 1 << 16,
  CONNECT: 1 << 20,
};

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
function section(title) { console.log(`\n▸ ${title}`); }

// ── Accès Discord direct (VÉRIFICATION uniquement — jamais le chemin testé) ──
const TOKEN = process.env.DISCORD_BOT_TOKEN;
async function discord(path, init = {}) {
  const headers = {
    Authorization: `Bot ${TOKEN}`,
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers || {}),
  };
  let res = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers });
  // Ce script tape Discord une centaine de fois par run : sans backoff, une
  // vérification finit par tomber sur un 429.
  for (let attempt = 0; attempt < 3 && (res.status === 429 || res.status >= 500); attempt++) {
    const body = await res.clone().json().catch(() => ({}));
    const waitMs = Math.min(10_000, Math.max(500, Math.round((body.retry_after ?? 2 ** attempt) * 1000)));
    await new Promise(r => setTimeout(r, waitMs));
    res = await fetch(`https://discord.com/api/v10${path}`, { ...init, headers });
  }
  return res;
}
/**
 * Lecture de VÉRIFICATION : elle doit échouer bruyamment. Renvoyer [] sur une
 * erreur rendrait vertes les assertions du type « ce salon n'existe plus » sans
 * avoir rien vérifié — un test qui ment est pire que pas de test.
 */
async function dGet(path) {
  const res = await discord(path);
  if (!res.ok) throw new Error(`lecture Discord ${path} → ${res.status} ${(await res.text()).slice(0, 150)}`);
  return res.json();
}
const guildRoles = () => dGet(`/guilds/${GUILD}/roles`);
const guildChannels = () => dGet(`/guilds/${GUILD}/channels`);
/** Un overwrite de permission, par identifiant de cible. */
function ow(channel, targetId) {
  return (channel?.permission_overwrites || []).find(o => o.id === targetId) || null;
}
const allows = (o, bit) => !!o && (Number(o.allow) & bit) === bit;
const denies = (o, bit) => !!o && (Number(o.deny) & bit) === bit;

// ── Appels API Aedral signés ────────────────────────────────────────────────
let ADMIN_UID = null;
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
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}
async function api(method, path, body) {
  const token = await tokenFor(ADMIN_UID);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...bypassHeaders },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

// ── Ressources créées par le script lui-même (à nettoyer) ───────────────────
const ownRoleIds = [];      // rôles créés hors provisioning (staff fictif)
const ownChannelIds = [];   // salons créés hors provisioning (salon « de l'orga »)

// Deuxième scénario : un CIRCUIT à deux étapes. Le rôle participant y est
// commun aux étapes (spec §7) — c'est le seul cas où un même joueur peut être
// engagé sous ce rôle dans deux inscriptions à la fois.
const CIRCUIT = `${P}-circuit`;
const COMP_A = `${P}-etape-a`;
const COMP_B = `${P}-etape-b`;
const ALL_COMPS = [COMP, COMP_A, COMP_B];

const regId = i => `${COMP}_team${i}`;
const TEAMS = [
  { i: 1, name: 'E2E Dragons', withOwner: true },   // → done  (joueur réel)
  { i: 2, name: 'E2E Wolves', withOwner: false },   // → partial (joueur absent)
  { i: 3, name: 'E2E Falcons', withOwner: true },   // → refusée plus loin
];

async function setup(ownerId, staffRoleId, designatedChannelId) {
  const batch = db.batch();
  for (const t of TEAMS) {
    const roster = t.withOwner
      ? [{ discordId: ownerId, displayName: 'Cobaye réel' }]
      : [{ discordId: '999999999999999901', displayName: 'Joueur absent' }];
    batch.set(db.collection('competition_registrations').doc(regId(t.i)), {
      competitionId: COMP, structureId: `${P}-struct`, teamId: `${P}-team${t.i}`,
      name: t.name, tag: `E${t.i}`, logoUrl: null,
      captainUid: `discord_${P}_cap${t.i}`,
      rosterUids: [`discord_${P}_cap${t.i}`],
      roster,
      status: 'approved',
      discord: { provisioningStatus: 'queued' },
      createdAt: Timestamp.now(),
    });
  }
  batch.set(db.collection('competitions').doc(COMP), {
    name: 'TEST E2E Discord — ne pas toucher',
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
      closesAt: Timestamp.fromDate(new Date('2026-12-01')),
      waitlist: false,
    },
    schedule: {
      days: [{ date: '2026-09-26', startsAt: '15:00' }],
      phasePlan: [{ phase: 1, day: 1, label: 'P1', rounds: [{ bracket: 'winners', round: 1 }] }],
      generalCheckinMinutes: 20, matchCheckinMinutes: 5, scoreCounterMinutes: 3,
    },
    discord: {
      guildId: GUILD,
      participantRoleId: null,
      categoryId: null,
      options: {
        teamChannels: true,
        teamVoiceChannels: true,
        categoryName: 'E2E TOURNOI',
        staffRoleIds: [staffRoleId],
        participantRoleName: 'E2E Participant',
        // Salon d'annonces CRÉÉ par le bot → doit disparaître au nettoyage.
        createAnnounceChannel: true,
        announceChannelName: 'e2e-annonces',
        announceChannelId: null,
        // Salon du staff DÉSIGNÉ par l'organisateur → doit SURVIVRE au nettoyage.
        createStaffChannel: false,
        staffChannelId: designatedChannelId,
        staffChannelName: null,
      },
    },
    status: 'draft',
    isDev: true,
    createdAt: Timestamp.now(),
  });
  await batch.commit();
}

/** Deux étapes d'un même circuit, chacune avec une équipe où joue le cobaye. */
async function setupCircuit(ownerId) {
  const batch = db.batch();
  batch.set(db.collection('circuits').doc(CIRCUIT), {
    name: 'E2E Circuit', slug: CIRCUIT, game: 'rocket_league',
    organizer: null, prizePool: null, discord: null,
    status: 'active', isDev: true, createdAt: Timestamp.now(),
  });
  for (const [compId, label] of [[COMP_A, 'A'], [COMP_B, 'B']]) {
    batch.set(db.collection('competitions').doc(compId), {
      name: `TEST E2E Étape ${label} — ne pas toucher`,
      game: 'rocket_league', circuitId: CIRCUIT,
      format: {
        kind: 'single_elim', maxTeams: 8,
        bo: { default: 3, overrides: [], grandFinal: 5 },
        thirdPlace: false, forfeitScore: { games: 2, goalsPerGame: 1 },
      },
      eligibility: { requireVerifiedAccounts: false, minAge: null, mmr: null },
      roster: { starters: 3, subsMax: 2 },
      registration: {
        opensAt: Timestamp.fromDate(new Date('2026-01-01')),
        closesAt: Timestamp.fromDate(new Date('2026-12-01')),
        waitlist: false,
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
          categoryName: `E2E ETAPE ${label}`,
          staffRoleIds: [],
          participantRoleName: 'E2E Participant Circuit',
          createAnnounceChannel: false, announceChannelId: null, announceChannelName: null,
          createStaffChannel: false, staffChannelId: null, staffChannelName: null,
        },
      },
      status: 'draft', isDev: true, createdAt: Timestamp.now(),
    });
    batch.set(db.collection('competition_registrations').doc(`${compId}_team`), {
      competitionId: compId, structureId: `${P}-struct`, teamId: `${P}-circteam`,
      name: `E2E Circuit ${label}`, tag: `EC${label}`, logoUrl: null,
      captainUid: `discord_${P}_circcap`,
      rosterUids: [`discord_${P}_circcap`],
      roster: [{ discordId: ownerId, displayName: 'Cobaye réel' }],
      status: 'approved',
      discord: { provisioningStatus: 'queued' },
      createdAt: Timestamp.now(),
    });
  }
  await batch.commit();
}

async function cleanupFirestore() {
  const batch = db.batch();
  for (const t of TEAMS) batch.delete(db.collection('competition_registrations').doc(regId(t.i)));
  for (const compId of [COMP_A, COMP_B]) {
    batch.delete(db.collection('competition_registrations').doc(`${compId}_team`));
  }
  for (const compId of ALL_COMPS) batch.delete(db.collection('competitions').doc(compId));
  batch.delete(db.collection('circuits').doc(CIRCUIT));
  await batch.commit().catch(() => {});
}

/** Supprime chez Discord tout ce que le run a pu laisser (idempotent). */
async function cleanupDiscord() {
  const channelIds = new Set(ownChannelIds);
  const roleIds = new Set(ownRoleIds);

  const circuitSnap = await db.collection('circuits').doc(CIRCUIT).get().catch(() => null);
  const circuitRole = circuitSnap?.data()?.discord?.participantRoleId;
  if (circuitRole) roleIds.add(circuitRole);

  for (const compId of ALL_COMPS) {
    const compSnap = await db.collection('competitions').doc(compId).get().catch(() => null);
    const d = compSnap?.data()?.discord ?? {};
    for (const id of Array.isArray(d.createdChannelIds) ? d.createdChannelIds : []) channelIds.add(id);
    for (const id of Array.isArray(d.categoryIds) ? d.categoryIds : []) channelIds.add(id);
    if (d.categoryId) channelIds.add(d.categoryId);
    if (d.participantRoleId) roleIds.add(d.participantRoleId);

    const regs = await db.collection('competition_registrations')
      .where('competitionId', '==', compId).get().catch(() => ({ docs: [] }));
    for (const doc of regs.docs) {
      const r = doc.data().discord ?? {};
      if (r.textChannelId) channelIds.add(r.textChannelId);
      if (r.voiceChannelId) channelIds.add(r.voiceChannelId);
      if (r.roleId) roleIds.add(r.roleId);
    }
  }
  for (const id of channelIds) await discord(`/channels/${id}`, { method: 'DELETE' }).catch(() => {});
  for (const id of roleIds) await discord(`/guilds/${GUILD}/roles/${id}`, { method: 'DELETE' }).catch(() => {});

  // Filet : tout résidu nommé e2e- laissé par un run interrompu. Ne touche que
  // ce préfixe — les salons de l'organisateur ne sont jamais concernés.
  try {
    for (const c of await guildChannels()) {
      if (/^(e2e-|E2E )/i.test(c.name)) await discord(`/channels/${c.id}`, { method: 'DELETE' }).catch(() => {});
    }
    for (const r of await guildRoles()) {
      if (/^E2E /i.test(r.name)) await discord(`/guilds/${GUILD}/roles/${r.id}`, { method: 'DELETE' }).catch(() => {});
    }
  } catch (err) {
    console.log(`  ⚠ filet de nettoyage incomplet : ${err.message}`);
  }
}

async function main() {
  if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN manquant');

  // Le propriétaire du serveur signe les appels (garde guildBlocker) et sert de
  // joueur cobaye : c'est le seul membre humain du serveur de test.
  const guild = await dGet(`/guilds/${GUILD}`);
  if (!guild) throw new Error(`Serveur ${GUILD} illisible — le bot y est-il ?`);
  const ownerId = guild.owner_id;
  ADMIN_UID = `discord_${ownerId}`;
  console.log(`Serveur   : ${guild.name}`);
  console.log(`Signataire: ${ADMIN_UID} (propriétaire)`);

  const adminDoc = await db.collection('aedral_admins').doc(ADMIN_UID).get();
  if (!adminDoc.exists) {
    throw new Error(`${ADMIN_UID} n'est pas dans aedral_admins — il ne peut pas lancer le provisioning.`);
  }

  // Ressources préexistantes « de l'organisateur » : un rôle staff et un salon
  // que le bot n'a PAS créés.
  const staffRole = await (await discord(`/guilds/${GUILD}/roles`, {
    method: 'POST', body: JSON.stringify({ name: 'E2E Staff', mentionable: false }),
  })).json();
  ownRoleIds.push(staffRole.id);
  const designated = await (await discord(`/guilds/${GUILD}/channels`, {
    method: 'POST', body: JSON.stringify({ name: 'e2e-salon-de-lorga', type: 0 }),
  })).json();
  ownChannelIds.push(designated.id);

  await setup(ownerId, staffRole.id, designated.id);

  // ── 1. Provisioning ───────────────────────────────────────────────────────
  section('Provisioning initial');
  const prov = await api('POST', `/api/admin/competitions/${COMP}/provision`);
  check('POST /provision → 200', prov.status === 200, `status ${prov.status} ${JSON.stringify(prov.json).slice(0, 200)}`);
  const report = prov.json?.report;
  check('3 équipes traitées', report?.total === 3, `total=${report?.total}`);
  check('2 équipes done', report?.done === 2, `done=${report?.done}`);
  check('1 équipe partial (joueur absent)', report?.partial === 1, `partial=${report?.partial}`);
  check('0 erreur', report?.errors === 0, JSON.stringify(report?.teams ?? []).slice(0, 300));
  const wolves = (report?.teams || []).find(t => t.name === 'E2E Wolves');
  check("le joueur absent est signalé en clair", !!wolves?.warnings?.some(w => /n'est pas sur le serveur/.test(w)),
    JSON.stringify(wolves?.warnings));

  // ── 2. Ce qui existe RÉELLEMENT chez Discord ──────────────────────────────
  section('État réel du serveur Discord');
  const comp = (await db.collection('competitions').doc(COMP).get()).data();
  const roles = await guildRoles();
  const channels = await guildChannels();
  const roleById = new Map((roles || []).map(r => [r.id, r]));
  const chanById = new Map((channels || []).map(c => [c.id, c]));

  const participantRoleId = comp.discord?.participantRoleId;
  check('rôle participant créé', !!roleById.get(participantRoleId));
  check('rôle participant nommé comme demandé', roleById.get(participantRoleId)?.name === 'E2E Participant',
    roleById.get(participantRoleId)?.name);

  const categoryId = comp.discord?.categoryId;
  const category = chanById.get(categoryId);
  check('catégorie créée', !!category && category.type === 4);
  check('catégorie nommée comme demandé', category?.name === 'E2E TOURNOI', category?.name);

  const announceId = comp.discord?.options?.announceChannelId;
  const announce = chanById.get(announceId);
  check("salon d'annonces créé", !!announce);
  check("salon d'annonces rangé dans la catégorie", announce?.parent_id === categoryId);
  check('annonces : tout le serveur peut lire', allows(ow(announce, GUILD), PERM.VIEW_CHANNEL));
  check('annonces : personne ne peut écrire sauf staff', denies(ow(announce, GUILD), PERM.SEND_MESSAGES));
  check('annonces : le rôle staff peut écrire', allows(ow(announce, staffRole.id), PERM.SEND_MESSAGES));

  check('le salon du staff désigné est resté celui de l’organisateur',
    comp.discord?.options?.staffChannelId === designated.id);
  check("le salon désigné n'est PAS marqué comme créé par le bot",
    !(comp.discord?.createdChannelIds || []).includes(designated.id));

  section('Salons privés des équipes');
  const regDocs = {};
  for (const t of TEAMS) {
    regDocs[t.i] = (await db.collection('competition_registrations').doc(regId(t.i)).get()).data();
  }
  const dragons = regDocs[1].discord;
  const dragonsText = chanById.get(dragons.textChannelId);
  const dragonsVoice = chanById.get(dragons.voiceChannelId);
  check('rôle d’équipe créé', !!roleById.get(dragons.roleId));
  check('rôle d’équipe nommé d’après l’équipe', roleById.get(dragons.roleId)?.name === 'E2E Dragons');
  check('salon texte créé', !!dragonsText);
  check('nom de salon slugifié', dragonsText?.name === 'e2e-dragons', dragonsText?.name);
  check('salon texte rangé dans la catégorie', dragonsText?.parent_id === categoryId);
  check('salon vocal créé', !!dragonsVoice && dragonsVoice.type === 2);
  check('salon privé : @everyone ne voit rien', denies(ow(dragonsText, GUILD), PERM.VIEW_CHANNEL));
  check('salon privé : l’équipe voit et écrit',
    allows(ow(dragonsText, dragons.roleId), PERM.VIEW_CHANNEL) && allows(ow(dragonsText, dragons.roleId), PERM.SEND_MESSAGES));
  check('salon privé : le staff y a accès', allows(ow(dragonsText, staffRole.id), PERM.VIEW_CHANNEL));
  check('vocal : l’équipe peut se connecter', allows(ow(dragonsVoice, dragons.roleId), PERM.CONNECT));

  section('Message d’accueil et notification');
  const messages = await dGet(`/channels/${dragons.textChannelId}/messages?limit=5`);
  const welcome = (messages || [])[0];
  check('un message d’accueil est posté', !!welcome);
  check('il porte un embed', (welcome?.embeds || []).length === 1);
  check('IL PING RÉELLEMENT (mention dans content, pas dans l’embed)',
    (welcome?.content || '').includes(`<@&${dragons.roleId}>`), `content="${welcome?.content}"`);
  check('la mention du rôle est autorisée', (welcome?.mentions_roles || []).includes(dragons.roleId)
    || (welcome?.mention_roles || []).includes(dragons.roleId), JSON.stringify(welcome?.mention_roles));

  section('Attribution des rôles aux joueurs');
  const member = await dGet(`/guilds/${GUILD}/members/${ownerId}`);
  check('le joueur a reçu le rôle de son équipe', (member?.roles || []).includes(dragons.roleId));
  check('le joueur a reçu le rôle participant', (member?.roles || []).includes(participantRoleId));

  // ── 3. Idempotence ────────────────────────────────────────────────────────
  section('Relance du provisioning (idempotence)');
  const rolesBefore = (await guildRoles()).length;
  const channelsBefore = (await guildChannels()).length;
  const again = await api('POST', `/api/admin/competitions/${COMP}/provision`);
  check('relance → 200', again.status === 200, JSON.stringify(again.json).slice(0, 200));
  const rolesAfter = (await guildRoles()).length;
  const channelsAfter = (await guildChannels()).length;
  check('aucun rôle en double', rolesAfter === rolesBefore, `${rolesBefore} → ${rolesAfter}`);
  check('aucun salon en double', channelsAfter === channelsBefore, `${channelsBefore} → ${channelsAfter}`);

  // ── 4. Déprovisionnement au refus ─────────────────────────────────────────
  section('Refus d’une équipe déjà provisionnée');
  const falcons = regDocs[3].discord;
  // Parcours réel : on ne refuse pas une équipe validée directement, on annule
  // d'abord sa validation. Ses salons doivent survivre à cette étape — elle
  // peut être re-validée dans la foulée.
  const unap = await api('POST', `/api/admin/competitions/${COMP}/registrations`, {
    registrationId: regId(3), action: 'unapprove',
  });
  check('POST unapprove → 200', unap.status === 200, JSON.stringify(unap.json).slice(0, 200));
  const midChannels = await guildChannels();
  check('annuler la validation ne détruit pas le salon de l’équipe',
    midChannels.some(c => c.id === falcons.textChannelId));

  const rej = await api('POST', `/api/admin/competitions/${COMP}/registrations`, {
    registrationId: regId(3), action: 'reject', reason: 'Test e2e du déprovisionnement',
  });
  check('POST reject → 200', rej.status === 200, JSON.stringify(rej.json).slice(0, 200));
  const afterReject = await guildChannels();
  const afterRejectRoles = await guildRoles();
  check('son salon texte est supprimé', !afterReject.some(c => c.id === falcons.textChannelId));
  check('son salon vocal est supprimé', !afterReject.some(c => c.id === falcons.voiceChannelId));
  check('son rôle d’équipe est supprimé', !afterRejectRoles.some(r => r.id === falcons.roleId));
  // Le joueur refusé jouait AUSSI dans une équipe encore validée : lui retirer
  // le rôle participant l'exclurait des salons communs du tournoi.
  const memberAfter = await dGet(`/guilds/${GUILD}/members/${ownerId}`);
  check('le joueur garde le rôle participant (il joue encore dans une équipe validée)',
    (memberAfter?.roles || []).includes(participantRoleId),
    'rôle participant retiré alors que le joueur est titulaire d’une autre équipe validée');
  check('le joueur garde le rôle de son autre équipe', (memberAfter?.roles || []).includes(dragons.roleId));

  // ── 5. Rôle participant partagé par un circuit ────────────────────────────
  // Le vrai scénario de la Legends : 4 Qualifs sous un même rôle participant.
  section('Circuit à deux étapes — rôle participant commun');
  await setupCircuit(ownerId);
  const provA = await api('POST', `/api/admin/competitions/${COMP_A}/provision`);
  check('étape A provisionnée', provA.status === 200 && provA.json?.report?.done === 1,
    JSON.stringify(provA.json).slice(0, 200));
  const provB = await api('POST', `/api/admin/competitions/${COMP_B}/provision`);
  check('étape B provisionnée', provB.status === 200 && provB.json?.report?.done === 1,
    JSON.stringify(provB.json).slice(0, 200));

  const compA = (await db.collection('competitions').doc(COMP_A).get()).data();
  const compB = (await db.collection('competitions').doc(COMP_B).get()).data();
  const circuitDoc = (await db.collection('circuits').doc(CIRCUIT).get()).data();
  const sharedRoleId = compA.discord?.participantRoleId;
  check('les deux étapes partagent LE MÊME rôle participant',
    !!sharedRoleId && compB.discord?.participantRoleId === sharedRoleId,
    `A=${sharedRoleId} B=${compB.discord?.participantRoleId}`);
  check('le rôle est porté par le circuit', circuitDoc?.discord?.participantRoleId === sharedRoleId);
  check('un seul rôle participant existe sur le serveur',
    (await guildRoles()).filter(r => r.name === 'E2E Participant Circuit').length === 1);

  const memberCirc = await dGet(`/guilds/${GUILD}/members/${ownerId}`);
  check('le joueur porte le rôle participant du circuit', (memberCirc?.roles || []).includes(sharedRoleId));

  // Refus à l'étape B alors que le joueur reste validé à l'étape A.
  const regBBefore = (await db.collection('competition_registrations').doc(`${COMP_B}_team`).get()).data();
  await api('POST', `/api/admin/competitions/${COMP_B}/registrations`, {
    registrationId: `${COMP_B}_team`, action: 'unapprove',
  });
  const rejB = await api('POST', `/api/admin/competitions/${COMP_B}/registrations`, {
    registrationId: `${COMP_B}_team`, action: 'reject', reason: 'Test e2e du rôle partagé',
  });
  check('refus à l’étape B → 200', rejB.status === 200, JSON.stringify(rejB.json).slice(0, 200));
  const rolesAfterB = await guildRoles();
  check('le rôle d’équipe de l’étape B est supprimé',
    !rolesAfterB.some(r => r.id === regBBefore.discord?.roleId));
  const memberAfterB = await dGet(`/guilds/${GUILD}/members/${ownerId}`);
  check('LE JOUEUR GARDE LE RÔLE PARTICIPANT (il court toujours l’étape A)',
    (memberAfterB?.roles || []).includes(sharedRoleId),
    'refuser une étape retire le rôle commun au circuit → accès perdu sur les autres étapes');

  // Nettoyage d'une étape : le rôle du circuit doit survivre aux autres étapes.
  await db.collection('competitions').doc(COMP_B).update({ status: 'finished' });
  const cleanB = await api('POST', `/api/admin/competitions/${COMP_B}/discord-cleanup`);
  check('nettoyage de l’étape B → 200', cleanB.status === 200, JSON.stringify(cleanB.json).slice(0, 200));
  check('le rôle participant du circuit N’EST PAS supprimé',
    (await guildRoles()).some(r => r.id === sharedRoleId));

  // ── 6. Nettoyage de fin de tournoi ────────────────────────────────────────
  section('Nettoyage de fin de tournoi');
  const tooEarly = await api('POST', `/api/admin/competitions/${COMP}/discord-cleanup`);
  check('refusé tant que la compétition n’est pas terminée', tooEarly.status === 409, `status ${tooEarly.status}`);

  await db.collection('competitions').doc(COMP).update({ status: 'finished' });
  const clean = await api('POST', `/api/admin/competitions/${COMP}/discord-cleanup`);
  check('POST discord-cleanup → 200', clean.status === 200, JSON.stringify(clean.json).slice(0, 200));
  const finalChannels = await guildChannels();
  const finalRoles = await guildRoles();
  check('salons d’équipe supprimés', !finalChannels.some(c => c.id === dragons.textChannelId));
  check('salon d’annonces (créé par le bot) supprimé', !finalChannels.some(c => c.id === announceId));
  check('catégorie supprimée', !finalChannels.some(c => c.id === categoryId));
  check('rôle participant supprimé (compétition hors circuit)', !finalRoles.some(r => r.id === participantRoleId));
  check('LE SALON DE L’ORGANISATEUR EST INTACT', finalChannels.some(c => c.id === designated.id));
  check('le rôle staff de l’organisateur est intact', finalRoles.some(r => r.id === staffRole.id));
  check('le nettoyage signale ce qu’il a épargné', (clean.json?.report?.skipped ?? 0) >= 1,
    JSON.stringify(clean.json?.report));

  // ── 6. Débordement de catégorie (option) ──────────────────────────────────
  if (WITH_OVERFLOW) {
    section('Débordement au-delà de 50 salons par catégorie');
    await db.collection('competitions').doc(COMP).update({
      status: 'draft',
      'discord.categoryId': null,
      'discord.categoryIds': [],
      'discord.participantRoleId': null,
      'discord.createdChannelIds': [],
      'discord.options.createAnnounceChannel': false,
      'discord.options.teamVoiceChannels': false,
    });
    for (const t of TEAMS) {
      await db.collection('competition_registrations').doc(regId(t.i)).update({
        status: 'approved',
        discord: { provisioningStatus: 'queued' },
      });
    }
    const first = await api('POST', `/api/admin/competitions/${COMP}/provision`);
    check('provisioning de départ → 200', first.status === 200);
    const compNow = (await db.collection('competitions').doc(COMP).get()).data();
    const catId = compNow.discord?.categoryId;

    // On remplit la catégorie jusqu'au seuil avec des salons factices, plutôt
    // que de créer 25 équipes : c'est le compteur qui est testé, pas le roster.
    const used = (await guildChannels()).filter(c => c.parent_id === catId).length;
    const filler = [];
    for (let i = used; i < 50; i++) {
      const res = await discord(`/guilds/${GUILD}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: `e2e-filler-${i}`, type: 0, parent_id: catId }),
      });
      if (res.ok) filler.push((await res.json()).id);
      else { console.log(`    (remplissage arrêté à ${i} : ${res.status})`); break; }
    }
    ownChannelIds.push(...filler);
    check('catégorie remplie au seuil', filler.length > 0, `${filler.length} salons factices`);

    // Une équipe de plus : elle ne DOIT PAS entrer dans la catégorie pleine.
    await db.collection('competition_registrations').doc(regId(2)).update({
      status: 'approved', discord: { provisioningStatus: 'queued' },
    });
    const overflow = await api('POST', `/api/admin/competitions/${COMP}/provision`);
    check('provisioning au-delà du seuil → 200 (pas d’échec au 51e)', overflow.status === 200,
      JSON.stringify(overflow.json).slice(0, 300));
    const compAfter = (await db.collection('competitions').doc(COMP).get()).data();
    const cats = compAfter.discord?.categoryIds || [];
    check('une catégorie de débordement a été ouverte', cats.length >= 2, JSON.stringify(cats));
    const reg2 = (await db.collection('competition_registrations').doc(regId(2)).get()).data();
    const chan2 = (await guildChannels()).find(c => c.id === reg2.discord?.textChannelId);
    check('la nouvelle équipe est rangée dans la catégorie de débordement',
      !!chan2 && chan2.parent_id !== catId, `parent=${chan2?.parent_id} / principale=${catId}`);
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
  await cleanupDiscord().catch(err => console.log(`  ⚠ nettoyage Discord : ${err.message}`));
  await cleanupFirestore();
  try {
    const rest = await guildChannels();
    const restRoles = await guildRoles();
    const residue = rest.filter(c => /^(e2e-|E2E )/i.test(c.name)).length
      + restRoles.filter(r => /^E2E /i.test(r.name)).length;
    console.log(`  serveur : ${rest.length} salons, ${restRoles.length} rôles — ${residue} résidu(s) e2e`);
  } catch (err) {
    console.log(`  ⚠ état final invérifiable : ${err.message}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}
