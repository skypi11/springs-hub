// Lot B : coupe le LFT (isAvailableForRecruitment) des joueurs déjà titulaires ou
// remplaçants d'une équipe — un joueur rostered n'est pas « looking for team ».
// One-shot d'alignement de l'existant ; la règle est ensuite tenue par le code
// (teams roster-add + garde-fou /api/profile).
//
// Usage : node --env-file=.env.local scripts/cleanup-rostered-lft.mjs [--dry-run]

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
const DRY = process.argv.includes('--dry-run');

// 1. Tous les joueurs rostered (titulaire/remplaçant) toutes équipes confondues.
const rostered = new Set();
for (const d of (await db.collection('sub_teams').get()).docs) {
  const t = d.data();
  for (const id of (t.playerIds ?? [])) rostered.add(id);
  for (const id of (t.subIds ?? [])) rostered.add(id);
}
console.log(`${rostered.size} joueurs rostered (titulaire/remplaçant).`);

// 2. Pour chacun, si LFT actif → couper.
let fixed = 0;
for (const uid of rostered) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) continue;
  if (snap.data().isAvailableForRecruitment === true) {
    console.log(`${DRY ? '[dry] ' : ''}LFT coupé : ${snap.data().displayName} (${uid})`);
    if (!DRY) await snap.ref.update({ isAvailableForRecruitment: false, recruitmentRole: '', recruitmentMessage: '' });
    fixed++;
  }
}
console.log('───────────────────────────────────────────────────────────');
console.log(`${DRY ? '[DRY RUN] ' : ''}Joueurs rostered + LFT corrigés : ${fixed}`);
process.exit(0);
