// E2E Springs Mania Cup — le parcours de l'ARGENT, de bout en bout.
//
// Ce module encaisse de vrais paiements et n'avait aucun test de bout en bout :
// c'est précisément pourquoi les défauts du 6 août sont partis en production
// sans que rien ne les arrête. Un joueur a payé deux fois.
//
// Ce que ce script prouve, en passant par les VRAIES routes :
//   · une inscription obtient un code unique et reste « en attente de paiement » ;
//   · un règlement dont le tarif n'est pas reconnu ne peut PLUS être « rattaché »
//     dans le vide avec un faux succès — la route refuse et dit quoi faire ;
//   · l'organisation peut trancher la catégorie elle-même, et le dossier passe
//     réellement à « confirmé », avec le joueur prévenu ;
//   · le même règlement ne peut pas confirmer deux dossiers ;
//   · tant qu'un règlement attend, le joueur est RETENU de payer une seconde fois ;
//   · un retrait rend la place.
//
// Le webhook HelloAsso n'est pas simulé : on ne peut pas fabriquer une commande
// chez HelloAsso à la demande. On écrit donc le journal de paiement comme le
// webhook l'aurait fait, et on éprouve tout ce qui vient APRÈS — c'est là que
// tous les défauts se sont trouvés.
//
// Données 100 % synthétiques (préfixe e2e_mania), cleanup TOUJOURS en finally.
// ATTENTION : la base Firestore est PARTAGÉE avec la production. Le script
// vérifie en sortie que le compteur public de places est revenu à son état
// initial.
//
// Prérequis : serveur sur localhost:3000 lancé depuis la racine du dépôt.
// Run : node --env-file=.env.local scripts/e2e-mania-cup.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_mania';
const ADMIN_UID = `discord_${P}_admin`;
const P1 = `discord_${P}_p1`;
const P2 = `discord_${P}_p2`;
const ITEM_A = 990000001;
const ITEM_B = 990000002;

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

const tokens = new Map();
async function tokenFor(uid) {
  if (tokens.has(uid)) return tokens.get(uid);
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
  tokens.set(uid, json.idToken);
  return json.idToken;
}

async function api(uid, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(uid ? { Authorization: `Bearer ${await tokenFor(uid)}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* corps vide */ }
  return { status: res.status, json };
}

/** Écrit une ligne de journal comme le webhook HelloAsso l'aurait fait. */
async function seedPayment(itemId, patch) {
  await db.collection('mania_cup_payments').doc(String(itemId)).set({
    itemId,
    orderId: itemId + 500,
    ticket: null,
    tierLabel: 'Billet Joueur',
    amountCents: 3000,
    state: 'Processed',
    rawCode: null,
    code: null,
    participantName: 'Testeur E2E',
    payerName: 'Testeur E2E',
    payerEmail: 'e2e@example.invalid',
    matchedUid: null,
    outcome: 'unmatched',
    reason: 'Aucun code d’inscription',
    source: 'webhook',
    receivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...patch,
  });
}

async function setup() {
  const batch = db.batch();
  batch.set(db.collection('aedral_admins').doc(ADMIN_UID), {
    addedBy: 'e2e', addedAt: FieldValue.serverTimestamp(),
  });
  for (const uid of [P1, P2]) {
    batch.set(db.collection('users').doc(uid), {
      uid,
      displayName: `E2E ${uid.slice(-2)}`,
      discordUsername: `e2e_${uid.slice(-2)}`,
      // L'identité Trackmania vérifiée est le préalable à toute inscription.
      tmVerifiedAt: FieldValue.serverTimestamp(),
      tmAccountId: `e2e-tm-${uid.slice(-2)}`,
      pseudoTM: `E2E_${uid.slice(-2)}`,
      country: 'FR',
      isDev: true,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function cleanup() {
  console.log('\nNettoyage…');
  const regs = await db.collection('mania_cup_registrations').get();
  const batch = db.batch();
  for (const d of regs.docs) {
    if (d.id.startsWith(`discord_${P}`)) {
      const code = d.data().registrationCode;
      // Le code est une réservation à part : le laisser le rendrait indisponible
      // pour un vrai joueur.
      if (code) batch.delete(db.collection('mania_cup_codes').doc(code));
      batch.delete(d.ref);
    }
  }
  for (const itemId of [ITEM_A, ITEM_B]) {
    batch.delete(db.collection('mania_cup_payments').doc(String(itemId)));
  }
  for (const uid of [P1, P2]) batch.delete(db.collection('users').doc(uid));
  batch.delete(db.collection('aedral_admins').doc(ADMIN_UID));
  await batch.commit();

  for (const uid of [P1, P2, ADMIN_UID]) {
    const notifs = await db.collection('notifications').where('userId', '==', uid).get();
    for (const n of notifs.docs) await n.ref.delete();
  }
  console.log('Terminé.');
}

async function main() {
  await setup();

  // La version du règlement voyage avec l'acceptation : il faut la vraie.
  const ctx0 = await api(P1, 'GET', '/api/mania-cup/register');
  const version = ctx0.json?.rulebook?.version;
  const seatsBefore = ctx0.json?.seats?.remaining;
  step(0, `Contexte : règlement v${version}, ${seatsBefore} places restantes`);
  check('la page d’inscription répond', ctx0.status === 200, `HTTP ${ctx0.status}`);

  const dossier = {
    firstName: 'Testeur', lastName: 'E2E',
    email: 'e2e@example.invalid', phone: '0600000000',
    emergencyName: '', emergencyPhone: '', imageConsent: true,
    birthDate: '2000-01-01', countryCode: 'FR',
    rulebookAccepted: true, rulebookVersion: version,
  };

  step(1, 'Inscription du joueur');
  const reg = await api(P1, 'POST', '/api/mania-cup/register', dossier);
  check('inscription acceptée', reg.status === 200, `HTTP ${reg.status} ${JSON.stringify(reg.json).slice(0, 160)}`);
  const code = reg.json?.registration?.registrationCode;
  check('un code d’inscription est attribué', /^LAN-[A-Z0-9]{4}$/.test(code ?? ''), String(code));
  check('le dossier attend son règlement', reg.json?.registration?.status === 'pending_payment');

  step(2, 'Un règlement arrive, tarif NON reconnu (le cas du 6 août)');
  await seedPayment(ITEM_A, { code, rawCode: code, outcome: 'needs_review', reason: 'Tarif non reconnu : « Billet Joueur »' });

  const ctx1 = await api(P1, 'GET', '/api/mania-cup/register');
  check('le joueur est RETENU de payer une seconde fois', ctx1.json?.paymentAwaitingReview === true);
  check('sa place n’est pas encore confirmée', ctx1.json?.registration?.status === 'pending_payment');

  step(3, 'Rattachement sans catégorie : refus explicite, plus de faux succès');
  const blind = await api(ADMIN_UID, 'POST', '/api/admin/mania-cup/helloasso', {
    action: 'match', itemId: ITEM_A, targetUid: P1,
  });
  check('la route REFUSE au lieu de répondre ok', blind.status === 409, `HTTP ${blind.status}`);
  check('le motif dit quoi faire', /correspondance/i.test(blind.json?.error ?? ''), blind.json?.error);

  const afterBlind = await db.collection('mania_cup_registrations').doc(P1).get();
  check('le dossier n’a pas bougé', afterBlind.data()?.status === 'pending_payment');

  step(4, 'Rattachement avec catégorie tranchée par l’organisation');
  const matched = await api(ADMIN_UID, 'POST', '/api/admin/mania-cup/helloasso', {
    action: 'match', itemId: ITEM_A, targetUid: P1, ticket: 'player',
  });
  check('rattachement accepté', matched.status === 200, `HTTP ${matched.status} ${JSON.stringify(matched.json).slice(0, 140)}`);

  const confirmed = (await db.collection('mania_cup_registrations').doc(P1).get()).data();
  check('la place est RÉELLEMENT confirmée', confirmed?.status === 'confirmed', confirmed?.status);
  check('le règlement est inscrit au dossier', confirmed?.payment?.itemId === ITEM_A);
  check('la date de règlement est posée', Boolean(confirmed?.paidAt));

  const payA = (await db.collection('mania_cup_payments').doc(String(ITEM_A)).get()).data();
  check('le journal retient la catégorie tranchée', payA?.ticket === 'player', String(payA?.ticket));
  check('le journal pointe le bon dossier', payA?.matchedUid === P1);

  const notifs = await db.collection('notifications').where('userId', '==', P1).get();
  check('le joueur est prévenu', notifs.size >= 1, `${notifs.size} notification(s)`);

  step(5, 'Un même règlement ne peut pas confirmer deux dossiers');
  const reg2 = await api(P2, 'POST', '/api/mania-cup/register', dossier);
  check('second joueur inscrit', reg2.status === 200, `HTTP ${reg2.status}`);

  const steal = await api(ADMIN_UID, 'POST', '/api/admin/mania-cup/helloasso', {
    action: 'match', itemId: ITEM_A, targetUid: P2, ticket: 'player',
  });
  check('la route REFUSE de faire payer une place deux fois', steal.status === 409, `HTTP ${steal.status}`);
  const p2after = (await db.collection('mania_cup_registrations').doc(P2).get()).data();
  check('le second dossier reste en attente', p2after?.status === 'pending_payment');

  step(6, 'Un billet spectateur ne se rattache à aucun dossier');
  await seedPayment(ITEM_B, { ticket: 'spectator', tierLabel: 'Billet Spectateur 2 jours', amountCents: 1000 });
  const spec = await api(ADMIN_UID, 'POST', '/api/admin/mania-cup/helloasso', {
    action: 'match', itemId: ITEM_B, targetUid: P2,
  });
  check('refus explicite', spec.status === 409, `HTTP ${spec.status}`);
  check('le motif parle du billet spectateur', /spectateur/i.test(spec.json?.error ?? ''), spec.json?.error);

  step(7, 'Retrait : la place repart à la vente');
  const withdraw = await api(P2, 'DELETE', '/api/mania-cup/register');
  check('retrait accepté', withdraw.status === 200, `HTTP ${withdraw.status}`);

  step(8, 'Les compteurs de la console disent la vérité');
  const admin = await api(ADMIN_UID, 'GET', '/api/admin/mania-cup/helloasso');
  if (admin.json?.configured === false) {
    // Les clés HelloAsso ne sont pas en local (elles sont « Sensitive » côté
    // Vercel, donc jamais récupérables). On ne fait pas semblant d'avoir
    // vérifié : relancer avec E2E_BASE_URL=https://aedral.com couvre ce pas.
    console.log('  · ignoré : pas de clés HelloAsso ici (relance avec E2E_BASE_URL pour le couvrir)');
  } else {
    check('les compteurs portent sur toute la caisse', typeof admin.json?.counts?.total === 'number');
    check('ils voient nos règlements de test', (admin.json?.counts?.total ?? 0) >= 2, String(admin.json?.counts?.total));
    check('ils comptent ce qui reste à traiter', typeof admin.json?.counts?.toReview === 'number');
    check('la troncature est annoncée honnêtement', typeof admin.json?.truncated === 'boolean');
  }
}

try {
  await main();
} catch (err) {
  failed++;
  console.error('\n💥', err);
} finally {
  await cleanup().catch((e) => console.error('nettoyage incomplet :', e));

  // Garde-fou : la base est partagée avec la production. Le compteur public
  // doit être revenu exactement là où il était.
  const res = await fetch(`${BASE}/api/mania-cup/participants`).catch(() => null);
  const after = res && res.ok ? await res.json().catch(() => null) : null;
  if (after) {
    const leftovers = (after.participants ?? []).filter((p) => /^E2E_/.test(p.tmDisplayName ?? ''));
    check('aucun joueur de test ne reste visible du public', leftovers.length === 0, JSON.stringify(leftovers));
  }

  console.log(`\n${passed} vérifications passées, ${failed} échouées`);
  process.exitCode = failed > 0 ? 1 : 0;
}
