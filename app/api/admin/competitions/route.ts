import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { validateCompetitionPayload } from '@/lib/competitions/validate';
import { toFirestoreCompetition, serializeCompetition } from '@/lib/competitions/serialize';

// Compétitions du moteur (Legends Qualifs = 4 instances). Lecture ouverte aux
// admins de compétition, mutations réservées aux admins Aedral complets
// (spec Legends §6 : le rôle scopé gère inscriptions/litiges, pas la config).

// GET /api/admin/competitions — liste complète (peu de docs, tri en mémoire)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const db = getAdminDb();
    const snap = await db.collection('competitions').get();
    const competitions = snap.docs
      .map(d => serializeCompetition(d.id, d.data()))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ competitions });
  } catch (err) {
    captureApiError('API Admin/Competitions GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/competitions — création (statut draft imposé)
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const validated = validateCompetitionPayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const payload = validated.value;

    const db = getAdminDb();

    // Rattachement circuit : vérifie l'existence + la cohérence de jeu, et
    // maintient circuits.competitionIds en batch avec la création (le lien est
    // dénormalisé des deux côtés — archi §2).
    if (payload.circuitId) {
      const circuitSnap = await db.collection('circuits').doc(payload.circuitId).get();
      if (!circuitSnap.exists) {
        return NextResponse.json({ error: 'Circuit introuvable.' }, { status: 400 });
      }
      if (circuitSnap.data()?.game !== payload.game) {
        return NextResponse.json({ error: 'Le circuit et la compétition doivent être sur le même jeu.' }, { status: 400 });
      }
    }

    const batch = db.batch();
    const ref = db.collection('competitions').doc();
    // PAS de createdBy sur le doc : competitions est en lecture publique et
    // l'invariant archi §8 interdit tout uid/snowflake dans les docs publics
    // (review adversariale Lot 0). L'auteur est tracé par l'audit log.
    batch.set(ref, {
      ...toFirestoreCompetition(payload),
      status: 'draft',
      // Compétition de test (invisible du public même publiée) — flag simple
      // hors schéma de validation partagé, écrit à la création uniquement.
      isDev: body.isDev === true,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (payload.circuitId) {
      batch.update(db.collection('circuits').doc(payload.circuitId), {
        competitionIds: FieldValue.arrayUnion(ref.id),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    await writeAdminAuditLog(db, {
      action: 'competition_created',
      adminUid: uid,
      targetType: 'competition',
      targetId: ref.id,
      targetLabel: payload.name,
      metadata: { game: payload.game, circuitId: payload.circuitId ?? undefined },
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (err) {
    captureApiError('API Admin/Competitions POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
