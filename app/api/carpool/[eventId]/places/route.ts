import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { getCarpoolEvent } from '@/lib/carpool';
import { searchPlaces } from '@/lib/carpool-routing';
import { canParticipate } from '@/lib/carpool-server';

// Recherche d'un lieu par son nom.
//
// Relayée par le serveur, jamais appelée depuis le navigateur : la clé du
// géocodeur ne doit pas fuir dans le code client. Réservée aux inscrits, pour
// que personne ne se serve du site comme d'un géocodeur gratuit.
//
// C'est aussi ce qui rend l'écran utilisable au doigt : taper « Moulins » est
// infiniment plus simple que viser une ville sur une carte au téléphone.

export async function GET(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const ev = getCarpoolEvent(eventId);
    if (!ev) return NextResponse.json({ error: 'Événement inconnu.' }, { status: 404 });

    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const db = getAdminDb();
    if (!(await canParticipate(db, ev, uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const q = req.nextUrl.searchParams.get('q') ?? '';
    return NextResponse.json({ places: await searchPlaces(ev, q) });
  } catch (err) {
    captureApiError('API Carpool places error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
