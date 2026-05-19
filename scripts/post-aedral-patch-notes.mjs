// Poste un message "patch notes" sur le serveur Discord communautaire officiel
// Aedral (guild 1498052178143875153), dans le channel d'annonces.
//
// Modes :
//   --dry-run       : liste les channels et montre celui qui serait ciblé,
//                     sans poster (recommandé en première passe)
//   (sans flag)     : poste directement (auto-discovery du channel)
//   --channel <id>  : force un channel précis
//
// Run :  node --env-file=.env.local scripts/post-aedral-patch-notes.mjs --dry-run
//
// Le script :
// 1. Liste les channels du guild via l'API Discord
// 2. Identifie la catégorie "INFOS" et le channel "annonces" dedans
// 3. Affiche le channel trouvé + log de tous les channels de la catégorie
// 4. Post un embed riche avec le contenu des patch notes (sauf en dry-run)

const AEDRAL_GUILD_ID = '1498052178143875153';
const DISCORD_API = 'https://discord.com/api/v10';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const channelArgIdx = args.indexOf('--channel');
const forcedChannelId = channelArgIdx >= 0 ? args[channelArgIdx + 1] : null;

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN manquant. Set la var ou run avec --env-file=.env.local');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bot ${token}`,
};

// ── 1. Liste les channels du guild Aedral ────────────────────────────────
const channelsRes = await fetch(`${DISCORD_API}/guilds/${AEDRAL_GUILD_ID}/channels`, { headers });
if (!channelsRes.ok) {
  console.error(`Échec liste channels: ${channelsRes.status} ${await channelsRes.text()}`);
  process.exit(1);
}
const channels = await channelsRes.json();

// Discord channel types : 4 = category, 0 = text
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

let targetChannel;
if (forcedChannelId) {
  targetChannel = channels.find(c => c.id === forcedChannelId);
  if (!targetChannel) {
    console.error(`Channel forcé ${forcedChannelId} introuvable.`);
    process.exit(1);
  }
  console.log(`📍 Channel forcé : #${targetChannel.name} (id: ${targetChannel.id})`);
} else {
  const categories = channels.filter(c => c.type === 4);
  const infosCategory = categories.find(c => norm(c.name).includes('info'));
  if (!infosCategory) {
    console.error('Catégorie "Infos" introuvable. Catégories dispo :');
    categories.forEach(c => console.error(`  - ${c.name} (id: ${c.id})`));
    process.exit(1);
  }

  const textChannels = channels.filter(c => c.type === 0 && c.parent_id === infosCategory.id);
  console.log(`📂 Catégorie "${infosCategory.name}" contient ${textChannels.length} channel(s) texte :`);
  textChannels.forEach(c => console.log(`     #${c.name} (id: ${c.id})`));

  targetChannel = textChannels.find(c => /annonce|news|patch|update|mise/i.test(c.name))
    ?? textChannels[0];
  if (!targetChannel) {
    console.error(`Catégorie "${infosCategory.name}" sans channel texte.`);
    process.exit(1);
  }
  console.log(`\n📍 Channel cible auto-détecté : #${targetChannel.name} (id: ${targetChannel.id})`);
}

if (dryRun) {
  console.log('\n[dry-run] Aucun message envoyé. Pour poster pour de vrai, retire --dry-run.');
  process.exit(0);
}

// ── 3. Construit et envoie l'embed ───────────────────────────────────────
const embed = {
  title: '📢 Nouveautés Aedral — Mai 2026',
  color: 0xFFB800, // Or Aedral
  description: 'Récap des dernières mises à jour. Comme toujours, tout est gratuit.',
  fields: [
    {
      name: '🎮 Profil Rocket League amélioré',
      value: 'Ton profil affiche maintenant les **vraies icônes de rang officielles** (Bronze → SSL). Choisis ta plateforme (Epic, Steam, PSN, Xbox, Switch) et les liens **tracker.gg + Ballchasing** sont générés automatiquement.',
    },
    {
      name: '🔗 Lie tes comptes Twitch, YouTube, Spotify, Epic, Steam…',
      value: 'Aedral récupère automatiquement tous les comptes que tu as liés à ton Discord. Va dans **Settings → Comptes liés** et toggle ceux que tu veux afficher sur ton profil public.',
    },
    {
      name: '🟢 Liaison Steam directe (recommandée pour les joueurs Steam)',
      value: 'Nouveau bouton **"Lier mon Steam"** dans Settings → Jeux. Ton identifiant Steam permanent est récupéré une bonne fois pour toutes — ton lien tracker.gg ne cassera jamais, même si tu changes ton pseudo Steam.',
    },
    {
      name: '✨ Branding Aedral peaufiné',
      value: 'Le logo a été refait avec une vraie typographie cohérente, et l\'aperçu quand tu partages [aedral.com](https://aedral.com) (Discord, Twitter…) est maintenant beaucoup plus propre.',
    },
    {
      name: '📱 App icons mobile',
      value: 'Tu peux ajouter **Aedral en raccourci** sur ton téléphone (iOS/Android) avec une vraie icône d\'app.',
    },
  ],
  footer: {
    text: 'Un bug ou une idée ? Ping Matt en MP ou viens en parler sur le serveur.',
  },
  timestamp: new Date().toISOString(),
};

const postRes = await fetch(`${DISCORD_API}/channels/${targetChannel.id}/messages`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    embeds: [embed],
    allowed_mentions: { parse: [] }, // pas de ping accidentel
  }),
});

if (!postRes.ok) {
  console.error(`Échec post : ${postRes.status} ${await postRes.text()}`);
  process.exit(1);
}

const data = await postRes.json();
console.log(`✅ Patch notes postées. Message ID: ${data.id}`);
console.log(`   Lien : https://discord.com/channels/${AEDRAL_GUILD_ID}/${targetChannel.id}/${data.id}`);
