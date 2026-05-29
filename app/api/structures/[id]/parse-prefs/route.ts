import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { resolveStructureId } from '@/lib/resolve-structure-id';
import { canAccessDocuments } from '@/lib/document-permissions';
import { isDirigeant } from '@/lib/event-permissions';

// GET / PATCH /api/structures/[id]/parse-prefs
//
// GET : renvoie la préférence "auto-parse ballchasing" de la structure.
//   - Default false (= upload ne lance pas le parsing auto)
//   - Lecture autorisée à tout le staff (= ceux qui peuvent voir les replays)
//     pour que la checkbox du ReplayUploader puisse pré-cocher
//
// PATCH : update du flag. Réservé aux dirigeants (fondateur + co-fondateurs).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const auto = resolved.structure.ballchasingAutoParse === true;
    return NextResponse.json({ ballchasingAutoParse: auto });
  } catch (err) {
    captureApiError('API structure parse-prefs GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: slugOrId } = await params;
    const db = getAdminDb();
    const structureId = await resolveStructureId(slugOrId, db);
    if (!structureId) {
      return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    }
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!isDirigeant(resolved.context)) {
      return NextResponse.json({ error: 'Réservé aux dirigeants' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const value = body.ballchasingAutoParse;
    if (typeof value !== 'boolean') {
      return NextResponse.json({ error: 'ballchasingAutoParse doit être un booléen' }, { status: 400 });
    }

    await db.collection('structures').doc(structureId).update({
      ballchasingAutoParse: value,
    });

    return NextResponse.json({ ballchasingAutoParse: value });
  } catch (err) {
    captureApiError('API structure parse-prefs PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
