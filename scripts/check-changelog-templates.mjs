import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

function parseServiceAccount(raw) {
  try { return JSON.parse(raw); }
  catch {
    const fixed = raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`);
    return JSON.parse(fixed);
  }
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

const db = getFirestore();
const snap = await db.collection('announce_templates').get();

console.log(`Total: ${snap.size} templates\n`);
for (const doc of snap.docs) {
  const d = doc.data();
  console.log(`- ${d.label}`);
  console.log(`  publishOnSite: ${d.publishOnSite} | category: ${d.category} | publishedAt: ${d.publishedAt?.toDate?.()?.toISOString?.() ?? 'NULL'}`);
}

console.log('\n--- Query test (where publishOnSite==true orderBy publishedAt desc) ---');
try {
  const querySnap = await db.collection('announce_templates')
    .where('publishOnSite', '==', true)
    .orderBy('publishedAt', 'desc')
    .limit(100)
    .get();
  console.log(`Query result: ${querySnap.size} items`);
  for (const doc of querySnap.docs) {
    console.log(`  - ${doc.data().label}`);
  }
} catch (err) {
  console.error('Query failed:', err.message);
}
process.exit(0);
