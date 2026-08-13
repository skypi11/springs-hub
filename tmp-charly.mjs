// LECTURE SEULE — état des deux commandes de Charly et de son inscription.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function parseSA(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/"private_key":\s*"([^"]+)"/, (_m, k) => `"private_key": "${k.replace(/\r?\n/g, '\\n')}"`));
  }
}
if (!getApps().length) initializeApp({ credential: cert(parseSA(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

const d = (t) => (t?._seconds ? new Date(t._seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');

for (const itemId of ['198457897', '198457903']) {
  const s = await db.collection('mania_cup_payments').doc(itemId).get();
  if (!s.exists) { console.log(itemId, '— absent'); continue; }
  const p = s.data();
  console.log(`ligne ${itemId} · commande ${p.orderId}`);
  console.log(`   état=${p.state} · moneyBack=${p.moneyBack ?? '(rien)'} · outcome=${p.outcome} · rattaché à ${p.matchedUid ?? '—'}`);
  console.log(`   reçu ${d(p.receivedAt)} · dernier mouvement ${d(p.updatedAt)} · motif: ${p.reason ?? '—'}\n`);
}

const regs = await db.collection('mania_cup_registrations').where('registrationCode', '==', 'LAN-7Y6B').get();
for (const doc of regs.docs) {
  const r = doc.data();
  console.log(`inscription ${r.tmDisplayName} : ${r.status} · réglée par la ligne ${r.payment?.itemId ?? '—'} (commande ${r.payment?.orderId ?? '—'})`);
}

const total = await db.collection('mania_cup_registrations').where('status', '==', 'confirmed').count().get();
console.log(`\nplaces réglées : ${total.data().count}`);
process.exit(0);
