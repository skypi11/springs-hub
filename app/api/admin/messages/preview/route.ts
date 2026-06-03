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

    return NextResponse.json({
      count: users.length,
      dmReachable: users.length - optedOut, // destinataires DM potentiels (hors opt-out)
      optedOut,
    });
  } catch (err) {
    captureApiError('API admin/messages/preview GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
