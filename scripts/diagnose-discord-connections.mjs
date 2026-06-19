// Diagnostic LIVE des connexions Discord d'un user : refait le refresh token +
// l'appel /users/@me/connections exactement comme le site, et imprime ce que
// Discord renvoie RÉELLEMENT (types, verified, visibility) + ce qu'on a stocké.
// Sert à trancher « le user dit avoir lié Riot mais le site ne voit pas la connexion ».
//
// Usage : node --env-file=.env.local scripts/diagnose-discord-connections.mjs <slug-ou-pseudo>

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) { const d = await import('dotenv'); d.config({ path: '.env.local' }); }
function parseServiceAccount(raw) {
  if (!raw.trim().startsWith('{')) return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant.'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}
const db = getFirestore();
const needle = (process.argv[2] || '').toLowerCase();
if (!needle) { console.error('Usage: ... diagnose-discord-connections.mjs <slug-ou-pseudo>'); process.exit(1); }

// 1. Trouver le user
let userDoc = null;
const bySlug = await db.collection('users').where('slug', '==', needle).limit(1).get();
if (!bySlug.empty) userDoc = bySlug.docs[0];
else {
  const all = await db.collection('users').get();
  userDoc = all.docs.find(d => {
    const u = d.data();
    return [u.slug, u.displayName, u.discordUsername].some(v => typeof v === 'string' && v.toLowerCase().includes(needle));
  }) || null;
}
if (!userDoc) { console.error(`Aucun user pour "${needle}".`); process.exit(1); }
const uid = userDoc.id;
const u = userDoc.data();
console.log(`USER ${u.displayName} (slug=${u.slug}, uid=${uid})`);
console.log('Connexions STOCKÉES :', JSON.stringify((u.discordConnections ?? []).map(c => ({ type: c.type, verified: c.verified, name: c.name })), null, 0));
console.log('valorantPuuid stocké :', u.valorantPuuid || '(aucun)');

// 2. Refresh token
const secSnap = await db.collection('user_secrets').doc(uid).get();
const refreshToken = secSnap.data()?.discordRefreshToken;
if (!refreshToken) { console.log('\n❌ PAS de discordRefreshToken stocké → refresh impossible (login d\'avant la capture, ou révoqué). Le site renverra « reconnecte-toi ».'); process.exit(0); }

const clientId = process.env.DISCORD_CLIENT_ID;
const clientSecret = process.env.DISCORD_CLIENT_SECRET;
console.log(`\nDISCORD_CLIENT_ID présent : ${!!clientId} | SECRET présent : ${!!clientSecret}`);

// 3. Échange refresh → access token
const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
});
console.log(`Refresh token exchange : HTTP ${tokenRes.status}`);
if (!tokenRes.ok) {
  console.log('Body :', (await tokenRes.text()).slice(0, 300));
  console.log('\n❌ Le refresh échoue → le site renvoie « reconnecte-toi » (pas le message connexion).');
  process.exit(0);
}
const tokenData = await tokenRes.json();
console.log('Scope renvoyé par Discord :', tokenData.scope || '(absent)');

// 4. Appel /users/@me/connections LIVE
const connRes = await fetch('https://discord.com/api/users/@me/connections', {
  headers: { Authorization: `Bearer ${tokenData.access_token}` },
});
console.log(`\n/users/@me/connections : HTTP ${connRes.status}`);
if (!connRes.ok) {
  console.log('Body :', (await connRes.text()).slice(0, 300));
  console.log('\n❌ L\'appel connexions échoue (scope manquant ? rate-limit 429 ?) → fetchDiscordConnections renvoie [] → faux « pas trouvé ».');
  process.exit(0);
}
const conns = await connRes.json();
console.log('Connexions LIVE renvoyées par Discord :');
for (const c of conns) {
  console.log(`  - type=${c.type} | name=${c.name} | id=${c.id?.slice(0, 12)}… | verified=${c.verified} | visibility=${c.visibility}`);
}
const riot = conns.find(c => c.type === 'riotgames');
console.log('\n═══ VERDICT ═══');
if (riot) {
  console.log(`✅ Discord RENVOIE bien riotgames : name="${riot.name}" verified=${riot.verified}. Le site DEVRAIT la voir.`);
  console.log('→ Si le user voit quand même l\'erreur : le refresh a échoué côté site OU connexions pas re-mergées. Creuser le merge/affichage.');
} else {
  console.log('❌ Discord NE RENVOIE PAS de connexion riotgames pour ce user.');
  console.log('   Types présents : ' + conns.map(c => c.type).join(', '));
  console.log('   → Le compte Riot n\'est pas (ou plus) partagé via OAuth Discord côté user, OU type différent.');
}
process.exit(0);
