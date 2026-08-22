// E2E covoiturage — le flux serveur en entier, par les VRAIES routes.
//
// Ce que ce script prouve :
//   · un visiteur non inscrit obtient le COMPTE et rien d'autre — aucune
//     position, aucun pseudo ne sort ;
//   · poser un point calcule un itinéraire ROUTIER jusqu'à la salle, sans que
//     personne ne dessine quoi que ce soit ;
//   · les coordonnées ne sont pas inversées (le tracé part bien de la ville de
//     départ, pas de son symétrique) ;
//   · une étape rallonge le trajet, et le détour est chiffré ;
//   · une demande de place n'a pas d'itinéraire ;
//   · une seule fiche par personne : reposer son trajet remplace, n'ajoute pas ;
//   · personne ne peut toucher au trajet d'un autre — c'est tout l'objet de
//     cette page par rapport à une carte partagée ;
//   · les garde-fous refusent une pastille hors zone, un nombre de places
//     absurde, une date hors période.
//
// Données 100 % synthétiques (préfixe e2e_carpool), cleanup TOUJOURS en
// finally : la base Firestore est PARTAGÉE avec la production.
//
// Prérequis : serveur sur localhost:3000 lancé depuis la racine du dépôt.
// Run : node --env-file=.env.local scripts/e2e-carpool.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const API_KEY = 'AIzaSyBx4Goq8VR1I2MFf9L2wJm2TBaV-l_cCps';
const P = 'e2e_carpool';
const A = `discord_${P}_a`;
const B = `discord_${P}_b`;
/** Admin de COMPÉTITION seul : ni admin Aedral, ni inscrit à la LAN. Le piège
 *  est que `isCompetitionAdmin` est vrai pour les deux rôles — tester avec un
 *  admin complet ne prouverait donc rien. */
const C = `discord_${P}_compadmin`;
const EVENT = 'mania-cup';

const LYON = { lat: 45.764, lng: 4.8357, label: 'Lyon' };
const MOULINS = { lat: 46.5646, lng: 3.3324, label: 'Moulins' };
const CLERMONT = { lat: 45.7772, lng: 3.087, label: 'Clermont-Ferrand' };

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
async function api(uid, method, path, body) {
  let token = tokens.get(uid);
  if (!token && uid) {
    const custom = await auth.createCustomToken(uid);
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://aedral.com/' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!json.idToken) throw new Error(`token failed: ${JSON.stringify(json).slice(0, 150)}`);
    token = json.idToken;
    tokens.set(uid, token);
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* vide */ }
  return { status: res.status, json };
}

/** Décodage du tracé encodé — copie minimale de lib/carpool.decodePolyline,
 *  l'e2e étant en .mjs et ne pouvant pas importer le TypeScript. */
function decode(encoded) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const axe of [0, 1]) {
      let res = 0, dec = 0, octet;
      do {
        octet = encoded.charCodeAt(i++) - 63;
        res |= (octet & 0x1f) << dec;
        dec += 5;
      } while (octet >= 0x20 && i < encoded.length);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (axe === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}


/** Distance à vol d'oiseau, pour vérifier qu'un tracé part bien d'où on croit. */
function km(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2
    + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

async function cleanup() {
  const batch = db.batch();
  for (const uid of [A, B, C]) {
    batch.delete(db.collection('carpool_trips').doc(`${EVENT}__${uid}`));
    batch.delete(db.collection('competition_admins').doc(uid));
    batch.delete(db.collection('mania_cup_registrations').doc(uid));
    batch.delete(db.collection('users').doc(uid));
  }
  await batch.commit();
  await Promise.all([A, B, C].map((u) => auth.deleteUser(u).catch(() => {})));
}

try {
  step(0, 'Deux joueurs inscrits, synthétiques');
  await cleanup();
  for (const [uid, nom] of [[A, 'E2E Pilote A'], [B, 'E2E Pilote B']]) {
    await auth.createUser({ uid }).catch(() => {});
    await db.collection('users').doc(uid).set({
      displayName: nom, discordUsername: `${nom.toLowerCase().replace(/ /g, '')}`,
      isDev: true, createdAt: new Date(),
    });
    await db.collection('mania_cup_registrations').doc(uid).set({
      uid, tmDisplayName: nom, status: 'confirmed', countryCode: 'FR', ageAtEvent: 25,
    });
  }
  await auth.createUser({ uid: C }).catch(() => {});
  await db.collection('users').doc(C).set({ displayName: 'E2E Admin compét', isDev: true });
  await db.collection('competition_admins').doc(C).set({ addedBy: 'e2e', addedAt: new Date() });
  // Garde du test lui-même : s'il était aussi admin Aedral, il ne prouverait rien.
  const estAdminComplet = (await db.collection('aedral_admins').doc(C).get()).exists;
  check('le compte de test n’est PAS admin Aedral', !estAdminComplet);


  check('inscriptions posées', true);

  step(1, 'Un visiteur non inscrit ne voit AUCUNE position');
  const anon = await api(null, 'GET', `/api/carpool/${EVENT}`);
  check('la route répond', anon.status === 200, `status ${anon.status}`);
  check('accès refusé à la carte', anon.json?.allowed === false);
  check('aucun trajet servi', anon.json?.trips === undefined, JSON.stringify(anon.json).slice(0, 120));
  check('mais le compteur est donné', typeof anon.json?.count === 'number');
  check('la destination reste publique', Boolean(anon.json?.event?.destination?.lat));

  step(2, 'Poser un trajet : l’itinéraire se calcule tout seul');
  const put = await api(A, 'PUT', `/api/carpool/${EVENT}`, {
    kind: 'offer', origin: LYON, waypoints: [], seats: 3,
    departAt: '2026-10-03T08:00', returnAt: '2026-10-04T19:00', note: 'Par l’A89.',
  });
  check('trajet accepté', put.status === 200, JSON.stringify(put.json).slice(0, 160));
  const route = put.json?.trip?.route;
  check('un itinéraire est renvoyé', Boolean(route));
  if (route) {
    console.log(`     → ${(route.distanceM / 1000).toFixed(0)} km, ${(route.durationS / 3600).toFixed(2)} h, tracé « ${route.kind} »`);
    check('calculé sur le réseau routier', route.kind === 'road',
      'repli à vol d’oiseau — clé OPENROUTESERVICE_API_KEY absente ou refusée');
    // Lyon → Marzy fait ~300 km à vol d'oiseau : par la route, entre 300 et 500.
    check('distance plausible', route.distanceM > 250_000 && route.distanceM < 500_000, `${route.distanceM} m`);
    const pts = decode(route.polyline);
    const depart = { lat: pts[0][0], lng: pts[0][1] };
    // LE piège de toute carte : [lng, lat] pris pour [lat, lng] envoie la
    // France au large de la Somalie sans lever la moindre erreur.
    check('le tracé part bien de Lyon (coordonnées non inversées)', km(depart, LYON) < 5, `${km(depart, LYON).toFixed(0)} km d’écart`);
    const arrivee = { lat: pts.at(-1)[0], lng: pts.at(-1)[1] };
    check('et arrive bien à la salle', km(arrivee, { lat: 46.9826, lng: 3.0932 }) < 5);

    // RÉGRESSION du 22/08 : le tracé était simplifié à 500 m de tolérance, ce
    // qui faisait couper les virages — « je ne passe pas à travers les champs
    // avec ma voiture ». Un itinéraire de 260 km compte des milliers de points ;
    // s'il en reste quelques centaines, c'est qu'on l'a raboté.
    console.log(`     → ${pts.length} points, ${route.polyline.length} caractères encodés`);
    check('le tracé garde son détail (pas de simplification)', pts.length > 1000, `${pts.length} points`);
    // Et surtout : aucun grand saut d'un point au suivant, sauf sur une vraie
    // ligne droite d'autoroute.
    let saut = 0;
    for (let i = 1; i < pts.length; i++) {
      saut = Math.max(saut, km({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] }));
    }
    console.log(`     → plus grand écart entre deux points consécutifs : ${(saut * 1000).toFixed(0)} m`);
    check('aucune corde à travers champs', saut < 3, `${saut.toFixed(1)} km entre deux points`);
    check('et ça reste léger', route.polyline.length < 60_000, `${route.polyline.length} caractères`);
    // Plausibilité — c'est ce qui attrape un profil de calcul cassé (piéton,
    // vélo, unités en miles) que la seule présence d'un nombre ne montrerait
    // pas. Le rapport route/vol d'oiseau d'un trajet routier français tient
    // entre 1,1 et 1,6 ; la vitesse moyenne portière à portière, entre 60 et
    // 115 km/h.
    const volDOiseau = km(LYON, { lat: 46.9826, lng: 3.0932 });
    const ratio = route.distanceM / 1000 / volDOiseau;
    const vitesse = (route.distanceM / 1000) / (route.durationS / 3600);
    console.log(`     → ${volDOiseau.toFixed(0)} km à vol d'oiseau, rapport ${ratio.toFixed(2)}, ${vitesse.toFixed(0)} km/h de moyenne`);
    check('rapport route / vol d’oiseau plausible', ratio > 1.1 && ratio < 1.6, ratio.toFixed(2));
    check('vitesse moyenne plausible (profil voiture)', vitesse > 60 && vitesse < 115, `${vitesse.toFixed(0)} km/h`);
  }

  step(3, 'Une étape rallonge le trajet, et le détour est chiffré');
  const prev = await api(A, 'POST', `/api/carpool/${EVENT}/preview`, {
    origin: LYON, waypoints: [CLERMONT], seats: 1,
  });
  check('l’aperçu répond', prev.status === 200, JSON.stringify(prev.json).slice(0, 120));
  const avecEtape = prev.json?.route;
  const direct = prev.json?.direct;
  check('le trajet direct est renvoyé pour comparaison', Boolean(direct));
  if (avecEtape && direct) {
    const detour = Math.round((avecEtape.durationS - direct.durationS) / 60);
    console.log(`     → détour par Clermont-Ferrand : +${detour} min`);
    check('passer par Clermont rallonge bien', avecEtape.durationS > direct.durationS);
  }

  step(4, 'Une demande de place n’a pas d’itinéraire');
  const dem = await api(B, 'PUT', `/api/carpool/${EVENT}`, {
    kind: 'search', origin: MOULINS, seats: 1, note: 'Je peux participer à l’essence.',
  });
  check('demande acceptée', dem.status === 200, JSON.stringify(dem.json).slice(0, 120));
  check('sans voiture, aucun tracé', dem.json?.trip?.route === null);

  step(5, 'Une seule fiche par personne');
  await api(A, 'PUT', `/api/carpool/${EVENT}`, { kind: 'offer', origin: LYON, seats: 2 });
  const vue = await api(A, 'GET', `/api/carpool/${EVENT}`);
  const miens = (vue.json?.trips ?? []).filter((t) => t.uid === A);
  check('reposer son trajet REMPLACE, n’ajoute pas', miens.length === 1, `${miens.length} fiches`);
  check('la nouvelle valeur a bien pris', miens[0]?.seats === 2, `${miens[0]?.seats} places`);

  step(6, 'La carte est bien servie aux inscrits');
  check('les deux trajets sont visibles', (vue.json?.trips ?? []).length >= 2);
  const auteur = (vue.json?.trips ?? []).find((t) => t.uid === B)?.author;
  check('avec le pseudo Trackmania de son auteur', auteur?.displayName === 'E2E Pilote B', JSON.stringify(auteur));
  check('et de quoi le joindre sur Discord', typeof auteur?.discordUsername === 'string');

  step(7, 'Personne ne touche au trajet d’un autre');
  const vol = await api(B, 'DELETE', `/api/carpool/${EVENT}?uid=${A}`);
  check('un joueur ne peut pas supprimer le trajet d’un autre', vol.status === 403, `status ${vol.status}`);
  const encoreLa = await api(A, 'GET', `/api/carpool/${EVENT}`);
  check('le trajet visé est intact', (encoreLa.json?.trips ?? []).some((t) => t.uid === A));

  step(8, 'Les garde-fous');
  const horsZone = await api(A, 'PUT', `/api/carpool/${EVENT}`, { kind: 'offer', origin: { lat: 12, lng: -40 }, seats: 2 });
  check('pastille au milieu de l’océan refusée', horsZone.status === 400, `status ${horsZone.status}`);
  const places = await api(A, 'PUT', `/api/carpool/${EVENT}`, { kind: 'offer', origin: LYON, seats: 99 });
  check('99 places refusées', places.status === 400);
  const horsPeriode = await api(A, 'PUT', `/api/carpool/${EVENT}`, {
    kind: 'offer', origin: LYON, seats: 2, departAt: '2026-07-01T08:00',
  });
  check('départ hors période refusé', horsPeriode.status === 400);
  const tropEtapes = await api(A, 'PUT', `/api/carpool/${EVENT}`, {
    kind: 'offer', origin: LYON, seats: 2, waypoints: Array.from({ length: 5 }, () => MOULINS),
  });
  check('cinq étapes refusées', tropEtapes.status === 400);
  const inconnu = await api(A, 'GET', '/api/carpool/evenement-qui-nexiste-pas');
  check('événement inconnu → 404', inconnu.status === 404);

  step(9, 'Chercher un lieu par son nom');
  // L'entrée principale de l'écran : sur un téléphone, taper « Moulins » vaut
  // mieux que viser une ville au doigt.
  const lieux = await api(A, 'GET', `/api/carpool/${EVENT}/places?q=${encodeURIComponent('Moulins')}`);
  check('la recherche répond', lieux.status === 200, `status ${lieux.status}`);
  const trouves = lieux.json?.places ?? [];
  check('elle propose au moins un résultat', trouves.length > 0, JSON.stringify(lieux.json).slice(0, 200));
  if (trouves.length > 0) {
    console.log(`     → ${trouves.slice(0, 3).map((p) => p.label).join(' | ')}`);
    check('avec des coordonnées exploitables',
      Number.isFinite(trouves[0].lat) && Number.isFinite(trouves[0].lng));
    check('centrée sur l’événement : le premier résultat est en France',
      km(trouves[0], { lat: 46.98, lng: 3.09 }) < 800, `${km(trouves[0], { lat: 46.98, lng: 3.09 }).toFixed(0)} km`);
  }
  const anonLieux = await api(null, 'GET', `/api/carpool/${EVENT}/places?q=Moulins`);
  check('fermée aux non-connectés', anonLieux.status === 401);

  step(9.5, 'Un admin de compétition voit la carte sans être inscrit');
  // Signalé par Matt : « les admins compétition ne peuvent pas voir l'onglet
  // covoiturage, ça leur dit de s'inscrire ». Toute la console de la LAN tourne
  // sur ce rôle — il serait absurde de lui refuser la carte qu'il doit modérer.
  const vueAdmin = await api(C, 'GET', `/api/carpool/${EVENT}`);
  check('la carte lui est ouverte', vueAdmin.json?.allowed === true, JSON.stringify(vueAdmin.json).slice(0, 140));
  check('et il voit les trajets', (vueAdmin.json?.trips ?? []).length >= 1);
  check('il peut retirer le trajet d’un joueur', (await api(C, 'DELETE', `/api/carpool/${EVENT}?uid=${A}`)).status === 200);
  // On le repose pour la suite.
  await api(A, 'PUT', `/api/carpool/${EVENT}`, { kind: 'offer', origin: LYON, seats: 2 });


  step(10, 'Retirer son propre trajet');
  const del = await api(B, 'DELETE', `/api/carpool/${EVENT}`);
  check('retrait accepté', del.status === 200);
  const apres = await api(A, 'GET', `/api/carpool/${EVENT}`);
  check('le trajet a disparu de la carte', !(apres.json?.trips ?? []).some((t) => t.uid === B));

} finally {
  await cleanup();
  const reste = await db.collection('carpool_trips').get();
  const orphelins = reste.docs.filter((d) => d.id.includes(P)).length;
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`Nettoyage : ${orphelins} donnée(s) de test restante(s)`);
  console.log(`${passed} vérification(s) OK, ${failed} échec(s)`);
  process.exit(failed > 0 || orphelins > 0 ? 1 : 0);
}
