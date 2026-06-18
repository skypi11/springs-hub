// Diagnostic READ-ONLY d'un joueur : compare son `structurePerGame` à la vérité
// terrain (structure_members + rôles structure + appartenance aux sub_teams) et
// affiche son statut LFT. Sert à confirmer le bug d'orphelins remove_member et
// l'incohérence "LFT alors qu'il est en équipe".
//
// Usage : node --env-file=.env.local scripts/diagnose-player.mjs <slug-ou-pseudo>

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant.'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();
const needle = (process.argv[2] || 'kmeyeur').toLowerCase();
const ACTIVE = new Set(['active', 'pending_validation']);

// 1. Trouver le user
let userDoc = null;
const bySlug = await db.collection('users').where('slug', '==', needle).limit(1).get();
if (!bySlug.empty) {
  userDoc = bySlug.docs[0];
} else {
  // Fallback : scan (collection raisonnable) sur slug/displayName/discordUsername
  const all = await db.collection('users').get();
  userDoc = all.docs.find(d => {
    const u = d.data();
    return [u.slug, u.displayName, u.discordUsername].some(
      v => typeof v === 'string' && v.toLowerCase().includes(needle),
    );
  }) || null;
}

if (!userDoc) { console.error(`Aucun user trouvé pour "${needle}".`); process.exit(1); }

const uid = userDoc.id;
const u = userDoc.data();
console.log('═══════════════════════════════════════════════════════════');
console.log(`USER : ${u.displayName} (slug=${u.slug}, uid=${uid})`);
console.log('───────────────────────────────────────────────────────────');
console.log('games               :', JSON.stringify(u.games ?? []));
console.log('isAvailableForRecruitment :', u.isAvailableForRecruitment);
console.log('recruitmentRole     :', u.recruitmentRole ?? '(vide)');
console.log('structurePerGame    :', JSON.stringify(u.structurePerGame ?? {}));
console.log('');

// 2. Vérité terrain : structure_members
const membersSnap = await db.collection('structure_members').where('userId', '==', uid).get();
console.log(`structure_members (${membersSnap.size}) :`);
const realByGame = {}; // game -> Set(structureId)
for (const d of membersSnap.docs) {
  const m = d.data();
  const sSnap = await db.collection('structures').doc(m.structureId).get();
  const sName = sSnap.exists ? sSnap.data().name : '(structure supprimée)';
  const sStatus = sSnap.exists ? sSnap.data().status : '?';
  const counted = ACTIVE.has(sStatus);
  if (counted) {
    (realByGame[m.game] ??= new Set()).add(m.structureId);
  }
  console.log(`  - [${m.game}] ${sName} (${m.structureId}) · role=${m.role} · status=${sStatus}${counted ? '' : ' · NON compté (archived/suspended)'}`);
}
console.log('');

// 3. Rôles structure (founder/cofounder/manager/coach) — comptent aussi dans le cap
const roleStructs = [];
const founderSnap = await db.collection('structures').where('founderId', '==', uid).get();
for (const d of founderSnap.docs) roleStructs.push({ id: d.id, data: d.data(), role: 'fondateur' });
for (const field of ['coFounderIds', 'managerIds', 'coachIds']) {
  const snap = await db.collection('structures').where(field, 'array-contains', uid).get();
  for (const d of snap.docs) roleStructs.push({ id: d.id, data: d.data(), role: field });
}
if (roleStructs.length) {
  console.log('Rôles structure (founder/staff) :');
  for (const r of roleStructs) {
    const counted = ACTIVE.has(r.data.status);
    const games = Array.isArray(r.data.games) ? r.data.games : [];
    if (counted) for (const g of games) (realByGame[g] ??= new Set()).add(r.id);
    console.log(`  - ${r.data.name} (${r.id}) · ${r.role} · games=${JSON.stringify(games)} · status=${r.data.status}`);
  }
  console.log('');
}

// 4. Appartenance aux équipes (sub_teams) — joueur (titulaire/remplaçant) vs staff
console.log('Équipes (sub_teams) :');
let teamPlayerCount = 0;
for (const field of ['playerIds', 'subIds', 'staffIds']) {
  const snap = await db.collection('sub_teams').where(field, 'array-contains', uid).get();
  for (const d of snap.docs) {
    const t = d.data();
    const asPlayer = field === 'playerIds' || field === 'subIds';
    if (asPlayer) teamPlayerCount++;
    console.log(`  - "${t.name}" [${t.game}] (struct ${t.structureId}) · en tant que ${field === 'playerIds' ? 'TITULAIRE' : field === 'subIds' ? 'REMPLAÇANT' : 'STAFF'}`);
  }
}
if (teamPlayerCount === 0) console.log('  (aucune équipe en tant que joueur)');
console.log('');

// 5. Comparaison orphelins : structurePerGame vs vérité terrain
console.log('═══ DIAGNOSTIC ═══');
const spg = u.structurePerGame ?? {};
let orphans = 0;
for (const game of Object.keys(spg)) {
  const declared = Array.isArray(spg[game]) ? spg[game] : (spg[game] ? [spg[game]] : []);
  const real = Array.from(realByGame[game] ?? []);
  const ghosts = declared.filter(id => !real.includes(id));
  const missing = real.filter(id => !declared.includes(id));
  console.log(`[${game}] structurePerGame=${JSON.stringify(declared)} | réel=${JSON.stringify(real)}`);
  if (ghosts.length) { orphans += ghosts.length; console.log(`   ⚠ ORPHELINS (dans structurePerGame mais plus membre) : ${ghosts.join(', ')}`); }
  if (missing.length) console.log(`   ⚠ MANQUANTS (membre mais absent de structurePerGame) : ${missing.join(', ')}`);
}
console.log('');
console.log(`LFT actif : ${u.isAvailableForRecruitment} · joueur dans ${teamPlayerCount} équipe(s) (titulaire/remplaçant)`);
if (u.isAvailableForRecruitment && teamPlayerCount > 0) {
  console.log('   ⚠ INCOHÉRENCE : LFT actif alors que déjà titulaire/remplaçant d\'une équipe.');
}
console.log(`Total orphelins détectés : ${orphans}`);
process.exit(0);
