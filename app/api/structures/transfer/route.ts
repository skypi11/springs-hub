import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import {
  MAX_CO_FOUNDERS_PER_STRUCTURE,
  MAX_SEATS_PER_PERSON,
  countDirigeantSeats,
  type DirigeantRef,
} from '@/lib/structure-roles';
import { addAuditLog } from '@/lib/audit-log';

// POST /api/structures/transfer — transfert de propriété d'une structure
// Seul le fondateur actuel peut déclencher. Par défaut l'ancien fondateur redevient
// simple membre (role='joueur') — la checkbox `keepAsCoFounder` permet de le conserver
// comme co-fondateur s'il s'agit d'un passage de témoin amical.

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId, newFounderId, keepAsCoFounder } = body;
    if (!structureId || !newFounderId) {
      return NextResponse.json({ error: 'structureId et newFounderId requis' }, { status: 400 });
    }
    if (newFounderId === uid) {
      return NextResponse.json({ error: 'Tu es déjà le fondateur.' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structureData = structureSnap.data()!;

    if (structureData.founderId !== uid) {
      return NextResponse.json({ error: 'Seul le fondateur peut transférer la structure.' }, { status: 403 });
    }
    if (structureData.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue — transfert bloqué.' }, { status: 403 });
    }

    // Vérifier que le nouveau fondateur est bien membre de la structure
    const newFounderMemberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', newFounderId)
      .get();
    if (newFounderMemberSnap.empty) {
      return NextResponse.json({ error: 'Le nouveau fondateur doit être membre de la structure.' }, { status: 400 });
    }

    // Vérifier que le nouveau fondateur ne dépassera pas son quota de sièges dirigeant
    // (on exclut la structure courante car on lui donne un nouveau rôle dedans)
    const [nfFounder, nfCoFounder] = await Promise.all([
      db.collection('structures').where('founderId', '==', newFounderId).get(),
      db.collection('structures').where('coFounderIds', 'array-contains', newFounderId).get(),
    ]);
    const nfRefs: DirigeantRef[] = [
      ...nfFounder.docs.map(d => ({ id: d.id, founderId: d.data().founderId, coFounderIds: d.data().coFounderIds ?? [], status: d.data().status })),
      ...nfCoFounder.docs.map(d => ({ id: d.id, founderId: d.data().founderId, coFounderIds: d.data().coFounderIds ?? [], status: d.data().status })),
    ];
    if (countDirigeantSeats(nfRefs, newFounderId, structureId) >= MAX_SEATS_PER_PERSON) {
      return NextResponse.json({
        error: `Le nouveau fondateur occupe déjà ${MAX_SEATS_PER_PERSON} sièges dirigeant ailleurs.`,
      }, { status: 400 });
    }

    // Si on veut garder l'ancien fondateur comme co-fondateur, vérifier qu'il reste de la place
    const currentCoFounders: string[] = structureData.coFounderIds ?? [];
    // Le nouveau fondateur sort des coFounderIds (s'il y était), l'ancien peut y entrer.
    const nextCoFounders = currentCoFounders.filter(id => id !== newFounderId);
    if (keepAsCoFounder) {
      if (nextCoFounders.length >= MAX_CO_FOUNDERS_PER_STRUCTURE) {
        return NextResponse.json({
          error: `Impossible de te garder comme co-fondateur : maximum ${MAX_CO_FOUNDERS_PER_STRUCTURE} atteint. Rétrograde d'abord un co-fondateur existant.`,
        }, { status: 400 });
      }
      nextCoFounders.push(uid);
    }

    // Récupérer le membre ancien fondateur pour mettre à jour son rôle
    const oldFounderMemberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', uid)
      .get();

    // Retirer un éventuel préavis en cours sur l'ancien fondateur s'il devient co-fondateur,
    // et sur le nouveau fondateur qui aurait pu avoir un préavis en tant que co-fondateur.
    const departureUpdates: Record<string, unknown> = {};
    const departures = structureData.coFounderDepartures ?? {};
    if (departures[newFounderId]) departureUpdates[`coFounderDepartures.${newFounderId}`] = FieldValue.delete();
    if (departures[uid]) departureUpdates[`coFounderDepartures.${uid}`] = FieldValue.delete();

    const batch = db.batch();
    batch.update(structureRef, {
      founderId: newFounderId,
      coFounderIds: nextCoFounders,
      transferredAt: FieldValue.serverTimestamp(),
      transferredBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
      ...departureUpdates,
    });
    // Nouveau fondateur : role = fondateur
    for (const doc of newFounderMemberSnap.docs) {
      batch.update(doc.ref, { role: 'fondateur' });
    }
    // Ancien fondateur : role = co_fondateur ou joueur selon le choix
    const oldRole = keepAsCoFounder ? 'co_fondateur' : 'joueur';
    for (const doc of oldFounderMemberSnap.docs) {
      batch.update(doc.ref, { role: oldRole });
    }
    addAuditLog(db, batch, {
      structureId,
      action: 'transfer_confirmed',
      actorUid: uid,
      targetUid: newFounderId,
      metadata: {
        previousFounderId: uid,
        keepAsCoFounder: !!keepAsCoFounder,
        oldRoleAfter: oldRole,
      },
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/transfer POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
