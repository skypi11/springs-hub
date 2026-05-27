// Crée/insère une template d'annonce dans Firestore via Admin SDK.
//
// Utilisé par :
// 1. Le seed initial (premier lancement après l'ajout de la feature)
// 2. Claude en fin de session : si des features user-visible ont été shippées
//    pendant la session, ajoute automatiquement une nouvelle template
//    "Patch notes — [date]" sans avoir besoin de redéployer.
//
// Run avec un payload JSON :
//   node --env-file=.env.local scripts/add-announce-template.mjs '<JSON>'
//
// Le JSON doit contenir :
//   { label, title, description, color, defaultChannelHint?, key? }
//
// Exemple :
//   node --env-file=.env.local scripts/add-announce-template.mjs '{
//     "label": "Patch notes — Mai 2026",
//     "title": "📢 Nouveautés Aedral — Mai 2026",
//     "description": "...",
//     "color": 16758784,
//     "defaultChannelHint": "annonces"
//   }'

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

// Charge .env.local manuellement — Node's --env-file parse mal les valeurs
// JSON multi-lignes comme FIREBASE_SERVICE_ACCOUNT qui contient des \n
// dans la private_key. On utilise dotenv (déjà dans node_modules via Next).
if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

// Accepte soit `--file <path>` (recommandé pour les gros payloads multi-lignes),
// soit un JSON inline en argument.
const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');
let raw = '';
if (fileIdx >= 0) {
  const filePath = args[fileIdx + 1];
  if (!filePath) {
    console.error('--file requiert un chemin de fichier.');
    process.exit(1);
  }
  raw = readFileSync(filePath, 'utf8');
} else {
  raw = args[0] ?? '';
}
if (!raw) {
  console.error('Payload JSON requis (--file <path> ou JSON inline). Voir commentaire script.');
  process.exit(1);
}

// Strip BOM UTF-8 si présent (Windows ajoute souvent 0xEF 0xBB 0xBF en tête)
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

let payload;
try {
  payload = JSON.parse(raw);
} catch (err) {
  console.error('JSON invalide :', err.message);
  process.exit(1);
}

const {
  label,
  title = '',
  description,
  color = 0xFFB800,
  defaultChannelHint = null,
  key,
  // Publication sur la page /changelog (timeline publique).
  // Default true : aligné sur le comportement de l'API admin pour qu'un script
  // Claude qui ajoute des patch notes les rende immédiatement visibles sur le site.
  publishOnSite = true,
  // Catégorie principale (override admin). Si non fournie, l'auto-tag par emoji
  // dans la description fera son boulot côté /changelog. 'feature' = défaut sûr.
  category = 'feature',
} = payload;

if (!label?.trim()) {
  console.error('Champ "label" requis.');
  process.exit(1);
}
if (!description?.trim()) {
  console.error('Champ "description" requis.');
  process.exit(1);
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `template-${Date.now()}`;
}

const finalKey = key ? slugify(key) : slugify(label);

// Init Admin SDK
function parseServiceAccount(raw) {
  // dotenv conserve les \n littéraux dans private_key — JSON.parse les refuse
  // (control characters interdits dans string literal). Fallback : on échappe
  // les newlines dans la valeur de "private_key" uniquement.
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
    console.error('FIREBASE_SERVICE_ACCOUNT manquant dans l\'env (charge .env.local d\'abord).');
    process.exit(1);
  }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();

// Si une template avec le même key existe déjà, on update au lieu de dupliquer
const existingSnap = await db.collection('announce_templates').where('key', '==', finalKey).limit(1).get();

if (!existingSnap.empty) {
  const doc = existingSnap.docs[0];
  const existingData = doc.data();
  const updates = {
    label,
    title,
    description,
    color,
    defaultChannelHint,
    publishOnSite,
    category,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Si on publie sur le site et que la template n'avait pas encore de publishedAt
  // (jamais publiée auparavant), on le set maintenant. Sinon on garde la date
  // historique pour ne pas faire remonter d'anciennes templates en tête de timeline.
  if (publishOnSite && !existingData.publishedAt) {
    updates.publishedAt = FieldValue.serverTimestamp();
  }
  await doc.ref.update(updates);
  console.log(`✓ Template mise à jour (existait déjà) : ${doc.id}`);
  console.log(`  key: ${finalKey}`);
  console.log(`  label: ${label}`);
} else {
  const newDoc = await db.collection('announce_templates').add({
    key: finalKey,
    label,
    title,
    description,
    color,
    defaultChannelHint,
    publishOnSite,
    category,
    // publishedAt = serverTimestamp si publié sur le site, sinon null (peut
    // être set plus tard via PUT admin si on toggle publishOnSite à true).
    publishedAt: publishOnSite ? FieldValue.serverTimestamp() : null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'system',
  });
  console.log(`✓ Template créée : ${newDoc.id}`);
  console.log(`  key: ${finalKey}`);
  console.log(`  label: ${label}`);
}

process.exit(0);
