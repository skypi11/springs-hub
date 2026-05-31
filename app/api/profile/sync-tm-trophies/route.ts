import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { syncTrackmaniaTrophiesForUser } from '@/lib/trackmania-sync';

// POST /api/profile/sync-tm-trophies
//
// Trigger une sync immédiate des trophées Trackmania pour le user authentifié.
// Pas de body. Réponse : { ok } ou { error }.
//
// Le cron nocturne /api/cron/sync-trackmania-trophies fait le boulot en batch,
// mais le user veut ses trophées TOUT DE SUITE après avoir mis à jour son
// pseudo ou son URL tm.io → ce endpoint permet ça sans attendre la passe cron.
//
// Pré-requis : l'user a renseigné une URL trackmania.io valide dans Settings
// (Mes jeux → Trackmania). Sinon retourne 400 explicite.

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    // Rate limit serré, empêcher un user de spammer tm.io via Aedral
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const result = await syncTrackmaniaTrophiesForUser(db, uid);
    if (result.ok) {
      return NextResponse.json({ ok: true });
    }

    const messages: Record<string, string> = {
      user_not_found: 'Utilisateur introuvable.',
      no_tm_io_url: 'Aucune URL trackmania.io renseignée. Va dans Mes jeux → Trackmania pour la configurer.',
    };
    const reason = result.reason;
    if (messages[reason]) {
      return NextResponse.json({ error: messages[reason] }, { status: 400 });
    }
    if (reason.startsWith('tm_io_')) {
      const status = reason.slice('tm_io_'.length);
      if (status === '404') {
        return NextResponse.json({
          error: 'Joueur introuvable sur trackmania.io. Vérifie que ton URL est correcte.',
        }, { status: 404 });
      }
      if (status === '429') {
        return NextResponse.json({
          error: 'trackmania.io a rate-limité ta requête. Réessaie dans 1 minute.',
        }, { status: 429 });
      }
      return NextResponse.json({
        error: `trackmania.io indisponible (${status}). Réessaie dans quelques minutes.`,
      }, { status: 502 });
    }
    return NextResponse.json({ error: `Sync échouée (${reason}).` }, { status: 500 });
  } catch (err) {
    captureApiError('API profile/sync-tm-trophies POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
