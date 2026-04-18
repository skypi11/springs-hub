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
import { createNotification } from '@/lib/notifications';

// POST /api/structures/transfer — transfert de propriété en 2 étapes avec fenêtre 24h.
// `initiate` écrit `transferPending` sur la structure ; `cancel` le retire ;
// `confirm` ne s'exécute que si 24h se sont écoulées depuis l'initiation.
// Les invariants (siège dirigeant, membre de la structure…) sont re-vérifiés au moment
// du `confirm` pour bloquer les cas où la situation a changé pendant la fenêtre.

const TRANSFER_WINDOW_HOURS = 24;
const TRANSFER_WINDOW_MS = TRANSFER_WINDOW_HOURS * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const { action, structureId, newFounderId, keepAsCoFounder } = body;
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

    // Tolérance : si on reçoit un ancien call sans action mais avec newFounderId, on route vers initiate.
    const effectiveAction = action || (newFounderId ? 'initiate' : null);
    if (!effectiveAction) {
      return NextResponse.json({ error: 'action requis' }, { status: 400 });
    }

    switch (effectiveAction) {
      case 'initiate':
        return handleInitiate({
          db, structureRef, structureData, uid, newFounderId, keepAsCoFounder,
        });
      case 'cancel':
        return handleCancel({ db, structureRef, structureData, uid });
      case 'confirm':
        return handleConfirm({ db, structureRef, structureData, uid });
      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400 });
    }
  } catch (err) {
    captureApiError('API Structures/transfer POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

interface HandlerCtx {
  db: FirebaseFirestore.Firestore;
  structureRef: FirebaseFirestore.DocumentReference;
  structureData: FirebaseFirestore.DocumentData;
  uid: string;
}

async function validateTargetCanBeFounder(
  db: FirebaseFirestore.Firestore,
  structureId: string,
  newFounderId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  // Le nouveau fondateur doit être membre de la structure
  const memberSnap = await db.collection('structure_members')
    .where('structureId', '==', structureId)
    .where('userId', '==', newFounderId)
    .get();
  if (memberSnap.empty) {
    return { ok: false, error: 'Le nouveau fondateur doit être membre de la structure.', status: 400 };
  }

  // Le nouveau fondateur ne doit pas dépasser son quota de sièges dirigeant
  // (on exclut la structure courante car on lui donne un nouveau rôle dedans).
  const [nfFounder, nfCoFounder] = await Promise.all([
    db.collection('structures').where('founderId', '==', newFounderId).get(),
    db.collection('structures').where('coFounderIds', 'array-contains', newFounderId).get(),
  ]);
  const nfRefs: DirigeantRef[] = [
    ...nfFounder.docs.map(d => ({ id: d.id, founderId: d.data().founderId, coFounderIds: d.data().coFounderIds ?? [], status: d.data().status })),
    ...nfCoFounder.docs.map(d => ({ id: d.id, founderId: d.data().founderId, coFounderIds: d.data().coFounderIds ?? [], status: d.data().status })),
  ];
  if (countDirigeantSeats(nfRefs, newFounderId, structureId) >= MAX_SEATS_PER_PERSON) {
    return {
      ok: false,
      error: `Le nouveau fondateur occupe déjà ${MAX_SEATS_PER_PERSON} sièges dirigeant ailleurs.`,
      status: 400,
    };
  }
  return { ok: true };
}

async function handleInitiate(args: HandlerCtx & {
  newFounderId?: string;
  keepAsCoFounder?: boolean;
}) {
  const { db, structureRef, structureData, uid, newFounderId, keepAsCoFounder } = args;
  const structureId = structureRef.id;

  if (!newFounderId) {
    return NextResponse.json({ error: 'newFounderId requis' }, { status: 400 });
  }
  if (newFounderId === uid) {
    return NextResponse.json({ error: 'Tu es déjà le fondateur.' }, { status: 400 });
  }
  if (structureData.founderId !== uid) {
    return NextResponse.json({ error: 'Seul le fondateur peut transférer la structure.' }, { status: 403 });
  }
  if (structureData.status === 'suspended') {
    return NextResponse.json({ error: 'Structure suspendue — transfert bloqué.' }, { status: 403 });
  }
  if (structureData.transferPending) {
    return NextResponse.json({
      error: 'Un transfert est déjà en cours. Annule-le d\'abord si tu veux en démarrer un nouveau.',
    }, { status: 400 });
  }

  const check = await validateTargetCanBeFounder(db, structureId, newFounderId);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // Si on veut garder l'ancien fondateur comme co-fondateur, vérifier qu'il reste de la place.
  const currentCoFounders: string[] = structureData.coFounderIds ?? [];
  const nextCoFounders = currentCoFounders.filter(id => id !== newFounderId);
  if (keepAsCoFounder && nextCoFounders.length >= MAX_CO_FOUNDERS_PER_STRUCTURE) {
    return NextResponse.json({
      error: `Impossible de te garder comme co-fondateur : maximum ${MAX_CO_FOUNDERS_PER_STRUCTURE} atteint. Rétrograde d'abord un co-fondateur existant.`,
    }, { status: 400 });
  }

  const scheduledAtMs = Date.now() + TRANSFER_WINDOW_MS;
  const batch = db.batch();
  batch.update(structureRef, {
    transferPending: {
      toUid: newFounderId,
      keepAsCoFounder: !!keepAsCoFounder,
      initiatedBy: uid,
      initiatedAt: FieldValue.serverTimestamp(),
      scheduledAtMs, // stocké en ms epoch pour comparaison déterministe côté serveur
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  addAuditLog(db, batch, {
    structureId,
    action: 'transfer_initiated',
    actorUid: uid,
    targetUid: newFounderId,
    metadata: {
      keepAsCoFounder: !!keepAsCoFounder,
      windowHours: TRANSFER_WINDOW_HOURS,
      scheduledAtMs,
    },
  });
  await batch.commit();

  // Best-effort : prévenir le futur fondateur
  await createNotification(db, {
    userId: newFounderId,
    type: 'transfer_pending',
    title: 'Transfert de propriété en cours',
    message: `${structureData.name} va te revenir dans ${TRANSFER_WINDOW_HOURS}h si le fondateur ne se rétracte pas.`,
    link: '/community/my-structure',
    metadata: { structureId, scheduledAtMs },
  });

  return NextResponse.json({ success: true, scheduledAtMs });
}

async function handleCancel(args: HandlerCtx) {
  const { db, structureRef, structureData, uid } = args;
  const structureId = structureRef.id;

  const pending = structureData.transferPending;
  if (!pending) {
    return NextResponse.json({ error: 'Aucun transfert en cours.' }, { status: 400 });
  }
  // Seul le fondateur actuel (ou l'initiateur si différent, mais normalement c'est le même) peut annuler.
  const canCancel = structureData.founderId === uid || pending.initiatedBy === uid;
  if (!canCancel) {
    return NextResponse.json({ error: 'Seul le fondateur peut annuler le transfert.' }, { status: 403 });
  }

  const targetUid: string = pending.toUid;
  const batch = db.batch();
  batch.update(structureRef, {
    transferPending: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  addAuditLog(db, batch, {
    structureId,
    action: 'transfer_cancelled',
    actorUid: uid,
    targetUid,
    metadata: { cancelledBeforeMs: pending.scheduledAtMs ?? null },
  });
  await batch.commit();

  // Best-effort : prévenir la cible
  if (targetUid && targetUid !== uid) {
    await createNotification(db, {
      userId: targetUid,
      type: 'transfer_cancelled',
      title: 'Transfert annulé',
      message: `Le transfert de propriété de ${structureData.name} a été annulé.`,
      link: '/community/my-structure',
      metadata: { structureId },
    });
  }

  return NextResponse.json({ success: true });
}

async function handleConfirm(args: HandlerCtx) {
  const { db, structureRef, structureData, uid } = args;
  const structureId = structureRef.id;

  const pending = structureData.transferPending;
  if (!pending) {
    return NextResponse.json({ error: 'Aucun transfert en cours.' }, { status: 400 });
  }
  // Confirm peut être déclenché par le fondateur courant OU par la cible.
  const canConfirm = structureData.founderId === uid || pending.toUid === uid;
  if (!canConfirm) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  const scheduledAtMs: number | undefined = pending.scheduledAtMs;
  if (typeof scheduledAtMs !== 'number' || Date.now() < scheduledAtMs) {
    return NextResponse.json({
      error: `Le transfert n'est pas encore exécutable. Patiente jusqu'à la fin de la fenêtre de ${TRANSFER_WINDOW_HOURS}h.`,
      scheduledAtMs: scheduledAtMs ?? null,
    }, { status: 400 });
  }
  if (structureData.status === 'suspended') {
    return NextResponse.json({ error: 'Structure suspendue — transfert bloqué.' }, { status: 403 });
  }

  const oldFounderId: string = structureData.founderId;
  const newFounderId: string = pending.toUid;
  const keepAsCoFounder: boolean = !!pending.keepAsCoFounder;

  // Re-valider les invariants : la cible peut avoir quitté, pris un autre siège, etc.
  const check = await validateTargetCanBeFounder(db, structureId, newFounderId);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const currentCoFounders: string[] = structureData.coFounderIds ?? [];
  const nextCoFounders = currentCoFounders.filter(id => id !== newFounderId);
  if (keepAsCoFounder) {
    if (nextCoFounders.length >= MAX_CO_FOUNDERS_PER_STRUCTURE) {
      return NextResponse.json({
        error: `Impossible de garder l'ancien fondateur comme co-fondateur : maximum ${MAX_CO_FOUNDERS_PER_STRUCTURE} atteint.`,
      }, { status: 400 });
    }
    nextCoFounders.push(oldFounderId);
  }

  const [newFounderMemberSnap, oldFounderMemberSnap] = await Promise.all([
    db.collection('structure_members').where('structureId', '==', structureId).where('userId', '==', newFounderId).get(),
    db.collection('structure_members').where('structureId', '==', structureId).where('userId', '==', oldFounderId).get(),
  ]);

  // Nettoyer les préavis co-fondateur qui pourraient traîner sur les deux parties.
  const departureUpdates: Record<string, unknown> = {};
  const departures = structureData.coFounderDepartures ?? {};
  if (departures[newFounderId]) departureUpdates[`coFounderDepartures.${newFounderId}`] = FieldValue.delete();
  if (departures[oldFounderId]) departureUpdates[`coFounderDepartures.${oldFounderId}`] = FieldValue.delete();

  const batch = db.batch();
  batch.update(structureRef, {
    founderId: newFounderId,
    coFounderIds: nextCoFounders,
    transferPending: FieldValue.delete(),
    transferredAt: FieldValue.serverTimestamp(),
    transferredBy: oldFounderId,
    updatedAt: FieldValue.serverTimestamp(),
    ...departureUpdates,
  });
  for (const doc of newFounderMemberSnap.docs) {
    batch.update(doc.ref, { role: 'fondateur' });
  }
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
      previousFounderId: oldFounderId,
      keepAsCoFounder,
      oldRoleAfter: oldRole,
      confirmedBy: uid === oldFounderId ? 'old_founder' : 'new_founder',
    },
  });
  await batch.commit();

  // Best-effort : notifier les deux parties du résultat
  await Promise.all([
    createNotification(db, {
      userId: newFounderId,
      type: 'transfer_confirmed',
      title: 'Tu es désormais fondateur',
      message: `Le transfert de propriété de ${structureData.name} est finalisé.`,
      link: '/community/my-structure',
      metadata: { structureId },
    }),
    oldFounderId !== uid ? createNotification(db, {
      userId: oldFounderId,
      type: 'transfer_confirmed',
      title: 'Transfert de propriété finalisé',
      message: `${structureData.name} appartient désormais à son nouveau fondateur.`,
      link: '/community/my-structure',
      metadata: { structureId },
    }) : Promise.resolve(),
  ]);

  return NextResponse.json({ success: true });
}
