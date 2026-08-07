// Répare les profils qui ont un compte Ubisoft vérifié mais pas d'adresse
// trackmania.io.
//
// Ces joueurs — typiquement les inscrits de la LAN — étaient bloqués sur
// l'accueil par le formulaire de complétion de profil, et la synchronisation
// nocturne des trophées les ignorait : elle ne savait les retrouver que par ce
// champ. Le code ne dépend plus de cette copie (l'identifiant vérifié fait
// foi), mais la poser évite de laisser des profils à moitié remplis.
//
//   node --env-file=.env.local scripts/backfill-tm-io-url.mjs          (simulation)
//   node --env-file=.env.local scripts/backfill-tm-io-url.mjs --ecrire (pour de vrai)
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const ECRIRE = process.argv.includes('--ecrire');

const snap = await db.collection('users').where('tmAccountId', '!=', '').get();
let aReparer = 0;
let jeuAjoute = 0;

for (const doc of snap.docs) {
  const u = doc.data();
  const id = String(u.tmAccountId ?? '').trim();
  if (!id) continue;

  const patch = {};
  if (!String(u.tmIoUrl ?? '').trim()) {
    patch.tmIoUrl = `https://trackmania.io/#/player/${id}`;
    aReparer++;
  }
  // Un compte Ubisoft vérifié sans « trackmania » dans les jeux pratiqués :
  // le profil se déclare incomplet alors qu'il porte une identité de jeu.
  if (!Array.isArray(u.games) || !u.games.includes('trackmania')) {
    patch.games = FieldValue.arrayUnion('trackmania');
    jeuAjoute++;
  }
  if (!Object.keys(patch).length) continue;

  console.log(`${ECRIRE ? 'écrit' : 'à écrire'} · ${u.displayName ?? doc.id} :`,
    Object.keys(patch).join(', '));
  if (ECRIRE) await doc.ref.set(patch, { merge: true });
}

console.log(`\n${snap.size} comptes Ubisoft liés · ${aReparer} adresses à poser · ${jeuAjoute} jeux à ajouter`);
if (!ECRIRE) console.log('SIMULATION — relance avec --ecrire pour appliquer.');
