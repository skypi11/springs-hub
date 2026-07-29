import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/firebase-admin';
import { buildInviteUrl } from '@/lib/discord-bot';
import { captureApiError } from '@/lib/sentry';

// GET /api/discord/invite-url
// URL d'invitation SIMPLE du bot : elle l'ajoute à un serveur sans rien lier
// côté Aedral. Sert quand le bot doit être présent sur PLUSIEURS serveurs —
// une structure qui a plusieurs Discord, ou un serveur qui hébergera une
// compétition (celle-ci désigne son serveur indépendamment de la structure).
//
// Le client_id n'est pas un secret (il est dans toute URL d'invitation), mais
// il vit dans une variable d'environnement : on le sert plutôt que de le
// recopier en dur côté client, où il deviendrait faux le jour d'un changement
// d'app Discord.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    return NextResponse.json({ url: buildInviteUrl() });
  } catch (err) {
    captureApiError('API Discord/InviteUrl GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
