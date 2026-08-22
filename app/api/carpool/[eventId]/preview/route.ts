import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { captureApiError } from '@/lib/sentry';
import { getCarpoolEvent, validateTripPayload } from '@/lib/carpool';
import { computeRoute } from '@/lib/carpool-routing';
import { canParticipate } from '@/lib/carpool-server';

// L'itinéraire AVANT d'enregistrer.
//
// C'est ce qui permet d'annoncer au conducteur ce que coûte une étape —
// « +18 min de détour » — pendant qu'il la place, et non après coup. Sans ça,
// « je prends quelqu'un en chemin » se décide à l'aveugle.
//
// Rien n'est écrit ici : la route calcule et rend la main. Limitée en débit
// comme une écriture, parce qu'elle consomme le quota du calculateur.

export async function POST(req: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
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
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    // On rejoue la MÊME validation qu'à l'enregistrement : un aperçu qui
    // accepterait ce que le serveur refusera ensuite ne servirait qu'à faire
    // perdre son temps au joueur.
    const parsed = validateTripPayload({ ...(body ?? {}), kind: 'offer' }, ev);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    // On renvoie AUSSI le trajet direct quand il y a des étapes : c'est la
    // comparaison des deux qui donne « +18 min de détour ». La calculer ici
    // évite au navigateur un second aller-retour, et surtout évite qu'il
    // affiche un détour calculé sur des tracés d'âges différents.
    const [route, direct] = await Promise.all([
      computeRoute(ev, parsed.value.origin, parsed.value.waypoints),
      parsed.value.waypoints.length > 0
        ? computeRoute(ev, parsed.value.origin, [])
        : Promise.resolve(null),
    ]);
    return NextResponse.json({ route, direct });
  } catch (err) {
    captureApiError('API Carpool preview error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
