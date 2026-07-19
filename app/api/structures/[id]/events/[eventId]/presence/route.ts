import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { writePresence } from '@/lib/event-presence-server';
import type { PresenceStatus } from '@/lib/event-permissions';

// POST /api/structures/[id]/events/[eventId]/presence
// Body : { userId?: string, status: 'present' | 'absent' | 'maybe' | 'pending' }
// Si userId omis ou === uid → l'user répond pour lui-même.
// Sinon → le staff modifie pour qqn d'autre (canModifyOthersPresence).
//
// L'écriture réelle + toutes les autorisations vivent dans writePresence
// (lib/event-presence-server) — chemin partagé avec le handler d'interactions
// Discord pour garantir des règles identiques sur les deux surfaces.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId, eventId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    const body = await req.json();
    const targetUserId = (body.userId as string | undefined) ?? uid;
    const newStatus = body.status as PresenceStatus;

    const result = await writePresence(db, {
      actorUid: uid,
      targetUserId,
      eventId,
      status: newStatus,
      expectedStructureId: structureId,
    });

    if (result.ok) return NextResponse.json({ success: true });

    switch (result.code) {
      case 'invalid_status':
        return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });
      case 'not_invited':
        return NextResponse.json({ error: 'Cet utilisateur n\'est pas invité' }, { status: 404 });
      case 'event_not_found':
      case 'structure_unavailable':
        return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
      case 'event_closed':
      case 'forbidden':
      default:
        return NextResponse.json({ error: 'Réponse impossible (événement terminé/annulé ?)' }, { status: 403 });
    }
  } catch (err) {
    captureApiError('API Structures/events presence POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
