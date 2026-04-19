import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { isStaffOfTeam } from '@/lib/event-permissions';

// GET /api/structures/[id]/events/[eventId]/lineup?subTeamId=X
// Renvoie deux listes pour le pré-remplissage d'un devoir lié à un event :
//  - `confirmed` : les userIds avec event_presences.status='present', intersectés avec le roster de l'équipe
//  - `rosterFallback` : tous les membres de l'équipe (players + subs), fallback si aucun 'present'
// Accessible uniquement au staff de l'équipe cible (fondateur/co-fondateur/manager/coach d'équipe).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, eventId } = await params;
    const subTeamId = req.nextUrl.searchParams.get('subTeamId');
    if (!subTeamId) {
      return NextResponse.json({ error: 'subTeamId requis.' }, { status: 400 });
    }

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }

    // Permission : staff de l'équipe cible (pour éviter que n'importe qui lise les présences).
    if (!isStaffOfTeam(resolved.context, subTeamId)) {
      return NextResponse.json({ error: 'Permissions insuffisantes.' }, { status: 403 });
    }

    // Team existe bien et appartient à la structure.
    const team = resolved.teams.find(t => t.id === subTeamId);
    if (!team) {
      return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 });
    }

    // Event existe bien et appartient à la structure.
    const evSnap = await db.collection('structure_events').doc(eventId).get();
    if (!evSnap.exists || evSnap.data()?.structureId !== structureId) {
      return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
    }

    // Roster de l'équipe : players (titulaires) + subs (remplaçants). Pas le staff : on assigne
    // des devoirs aux joueurs, pas au coach (à moins que le staff les ajoute manuellement ensuite).
    const roster = new Set<string>([
      ...(((team as { playerIds?: string[] }).playerIds) ?? []),
      ...(((team as { subIds?: string[] }).subIds) ?? []),
    ]);

    // Présences confirmées.
    const pSnap = await db.collection('event_presences')
      .where('eventId', '==', eventId)
      .where('status', '==', 'present')
      .get();
    const present: string[] = [];
    for (const d of pSnap.docs) {
      const userId = d.data().userId as string | undefined;
      if (userId && roster.has(userId)) present.push(userId);
    }

    return NextResponse.json({
      confirmed: present,
      rosterFallback: Array.from(roster),
    });
  } catch (err) {
    captureApiError('API Structures/events lineup GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
