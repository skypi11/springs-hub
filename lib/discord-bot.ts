// Helpers REST pour l'API Discord, côté serveur uniquement.
// Le token du bot n'est JAMAIS exposé au client — ces fonctions sont appelées
// depuis les Route Handlers Next.js (runtime serveur).

const DISCORD_API = 'https://discord.com/api/v10';

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error('DISCORD_BOT_TOKEN manquant');
  return t;
}

function clientId(): string {
  const v = process.env.DISCORD_BOT_CLIENT_ID;
  if (!v) throw new Error('DISCORD_BOT_CLIENT_ID manquant');
  return v;
}

function clientSecret(): string {
  const v = process.env.DISCORD_BOT_CLIENT_SECRET;
  if (!v) throw new Error('DISCORD_BOT_CLIENT_SECRET manquant');
  return v;
}

export interface DiscordGuildInfo {
  id: string;
  name: string;
  iconHash: string | null;
}

// Permission demandée : Administrator (8). Justification : les salons privés
// réservés aux équipes ont presque toujours des permission overrides qui
// bloquent @everyone (et donc le rôle du bot). Sans Administrator, le fondateur
// devrait ajouter le bot manuellement comme override sur CHAQUE salon d'équipe
// — c'est le cauchemar des bots de gestion esport. Administrator bypass tous
// les overrides et permet de poster partout sans config manuelle, ce qui est
// le standard pour les bots de ce type (MEE6, Carl-bot, Dyno…).
export const BOT_INVITE_PERMISSIONS = '8';

// Construit l'URL vers laquelle on redirige le fondateur pour qu'il invite le bot
// dans un de ses serveurs. `state` est un nonce CSRF, stocké en cookie côté Next.
export function buildInstallUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    permissions: BOT_INVITE_PERMISSIONS,
    scope: 'bot',
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// Échange le code OAuth contre un access token (officiellement pour l'utilisateur,
// mais on l'utilise surtout pour valider que le code est légitime). Discord
// renvoie aussi `guild` dans la réponse quand scope=bot.
export async function exchangeInstallCode(code: string, redirectUri: string): Promise<{
  accessToken: string;
  guild: { id: string; name: string; icon: string | null } | null;
}> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const g = data.guild as { id?: string; name?: string; icon?: string | null } | undefined;
  return {
    accessToken: data.access_token as string,
    guild: g && g.id && g.name ? { id: g.id, name: g.name, icon: g.icon ?? null } : null,
  };
}

// Récupère les infos d'un serveur via le token bot. Nécessite que le bot soit
// déjà dans ce serveur (sinon 403).
export async function getGuildInfo(guildId: string): Promise<DiscordGuildInfo> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord guild fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    id: data.id as string,
    name: data.name as string,
    iconHash: (data.icon as string | null) ?? null,
  };
}

// Couleurs (decimal) utilisées dans les embeds selon le type d'event Springs —
// alignées sur la DA du calendrier côté site.
const EVENT_COLORS: Record<string, number> = {
  training: 0x4da6ff, // bleu clair
  scrim: 0xa364d9,    // violet Springs
  match: 0xffb800,    // or Springs
  springs: 0x5865f2,  // blurple Discord
  autre: 0x7a7a95,    // gris
};

const EVENT_LABELS: Record<string, string> = {
  training: 'Entraînement',
  scrim: 'Scrim',
  match: 'Match',
  springs: 'Évènement Springs',
  autre: 'Autre',
};

export interface EventEmbedInput {
  title: string;
  type: string;
  description?: string | null;
  location?: string | null;
  startsAtMs: number;
  endsAtMs: number;
  teamName?: string | null;
  structureName?: string | null;
  createdByName?: string | null;
  adversaire?: string | null;
  resultat?: string | null;
  siteEventUrl?: string | null;
  // Thumbnail (coin supérieur droit). Pour un match : logo adversaire si fourni,
  // sinon logo équipe. Pour les autres types : logo équipe.
  thumbnailUrl?: string | null;
  // Logo adversaire pour un match (si fourni, remplace la thumbnail par défaut).
  adversaryLogoUrl?: string | null;
  // Icône de l'author line (petit, à gauche du nom d'author). On y met le logo
  // équipe pour qu'il reste visible même quand la thumbnail montre l'adversaire.
  authorIconUrl?: string | null;
  // Bannière composite "TEAM VS ADVERSAIRE" générée côté serveur (route OG).
  // Si fournie pour un match officiel, elle devient l'`image` principale de
  // l'embed (pleine largeur, ~500px de haut) — remplace le "gallery trick" qui
  // collait les logos sans gutter ni centrage.
  matchBannerUrl?: string | null;
  // Pings : liste d'IDs Discord à mentionner en tête de message (et dans
  // allowed_mentions pour que la notif push parte).
  pingUserIds?: string[];
  pingRoleId?: string | null;
  pingEveryone?: boolean;
}

// Poste un message + embed dans un salon Discord via le bot. Retourne l'id du
// message pour permettre un futur edit/delete. Throw en cas d'échec (l'appelant
// doit catch et rester silencieux côté UI si c'est un effet secondaire non-bloquant).
export async function postEventEmbed(channelId: string, input: EventEmbedInput): Promise<string> {
  const typeLabel = EVENT_LABELS[input.type] ?? input.type;
  const color = EVENT_COLORS[input.type] ?? 0x7a7a95;

  // Timestamps Discord : :F = date complète, :R = relative ("dans 2h"), :t = heure courte.
  const startSec = Math.floor(input.startsAtMs / 1000);
  const endSec = Math.floor(input.endsAtMs / 1000);

  // Mentions en tête de message (content). On cappe à 40 users pour éviter
  // de dépasser la limite Discord (2000 chars content).
  const userPings = (input.pingUserIds ?? []).slice(0, 40);
  const mentionsLine = [
    input.pingRoleId ? `<@&${input.pingRoleId}>` : '',
    ...userPings.map(id => `<@${id}>`),
  ].filter(Boolean).join(' ');

  // Layout spécial pour les matchs officiels : le titre dominant devient
  // "ÉQUIPE vs ADVERSAIRE", l'author line annonce "MATCH OFFICIEL", et la
  // thumbnail bascule sur le logo adversaire (si fourni). Le logo de l'équipe
  // reste visible via author.icon_url.
  const isOfficialMatch = input.type === 'match' && !!input.adversaire;

  const authorParts = [isOfficialMatch ? 'MATCH OFFICIEL' : typeLabel];
  if (input.structureName) authorParts.push(input.structureName);
  const authorName = authorParts.join(' · ').slice(0, 256);

  // Titre : pour un match, "ÉQUIPE VS ADVERSAIRE" (en majuscules pour le punch).
  // Pour le reste, le titre de l'event + suffixe vs X si scrim avec adversaire.
  let titleWithType: string;
  if (isOfficialMatch && input.adversaire) {
    const teamLabel = (input.teamName || input.structureName || 'Équipe').toUpperCase();
    titleWithType = `${teamLabel} VS ${input.adversaire.toUpperCase()}`.slice(0, 256);
  } else {
    const adversaireSuffix = input.adversaire ? ` · vs ${input.adversaire}` : '';
    titleWithType = `${input.title}${adversaireSuffix}`.slice(0, 256);
  }

  // Fields inline : date et heure séparées pour plus de lisibilité.
  // <t:SEC:D> = "24 avril 2026", <t:SEC:R> = "dans 2h", <t:SEC:t> = "20:00"
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '🗓️ Date', value: `<t:${startSec}:D>\n<t:${startSec}:R>`, inline: true },
    { name: '⏱️ Heure', value: `<t:${startSec}:t> → <t:${endSec}:t>`, inline: true },
  ];
  // Titre de l'event affiché en clair pour un match (puisqu'il a été remplacé
  // par "TEAM VS ADV" dans le title). Ça préserve l'info "encore un test" par ex.
  if (isOfficialMatch && input.title) {
    fields.push({ name: '📋 Événement', value: input.title.slice(0, 256), inline: true });
  }
  if (input.location) {
    fields.push({ name: '📍 Lieu', value: input.location.slice(0, 256), inline: true });
  }
  if (input.resultat) {
    fields.push({ name: '🏆 Résultat', value: input.resultat.slice(0, 64), inline: true });
  }

  const authorObj: Record<string, unknown> = { name: authorName };
  if (input.authorIconUrl && /^https:\/\//.test(input.authorIconUrl)) {
    authorObj.icon_url = input.authorIconUrl;
  }

  const embed: Record<string, unknown> = {
    color,
    author: authorObj,
    title: titleWithType,
    description: (input.description ?? '').slice(0, 2000) || undefined,
    fields,
    footer: {
      text: input.createdByName
        ? `Créé par ${input.createdByName} · Springs Hub`
        : 'Springs Hub',
    },
    timestamp: new Date().toISOString(),
  };
  if (input.siteEventUrl) embed.url = input.siteEventUrl;

  // Image principale :
  //   - Match officiel avec bannière composite : on utilise l'`image` de l'embed
  //     (pleine largeur, centrée) pour afficher une bannière "TEAM VS ADVERSAIRE"
  //     générée côté serveur. Propre, centré, avec vrai padding — contrairement
  //     au "gallery trick" qui collait les logos.
  //   - Sinon : thumbnail classique en haut-droit (logo équipe ou structure).
  const useMatchBanner = isOfficialMatch
    && !!input.matchBannerUrl
    && /^https:\/\//.test(input.matchBannerUrl);
  if (useMatchBanner && input.matchBannerUrl) {
    embed.image = { url: input.matchBannerUrl };
  } else if (input.thumbnailUrl && /^https:\/\//.test(input.thumbnailUrl)) {
    embed.thumbnail = { url: input.thumbnailUrl };
  }

  // allowed_mentions : liste EXPLICITE des user/role IDs autorisés. Discord ne
  // pingera que ces IDs, même si le content contient d'autres mentions ou
  // @everyone. Sécurité par construction : on ne peut pas accidentellement
  // pinger quelqu'un hors liste.
  const allowedMentions: Record<string, unknown> = { parse: [] };
  if (userPings.length > 0) allowedMentions.users = userPings;
  if (input.pingRoleId) allowedMentions.roles = [input.pingRoleId];
  if (input.pingEveryone) (allowedMentions.parse as string[]).push('everyone');

  const content = mentionsLine || undefined;

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
    },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed],
      allowed_mentions: allowedMentions,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord post message failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.id as string;
}

// ---------- Todos (devoirs) ----------

// Couleurs par type de devoir — DA Springs (dégradés utilisés par le panel TeamTodosPanel).
const TODO_COLORS: Record<string, number> = {
  free:           0x7a7a95, // gris (tâche libre)
  replay_review:  0x4da6ff, // bleu (replay)
  training_pack:  0xa364d9, // violet Springs (entraînement)
  vod_review:     0xff6bb5, // rose (vidéo)
  scouting:       0xff9f43, // orange (analyse adversaire)
  watch_party:    0x5865f2, // blurple (watch)
  mental_checkin: 0x00d936, // vert (mental/fitness)
};

const TODO_LABELS: Record<string, string> = {
  free:           'Tâche libre',
  replay_review:  'Visionnage replay',
  training_pack:  'Training pack',
  vod_review:     'VOD review',
  scouting:       'Analyse adversaire',
  watch_party:    'Watch party',
  mental_checkin: 'Check-in mental',
};

export interface TodoEmbedInput {
  title: string;
  type: string;
  description?: string | null;
  deadlineAtMs?: number | null;       // ms epoch — si fourni, on utilise Discord timestamps pour localiser
  deadlineYmd?: string | null;        // fallback texte "YYYY-MM-DD" si pas de deadlineAtMs
  teamName?: string | null;
  structureName?: string | null;
  createdByName?: string | null;
  siteTodoUrl?: string | null;        // lien vers /calendar (ou page dédiée)
  thumbnailUrl?: string | null;       // logo équipe ou structure
  authorIconUrl?: string | null;
  pingUserIds?: string[];             // snowflakes à ping — assignés
  // Résumé de config par type (ex: nombre de packs, URL VOD courte…). Si null, pas de field extra.
  configSummary?: string | null;
}

// Poste un embed "nouveau devoir" dans un channel Discord. Même forme que postEventEmbed :
// appelé en fire-and-forget côté route, throw si échec pour log Sentry.
export async function postTodoEmbed(channelId: string, input: TodoEmbedInput): Promise<string> {
  const typeLabel = TODO_LABELS[input.type] ?? input.type;
  const color = TODO_COLORS[input.type] ?? 0x7a7a95;

  const userPings = (input.pingUserIds ?? []).slice(0, 40);
  const mentionsLine = userPings.map(id => `<@${id}>`).join(' ');

  const authorParts = [`📝 DEVOIR · ${typeLabel}`];
  if (input.structureName) authorParts.push(input.structureName);
  const authorName = authorParts.join(' · ').slice(0, 256);

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  // Deadline : Discord timestamps (<t:SEC:F> = date+heure, <t:SEC:R> = relatif "dans 2h").
  // Avec l'option A, deadlineAtMs porte l'heure exacte (kick-off pour un devoir relatif offset=0).
  if (typeof input.deadlineAtMs === 'number') {
    const sec = Math.floor(input.deadlineAtMs / 1000);
    fields.push({ name: '⏰ Deadline', value: `<t:${sec}:F>\n<t:${sec}:R>`, inline: true });
  } else if (input.deadlineYmd) {
    fields.push({ name: '⏰ Deadline', value: input.deadlineYmd, inline: true });
  }
  if (input.teamName) {
    fields.push({ name: '👥 Équipe', value: input.teamName.slice(0, 256), inline: true });
  }
  if (input.configSummary) {
    fields.push({ name: '🎯 Détail', value: input.configSummary.slice(0, 1024), inline: false });
  }

  const authorObj: Record<string, unknown> = { name: authorName };
  if (input.authorIconUrl && /^https:\/\//.test(input.authorIconUrl)) {
    authorObj.icon_url = input.authorIconUrl;
  }

  const embed: Record<string, unknown> = {
    color,
    author: authorObj,
    title: input.title.slice(0, 256),
    description: (input.description ?? '').slice(0, 2000) || undefined,
    fields,
    footer: {
      text: input.createdByName
        ? `Assigné par ${input.createdByName} · Springs Hub`
        : 'Springs Hub',
    },
    timestamp: new Date().toISOString(),
  };
  if (input.siteTodoUrl) embed.url = input.siteTodoUrl;
  if (input.thumbnailUrl && /^https:\/\//.test(input.thumbnailUrl)) {
    embed.thumbnail = { url: input.thumbnailUrl };
  }

  const allowedMentions: Record<string, unknown> = { parse: [] };
  if (userPings.length > 0) allowedMentions.users = userPings;

  const content = mentionsLine || undefined;

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
    },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed],
      allowed_mentions: allowedMentions,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord post todo failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.id as string;
}

// Ouvre (ou récupère) un DM channel avec un user et y poste un embed todo.
// Retourne { ok: true, messageId } ou { ok: false, reason } — 403 = le user a bloqué
// les DMs du bot ou n'a aucun serveur mutual. On ne throw PAS car c'est un cas normal.
export async function sendTodoDM(
  discordUserId: string,
  input: TodoEmbedInput,
): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  // Étape 1 : créer ou récupérer le DM channel.
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!dmRes.ok) {
    const body = await dmRes.text().catch(() => '');
    return { ok: false, reason: `dm_open_${dmRes.status}: ${body.slice(0, 150)}` };
  }
  const dm = await dmRes.json();
  const channelId = dm.id as string;

  // Étape 2 : poster le même embed que celui du channel, mais sans ping (inutile en DM).
  const postInput: TodoEmbedInput = { ...input, pingUserIds: [] };
  try {
    const messageId = await postTodoEmbed(channelId, postInput);
    return { ok: true, messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 403 attendu quand le user a désactivé les DMs du serveur où le bot est.
    return { ok: false, reason: msg.slice(0, 200) };
  }
}

// ---------- Recrutement ----------

// Couleurs alignées sur la DA Springs :
//   - join_request : teal/cyan (candidature reçue, action requise des dirigeants)
//   - direct_invite : violet Springs (action sortante de la structure)
const RECRUITMENT_COLORS = {
  join_request: 0x00d9b5,   // teal — incoming
  direct_invite: 0xa364d9,  // violet Springs — outgoing
} as const;

const GAME_LABELS: Record<string, string> = {
  rocket_league: 'Rocket League',
  trackmania: 'Trackmania',
};

const RECRUITMENT_ROLE_LABELS: Record<string, string> = {
  joueur: 'Joueur',
  coach: 'Coach',
  manager: 'Manager',
};

export interface RecruitmentEmbedInput {
  // Type de notification — détermine les couleurs, le titre et le verbe utilisés.
  kind: 'join_request' | 'direct_invite';
  // Personne au cœur de la notification (candidat pour join_request, cible pour direct_invite).
  personName: string;
  personAvatarUrl?: string | null;
  // Contexte structure (affiché dans l'author line + footer).
  structureName: string;
  structureLogoUrl?: string | null;
  // Détail de la candidature/invitation.
  game: string;            // 'rocket_league' | 'trackmania' | autre
  role?: string | null;    // 'joueur' | 'coach' | 'manager'
  country?: string | null;
  message?: string | null; // motivation candidat / message d'invitation
  // Niveau jeu (rendu uniquement si pertinent pour le jeu visé).
  rlRank?: string | null;
  pseudoTM?: string | null;
  // Lien vers le Hub (rend le titre cliquable). Mène typiquement vers
  // /community/my-structure?tab=recruitment.
  siteUrl?: string | null;
  // Ping rôle staff (allowed_mentions ne pingera QUE ce rôle, jamais @everyone).
  pingRoleId?: string | null;
}

// Poste un embed "candidature reçue" ou "invitation envoyée" dans un salon
// Discord. Même contrat que postEventEmbed/postTodoEmbed : appelé en
// fire-and-forget côté route, throw si échec pour log Sentry — la candidature
// elle-même ne doit JAMAIS échouer si Discord est down.
export async function postRecruitmentEmbed(channelId: string, input: RecruitmentEmbedInput): Promise<string> {
  const isJoin = input.kind === 'join_request';
  const color = RECRUITMENT_COLORS[input.kind];
  const gameLabel = GAME_LABELS[input.game] ?? input.game;
  const roleLabel = input.role ? (RECRUITMENT_ROLE_LABELS[input.role] ?? input.role) : null;

  // Mention en tête de message — staff role uniquement (allowed_mentions filtre).
  const mentionsLine = input.pingRoleId ? `<@&${input.pingRoleId}>` : '';

  const authorParts = [isJoin ? '📩 RECRUTEMENT · Candidature' : '📨 RECRUTEMENT · Invitation'];
  if (input.structureName) authorParts.push(input.structureName);
  const authorName = authorParts.join(' · ').slice(0, 256);

  const titleVerb = isJoin
    ? `Nouvelle candidature de ${input.personName}`
    : `Invitation envoyée à ${input.personName}`;
  const title = titleVerb.slice(0, 256);

  // Champs meta inline — toujours présents pour donner le contexte rapide.
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '🎮 Jeu', value: gameLabel.slice(0, 256), inline: true },
  ];
  if (roleLabel) {
    fields.push({ name: '👤 Rôle', value: roleLabel.slice(0, 256), inline: true });
  }
  if (input.country) {
    fields.push({ name: '🌍 Pays', value: input.country.slice(0, 64), inline: true });
  }

  // Niveau jeu — uniquement si pertinent pour le jeu visé. Mettre des champs
  // vides pour des jeux non concernés rendrait l'embed bruyant.
  if (input.game === 'rocket_league' && input.rlRank) {
    fields.push({ name: '🏆 Rang RL', value: input.rlRank.slice(0, 64), inline: true });
  }
  if (input.game === 'trackmania' && input.pseudoTM) {
    fields.push({ name: '🎯 Pseudo TM', value: input.pseudoTM.slice(0, 64), inline: true });
  }

  const authorObj: Record<string, unknown> = { name: authorName };
  if (input.structureLogoUrl && /^https:\/\//.test(input.structureLogoUrl)) {
    authorObj.icon_url = input.structureLogoUrl;
  }

  const embed: Record<string, unknown> = {
    color,
    author: authorObj,
    title,
    description: (input.message ?? '').slice(0, 2000) || undefined,
    fields,
    footer: {
      text: isJoin
        ? 'Springs Hub · À traiter dans l\'onglet Recrutement'
        : 'Springs Hub · Suivi dans l\'onglet Recrutement',
    },
    timestamp: new Date().toISOString(),
  };
  if (input.siteUrl) embed.url = input.siteUrl;
  // Thumbnail = avatar de la personne (candidat ou cible) — visage humain
  // immédiatement reconnaissable par les dirigeants qui scannent leur Discord.
  if (input.personAvatarUrl && /^https:\/\//.test(input.personAvatarUrl)) {
    embed.thumbnail = { url: input.personAvatarUrl };
  }

  const allowedMentions: Record<string, unknown> = { parse: [] };
  if (input.pingRoleId) allowedMentions.roles = [input.pingRoleId];

  const content = mentionsLine || undefined;

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken()}`,
    },
    body: JSON.stringify({
      ...(content ? { content } : {}),
      embeds: [embed],
      allowed_mentions: allowedMentions,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord post recruitment failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.id as string;
}

// URL CDN de l'icône d'un serveur (ou null si pas d'icône custom).
export function guildIconUrl(guildId: string, iconHash: string | null, size = 128): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

// Types Discord channel pertinents pour poster des notifs :
//   0  = GUILD_TEXT
//   5  = GUILD_ANNOUNCEMENT (salon d'annonce "classique")
//   15 = GUILD_FORUM (on exclut : poster y est un post, pas un message)
// On ignore aussi les voice/stage/threads/categories.
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);
const CATEGORY_CHANNEL_TYPE = 4;

export interface DiscordChannel {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  position: number;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;       // decimal RGB (0 = pas de couleur)
  position: number;
  mentionable: boolean;
}

// Récupère la liste des rôles d'un serveur pour le picker de rôle à ping.
// Exclut :
//   - @everyone (id === guildId)
//   - rôles "managed" = rôles système auto-créés pour les bots/intégrations
//     (on ne ping pas un rôle bot, et l'utilisateur ne peut pas le gérer)
// Tri par position descendante (le rôle "le plus haut" en premier, correspond
// à l'ordre dans les paramètres Discord).
export async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord roles fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Array<{
    id: string;
    name: string;
    color: number;
    position: number;
    mentionable: boolean;
    managed: boolean;
  }>;

  return raw
    .filter(r => r.id !== guildId && !r.managed)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      mentionable: r.mentionable,
    }))
    .sort((a, b) => b.position - a.position);
}

// Récupère la liste des salons d'un serveur filtrés aux types "postables".
// Inclut le nom de la catégorie parente si elle existe (pour regrouper côté UI).
// Nécessite que le bot soit dans le serveur + scope View Channels.
export async function getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord channels fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Array<{
    id: string;
    name: string;
    type: number;
    parent_id: string | null;
    position: number;
  }>;

  const categories = new Map<string, string>();
  for (const c of raw) {
    if (c.type === CATEGORY_CHANNEL_TYPE) categories.set(c.id, c.name);
  }

  return raw
    .filter(c => POSTABLE_CHANNEL_TYPES.has(c.type))
    .map(c => ({
      id: c.id,
      name: c.name,
      parentId: c.parent_id ?? null,
      parentName: c.parent_id ? (categories.get(c.parent_id) ?? null) : null,
      position: c.position ?? 0,
    }))
    .sort((a, b) => {
      // Tri : catégorie (nom) puis position dans la catégorie. Les salons sans
      // catégorie passent en premier.
      const pa = a.parentName ?? '';
      const pb = b.parentName ?? '';
      if (pa !== pb) return pa.localeCompare(pb);
      return a.position - b.position;
    });
}
