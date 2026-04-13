import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// POST — le co-fondateur dépose un préavis de départ (7 jours avant retrait effectif)
// DELETE — le co-fondateur annule son préavis
// Le retrait effectif est géré en lazy-process dans les GET de structures/my et structures/[id]
// (le cron n'existe pas encore, donc on traite au moment de la lecture).

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId } = body;
    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structureData = structureSnap.data()!;

    const coFounders: string[] = structureData.coFounderIds ?? [];
    if (!coFounders.includes(uid)) {
      return NextResponse.json({ error: 'Tu n\'es pas co-fondateur de cette structure.' }, { status: 403 });
    }

    const departures = structureData.coFounderDepartures ?? {};
    if (departures[uid]) {
      return NextResponse.json({ error: 'Tu as déjà un préavis en cours.' }, { status: 400 });
    }

    // On utilise un champ notation plutôt que coFounderDepartures: { ... } pour préserver
    // les autres préavis existants sans les réécrire.
    await structureRef.update({
      [`coFounderDepartures.${uid}`]: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/co-founders/leave POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId } = body;
    if (!structureId) {
      return NextResponse.json({ error: 'structureId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structureData = structureSnap.data()!;

    const departures = structureData.coFounderDepartures ?? {};
    if (!departures[uid]) {
      return NextResponse.json({ error: 'Aucun préavis en cours.' }, { status: 400 });
    }

    await structureRef.update({
      [`coFounderDepartures.${uid}`]: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/co-founders/leave DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
