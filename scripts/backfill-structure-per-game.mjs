// Backfill : reconstruit `users.structurePerGame` au format ARRAY (max 2 par jeu)
// pour TOUS les users existants. Source de vérité : les liens user ↔ structure
// effectifs en base, agrégés depuis :
//   - founderId, coFounderIds, managerIds, coachIds de chaque structure (active + pending)
//   - structure_members docs
//
// Pourquoi : avant 2026-05-25 le champ structurePerGame[game] était une STRING
// (1 struct max par jeu). Le passage au cap "2 max par jeu" nécessite un array.
// Les nouveaux writes utilisent déjà le format array via lib/structure-membership.ts
// mais les anciens docs sont en format mixte. Ce script normalise tout.
//
// Usage : node --env-file=.env.local scripts/backfill-structure-per-game.mjs
//
// Idempotent : peut être relancé sans risque (overwrite avec la vraie valeur).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

function parseServiceAccount(raw) {
  if (raw.startsWith('{')) return JSON.parse(raw);
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
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
const ACTIVE_STATUSES = new Set(['active', 'pending_validation']);

console.log('▶ Backfill structurePerGame (array format)…');

// 1. Charger toutes les structures active + pending_validation
const structuresSnap = await db.collection('structures').get();
const structures = [];
for (const d of structuresSnap.docs) {
  const data = d.data();
  if (!ACTIVE_STATUSES.has(data.status)) continue;
  const games = Array.isArray(data.games) ? data.games : [];
  if (games.length === 0) continue;
  structures.push({
    id: d.id,
    games,
    founderId: data.founderId,
    coFounderIds: Array.isArray(data.coFounderIds) ? data.coFounderIds : [],
    managerIds: Array.isArray(data.managerIds) ? data.managerIds : [],
    coachIds: Array.isArray(data.coachIds) ? data.coachIds : [],
  });
}
console.log(`  ${structures.length} structures actives/pending chargées.`);

// 2. Charger tous les structure_members
const membersSnap = await db.collection('structure_members').get();
const memberships = [];
for (const d of membersSnap.docs) {
  const data = d.data();
  if (!data.userId || !data.game || !data.structureId) continue;
  memberships.push({
    userId: data.userId,
    game: data.game,
    structureId: data.structureId,
  });
}
console.log(`  ${memberships.length} structure_members chargés.`);

// 3. Reconstruire structurePerGame par user
const userToSpg = new Map(); // userId → { [game]: Set<structureId> }

function addLink(userId, game, structureId) {
  if (!userToSpg.has(userId)) userToSpg.set(userId, {});
  const spg = userToSpg.get(userId);
  if (!spg[game]) spg[game] = new Set();
  spg[game].add(structureId);
}

// Source A : structure_members
for (const m of memberships) {
  // Vérifier que la struct est active/pending
  if (!structures.find(s => s.id === m.structureId)) continue;
  addLink(m.userId, m.game, m.structureId);
}

// Source B : founderId + coFounderIds + managerIds + coachIds (pour chaque game)
for (const s of structures) {
  const allUsers = new Set([
    s.founderId,
    ...s.coFounderIds,
    ...s.managerIds,
    ...s.coachIds,
  ].filter(Boolean));
  for (const uid of allUsers) {
    for (const g of s.games) {
      addLink(uid, g, s.id);
    }
  }
}

console.log(`  ${userToSpg.size} users à mettre à jour.`);

// 4. Écrire dans Firestore par batch
const CHUNK = 400;
const userIds = Array.from(userToSpg.keys());
let warningsCap = 0;
let updated = 0;

for (let i = 0; i < userIds.length; i += CHUNK) {
  const slice = userIds.slice(i, i + CHUNK);
  const batch = db.batch();
  for (const uid of slice) {
    const spgSets = userToSpg.get(uid);
    const spg = {};
    for (const game of Object.keys(spgSets)) {
      const ids = Array.from(spgSets[game]);
      // Warning si un user a déjà > 2 structs sur un même jeu (état legacy
      // hérité — on garde tel quel sans tronquer pour ne pas casser, mais on
      // log pour qu'un humain audite).
      if (ids.length > 2) {
        warningsCap++;
        console.warn(`  ⚠ user ${uid} a ${ids.length} structures sur ${game} : ${ids.join(', ')}`);
      }
      spg[game] = ids;
    }
    batch.update(db.collection('users').doc(uid), { structurePerGame: spg });
  }
  await batch.commit();
  updated += slice.length;
  console.log(`  → ${updated}/${userIds.length} users updated…`);
}

console.log(`✓ Backfill terminé. ${updated} users updatés.`);
if (warningsCap > 0) {
  console.warn(`⚠ ${warningsCap} cas de cap dépassé (> 2 structures par jeu). À auditer manuellement — le code ne tronquera PAS automatiquement pour ne pas faire de mal aux données existantes.`);
}
process.exit(0);
