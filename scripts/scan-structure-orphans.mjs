// READ-ONLY : scanne tous les users et compare leur `structurePerGame` à la
// vérité terrain (structure_members + rôles structure). Quantifie les orphelins
// laissés par le bug remove_member (structurePerGame qui garde une structure
// dont l'user n'est plus membre) et les entrées manquantes.
//
// Usage : node --env-file=.env.local scripts/scan-structure-orphans.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}
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
const ACTIVE = new Set(['active', 'pending_validation']);

// Vérité terrain
const structuresSnap = await db.collection('structures').get();
const structs = new Map();
for (const d of structuresSnap.docs) {
  const data = d.data();
  if (!ACTIVE.has(data.status)) continue;
  structs.set(d.id, { games: Array.isArray(data.games) ? data.games : [],
    founderId: data.founderId, coFounderIds: data.coFounderIds ?? [], managerIds: data.managerIds ?? [], coachIds: data.coachIds ?? [] });
}
const truth = new Map(); // uid -> { game -> Set(structureId) }
const add = (uid, g, sid) => { if (!uid) return; const m = truth.get(uid) ?? {}; (m[g] ??= new Set()).add(sid); truth.set(uid, m); };
const membersSnap = await db.collection('structure_members').get();
for (const d of membersSnap.docs) { const m = d.data(); if (m.userId && m.game && structs.has(m.structureId)) add(m.userId, m.game, m.structureId); }
for (const [sid, s] of structs) for (const uid of [s.founderId, ...s.coFounderIds, ...s.managerIds, ...s.coachIds].filter(Boolean)) for (const g of s.games) add(uid, g, sid);

// Diff vs structurePerGame déclaré
const usersSnap = await db.collection('users').get();
let usersWithGhosts = 0, totalGhosts = 0, usersWithMissing = 0;
for (const d of usersSnap.docs) {
  const spg = d.data().structurePerGame ?? {};
  const real = truth.get(d.id) ?? {};
  const ghostLines = [];
  for (const g of Object.keys(spg)) {
    const declared = Array.isArray(spg[g]) ? spg[g] : (spg[g] ? [spg[g]] : []);
    const realIds = Array.from(real[g] ?? []);
    const ghosts = declared.filter(id => !realIds.includes(id));
    if (ghosts.length) ghostLines.push(`[${g}] fantôme: ${ghosts.join(', ')}`);
  }
  const missingLines = [];
  for (const g of Object.keys(real)) {
    const declared = Array.isArray(spg[g]) ? spg[g] : (spg[g] ? [spg[g]] : []);
    const miss = Array.from(real[g]).filter(id => !declared.includes(id));
    if (miss.length) missingLines.push(`[${g}] manquant: ${miss.join(', ')}`);
  }
  if (ghostLines.length) { usersWithGhosts++; totalGhosts += ghostLines.length; console.log(`GHOST ${d.data().displayName} (${d.id}) → ${ghostLines.join(' ; ')}`); }
  if (missingLines.length) { usersWithMissing++; console.log(`MISS  ${d.data().displayName} (${d.id}) → ${missingLines.join(' ; ')}`); }
}
console.log('───────────────────────────────────────────────────────────');
console.log(`Users scannés : ${usersSnap.size}`);
console.log(`Users avec orphelins (fantômes) : ${usersWithGhosts} (${totalGhosts} entrées)`);
console.log(`Users avec entrées manquantes   : ${usersWithMissing}`);
process.exit(0);
