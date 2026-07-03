import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { getRulebookForCompetition } from '@/lib/competitions/rulebooks';

// GET /api/competitions/[id]/rulebook — règlement applicable à une compétition
// (le règlement propre à la compétition prime, sinon celui du circuit).
// PUBLIC : la page /competitions/[id]/reglement est accessible sans compte
// (spec §13bis). Feature gating : une compétition en draft n'existe pas pour
// le public — seuls les admins de compétition la voient (tests pré-publication).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const { id } = await params;
    const db = getAdminDb();

    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const comp = compSnap.data()!;

    if (comp.status === 'draft') {
      const uid = await verifyAuth(req);
      if (!uid || !(await isCompetitionAdmin(uid))) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
    }

    const rulebook = await getRulebookForCompetition(db, {
      id,
      circuitId: (comp.circuitId as string | null) ?? null,
    });

    return NextResponse.json({
      competition: {
        id,
        name: comp.name ?? '',
        game: comp.game ?? '',
        status: comp.status ?? 'draft',
      },
      rulebook,
    });
  } catch (err) {
    captureApiError('API Competitions/Rulebook GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
