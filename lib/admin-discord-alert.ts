// Alertes admin Discord, poste dans un salon configuré du serveur Aedral
// quand un événement réclame l'attention d'un admin (nouvelle demande de
// structure, etc.). Fire-and-forget : ne fait JAMAIS échouer le flux appelant.

import type { Firestore } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';

const DISCORD_API = 'https://discord.com/api/v10';
// Serveur Discord communautaire officiel Aedral, le bot y est présent.
export const AEDRAL_GUILD_ID = '1498052178143875153';
// Doc Firestore portant la config des alertes (channel choisi par l'admin).
const CONFIG_DOC_PATH = 'app_config/discord_alerts';
const ALERT_COLOR = 0xffb800; // or Aedral

export async function getAdminAlertChannelId(db: Firestore): Promise<string | null> {
  try {
    const snap = await db.doc(CONFIG_DOC_PATH).get();
    const id = snap.data()?.adminAlertChannelId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export async function setAdminAlertChannelId(db: Firestore, channelId: string | null): Promise<void> {
  await db.doc(CONFIG_DOC_PATH).set({ adminAlertChannelId: channelId ?? null }, { merge: true });
}

// Snowflakes Discord des admins, UID au format `discord_SNOWFLAKE`. Les admins
// ajoutés via le panel sont des comptes Discord, donc on peut les mentionner.
async function adminDiscordIds(db: Firestore): Promise<string[]> {
  try {
    const snap = await db.collection('aedral_admins').get();
    return snap.docs
      .map(d => d.id)
      .filter(id => id.startsWith('discord_'))
      .map(id => id.slice('discord_'.length))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export type AdminAlertInput = {
  title: string;
  description: string;
  url?: string | null;
};

// Poste une alerte dans le salon admin configuré, en mentionnant les admins.
// Silencieux si aucun salon n'est configuré. Ne throw jamais, l'appelant peut
// l'await sans try/catch.
export async function sendAdminAlert(db: Firestore, input: AdminAlertInput): Promise<void> {
  try {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return;

    const channelId = await getAdminAlertChannelId(db);
    if (!channelId) return; // pas configuré → rien à faire

    const pingIds = (await adminDiscordIds(db)).slice(0, 40);
    const content = pingIds.length > 0 ? pingIds.map(id => `<@${id}>`).join(' ') : undefined;

    const embed: Record<string, unknown> = {
      color: ALERT_COLOR,
      title: input.title.slice(0, 256),
      description: input.description.slice(0, 2000),
      footer: { text: 'Alerte admin · Aedral' },
      timestamp: new Date().toISOString(),
    };
    if (input.url) embed.url = input.url;

    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${token}` },
      body: JSON.stringify({
        ...(content ? { content } : {}),
        embeds: [embed],
        // allowed_mentions explicite : ne pinge QUE les admins listés.
        allowed_mentions: { parse: [], users: pingIds },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`admin alert post failed: ${res.status} ${body.slice(0, 200)}`);
    }
  } catch (err) {
    captureApiError('sendAdminAlert error', err);
  }
}
