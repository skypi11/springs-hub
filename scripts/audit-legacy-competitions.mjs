// Audit READ-ONLY des collections `competitions` et `competition_registrations`
// avant la bascule vers le nouveau schéma du moteur de compétitions (Lot 0,
// docs/legends-cup-architecture.md §1.7) : inventaire des éventuels docs legacy
// en prod + vérification du plan de facturation (Blaze requis, archi §8).
//
// Usage : node scripts/audit-legacy-competitions.mjs
// N'écrit RIEN. La purge éventuelle est un script séparé, lancé après décision.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
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

const rawSa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawSa) {
  console.error("FIREBASE_SERVICE_ACCOUNT manquant dans l'env (.env.local).");
  process.exit(1);
}
const serviceAccount = parseServiceAccount(rawSa);

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

function fmtDate(v) {
  if (!v) return '—';
  if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
  return String(v);
}

async function auditCollection(name, describe) {
  const snap = await db.collection(name).get();
  console.log(`\n── ${name} : ${snap.size} doc(s) ──`);
  for (const doc of snap.docs) {
    console.log(`  • ${doc.id} → ${describe(doc.data())}`);
  }
  return snap.size;
}

async function checkBillingPlan(projectId) {
  console.log('\n── Plan de facturation ──');
  try {
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-billing.readonly'],
    });
    const client = await auth.getClient();
    const res = await client.request({
      url: `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
    });
    const enabled = res.data?.billingEnabled === true;
    console.log(`  billingEnabled: ${enabled} (${res.data?.billingAccountName || 'aucun compte'})`);
    console.log(enabled
      ? '  ✅ Projet en plan Blaze (facturation active) — quota reads OK pour le temps réel.'
      : '  ❌ Projet en plan SPARK — quota 50k reads/jour, BLOQUANT pour le tournoi (archi §8).');
    return enabled;
  } catch (err) {
    console.log(`  ⚠️ Impossible de lire le billing via l'API (${err.response?.status || err.message}).`);
    console.log('  → Vérifier manuellement : https://console.firebase.google.com/project/monthly-cup/usage/details');
    return null;
  }
}

const total =
  (await auditCollection('competitions', d =>
    `name="${d.name ?? '?'}" game=${d.game ?? '?'} status=${d.status ?? '?'} createdAt=${fmtDate(d.createdAt)}`)) +
  (await auditCollection('competition_registrations', d =>
    `competitionId=${d.competitionId ?? '?'} userId=${d.userId ?? '?'} type=${d.type ?? '?'} status=${d.status ?? '?'}`));

await checkBillingPlan(serviceAccount.project_id || 'monthly-cup');

console.log(`\nTotal docs legacy : ${total}`);
console.log(total === 0
  ? '✅ Collections vides — bascule du schéma sans purge nécessaire.'
  : '⚠️ Docs legacy présents — décider purge/migration avant le premier write du nouveau schéma.');
