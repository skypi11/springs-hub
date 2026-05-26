// Backfill : génère un `slug` public pour TOUS les users existants qui n'en ont
// pas encore (créés avant l'introduction du système de slug 2026-05-26).
//
// Le slug remplace l'uid Discord (discord_SNOWFLAKE) dans les URLs publiques
// /profile/[slug] — pour éviter d'exposer le snowflake Discord qui permet
// d'être mentionné en raw <@id> dans n'importe quel guild commun.
//
// Stratégie :
//   1. Charger tous les users (collection `users`)
//   2. Pour chaque user sans slug : générer baseSlug = kebab-case(displayName)
//   3. Vérifier l'unicité contre les slugs déjà écrits dans la base + ceux
//      qu'on est en train de générer dans ce run (in-memory set)
//   4. Si collision : suffixer -2, -3, ..., -99 jusqu'à trouver un slug libre
//   5. Écrire le doc avec { slug }
//
// Idempotent : les users qui ont déjà un slug sont skip. Peut être relancé
// sans risque.
//
// Usage : node --env-file=.env.local scripts/backfill-user-slugs.mjs
//         node --env-file=.env.local scripts/backfill-user-slugs.mjs --dry-run
//
// IMPORTANT : à lancer UNE FOIS en prod après le déploiement du commit qui
// introduit le système de slug. Sans backfill, les users existants n'auront
// pas d'URL slug et continueront à utiliser leur URL legacy (fallback).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

const DRY_RUN = process.argv.includes('--dry-run');

function parseServiceAccount(raw) {
  if (!raw.trim().startsWith('{')) {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
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

if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.error('FIREBASE_SERVICE_ACCOUNT manquant.');
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();

// Doit rester aligné avec lib/user-slug.ts. Pas d'import partagé car ce
// script tourne sous Node ESM et lib/user-slug.ts est TS — on duplique la
// logique pour éviter une chaîne de build juste pour ça.
const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 32;
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'settings', 'community', 'competitions', 'profile',
  'guide', 'login', 'logout', 'auth', 'help', 'about', 'legal', 'privacy',
  'aedral', 'springs', 'null', 'undefined', 'system', 'bot', 'support',
  'discord', 'steam', 'epic',
]);

function generateBaseSlug(displayName) {
  const normalized = (displayName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  if (normalized.length > MAX_SLUG_LENGTH) {
    return normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  }
  return normalized;
}

console.log(`▶ Backfill user slugs ${DRY_RUN ? '(DRY RUN)' : ''}…`);

const usersSnap = await db.collection('users').get();
console.log(`  ${usersSnap.size} users trouvés`);

// 1. Cartographier les slugs déjà pris (pour ne pas en regénérer un identique)
const takenSlugs = new Set();
for (const doc of usersSnap.docs) {
  const slug = doc.data()?.slug;
  if (typeof slug === 'string' && slug) {
    takenSlugs.add(slug);
  }
}
console.log(`  ${takenSlugs.size} slugs déjà attribués (skip)`);

// 2. Pour chaque user sans slug, en générer un unique
let generated = 0;
let skipped = 0;
let failed = 0;
const writes = [];

for (const doc of usersSnap.docs) {
  const data = doc.data();
  if (typeof data?.slug === 'string' && data.slug) {
    skipped++;
    continue;
  }

  const displayName = data?.displayName || data?.discordUsername || '';
  let baseSlug = generateBaseSlug(displayName);
  if (baseSlug.length < MIN_SLUG_LENGTH) {
    // Fallback : "user-XXXX" si le displayName produit un slug trop court
    baseSlug = `user-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  if (RESERVED_SLUGS.has(baseSlug)) {
    baseSlug = `${baseSlug}-user`;
  }

  let finalSlug = baseSlug;
  if (takenSlugs.has(finalSlug)) {
    let found = false;
    for (let i = 2; i <= 99; i++) {
      let candidate = `${baseSlug}-${i}`;
      if (candidate.length > MAX_SLUG_LENGTH) {
        const truncated = baseSlug.slice(0, MAX_SLUG_LENGTH - String(i).length - 1).replace(/-+$/, '');
        candidate = `${truncated}-${i}`;
      }
      if (!takenSlugs.has(candidate)) {
        finalSlug = candidate;
        found = true;
        break;
      }
    }
    if (!found) {
      // Fallback rarissime : suffix random
      for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = Math.floor(Math.random() * 9000 + 1000);
        const candidate = `${baseSlug.slice(0, MAX_SLUG_LENGTH - 5)}-${suffix}`;
        if (!takenSlugs.has(candidate)) {
          finalSlug = candidate;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      console.error(`  ❌ Impossible de générer un slug pour "${displayName}" (uid: ${doc.id})`);
      failed++;
      continue;
    }
  }

  takenSlugs.add(finalSlug);
  generated++;
  console.log(`  + ${doc.id.slice(0, 30).padEnd(30)} → ${finalSlug}`);

  if (!DRY_RUN) {
    writes.push(doc.ref.update({ slug: finalSlug }));
  }
}

// 3. Flush les writes en parallèle (par batch de 50 pour ménager Firestore)
if (!DRY_RUN && writes.length > 0) {
  console.log(`\n▶ Écriture de ${writes.length} slugs…`);
  for (let i = 0; i < writes.length; i += 50) {
    const batch = writes.slice(i, i + 50);
    await Promise.all(batch);
  }
}

console.log('\n✅ Terminé.');
console.log(`  ${generated} slugs ${DRY_RUN ? 'à générer' : 'générés et écrits'}`);
console.log(`  ${skipped} users déjà avec slug (skip)`);
if (failed > 0) console.log(`  ${failed} ÉCHECS (voir logs ci-dessus)`);
process.exit(0);
