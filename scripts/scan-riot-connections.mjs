// READ-ONLY : combien d'users ont une connexion Discord 'riotgames' stockée, et
// combien ont un valorantPuuid (= compte Riot vérifié). Dit si la capture Riot
// marche globalement ou si elle est cassée pour tout le monde.
//
// Usage : node --env-file=.env.local scripts/scan-riot-connections.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) { const d = await import('dotenv'); d.config({ path: '.env.local' }); }
function parseServiceAccount(raw) {
  if (!raw.trim().startsWith('{')) return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  try { return JSON.parse(raw); } catch { return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`)); }
}
if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant.'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}
const db = getFirestore();

const snap = await db.collection('users').get();
let total = 0, withRiotConn = 0, withPuuid = 0, valorantPlayers = 0, valorantNoPuuid = 0;
const riotConnSamples = [];
for (const d of snap.docs) {
  total++;
  const u = d.data();
  const conns = Array.isArray(u.discordConnections) ? u.discordConnections : [];
  const hasRiot = conns.some(c => c.type === 'riotgames');
  const games = Array.isArray(u.games) ? u.games : [];
  const playsVal = games.includes('valorant');
  if (hasRiot) { withRiotConn++; if (riotConnSamples.length < 8) riotConnSamples.push(`${u.displayName} (riot name="${conns.find(c=>c.type==='riotgames')?.name}")`); }
  if (u.valorantPuuid) withPuuid++;
  if (playsVal) { valorantPlayers++; if (!u.valorantPuuid) valorantNoPuuid++; }
}
console.log(`Users total                         : ${total}`);
console.log(`Avec connexion Discord 'riotgames'  : ${withRiotConn}`);
console.log(`Avec valorantPuuid (compte vérifié) : ${withPuuid}`);
console.log(`Joueurs Valorant (games inclut val) : ${valorantPlayers}`);
console.log(`  dont SANS valorantPuuid           : ${valorantNoPuuid}`);
console.log('\nÉchantillon connexions riotgames stockées :');
for (const s of riotConnSamples) console.log('  - ' + s);
if (withRiotConn === 0) console.log('  (AUCUNE → la capture riotgames est cassée pour TOUT LE MONDE)');
process.exit(0);
