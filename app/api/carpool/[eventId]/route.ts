import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { getCarpoolEvent, validateTripPayload } from '@/lib/carpool';
import { computeRoute, isRoutingConfigured } from '@/lib/carpool-routing';
import {
  canParticipate, listTrips, countTrips, saveTrip, deleteTrip,
} from '@/lib/carpool-server';

// Covoiturage vers un événement.
//
// GET    — l'état de la carte. Un visiteur qui n'est pas inscrit reçoit le
//          COMPTE des trajets et rien d'autre : ni position, ni pseudo. C'est
//          ce qui permet d'annoncer « 12 joueurs ont posé leur trajet » sur la
//          page publique sans rien divulguer.
// PUT    — poser ou corriger SON trajet. Une seule fiche par personne.
// DELETE — retirer le sien, ou celui de quelqu'un d'autre quand on est admin
//          (modération), auquel cas c'est journalisé.

/** Ce que le client a besoin de savoir de l'événement : où l'on va, et sous
 *  quelle période. */
function publicEvent(ev: NonNullable<ReturnType<typeof getCarpoolEvent>>) {
  return {
    id: ev.id,
    label: ev.label,
    destination: ev.destination,
    window: ev.window,
    href: ev.href,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const ev = getCarpoolEvent(eventId);
    if (!ev) return NextResponse.json({ error: 'Événement inconnu.' }, { status: 404 });

    const db = getAdminDb();
    const uid = await verifyAuth(req);

    // Porte fermée : on ne renvoie qu'un compteur. Aucune position ne sort.
    if (!uid || !(await canParticipate(db, ev, uid))) {
      return NextResponse.json({
        allowed: false,
        authenticated: Boolean(uid),
        event: publicEvent(ev),
        count: await countTrips(db, ev),
      });
    }

    const trips = await listTrips(db, ev);
    return NextResponse.json({
      allowed: true,
      authenticated: true,
      event: publicEvent(ev),
      me: uid,
      trips,
      count: trips.length,
      /** Sans clé de calcul, les tracés sont des traits droits. L'écran doit
       *  pouvoir le dire plutôt que de laisser croire à un itinéraire. */
      routing: isRoutingConfigured() ? 'road' : 'straight',
    });
  } catch (err) {
    captureApiError('API Carpool GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const ev = getCarpoolEvent(eventId);
    if (!ev) return NextResponse.json({ error: 'Événement inconnu.' }, { status: 404 });

    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    if (!(await canParticipate(db, ev, uid))) {
      return NextResponse.json(
        { error: 'Le covoiturage est réservé aux joueurs inscrits à l’événement.' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = validateTripPayload(body ?? {}, ev);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // L'itinéraire est TOUJOURS recalculé ici, jamais lu depuis le corps de la
    // requête : sinon n'importe qui pourrait faire afficher au site le tracé
    // de son choix. Une demande de place n'en a pas — sans voiture, il n'y a
    // pas de route à tracer.
    const route = parsed.value.kind === 'offer'
      ? await computeRoute(ev, parsed.value.origin, parsed.value.waypoints)
      : null;

    await saveTrip(db, ev, uid, { ...parsed.value, route });
    return NextResponse.json({ ok: true, trip: { ...parsed.value, route, eventId: ev.id, uid } });
  } catch (err) {
    captureApiError('API Carpool PUT error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const ev = getCarpoolEvent(eventId);
    if (!ev) return NextResponse.json({ error: 'Événement inconnu.' }, { status: 404 });

    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    const cible = req.nextUrl.searchParams.get('uid');

    // Retirer le trajet de QUELQU'UN D'AUTRE est un acte de modération :
    // réservé aux administrateurs, et journalisé. C'est la différence avec une
    // carte partagée, où le premier venu efface le travail des autres.
    //
    // Même rôle que le reste de la console de l'événement : un admin de
    // compétition qui gère la LAN doit pouvoir modérer sa carte.
    if (cible && cible !== uid) {
      if (!(await isCompetitionAdmin(uid))) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
      await deleteTrip(db, ev.id, cible);
      await writeAdminAuditLog(db, {
        action: 'carpool_trip_deleted',
        adminUid: uid,
        targetType: 'user',
        targetId: cible,
        targetLabel: null,
        metadata: { eventId: ev.id },
      });
      return NextResponse.json({ ok: true });
    }

    await deleteTrip(db, ev.id, uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API Carpool DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
