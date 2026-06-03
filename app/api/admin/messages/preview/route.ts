// GET /api/admin/messages/preview?segment=<id>&game=<gameId>
// Compte les destinataires d'un segment (admin only), pour l'aperçu live dans
// /admin/messages avant l'envoi. Renvoie aussi le nombre d'opt-out DM.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isSegmentId } from '@/lib/admin-segments';
import { querySegmentUsers } from '@/lib/admin-segment-query';

export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const segment = req.nextUrl.searchParams.get('segment');
    const game = req.nextUrl.searchParams.get('game');
    if (!isSegmentId(segment)) {
      return NextResponse.json({ error: 'Segment invalide' }, { status: 400 });
    }

    const users = await querySegmentUsers(getAdminDb(), segment, game || null);
    const optedOut = users.filter(u => u.optedOutDM).length;
    // dmReachable aligné sur la logique du /send : hors opt-out ET avec une
    // snowflake Discord valide (un discordId vide n'est pas joignable en DM).
    const dmReachable = users.filter(u => !u.optedOutDM && u.discordId).length;

    // Liste dépliable des destinataires (cappée pour ne pas exploser la réponse).
    // `count` reste exact même si la liste est tronquée.
    const PREVIEW_LIST_CAP = 500;
    const recipients = users.slice(0, PREVIEW_LIST_CAP).map(u => ({
      uid: u.uid,
      name: u.displayName,
      dmReachable: !u.optedOutDM && !!u.discordId,
      optedOut: u.optedOutDM,
    }));

    return NextResponse.json({
      count: users.length,
      dmReachable,
      optedOut,
      recipients,
      listTruncated: users.length > PREVIEW_LIST_CAP,
    });
  } catch (err) {
    captureApiError('API admin/messages/preview GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
