import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { validateCircuitPayload } from '@/lib/competitions/validate';
import { serializeCircuit } from '@/lib/competitions/serialize';

// Circuits du moteur de compétitions (Legends Springs Cup = 1 circuit).
// Périmètre des rôles (spec Legends §6) : la CRÉATION/ÉDITION des circuits et
// compétitions est réservée aux admins Aedral complets — le rôle scopé « admin
// de compétition » gère les inscriptions/litiges/scores, pas la configuration.
// La LECTURE des listes est ouverte aux admins de compétition (ils en auront
// besoin dans la console dès le Lot 1).

// GET /api/admin/circuits — liste complète (peu de docs, tri en mémoire)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const db = getAdminDb();
    const snap = await db.collection('circuits').get();
    const circuits = snap.docs
      .map(d => serializeCircuit(d.id, d.data()))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ circuits });
  } catch (err) {
    captureApiError('API Admin/Circuits GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/admin/circuits — création (statut draft imposé)
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const validated = validateCircuitPayload(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const db = getAdminDb();
    // PAS de createdBy sur le doc : circuits est en lecture publique et
    // l'invariant archi §8 interdit tout uid/snowflake dans les docs publics
    // (review adversariale Lot 0). L'auteur est tracé par l'audit log.
    const ref = await db.collection('circuits').add({
      ...validated.value,
      // Un circuit naît toujours en draft : la publication (visibilité public)
      // arrive avec les pages publiques des lots suivants.
      status: 'draft',
      competitionIds: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    await writeAdminAuditLog(db, {
      action: 'circuit_created',
      adminUid: uid,
      targetType: 'circuit',
      targetId: ref.id,
      targetLabel: validated.value.name,
      metadata: { game: validated.value.game },
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (err) {
    captureApiError('API Admin/Circuits POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
