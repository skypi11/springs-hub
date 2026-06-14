// Diagnostic one-shot : taux de vérification des comptes de jeu.
//
// Objectif : distinguer les causes d'un faible taux de vérif.
//  - "verified" = compte de jeu prouvé sur le site (rlEpicId/rlSteamId pour RL,
//    valorantPuuid pour Valorant).
//  - GAP CLÉ : combien d'users ONT la connection du jeu dans leur Discord
//    (epicgames/steam/riotgames, capturée au login via le scope `connections`)
//    mais ne sont PAS vérifiés sur le site. Un gap élevé = friction/bug dans la
//    capture (pas un problème de comm). Un gap faible = les gens n'ont même pas
//    lié leur compte de jeu à Discord en amont (problème d'incitation/comm).
//
// Run : node --env-file=.env.local scripts/diagnose-verification.mjs
//   (ou sans --env-file : le script charge .env.local via dotenv)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

function parseServiceAccount(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const fixed = raw.replace(
      /"private_key":\s*"([^"]+)"/,
      (_m, key) => `"private_key": "${key.replace(/\r?\n/g, '\\n')}"`,
    );
    return JSON.parse(fixed);
  }
}

if (!getApps().length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant (charge .env.local).'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();
const snap = await db.collection('users').get();

let total = 0, dev = 0;
const rl = { players: 0, epic: 0, steam: 0, verified: 0, epicConn: 0, steamConn: 0, connButUnverified: 0 };
const val = { players: 0, puuid: 0, riotConn: 0, verified: 0, connButUnverified: 0 };
const tm = { players: 0, withAccount: 0 };
let noGames = 0;
let anyGameVerified = 0;     // users avec >=1 jeu "vérifiable" (RL/Val) ET vérifié sur >=1
let anyGamePlayer = 0;       // users avec >=1 jeu "vérifiable" (RL/Val)

const pct = (n, d) => d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;

for (const d of snap.docs) {
  const u = d.data();
  if (u.isDev === true) { dev++; continue; }
  total++;

  const games = Array.isArray(u.games) ? u.games : [];
  const conns = Array.isArray(u.discordConnections) ? u.discordConnections : [];
  const hasConn = (type) => conns.some(c => c && c.type === type);

  if (games.length === 0) noGames++;

  const playsRL = games.includes('rocket_league');
  const playsVal = games.includes('valorant');
  const playsTM = games.includes('trackmania');

  let isVerifiableUser = false, isVerifiedSomewhere = false;

  if (playsRL) {
    isVerifiableUser = true;
    rl.players++;
    const epic = !!u.rlEpicId, steam = !!u.rlSteamId;
    if (epic) rl.epic++;
    if (steam) rl.steam++;
    if (epic || steam) { rl.verified++; isVerifiedSomewhere = true; }
    const ce = hasConn('epicgames'), cs = hasConn('steam');
    if (ce) rl.epicConn++;
    if (cs) rl.steamConn++;
    if ((ce || cs) && !(epic || steam)) rl.connButUnverified++;
  }

  if (playsVal) {
    isVerifiableUser = true;
    val.players++;
    const puuid = !!u.valorantPuuid;
    if (puuid) { val.puuid++; val.verified++; isVerifiedSomewhere = true; }
    const cr = hasConn('riotgames');
    if (cr) val.riotConn++;
    if (cr && !puuid) val.connButUnverified++;
  }

  if (playsTM) {
    tm.players++;
    if (u.tmAccountId || u.loginTM) tm.withAccount++;
  }

  if (isVerifiableUser) {
    anyGamePlayer++;
    if (isVerifiedSomewhere) anyGameVerified++;
  }
}

console.log('\n==================  DIAGNOSTIC VÉRIFICATION  ==================');
console.log(`Users (hors dev) : ${total}   |   comptes dev ignorés : ${dev}`);
console.log(`Sans aucun jeu déclaré : ${noGames} (${pct(noGames, total)})`);
console.log(`\n--- GLOBAL (joueurs d'un jeu vérifiable RL/Valorant) ---`);
console.log(`Joueurs RL ou Valorant : ${anyGamePlayer}`);
console.log(`  ...dont vérifiés sur >=1 jeu : ${anyGameVerified} (${pct(anyGameVerified, anyGamePlayer)})`);

console.log(`\n--- ROCKET LEAGUE ---`);
console.log(`Joueurs RL : ${rl.players}`);
console.log(`  Vérifiés (Epic OU Steam) : ${rl.verified} (${pct(rl.verified, rl.players)})`);
console.log(`    dont Epic : ${rl.epic}  |  Steam : ${rl.steam}`);
console.log(`  Connection Discord epicgames présente : ${rl.epicConn}`);
console.log(`  Connection Discord steam présente     : ${rl.steamConn}`);
console.log(`  >>> GAP : a une connection Epic/Steam dans Discord MAIS non vérifié : ${rl.connButUnverified}`);
console.log(`      (gap élevé => friction/bug de capture ; gap faible => peu ont lié le compte à Discord)`);

console.log(`\n--- VALORANT ---`);
console.log(`Joueurs Valorant : ${val.players}`);
console.log(`  Vérifiés (PUUID) : ${val.verified} (${pct(val.verified, val.players)})`);
console.log(`  Connection Discord riotgames présente : ${val.riotConn}`);
console.log(`  >>> GAP : a une connection Riot dans Discord MAIS non vérifié : ${val.connButUnverified}`);

console.log(`\n--- TRACKMANIA (réf, pas de "vérif" anti-mensonge) ---`);
console.log(`Joueurs TM : ${tm.players}  |  avec compte renseigné : ${tm.withAccount} (${pct(tm.withAccount, tm.players)})`);
console.log('================================================================\n');

process.exit(0);
