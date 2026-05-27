import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { syncValorantRanksBatch } from '@/lib/valorant-sync';

// GET /api/cron/sync-valorant-ranks
//
// Route dédiée pour la sync rang Valorant via HenrikDev. Test manuel via :
//   curl -H "Authorization: Bearer $CRON_SECRET" https://aedral.com/api/cron/sync-valorant-ranks
//
// En production, la même logique tourne aussi dans le cron quotidien
// /api/cron/expire-invitations (Vercel Hobby = 1 cron/jour, donc on empile
// toutes les passes nocturnes sur celui-là). Cette route séparée sert :
// - aux tests manuels (vérifier que HenrikDev répond, debug d'un user précis)
// - à pouvoir trigger une sync hors du cycle quotidien si besoin
//
// Sécurisé par CRON_SECRET (Bearer). En dev sans secret, accessible librement.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
      }
    } else if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'CRON_SECRET non configuré' }, { status: 500 });
    }

    const db = getAdminDb();
    const stats = await syncValorantRanksBatch(db);

    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    captureApiError('API cron sync-valorant-ranks error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
