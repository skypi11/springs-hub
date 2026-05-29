// Backfill : génère un `slug` public pour TOUTES les structures existantes qui
// n'en ont pas encore (créées avant l'introduction du système de slug pour les
// structures).
//
// Le slug remplace le Firestore docId dans les URLs publiques
// /community/structure/[slug] — pour des raisons d'UX (URLs lisibles,
// partageables, mémorisables) et d'alignement avec les autres pages publiques
// du site (cf. lib/user-slug.ts pour les profils joueurs, qui ont été slug-ifiés
// en premier — mémoire `project_profile_slugs`).
//
// Stratégie :
//   1. Charger toutes les structures (collection `structures`) — pas de filtre
//      sur `status`, on slug aussi les pending/suspended pour ne pas avoir à
//      re-run le script chaque fois qu'une structure passe active.
//   2. Pour chaque structure sans slug : générer baseSlug = kebab-case(name),
//      avec fallback sur `tag`, puis sur `structure-XXXX` en dernier recours.
//   3. Vérifier l'unicité contre les slugs déjà écrits dans la base + ceux
//      qu'on est en train de générer dans ce run (in-memory set).
//   4. Si collision : suffixer -2, -3, ..., -99 jusqu'à trouver un slug libre.
//      Au-delà (cas extrême), fallback sur un suffix random à 4 chiffres.
//   5. Écrire le doc avec `{ slug, updatedAt: serverTimestamp() }`.
//
// Idempotent : les structures qui ont déjà un slug valide sont skip. Peut être
// relancé sans risque.
//
// Usage :
//   node --env-file=.env.local scripts/backfill-structure-slugs.mjs
//   node --env-file=.env.local scripts/backfill-structure-slugs.mjs --dry-run
//
// IMPORTANT : à lancer UNE FOIS en prod après le déploiement du commit qui
// introduit le système de slug pour les structures. Sans backfill, les
// structures existantes n'auront pas d'URL slug et continueront à utiliser leur
// URL legacy /community/structure/{firestoreDocId} (fallback géré côté route).

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

const DRY_RUN = process.argv.includes('--dry-run');

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

// Doit rester aligné avec lib/structure-slug.ts. Pas d'import partagé car ce
// script tourne sous Node ESM et lib/structure-slug.ts est TS — on duplique la
// logique pour éviter une chaîne de build juste pour ça (même pattern que
// scripts/backfill-user-slugs.mjs).
const MIN_SLUG_LENGTH = 3;
const MAX_SLUG_LENGTH = 32;

// Slugs réservés : collision avec les routes Next.js de premier niveau dans
// /community/structure/[slug] (aucune sous-route à l'heure actuelle, mais on
// reste préventif pour les évolutions futures du dossier `app/community/`).
// On reprend aussi les noms de marque pour éviter qu'une structure squatte un
// slug protégé (`aedral`, `springs`).
const RESERVED_STRUCTURE_SLUGS = new Set([
  'admin', 'api', 'settings', 'community', 'competitions', 'profile',
  'guide', 'login', 'logout', 'auth', 'help', 'about', 'legal', 'privacy',
  'aedral', 'springs', 'null', 'undefined', 'system', 'bot', 'support',
  'new', 'create', 'edit', 'delete', 'manage', 'structure', 'structures',
  'team', 'teams', 'players', 'invite', 'join',
]);

function generateBaseStructureSlug(name) {
  const normalized = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents (ranges Unicode combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  if (normalized.length > MAX_SLUG_LENGTH) {
    return normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  }
  return normalized;
}

function isValidStructureSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false;
  if (RESERVED_STRUCTURE_SLUGS.has(slug)) return false;
  return true;
}

console.log(`▶ Backfill structure slugs ${DRY_RUN ? '(DRY RUN)' : ''}…`);

const structuresSnap = await db.collection('structures').get();
console.log(`  ${structuresSnap.size} structures trouvées`);

// 1. Cartographier les slugs déjà pris (pour ne pas en regénérer un identique
//    et alimenter le set in-memory utilisé pour les nouveaux slugs générés ici).
const takenSlugs = new Set();
let alreadyValid = 0;
let invalidExisting = 0;
for (const doc of structuresSnap.docs) {
  const slug = doc.data()?.slug;
  if (typeof slug === 'string' && slug) {
    if (isValidStructureSlug(slug)) {
      takenSlugs.add(slug);
      alreadyValid++;
    } else {
      // Slug présent mais invalide (manuellement édité, legacy d'une version
      // antérieure du regex…) : on log et on regénérera proprement.
      invalidExisting++;
      console.warn(`  ⚠ structure ${doc.id} a un slug invalide "${slug}" → sera regénéré`);
    }
  }
}
console.log(`  ${alreadyValid} structures déjà avec slug valide (skip)`);
if (invalidExisting > 0) {
  console.log(`  ${invalidExisting} structures avec slug invalide (à regénérer)`);
}
const toGenerate = structuresSnap.size - alreadyValid;
console.log(`  → ${toGenerate} structures à traiter\n`);

if (toGenerate === 0) {
  console.log('✅ Rien à faire, toutes les structures ont déjà un slug valide.');
  process.exit(0);
}

// 2. Pour chaque structure sans slug valide, en générer un unique
let generated = 0;
let skipped = 0;
let failed = 0;
const updates = []; // { docRef, slug, name } accumulés puis flush par batch

for (const doc of structuresSnap.docs) {
  const data = doc.data();
  const existingSlug = data?.slug;
  if (typeof existingSlug === 'string' && isValidStructureSlug(existingSlug)) {
    skipped++;
    continue;
  }

  // Source primaire : name. Fallbacks en cascade : tag → "structure-XXXX".
  const name = (data?.name || '').toString().trim();
  const tag = (data?.tag || '').toString().trim();
  let baseSlug = generateBaseStructureSlug(name);

  // Fallback 1 : nom vide ou produit un slug trop court → essayer le tag
  if (baseSlug.length < MIN_SLUG_LENGTH) {
    if (tag) {
      baseSlug = generateBaseStructureSlug(tag);
    }
  }
  // Fallback 2 : tag absent ou aussi trop court → "structure-XXXX"
  if (baseSlug.length < MIN_SLUG_LENGTH) {
    baseSlug = `structure-${Math.floor(Math.random() * 9000 + 1000)}`;
  }
  // Si baseSlug tombe pile sur un slug réservé, on suffixe -team pour s'en sortir
  if (RESERVED_STRUCTURE_SLUGS.has(baseSlug)) {
    baseSlug = `${baseSlug}-team`;
    if (baseSlug.length > MAX_SLUG_LENGTH) {
      baseSlug = baseSlug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
    }
  }

  // 3. Vérifier l'unicité contre takenSlugs (qui inclut les slugs déjà en base
  //    + ceux générés plus tôt dans ce run).
  let finalSlug = baseSlug;
  if (takenSlugs.has(finalSlug)) {
    let found = false;
    for (let i = 2; i <= 99; i++) {
      let candidate = `${baseSlug}-${i}`;
      if (candidate.length > MAX_SLUG_LENGTH) {
        const truncated = baseSlug
          .slice(0, MAX_SLUG_LENGTH - String(i).length - 1)
          .replace(/-+$/, '');
        candidate = `${truncated}-${i}`;
      }
      if (!takenSlugs.has(candidate)) {
        finalSlug = candidate;
        found = true;
        break;
      }
    }
    // Fallback ultra rare : suffix random 4 chiffres (10 tentatives)
    if (!found) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = Math.floor(Math.random() * 9000 + 1000);
        const truncBase = baseSlug.slice(0, MAX_SLUG_LENGTH - 5).replace(/-+$/, '');
        const candidate = `${truncBase}-${suffix}`;
        if (!takenSlugs.has(candidate)) {
          finalSlug = candidate;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      console.error(`  ❌ Impossible de générer un slug pour "${name || tag || doc.id}"`);
      failed++;
      continue;
    }
  }

  // Sanity check final — devrait toujours passer mais on protège la base
  if (!isValidStructureSlug(finalSlug)) {
    console.error(`  ❌ Slug généré invalide "${finalSlug}" pour ${doc.id} — skip`);
    failed++;
    continue;
  }

  takenSlugs.add(finalSlug);
  generated++;
  const label = (name || tag || '(sans nom)').padEnd(28).slice(0, 28);
  console.log(`  + ${label} → ${finalSlug}`);

  updates.push({ docRef: doc.ref, slug: finalSlug, name: name || tag || doc.id });
}

// 4. Flush les writes en batches de 400 (limite Firestore = 500 writes/batch,
//    on garde un margin de sécurité). Chaque écriture set { slug, updatedAt }.
if (!DRY_RUN && updates.length > 0) {
  console.log(`\n▶ Écriture de ${updates.length} slugs en batches de 400…`);
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const u of slice) {
      batch.update(u.docRef, {
        slug: u.slug,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      written += slice.length;
      console.log(`  → ${written}/${updates.length} écrits…`);
    } catch (err) {
      console.error(`  ❌ Échec batch [${i}..${i + slice.length - 1}]:`, err?.message || err);
      failed += slice.length;
    }
  }
}

console.log('\n✅ Terminé.');
console.log(`  ${generated} slugs ${DRY_RUN ? 'à générer (dry-run, rien écrit)' : 'générés et écrits'}`);
console.log(`  ${skipped} structures déjà avec slug valide (skip)`);
if (failed > 0) console.log(`  ⚠ ${failed} ÉCHECS (voir logs ci-dessus)`);
process.exit(failed > 0 ? 1 : 0);
