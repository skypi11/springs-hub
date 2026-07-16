import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { validateCompetitionPayload } from '@/lib/competitions/validate';
import { toFirestoreCompetition } from '@/lib/competitions/serialize';

// Édition/suppression d'une compétition — admins Aedral complets uniquement.
// Au Lot 0 tout vit en draft : les transitions de statut (publication,
// ouverture des inscriptions…) arrivent avec le wizard du Lot 1.

// PATCH /api/admin/competitions/[id] — édition, verrouillée après draft
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();
    const validated = validateCompetitionPayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const payload = validated.value;

    const db = getAdminDb();
    const ref = db.collection('competitions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Compétition introuvable' }, { status: 404 });

    const existing = snap.data() ?? {};
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Compétition verrouillée : seules les compétitions en brouillon sont éditables au Lot 0.' },
        { status: 409 },
      );
    }

    // Changement de circuit : cohérence de jeu + maintien des deux côtés du
    // lien dénormalisé (competitionIds sur l'ancien ET le nouveau circuit).
    const oldCircuitId = (existing.circuitId as string | null) ?? null;
    if (payload.circuitId && payload.circuitId !== oldCircuitId) {
      const circuitSnap = await db.collection('circuits').doc(payload.circuitId).get();
      if (!circuitSnap.exists) {
        return NextResponse.json({ error: 'Circuit introuvable.' }, { status: 400 });
      }
      if (circuitSnap.data()?.game !== payload.game) {
        return NextResponse.json({ error: 'Le circuit et la compétition doivent être sur le même jeu.' }, { status: 400 });
      }
    }

    const batch = db.batch();
    batch.update(ref, {
      ...toFirestoreCompetition(payload),
      // Flag test éditable tant que la compét est en brouillon (hors schéma
      // de validation partagé). Ne s'écrit que si explicitement fourni.
      ...(typeof body.isDev === 'boolean' ? { isDev: body.isDev } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (payload.circuitId !== oldCircuitId) {
      // batch.update échoue (NOT_FOUND, batch entier rollback) si le doc cible
      // n'existe plus — or la DB partagée peut avoir perdu un circuit TEST
      // purgé à la main. Si l'ancien circuit a disparu, le lien dénormalisé
      // est déjà mort : on continue sans lui (review adversariale Lot 0).
      if (oldCircuitId) {
        const oldSnap = await db.collection('circuits').doc(oldCircuitId).get();
        if (oldSnap.exists) {
          batch.update(oldSnap.ref, {
            competitionIds: FieldValue.arrayRemove(id),
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          console.warn(`[admin/competitions] circuit ${oldCircuitId} introuvable au détachement de ${id}`);
        }
      }
      if (payload.circuitId) {
        batch.update(db.collection('circuits').doc(payload.circuitId), {
          competitionIds: FieldValue.arrayUnion(id),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();

    await writeAdminAuditLog(db, {
      action: 'competition_edited',
      adminUid: uid,
      targetType: 'competition',
      targetId: id,
      targetLabel: payload.name,
      metadata: {
        circuitId: payload.circuitId ?? undefined,
        ...(payload.circuitId !== oldCircuitId ? { circuitChangedFrom: oldCircuitId ?? 'aucun' } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Competitions PATCH error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/admin/competitions/[id] — uniquement draft ET sans inscription
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const ref = db.collection('competitions').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Compétition introuvable' }, { status: 404 });

    const data = snap.data() ?? {};
    if (data.status !== 'draft') {
      return NextResponse.json({ error: 'Seule une compétition en brouillon peut être supprimée.' }, { status: 409 });
    }

    // Garde-fou données : même en draft, s'il existe des inscriptions (données
    // de test comprises), on refuse — les purger explicitement d'abord.
    const regs = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .limit(1)
      .get();
    if (!regs.empty) {
      return NextResponse.json(
        { error: 'Des inscriptions existent sur cette compétition : purge-les avant de la supprimer.' },
        { status: 409 },
      );
    }

    const batch = db.batch();
    batch.delete(ref);
    const circuitId = (data.circuitId as string | null) ?? null;
    if (circuitId) {
      // Même garde que le PATCH : un circuit disparu (purge manuelle sur la DB
      // partagée) ne doit pas rendre la compétition insupprimable.
      const circuitSnap = await db.collection('circuits').doc(circuitId).get();
      if (circuitSnap.exists) {
        batch.update(circuitSnap.ref, {
          competitionIds: FieldValue.arrayRemove(id),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        console.warn(`[admin/competitions] circuit ${circuitId} introuvable à la suppression de ${id}`);
      }
    }
    await batch.commit();

    await writeAdminAuditLog(db, {
      action: 'competition_deleted',
      adminUid: uid,
      targetType: 'competition',
      targetId: id,
      targetLabel: (data.name as string) ?? null,
      metadata: circuitId ? { circuitId } : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    captureApiError('API Admin/Competitions DELETE error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
