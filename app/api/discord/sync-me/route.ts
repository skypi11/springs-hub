import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { syncDiscordMember } from '@/lib/discord-role-sync';
import { captureApiError } from '@/lib/sentry';

// POST /api/discord/sync-me, synchronise le pseudo serveur « [TAG] Pseudo »
// et les rôles Discord de l'utilisateur courant sur le serveur Aedral.
// Utilisé par le bouton « resynchroniser » des réglages.
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const result = await syncDiscordMember(getAdminDb(), uid);
    return NextResponse.json({ result });
  } catch (err) {
    captureApiError('API discord/sync-me POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
