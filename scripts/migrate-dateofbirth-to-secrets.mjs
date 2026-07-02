// Backfill : déplace users.dateOfBirth → user_secrets.dateOfBirth pour tous
// les utilisateurs, pose le flag users.hasDateOfBirth et supprime la copie
// legacy du doc users (lisible par tout connecté — donnée de mineurs, RGPD).
// Contexte : Lot 0 Legends Cup, docs/legends-cup-architecture.md §2.
//
// ⚠️ À lancer UNIQUEMENT après le merge/deploy du code qui lit user_secrets
// (fallback legacy inclus) — sinon la prod perd l'affichage de l'âge.
//
// Usage :
//   node scripts/migrate-dateofbirth-to-secrets.mjs --dry-run   (inventaire seul)
//   node scripts/migrate-dateofbirth-to-secrets.mjs             (exécute)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

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

if (!getApps().length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.error("FIREBASE_SERVICE_ACCOUNT manquant dans l'env (.env.local).");
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const DRY_RUN = process.argv.includes('--dry-run');
const db = getFirestore();

const usersSnap = await db.collection('users').get();
console.log(`${usersSnap.size} users — ${DRY_RUN ? 'DRY RUN (aucune écriture)' : 'MIGRATION'}`);

let toMigrate = 0;
let flagOnly = 0;
let skipped = 0;

for (const doc of usersSnap.docs) {
  const data = doc.data();
  const dob = typeof data.dateOfBirth === 'string' ? data.dateOfBirth.trim() : '';

  if (!dob) {
    // Pas de date sur users : soit jamais renseignée, soit déjà migrée par un
    // save récent (POST /api/profile pose le flag + delete). Rien à faire.
    skipped++;
    continue;
  }

  const isFlagOnly = data.hasDateOfBirth === true;
  if (isFlagOnly) flagOnly++; else toMigrate++;
  console.log(`  • ${doc.id} — dateOfBirth présent sur users${isFlagOnly ? ' (flag déjà posé)' : ''}`);

  if (DRY_RUN) continue;

  // Copie vers user_secrets AVANT le delete (jamais l'inverse). On n'écrase
  // pas une date déjà posée dans user_secrets par un save post-deploy : le
  // save API est plus récent que la copie legacy.
  const secretRef = db.collection('user_secrets').doc(doc.id);
  const secretSnap = await secretRef.get();
  if (!secretSnap.data()?.dateOfBirth) {
    await secretRef.set({ dateOfBirth: dob }, { merge: true });
  }
  await doc.ref.update({
    hasDateOfBirth: true,
    dateOfBirth: FieldValue.delete(),
  });
}

console.log(`\nBilan : ${toMigrate + flagOnly} avec copie legacy sur users (dont ${flagOnly} flag déjà posé), ${skipped} sans date sur users.`);
if (DRY_RUN) {
  console.log('DRY RUN terminé — relancer sans --dry-run pour exécuter.');
} else {
  console.log('✅ Migration terminée : plus aucune dateOfBirth sur les docs users listés.');
}
