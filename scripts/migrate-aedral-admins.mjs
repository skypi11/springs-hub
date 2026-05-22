// Migration : sépare les admins d'Aedral de la collection `admins` partagée.
//
// Contexte — les deux repos (`springs-hub` / Aedral et `site cup monthly`)
// partagent le même projet Firebase `monthly-cup`. La collection `admins` y est
// donc commune : un admin du vieux site (ex. tournoi RL) devenait automatiquement
// admin sur Aedral. On veut une collection dédiée `aedral_admins` pilotée par
// Aedral seul.
//
// Ce que fait ce script : copie TOUS les docs de `admins` vers `aedral_admins`
// (Matt inclus → zéro risque de verrouillage). Idempotent — relançable sans
// danger. Ne supprime RIEN dans `admins` (le vieux site continue de l'utiliser).
//
// Le tri final (ne garder que Matt) se fait ENSUITE depuis /admin/users, une
// fois le code basculé sur `aedral_admins`.
//
// Run :
//   node --env-file=.env.local scripts/migrate-aedral-admins.mjs
// (ou simplement `node scripts/migrate-aedral-admins.mjs` — il charge .env.local)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
  if (!sa) {
    console.error('FIREBASE_SERVICE_ACCOUNT manquant dans l\'env (.env.local).');
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();

const sourceSnap = await db.collection('admins').get();
if (sourceSnap.empty) {
  console.error('⚠ La collection `admins` est vide — rien à migrer. Abandon par sécurité.');
  process.exit(1);
}

console.log(`Source : ${sourceSnap.size} admin(s) dans \`admins\`.\n`);

let copied = 0;
for (const doc of sourceSnap.docs) {
  // Nom lisible pour le log (best-effort).
  let label = doc.id;
  try {
    const userSnap = await db.collection('users').doc(doc.id).get();
    const u = userSnap.data();
    if (u?.displayName || u?.discordUsername) {
      label = `${u.displayName || u.discordUsername} (${doc.id})`;
    }
  } catch { /* best-effort */ }

  await db.collection('aedral_admins').doc(doc.id).set(
    {
      ...doc.data(),
      migratedFrom: 'admins',
      migratedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  copied++;
  console.log(`  ✓ ${label}`);
}

const targetSnap = await db.collection('aedral_admins').get();
console.log(`\n✓ ${copied} admin(s) copié(s). \`aedral_admins\` contient maintenant ${targetSnap.size} doc(s).`);
console.log('La collection `admins` est intacte (le vieux site continue de l\'utiliser).');
process.exit(0);
