import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { getStructureWeeklyCount } from '@/lib/ballchasing-quota';

// GET /api/structures/[id]/ballchasing-quota
// Renvoie le compteur d'uploads ballchasing réussis de la structure pour la
// semaine courante (lundi 00:00 UTC → maintenant). Utilisé par la jauge UI
// dans my-structure pour afficher "X/20 stats parsées · reset lundi".
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const count = await getStructureWeeklyCount(db, structureId);
    return NextResponse.json(count);
  } catch (err) {
    captureApiError('API structure ballchasing-quota', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
