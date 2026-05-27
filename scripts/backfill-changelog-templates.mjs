// Backfill one-shot pour les templates `announce_templates` existantes :
// - Set `publishOnSite: true` si absent (default = publié sur le site)
// - Set `category: 'feature'` si absent (default catégorie nouveauté)
// - Set `publishedAt: createdAt` si absent (sinon /changelog les exclurait)
//
// Run :
//   node scripts/backfill-changelog-templates.mjs
//
// Safe à re-run : ne touche que les champs absents.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

// dotenv conserve les \n littéraux dans private_key — JSON.parse les refuse.
// Fallback : on échappe les newlines dans private_key uniquement.
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

if (getApps().length === 0) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT manquant dans .env.local');
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(raw)) });
}

const db = getFirestore();

console.log('🔍 Scan announce_templates…');
const snap = await db.collection('announce_templates').get();
console.log(`✓ ${snap.size} templates trouvées.\n`);

let updated = 0;
let skipped = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  const updates = {};

  if (data.publishOnSite === undefined) {
    updates.publishOnSite = true;
  }
  if (data.category === undefined) {
    updates.category = 'feature';
  }
  if (!data.publishedAt && data.createdAt) {
    // Backfill publishedAt = createdAt pour que la timeline affiche les anciens patchs
    updates.publishedAt = data.createdAt;
  }

  if (Object.keys(updates).length === 0) {
    skipped++;
    console.log(`  ⏭️  ${data.label ?? doc.id} : déjà à jour`);
    continue;
  }

  await doc.ref.update(updates);
  updated++;
  console.log(`  ✓ ${data.label ?? doc.id} : ${Object.keys(updates).join(', ')}`);
}

console.log(`\n✅ ${updated} templates updated, ${skipped} déjà à jour.`);
process.exit(0);
