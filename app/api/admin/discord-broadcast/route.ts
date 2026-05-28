// Admin endpoint pour poster une annonce sur le serveur Discord communautaire
// officiel Aedral via le bot (DISCORD_BOT_TOKEN).
//
// GET  → liste les channels texte du guild Aedral, groupés par catégorie
//        (utilisé par la UI admin pour le dropdown de sélection)
// POST → envoie un message embed dans le channel choisi
//
// Sécurité :
// - verifyAuth + check isAdmin (collection `admins`)
// - Hardcoded sur le guild Aedral (1498052178143875153), pas de risque
//   d'utiliser le bot pour broadcaster ailleurs
// - Validation que le channelId fait bien partie de la liste des channels du
//   guild (pas n'importe quel ID au pif)
// - allowed_mentions vide = pas de ping accidentel @everyone/@here

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, getAdminDb } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { clampString } from '@/lib/validation';

const DISCORD_API = 'https://discord.com/api/v10';
const AEDRAL_GUILD_ID = '1498052178143875153';
const AEDRAL_OR_COLOR = 0xFFB800;

async function requireAdmin(req: NextRequest): Promise<string | NextResponse> {
  const uid = await verifyAuth(req);
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = getAdminDb();
  const adminSnap = await db.collection('aedral_admins').doc(uid).get();
  if (!adminSnap.exists) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return uid;
}

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error('DISCORD_BOT_TOKEN manquant');
  return t;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number;
}

async function fetchGuildChannels(): Promise<DiscordChannel[]> {
  const res = await fetch(`${DISCORD_API}/guilds/${AEDRAL_GUILD_ID}/channels`, {
    headers: { Authorization: `Bot ${botToken()}` },
  });
  if (!res.ok) {
    throw new Error(`Discord channels list failed: ${res.status}`);
  }
  return res.json();
}

// GET : retourne les channels texte du guild Aedral, groupés par catégorie
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, auth));
  if (blocked) return blocked;

  try {
    const channels = await fetchGuildChannels();
    const categories = new Map<string, string>();
    for (const c of channels) {
      if (c.type === 4) categories.set(c.id, c.name); // type 4 = category
    }
    const textChannels = channels
      .filter(c => c.type === 0)
      .sort((a, b) => a.position - b.position)
      .map(c => ({
        id: c.id,
        name: c.name,
        category: c.parent_id ? (categories.get(c.parent_id) ?? '—') : '—',
      }));
    return NextResponse.json({ channels: textChannels });
  } catch (err) {
    captureApiError('AdminDiscordBroadcast GET error', err);
    return NextResponse.json({ error: 'failed_to_list_channels' }, { status: 502 });
  }
}

// POST : envoie un message embed dans le channel choisi
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, auth));
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const channelId = typeof body.channelId === 'string' ? body.channelId : '';
    const title = clampString(typeof body.title === 'string' ? body.title : '', 256);
    const description = clampString(typeof body.description === 'string' ? body.description : '', 4000);
    const colorHex = typeof body.color === 'number' && Number.isFinite(body.color) && body.color >= 0 && body.color <= 0xFFFFFF
      ? Math.floor(body.color)
      : AEDRAL_OR_COLOR;
    const footerText = clampString(typeof body.footer === 'string' ? body.footer : 'Aedral · aedral.com', 200);

    if (!channelId || !description.trim()) {
      return NextResponse.json({ error: 'channelId + description requis' }, { status: 400 });
    }

    // Valider que le channelId est bien un channel texte du guild Aedral
    const channels = await fetchGuildChannels();
    const target = channels.find(c => c.id === channelId && c.type === 0);
    if (!target) {
      return NextResponse.json({ error: 'channel_not_in_aedral_guild' }, { status: 400 });
    }

    const embed: Record<string, unknown> = {
      color: colorHex,
      description,
      timestamp: new Date().toISOString(),
      footer: { text: footerText },
    };
    if (title.trim()) embed.title = title;

    const postRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken()}`,
      },
      body: JSON.stringify({
        embeds: [embed],
        allowed_mentions: { parse: [] }, // pas de ping accidentel
      }),
    });

    if (!postRes.ok) {
      const text = await postRes.text().catch(() => '');
      console.error('[discord-broadcast POST] Discord error:', postRes.status, text.slice(0, 300));
      return NextResponse.json({ error: 'discord_post_failed', detail: text.slice(0, 300) }, { status: 502 });
    }

    const data = await postRes.json();
    return NextResponse.json({
      ok: true,
      messageId: data.id,
      messageUrl: `https://discord.com/channels/${AEDRAL_GUILD_ID}/${channelId}/${data.id}`,
      channelName: target.name,
    });
  } catch (err) {
    captureApiError('AdminDiscordBroadcast POST error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
