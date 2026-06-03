// Cleanup one-shot : purge les rangs Valorant DÉCLARÉS legacy.
//
// Contexte : avant le pivot "rang Valorant 100% auto", des users avaient pu
// saisir un rang Valorant manuellement (valorantRankSource === 'declared').
// Le nouveau modèle n'affiche QUE les rangs synchronisés (source 'henrikdev').
// Les rangs déclarés legacy ne s'affichent plus (gate côté code) mais persistent
// en base — ce script les efface à la racine pour qu'aucune surface ne puisse
// jamais les ré-exposer (defense-in-depth).
//
// Cible : tout doc users où valorantRank est non vide ET valorantRankSource
// !== 'henrikdev' (donc 'declared' ou absent). On efface valorantRank, valorantRR
// et valorantRankSource. Les comptes réellement synchronisés (henrikdev) ne sont
// JAMAIS touchés.
//
// Usage :
//   node --env-file=.env.local scripts/cleanup-valorant-declared-ranks.mjs          (dry-run, compte seulement)
//   node --env-file=.env.local scripts/cleanup-valorant-declared-ranks.mjs --apply  (applique)
//
// Idempotent : un 2e run ne trouve plus rien à purger.

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

if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.error('FIREBASE_SERVICE_ACCOUNT manquant.');
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();
const APPLY = process.argv.includes('--apply');

console.log(`▶ Cleanup rangs Valorant déclarés legacy (${APPLY ? 'APPLY' : 'DRY-RUN'})…`);

const snap = await db.collection('users').get();
const targets = [];
for (const d of snap.docs) {
  const data = d.data();
  const rank = typeof data.valorantRank === 'string' ? data.valorantRank.trim() : '';
  const source = data.valorantRankSource;
  // Non vide + source non vérifiée (declared ou absente) = à purger.
  if (rank && source !== 'henrikdev') {
    targets.push({ id: d.id, name: data.displayName || data.discordUsername || d.id, rank, source: source ?? '(absent)' });
  }
}

console.log(`  ${snap.size} users scannés, ${targets.length} rang(s) déclaré(s) legacy à purger.`);
for (const t of targets) {
  console.log(`   - ${t.name} (${t.id}) : ${t.rank} [source: ${t.source}]`);
}

if (!APPLY) {
  console.log('\nDRY-RUN terminé. Relance avec --apply pour purger.');
  process.exit(0);
}

if (targets.length === 0) {
  console.log('✓ Rien à purger.');
  process.exit(0);
}

const CHUNK = 400;
let done = 0;
for (let i = 0; i < targets.length; i += CHUNK) {
  const slice = targets.slice(i, i + CHUNK);
  const batch = db.batch();
  for (const t of slice) {
    batch.update(db.collection('users').doc(t.id), {
      valorantRank: FieldValue.delete(),
      valorantRR: FieldValue.delete(),
      valorantRankSource: FieldValue.delete(),
    });
  }
  await batch.commit();
  done += slice.length;
  console.log(`  → ${done}/${targets.length} purgés…`);
}

console.log(`✓ Cleanup terminé. ${done} rang(s) Valorant déclaré(s) legacy purgé(s).`);
process.exit(0);
