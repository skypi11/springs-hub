import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

const MAX_USERS_SCAN = 2000;

type MonthBucket = { ym: string; count: number };

// GET /api/admin/discord — stats sur les utilisateurs connectés via Discord OAuth
// (tous les users du Hub sont Discord — l'auth Google est réservée aux admins Springs).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const snap = await db.collection('users').limit(MAX_USERS_SCAN).get();

    let totalDiscord = 0;
    let withAvatar = 0;
    let withBio = 0;
    let withCountry = 0;
    let withRlProfile = 0;
    let withTmProfile = 0;
    let banned = 0;

    const monthMap = new Map<string, number>();

    for (const d of snap.docs) {
      const data = d.data();
      if (!data.discordId) continue;
      totalDiscord++;
      if (data.banned === true) banned++;
      if (data.discordAvatar || data.avatarUrl) withAvatar++;
      if (typeof data.bio === 'string' && data.bio.trim()) withBio++;
      if (typeof data.country === 'string' && data.country.trim()) withCountry++;
      if (data.rlTrackerUrl || data.epicAccountId || data.rlRank) withRlProfile++;
      if (data.pseudoTM || data.loginTM) withTmProfile++;

      const createdAt = data.createdAt?.toDate?.() as Date | undefined;
      if (createdAt) {
        const ym = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
        monthMap.set(ym, (monthMap.get(ym) ?? 0) + 1);
      }
    }

    const signupsByMonth: MonthBucket[] = Array.from(monthMap.entries())
      .map(([ym, count]) => ({ ym, count }))
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .slice(-12);  // 12 derniers mois

    return NextResponse.json({
      stats: {
        totalDiscord,
        withAvatar,
        withBio,
        withCountry,
        withRlProfile,
        withTmProfile,
        banned,
        active: totalDiscord - banned,
      },
      signupsByMonth,
      truncated: snap.size >= MAX_USERS_SCAN,
      env: {
        redirectUri: 'https://springs-hub.vercel.app/api/auth/discord/callback',
      },
    });
  } catch (err) {
    captureApiError('API Admin/Discord GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/discord — test d'envoi sur un webhook Discord.
// Body : { webhookUrl, message }
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const body = await req.json();
    const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';
    const message = typeof body.message === 'string' ? body.message : '';

    if (!webhookUrl || !message) {
      return NextResponse.json({ error: 'URL webhook et message requis' }, { status: 400 });
    }
    // Validation stricte : seulement Discord officiel
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
      return NextResponse.json({ error: 'URL webhook Discord invalide' }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: 'Message > 2000 caractères' }, { status: 400 });
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        username: 'Springs Hub (test admin)',
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({
        error: `Discord a rejeté : ${res.status} ${text.slice(0, 200)}`,
      }, { status: 400 });
    }

    return NextResponse.json({ ok: true, status: res.status });
  } catch (err) {
    captureApiError('API Admin/Discord POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
