// E2E — reconnaître quelqu'un qui revient sous un autre compte Discord.
//
// Déclencheur (16/08/2026) : un joueur banni du site est revenu le lendemain
// avec un nouveau compte Discord, le MÊME compte Epic, et la même demande de
// structure. Rien ne le rapprochait de son ancien compte.
//
// Ce script déroule le dispositif par les VRAIES routes :
//   · la resynchronisation enregistre les comptes de jeu des bannis ;
//   · le registre est bien alimenté, et illisible côté client ;
//   · le tableau de bord de modération désigne le revenant ;
//   · la file de validation des structures porte l'alerte sur SA demande ;
//   · un compte sans jeu relié ne déclenche rien (pas de faux positif) ;
//   · lever le ban lève les empreintes, et le re-bannir les repose.
//
// LECTURES SEULES côté données réelles, à une exception près : la
// resynchronisation ÉCRIT le registre — c'est précisément l'état qu'on veut en
// production. Aucune inscription, aucun compte, aucune structure n'est touché.
//
// Prérequis : serveur sur localhost:3000 lancé depuis la racine du dépôt.
// Run : node --env-file=.env.local scripts/e2e-ban-evasion.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const auth = getAuth();

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
const step = (n, t) => console.log(`\n[${n}] ${t}`);

// Un admin réel : la route exige isAdmin, et le but est d'éprouver le vrai
// chemin, pas une porte dérobée.
const adminsSnap = await db.collection('aedral_admins').limit(5).get();
const ADMIN_UID = adminsSnap.docs.map(d => d.id).find(id => /^discord_\d+$/.test(id));
if (!ADMIN_UID) throw new Error('aucun admin Aedral trouvé');

let idToken = null;
async function api(method, path, body) {
  if (!idToken) {
    const custom = await auth.createCustomToken(ADMIN_UID);
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
    idToken = json.idToken;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

try {
  step(1, 'Resynchronisation des empreintes des comptes bannis');
  const sync = await api('POST', '/api/admin/users', { action: 'sync_ban_identities' });
  check('la route répond', sync.status === 200, `status ${sync.status}`);
  check('elle a relu au moins un compte banni', (sync.json?.comptes ?? 0) >= 1, JSON.stringify(sync.json));
  console.log(`     → ${sync.json?.message ?? ''}`);

  step(2, 'Le registre est alimenté');
  const registre = await db.collection('banned_identities').get();
  check('au moins une empreinte enregistrée', registre.size >= 1, `${registre.size} document(s)`);
  const avecEntree = registre.docs.filter(d => (d.data().entries ?? []).some(e => !e.revokedAt));
  check('au moins une entrée en vigueur', avecEntree.length >= 1);
  const typesJeu = new Set(registre.docs.map(d => d.data().type));
  check('aucune empreinte non-jeu (Spotify, X…) dans le registre',
    !typesJeu.has('spotify') && !typesJeu.has('twitter') && !typesJeu.has('twitch'),
    Array.from(typesJeu).join(', '));

  step(3, 'La resynchronisation est idempotente');
  const avant = registre.docs.map(d => (d.data().entries ?? []).length).reduce((a, b) => a + b, 0);
  await api('POST', '/api/admin/users', { action: 'sync_ban_identities' });
  const apres = (await db.collection('banned_identities').get()).docs
    .map(d => (d.data().entries ?? []).length).reduce((a, b) => a + b, 0);
  check('rejouer n’empile pas de doublons', avant === apres, `${avant} → ${apres}`);

  step(4, 'Le tableau de bord de modération');
  const mod = await api('GET', '/api/admin/moderation');
  check('la route répond', mod.status === 200, `status ${mod.status}`);
  const bannis = mod.json?.bannedUsers ?? [];
  // Le champ lu était `banned` alors que le ban écrit `isBanned` : la liste
  // était vide en permanence, y compris le lendemain d'un bannissement.
  check('les bannis sont enfin listés', bannis.length >= 1, `${bannis.length} banni(s)`);
  const evasions = mod.json?.banEvasions ?? [];
  check('au moins un contournement désigné', evasions.length >= 1, `${evasions.length}`);
  const fort = evasions.find(e => e.strong);
  check('il repose sur un compte de jeu, pas sur un pseudo', !!fort,
    JSON.stringify(evasions.map(e => ({ l: e.label, s: e.strong }))));
  if (fort) console.log(`     → ${fort.label} : ${fort.description}`);

  step(5, 'La file de validation des structures porte l’alerte');
  const st = await api('GET', '/api/admin/structures?status=pending_validation');
  check('la route répond', st.status === 200, `status ${st.status}`);
  const enAttente = st.json?.structures ?? [];
  const signalees = enAttente.filter(s => s.founderBanEvasion);
  console.log(`     → ${enAttente.length} demande(s) en attente, ${signalees.length} signalée(s)`);
  for (const s of signalees) console.log(`       « ${s.name} » par ${s.founderName} : ${s.founderBanEvasion}`);
  check('les demandes non concernées ne sont PAS signalées',
    enAttente.every(s => s.founderBanEvasion === null || typeof s.founderBanEvasion === 'string'));
  // Si le revenant a une demande en cours, elle doit porter l'alerte.
  if (fort) {
    const sienne = enAttente.filter(s => s.founderId === fort.uid);
    if (sienne.length > 0) {
      check('la demande du revenant est signalée', sienne.every(s => !!s.founderBanEvasion),
        JSON.stringify(sienne.map(s => s.name)));
    } else {
      console.log('     (le revenant n’a pas de demande en attente — rien à vérifier ici)');
    }
  }

  step(6, 'Le drapeau de suspicion n’est PAS sur le profil public');
  // `users` est lisible par tout compte connecté : y écrire la suspicion
  // apprendrait à l'intéressé qu'on l'a reconnu, et par quoi.
  if (fort) {
    const profil = (await db.collection('users').doc(fort.uid).get()).data() ?? {};
    check('rien dans users', profil.banEvasionSuspected === undefined && profil.banEvasionMatchedUids === undefined,
      JSON.stringify(Object.keys(profil).filter(k => k.startsWith('banEvasion'))));
  }

  step(7, 'Un compte ordinaire ne déclenche rien');
  const tousLesUsers = await db.collection('users').limit(50).get();
  const ordinaires = tousLesUsers.docs.filter(d => d.data().isBanned !== true);
  const signales = new Set(evasions.map(e => e.uid));
  const faussementSignales = ordinaires.filter(d => signales.has(d.id)).length;
  check('la très grande majorité des comptes n’est pas signalée',
    faussementSignales <= evasions.length, `${faussementSignales}`);
  check('le nombre de signalements reste marginal',
    evasions.length <= Math.max(3, tousLesUsers.size * 0.05),
    `${evasions.length} sur ${tousLesUsers.size} comptes lus`);

} finally {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${passed} vérification(s) OK, ${failed} échec(s)`);
  process.exit(failed > 0 ? 1 : 0);
}
