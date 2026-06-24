// Backfill one-shot : rafraîchit `users.discordAvatar` pour TOUS les users via
// le bot Discord (GET /users/{id}). Corrige les ~20 % d'avatars en 404 (hash
// périmé après changement/retrait d'avatar Discord, jamais resynchronisé hors
// login). Le cron expire-invitations entretient ensuite la fraîcheur en continu.
//
//   node --env-file=.env.local scripts/refresh-discord-avatars.mjs        # écrit
//   node --env-file=.env.local scripts/refresh-discord-avatars.mjs --dry  # simulation
//
// Requiert : FIREBASE_SERVICE_ACCOUNT + DISCORD_BOT_TOKEN dans .env.local.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

const DRY = process.argv.includes('--dry');
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN manquant dans .env.local.');
  process.exit(1);
}

// ── Même logique que lib/discord-avatar.ts (inline car .mjs ne peut pas
//    importer du TS sans build). Garder les deux synchronisés. ──
function buildDiscordAvatarUrl(userId, avatarHash, discriminator) {
  if (avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
  }
  let index;
  if (!discriminator || discriminator === '0') {
    try { index = Number((BigInt(userId) >> 22n) % 6n); } catch { index = 0; }
  } else {
    index = Number(discriminator) % 5;
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Récupère l'avatar actuel via le bot. Gère le 429 (retry-after) avec retries.
async function fetchAvatarViaBot(discordId, attempt = 0) {
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || '1');
      if (attempt < 5) {
        await sleep((retryAfter + 0.5) * 1000);
        return fetchAvatarViaBot(discordId, attempt + 1);
      }
      return { status: 'rate_limited' };
    }
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'error', code: res.status };
    const u = await res.json();
    if (!u?.id) return { status: 'error', code: 'no_id' };
    return { status: 'ok', url: buildDiscordAvatarUrl(u.id, u.avatar ?? null, u.discriminator ?? null) };
  } catch (err) {
    return { status: 'error', code: err?.message || 'fetch_failed' };
  }
}

// Init Admin SDK (même parse robuste que add-announce-template.mjs)
function parseServiceAccount(raw) {
  try { return JSON.parse(raw); }
  catch {
    const fixed = raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`);
    return JSON.parse(fixed);
  }
}
if (!getApps().length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant.'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}
const db = getFirestore();

console.log(`\n${DRY ? '[DRY-RUN] ' : ''}Refresh des avatars Discord…\n`);

const snap = await db.collection('users').get();
let total = 0, withId = 0, updated = 0, unchanged = 0, notFound = 0, rateLimited = 0, errors = 0;

for (const doc of snap.docs) {
  total++;
  const data = doc.data();
  const discordId = data.discordId;
  if (!discordId) continue;
  withId++;

  const r = await fetchAvatarViaBot(discordId);
  if (r.status === 'not_found') { notFound++; }
  else if (r.status === 'rate_limited') { rateLimited++; }
  else if (r.status === 'error') { errors++; }
  else if (r.status === 'ok') {
    if (r.url === data.discordAvatar) {
      unchanged++;
    } else {
      updated++;
      console.log(`  ${updated.toString().padStart(3)} ${data.displayName || doc.id}`);
      if (!DRY) await doc.ref.update({ discordAvatar: r.url });
    }
  }

  await sleep(150); // ~6-7 req/s, marge sous le rate-limit Discord
}

console.log(`\n${DRY ? '[DRY-RUN] ' : ''}Terminé.`);
console.log(`  users total          : ${total}`);
console.log(`  avec discordId       : ${withId}`);
console.log(`  ${DRY ? 'à mettre à jour    ' : 'mis à jour         '} : ${updated}`);
console.log(`  inchangés            : ${unchanged}`);
console.log(`  compte Discord absent: ${notFound}`);
console.log(`  rate-limited (skip)  : ${rateLimited}`);
console.log(`  erreurs              : ${errors}`);

process.exit(0);
