// Rend les deux formats de l'affiche de résultat d'un match, en fichiers, pour
// les JUGER À L'ŒIL avant de déployer.
//
// L'affiche est une image générée par satori : ni tsc ni les tests ne disent
// quoi que ce soit de sa composition. La seule vérification qui vaille est de
// la regarder — et la regarder en local évite un aller-retour de déploiement
// par itération.
//
// Run : node --env-file=.env.local scripts/render-poster.mjs [competitionId] [dossier]
//       (par défaut : la compétition de démonstration, sortie dans ./tmp)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';

const COMP = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'demo_bot-qualif';
const OUT = process.argv[3] || 'tmp';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const snap = await db.collection('competition_matches').where('competitionId', '==', COMP).get();
const done = snap.docs
  .map(d => ({ key: d.id.split('__')[1], ...d.data() }))
  .filter(m => m.winner && m.teamA && m.teamB)
  .sort((a, b) => (b.round ?? 0) - (a.round ?? 0));

if (!done.length) {
  console.log(`Aucun match terminé sur ${COMP}.`);
  process.exit(1);
}
console.log(`${done.length} match(s) terminé(s) sur ${COMP}`);

// Un match joué au score plutôt qu'un forfait : c'est la composition la plus
// chargée (le détail des manches), donc celle qui casse en premier.
const target = done.find(m => !m.forfeit && Array.isArray(m.scores?.final) && m.scores.final.length >= 2) || done[0];
console.log(`→ ${target.key} (${target.bracket} R${target.round}, BO${target.bo})`);

fs.mkdirSync(OUT, { recursive: true });
for (const [suffix, qs] of [['wide', ''], ['square', '?format=square']]) {
  const url = `${BASE}/api/og/competition/${COMP}/match/${target.key}${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`  ✗ ${suffix}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `${OUT}/affiche-${suffix}.png`;
  fs.writeFileSync(file, buf);
  console.log(`  ${file} (${(buf.length / 1024).toFixed(0)} Ko)`);
}
console.log(`\nURL : ${BASE}/api/og/competition/${COMP}/match/${target.key}`);
