// One-shot : prévient les joueurs dont le rang Valorant DÉCLARÉ legacy a été
// purgé (voir scripts/cleanup-valorant-declared-ranks.mjs) qu'ils doivent
// re-synchroniser leur rang depuis leur compte Riot.
//
// Double canal : DM Discord via le bot (best-effort, 403 si DM bloqués) +
// notification in-app (garantie, l'action de re-sync se fait sur le site).
//
// Usage :
//   node scripts/notify-valorant-purged.mjs           (dry-run : liste les cibles)
//   node scripts/notify-valorant-purged.mjs --apply    (envoie réellement)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env.local' });
}

function parseServiceAccount(raw) {
  if (!raw.trim().startsWith('{')) return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  try { return JSON.parse(raw); }
  catch {
    const fixed = raw.replace(/"private_key":\s*"([^"]+)"/, (_m, key) => `"private_key": "${key.replace(/\r?\n/g, '\\n')}"`);
    return JSON.parse(fixed);
  }
}

if (getApps().length === 0) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT manquant.'); process.exit(1); }
  initializeApp({ credential: cert(parseServiceAccount(sa)) });
}

const db = getFirestore();
const APPLY = process.argv.includes('--apply');
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_API = 'https://discord.com/api/v10';

// Cibles = les 3 joueurs purgés par le cleanup (uids Discord).
const TARGET_UIDS = [
  'discord_1099598000290013205', // Undersnyl
  'discord_1308127271504187454', // sian2ah
  'discord_780772403927318568',  // _vinbo
];

const EMBED = {
  title: '🔷 Mise à jour de ton rang Valorant sur Aedral',
  description:
    "On a amélioré la vérification des rangs Valorant : le rang est maintenant récupéré "
    + "**automatiquement** depuis ton compte Riot lié (fini la saisie manuelle), pour que "
    + "personne ne puisse gonfler son niveau.\n\n"
    + "Ton ancien rang saisi à la main a donc été retiré. Pour réafficher ton rang (vérifié cette fois) :\n"
    + "1. Lie ton compte Riot dans **Discord → Paramètres → Connexions → Riot Games**\n"
    + "2. Reconnecte-toi sur **aedral.com**\n"
    + "3. **Paramètres → Jeux → « Sync mon rang maintenant »**\n\n"
    + "Merci ! 🎯",
  color: 0xff4655,
};

const INAPP = {
  type: 'generic',
  title: 'Ton rang Valorant a été mis à jour',
  message:
    "On a amélioré la vérification des rangs Valorant : il est désormais synchronisé automatiquement "
    + "depuis ton compte Riot lié. Ton ancien rang saisi à la main a été retiré — lie ton compte Riot "
    + "dans Discord puis synchronise depuis Paramètres → Jeux pour réafficher ton rang vérifié.",
  link: '/settings',
};

async function sendDM(discordId) {
  if (!BOT_TOKEN) return { ok: false, reason: 'no_token' };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bot ${BOT_TOKEN}` };
  const ch = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST', headers, body: JSON.stringify({ recipient_id: discordId }),
  });
  if (!ch.ok) return { ok: false, reason: `dm_channel_${ch.status}` };
  const { id: channelId } = await ch.json();
  const msg = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST', headers, body: JSON.stringify({ embeds: [EMBED] }),
  });
  if (!msg.ok) return { ok: false, reason: `send_${msg.status}` };
  return { ok: true };
}

console.log(`▶ Notification rang Valorant purgé (${APPLY ? 'APPLY' : 'DRY-RUN'})…`);
if (APPLY && !BOT_TOKEN) console.warn('  ⚠ DISCORD_BOT_TOKEN absent → DM ignorés, seules les notifs in-app partiront.');

for (const uid of TARGET_UIDS) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) { console.warn(`  ✗ ${uid} introuvable, skip.`); continue; }
  const data = snap.data();
  const discordId = data.discordId || uid.replace(/^discord_/, '');
  const name = data.displayName || data.discordUsername || uid;

  if (!APPLY) {
    console.log(`  • ${name} (discordId ${discordId}) → DM + notif in-app`);
    continue;
  }

  // 1. Notif in-app (garantie)
  await db.collection('notifications').add({
    userId: uid, type: INAPP.type, title: INAPP.title, message: INAPP.message,
    link: INAPP.link, metadata: {}, read: false, createdAt: FieldValue.serverTimestamp(),
  });
  // 2. DM Discord (best-effort)
  const dm = await sendDM(discordId);
  console.log(`  ${dm.ok ? '✓' : '⚠'} ${name} : notif in-app OK · DM ${dm.ok ? 'envoyé' : `échoué (${dm.reason})`}`);
  await new Promise(r => setTimeout(r, 300)); // throttle léger
}

console.log(APPLY ? '✓ Terminé.' : '\nDRY-RUN terminé. Relance avec --apply pour envoyer.');
process.exit(0);
