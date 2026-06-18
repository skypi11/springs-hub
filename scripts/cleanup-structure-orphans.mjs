// Nettoyage CHIRURGICAL des orphelins de structurePerGame laissés par le bug
// remove_member : pour CHAQUE user, on retire des structurePerGame[game] les
// structureIds qui ne correspondent à AUCUNE appartenance réelle (structure_members
// + rôles founder/staff sur structure active/pending). On ne touche à rien d'autre.
// Complète le backfill (qui ne réécrit que les users ayant ≥1 appartenance).
//
// Usage : node --env-file=.env.local scripts/cleanup-structure-orphans.mjs [--dry-run]

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
const ACTIVE = new Set(['active', 'pending_validation']);

// Vérité terrain (identique au scan)
const structuresSnap = await db.collection('structures').get();
const structs = new Map();
for (const d of structuresSnap.docs) {
  const data = d.data();
  if (!ACTIVE.has(data.status)) continue;
  structs.set(d.id, { games: Array.isArray(data.games) ? data.games : [],
    founderId: data.founderId, coFounderIds: data.coFounderIds ?? [], managerIds: data.managerIds ?? [], coachIds: data.coachIds ?? [] });
}
const truth = new Map();
const add = (uid, g, sid) => { if (!uid) return; const m = truth.get(uid) ?? {}; (m[g] ??= new Set()).add(sid); truth.set(uid, m); };
for (const d of (await db.collection('structure_members').get()).docs) { const m = d.data(); if (m.userId && m.game && structs.has(m.structureId)) add(m.userId, m.game, m.structureId); }
for (const [sid, s] of structs) for (const uid of [s.founderId, ...s.coFounderIds, ...s.managerIds, ...s.coachIds].filter(Boolean)) for (const g of s.games) add(uid, g, sid);

// Retrait chirurgical des ghosts
const usersSnap = await db.collection('users').get();
let fixed = 0;
for (const d of usersSnap.docs) {
  const spg = d.data().structurePerGame ?? {};
  const real = truth.get(d.id) ?? {};
  const updates = {};
  for (const g of Object.keys(spg)) {
    const declared = Array.isArray(spg[g]) ? spg[g] : (spg[g] ? [spg[g]] : []);
    const realIds = real[g] ? Array.from(real[g]) : [];
    const kept = declared.filter(id => realIds.includes(id));
    if (kept.length !== declared.length) {
      updates[`structurePerGame.${g}`] = kept.length === 0 ? FieldValue.delete() : kept;
      console.log(`${DRY ? '[dry] ' : ''}${d.data().displayName} (${d.id}) [${g}] ${JSON.stringify(declared)} → ${JSON.stringify(kept)}`);
    }
  }
  if (Object.keys(updates).length) {
    if (!DRY) await db.collection('users').doc(d.id).update(updates);
    fixed++;
  }
}
console.log('───────────────────────────────────────────────────────────');
console.log(`${DRY ? '[DRY RUN] ' : ''}Users nettoyés : ${fixed}`);
process.exit(0);
