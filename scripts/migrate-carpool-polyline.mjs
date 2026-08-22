// Migration — recalculer les itinéraires de covoiturage au format complet.
//
// Avant le 22/08/2026, le tracé était stocké en liste de nombres SIMPLIFIÉE à
// 500 m de tolérance. À l'échelle d'un pays ça ne se voyait pas ; en zoomant,
// la ligne coupait les virages et traversait les champs.
//
// La lecture sait déjà relire l'ancien format pour qu'aucun trajet ne
// disparaisse, mais elle ne peut pas inventer les points jetés. Ce script les
// recalcule vraiment, en rappelant le calculateur d'itinéraire.
//
// Idempotent : un trajet déjà au bon format est laissé tel quel.
//
// Run : node --env-file=.env.local scripts/migrate-carpool-polyline.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DESTINATIONS = {
  // Doit rester aligné sur CARPOOL_EVENTS (lib/carpool.ts).
  'mania-cup': { lat: 46.9826369, lng: 3.0932185 },
};

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const cle = process.env.OPENROUTESERVICE_API_KEY?.trim();
if (!cle) {
  console.error('OPENROUTESERVICE_API_KEY absente — impossible de recalculer.');
  process.exit(1);
}

const snap = await db.collection('carpool_trips').get();
let recalcules = 0;
let ignores = 0;

for (const doc of snap.docs) {
  const t = doc.data();
  if (!t.route) { ignores++; continue; }
  if (typeof t.route.polyline === 'string' && t.route.polyline.length > 0) { ignores++; continue; }

  const dest = DESTINATIONS[t.eventId];
  if (!dest || !t.origin) { ignores++; continue; }

  const points = [t.origin, ...(t.waypoints ?? []), dest].map((p) => [p.lng, p.lat]);
  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
    method: 'POST',
    headers: { Authorization: cle, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ coordinates: points }),
  });
  if (!res.ok) {
    console.error(`${doc.id} → le calculateur a répondu ${res.status}, laissé en l'état`);
    continue;
  }
  const json = await res.json();
  const r = json?.routes?.[0];
  if (typeof r?.geometry !== 'string') {
    console.error(`${doc.id} → réponse inattendue, laissé en l'état`);
    continue;
  }

  await doc.ref.update({
    route: {
      polyline: r.geometry,
      distanceM: r.summary?.distance ?? t.route.distanceM ?? 0,
      durationS: r.summary?.duration ?? t.route.durationS ?? 0,
      kind: 'road',
    },
  });
  const pts = r.geometry.length;
  console.log(`${doc.id} → recalculé (${(r.summary?.distance / 1000).toFixed(0)} km, ${pts} caractères encodés)`);
  recalcules++;
  // Politesse envers le calculateur : on n'enchaîne pas les appels.
  await new Promise((r) => setTimeout(r, 300));
}

console.log(`\n${recalcules} trajet(s) recalculé(s), ${ignores} déjà au bon format ou sans itinéraire.`);
