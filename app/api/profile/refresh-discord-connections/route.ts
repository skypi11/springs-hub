// POST /api/profile/refresh-discord-connections
//
// Re-fetch les connexions Discord du user À LA DEMANDE, via le refresh token
// stocké server-side (le même que la sync nocturne). Sert au palier C de la
// vérif : un joueur qui vient de lier Epic/Steam/Riot dans Discord voit la
// connexion apparaître TOUT DE SUITE, sans attendre la passe cron ni un relogin
// complet → débloque le « 1 clic » dans la foulée.
//
// Garde-fou : on ne met à jour QUE si le fetch renvoie ≥1 connexion (comme le
// cron) — sinon un échec réseau transitoire wiperait toutes les connexions.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { refreshDiscordAccessToken } from '@/lib/discord-refresh';
import { fetchDiscordConnections, mergeConnections, type DiscordConnection } from '@/lib/discord-connections';

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
    const existing = snap.data()?.discordConnections as DiscordConnection[] | undefined;

    const refreshed = await refreshDiscordAccessToken(db, uid);
    if (!refreshed) {
      // Refresh token manquant (login d'avant la capture) ou révoqué (app
      // désautorisée). On guide vers le relogin complet qui re-capture tout.
      return NextResponse.json({
        error: 'Resynchronisation automatique impossible. Reconnecte-toi avec Discord pour rafraîchir tes connexions.',
        needsRelogin: true,
      }, { status: 409 });
    }

    const fresh = await fetchDiscordConnections(refreshed.accessToken);
    if (fresh.length === 0) {
      // Fetch vide = échec transitoire OU aucune connexion liée. On NE wipe PAS.
      return NextResponse.json({
        ok: true,
        changed: false,
        connectionTypes: (existing ?? []).map(c => c.type),
      });
    }

    const merged = mergeConnections(fresh, existing);
    await userRef.update({ discordConnections: merged });

    return NextResponse.json({
      ok: true,
      changed: true,
      connectionTypes: merged.map(c => c.type),
    });
  } catch (err) {
    captureApiError('API refresh-discord-connections error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
