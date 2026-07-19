import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canViewEventReplayStats, canViewReplayStats } from '@/lib/replay-permissions';
import type { TeamRef } from '@/lib/event-permissions';

// GET /api/events/[eventId]/meta
// Fetch les méta d'un event (titre, type, dates, adversaire, structureId)
// pour la page dédiée /community/event/[id]/stats. Résout structureId depuis
// l'event puis vérifie via resolveUserContext que l'user y a bien accès.
//
// Endpoint léger, ne renvoie pas les replays ni les présences, juste de quoi
// afficher le header de la page stats. Pour les stats elles-mêmes, le client
// appellera /api/structures/[id]/events/[eventId]/replay-stats-agg.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { eventId } = await params;
    const db = getAdminDb();
    const snap = await db.collection('structure_events').doc(eventId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    const data = snap.data()!;
    const structureId = data.structureId as string;

    // Auth : staff/capitaine (accès calendrier) OU joueur d'une des équipes
    // ciblées par l'event (lecture des stats, §3.4). Lecture seule, zéro quota.
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    const target = (data.target ?? { scope: 'structure' }) as { scope: string; teamIds?: string[] };
    if (!canViewEventReplayStats(resolved.context, target, resolved.teams as TeamRef[])) {
      // Alignement avec /replay-stats-agg (§3.4) : cette route sert au joueur les
      // replays de SES équipes quel que soit le scope de l'event. Si l'event est
      // loggé en scope='structure'/'game' mais porte un replay d'une équipe du
      // joueur, la garde ci-dessus renvoyait 403 alors que les stats sont bien
      // lisibles → page cassée. On accorde donc l'accès si (et seulement si) une
      // équipe accessible au joueur a réellement un replay sur cet event.
      const teams = resolved.teams as TeamRef[];
      const allowedTeamIds = new Set(
        teams.filter(t => canViewReplayStats(resolved.context, t.id, t)).map(t => t.id),
      );
      let granted = false;
      if (allowedTeamIds.size > 0) {
        // Requête mono-champ (eventId) → pas d'index composite requis ; filtre
        // status/teamId en mémoire (un event a peu de replays).
        const repSnap = await db.collection('replays').where('eventId', '==', eventId).limit(50).get();
        granted = repSnap.docs.some(d => {
          const r = d.data();
          return r.status === 'ready' && allowedTeamIds.has(r.teamId as string);
        });
      }
      if (!granted) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    return NextResponse.json({
      eventId,
      structureId,
      structureName: resolved.structure.name ?? '',
      title: (data.title as string) || 'Sans titre',
      type: (data.type as string) || 'event',
      startsAt: data.startsAt?.toDate?.()?.toISOString() ?? null,
      endsAt: data.endsAt?.toDate?.()?.toISOString() ?? null,
      opponent: (data.opponent as string) || null,
      result: (data.result as string) || null,
      score: (data.score as string) || null,
    });
  } catch (err) {
    captureApiError('API event meta', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
