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

// POST — le fondateur promeut un membre en co-fondateur
// DELETE — le fondateur rétrograde un co-fondateur en joueur
// Dans les deux cas : update atomique de `structures.coFounderIds` ET du `structure_members.role`
// associé pour que l'affichage (qui s'appuie sur `role`) reste cohérent avec les permissions.

async function fetchDirigeantRefs(
  db: FirebaseFirestore.Firestore,
  targetUserId: string
): Promise<DirigeantRef[]> {
  const [founderSnap, coFounderSnap] = await Promise.all([
    db.collection('structures').where('founderId', '==', targetUserId).get(),
    db.collection('structures').where('coFounderIds', 'array-contains', targetUserId).get(),
  ]);
  const toRef = (d: FirebaseFirestore.QueryDocumentSnapshot): DirigeantRef => ({
    id: d.id,
    founderId: d.data().founderId,
    coFounderIds: d.data().coFounderIds ?? [],
    status: d.data().status,
  });
  return [...founderSnap.docs.map(toRef), ...coFounderSnap.docs.map(toRef)];
}

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { structureId, targetUserId } = body;
    if (!structureId || !targetUserId) {
      return NextResponse.json({ error: 'structureId et targetUserId requis' }, { status: 400 });
    }
    if (targetUserId === uid) {
      return NextResponse.json({ error: 'Tu ne peux pas te promouvoir toi-même.' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structureData = structureSnap.data()!;

    // Seul le fondateur peut promouvoir — pas de cascade
    if (structureData.founderId !== uid) {
      return NextResponse.json({ error: 'Seul le fondateur peut promouvoir des co-fondateurs.' }, { status: 403 });
    }
    if (structureData.status === 'suspended') {
      return NextResponse.json({ error: 'Structure suspendue — action bloquée.' }, { status: 403 });
    }

    const currentCoFounders: string[] = structureData.coFounderIds ?? [];
    if (currentCoFounders.includes(targetUserId)) {
      return NextResponse.json({ error: 'Ce membre est déjà co-fondateur.' }, { status: 400 });
    }
    if (currentCoFounders.length >= MAX_CO_FOUNDERS_PER_STRUCTURE) {
      return NextResponse.json({
        error: `Maximum ${MAX_CO_FOUNDERS_PER_STRUCTURE} co-fondateurs par structure.`,
      }, { status: 400 });
    }

    // La cible doit déjà être membre — on ne peut pas promouvoir quelqu'un de l'extérieur
    const memberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', targetUserId)
      .get();
    if (memberSnap.empty) {
      return NextResponse.json({ error: 'Cet utilisateur n\'est pas membre de la structure.' }, { status: 400 });
    }

    // Vérifier que la cible n'a pas déjà 2 sièges dirigeant ailleurs
    // (la structure courante ne compte pas — on la filtre dans countDirigeantSeats)
    const refs = await fetchDirigeantRefs(db, targetUserId);
    if (countDirigeantSeats(refs, targetUserId, structureId) >= MAX_SEATS_PER_PERSON) {
      return NextResponse.json({
        error: `Ce membre occupe déjà ${MAX_SEATS_PER_PERSON} sièges dirigeant ailleurs.`,
      }, { status: 400 });
    }

    const batch = db.batch();
    batch.update(structureRef, {
      coFounderIds: FieldValue.arrayUnion(targetUserId),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const memberDoc of memberSnap.docs) {
      batch.update(memberDoc.ref, { role: 'co_fondateur' });
    }
    addAuditLog(db, batch, {
      structureId,
      action: 'cofounder_promoted',
      actorUid: uid,
      targetUid: targetUserId,
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/co-founders POST error', err);
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
    const { structureId, targetUserId } = body;
    if (!structureId || !targetUserId) {
      return NextResponse.json({ error: 'structureId et targetUserId requis' }, { status: 400 });
    }

    const db = getAdminDb();
    const structureRef = db.collection('structures').doc(structureId);
    const structureSnap = await structureRef.get();
    if (!structureSnap.exists) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const structureData = structureSnap.data()!;

    if (structureData.founderId !== uid) {
      return NextResponse.json({ error: 'Seul le fondateur peut rétrograder des co-fondateurs.' }, { status: 403 });
    }

    const currentCoFounders: string[] = structureData.coFounderIds ?? [];
    if (!currentCoFounders.includes(targetUserId)) {
      return NextResponse.json({ error: 'Ce membre n\'est pas co-fondateur.' }, { status: 400 });
    }

    const memberSnap = await db.collection('structure_members')
      .where('structureId', '==', structureId)
      .where('userId', '==', targetUserId)
      .get();

    // Retirer aussi un éventuel préavis de départ en cours (la rétrogradation remplace le départ)
    const updates: Record<string, unknown> = {
      coFounderIds: FieldValue.arrayRemove(targetUserId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const departures = structureData.coFounderDepartures ?? {};
    if (departures[targetUserId]) {
      updates[`coFounderDepartures.${targetUserId}`] = FieldValue.delete();
    }

    const batch = db.batch();
    batch.update(structureRef, updates);
    for (const memberDoc of memberSnap.docs) {
      batch.update(memberDoc.ref, { role: 'joueur' });
    }
    addAuditLog(db, batch, {
      structureId,
      action: 'cofounder_demoted',
      actorUid: uid,
      targetUid: targetUserId,
      metadata: {
        hadPendingDeparture: !!departures[targetUserId],
      },
    });
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Structures/co-founders DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
