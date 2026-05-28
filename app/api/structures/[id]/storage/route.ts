import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { computeStructureStorageUsage } from '@/lib/structure-storage';

// GET /api/structures/[id]/storage
// Renvoie le breakdown du stockage de la structure (docs + replays) + quota + flag premium.
// Endpoint léger : pas de listing détaillé, juste les compteurs pour la jauge UI.
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
    // Tout le staff peut voir le quota, pas seulement les dirigeants, pour
    // que les staffs d'équipe sachent où ils en sont avant un upload.
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const usage = await computeStructureStorageUsage(db, structureId);
    return NextResponse.json(usage);
  } catch (err) {
    captureApiError('API structure storage GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
