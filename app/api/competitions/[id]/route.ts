import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';

// GET /api/competitions/[id] — fiche publique d'une compétition.
// Sert la config publique (format, fenêtres, planning) + la liste des équipes
// VALIDÉES (nom/tag/logo uniquement : le snapshot d'inscription complet — MMR,
// âges, Discord IDs — reste deny-all, servi à la validation admin, archi §2).
// Feature gating : draft = 404 pour le public, visible admins compét.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const { id } = await params;
    const db = getAdminDb();

    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const comp = compSnap.data()!;

    if (comp.status === 'draft') {
      // Draft visible des admins compét ET des comptes fictifs du bac à sable
      // (users.isDev, Admin SDK only) — jamais du public.
      const uid = await verifyAuth(req);
      if (!uid) return NextResponse.json({ error: 'not_found' }, { status: 404 });
      if (!(await isCompetitionAdmin(uid))) {
        const userSnap = await db.collection('users').doc(uid).get();
        if (userSnap.data()?.isDev !== true) {
          return NextResponse.json({ error: 'not_found' }, { status: 404 });
        }
      }
    }

    // Équipes inscrites affichées publiquement : les validées (+ liste
    // d'attente, comptée à part). Jamais les pending/rejetées.
    const regsSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .get();
    const teams: Array<{ name: string; tag: string; logoUrl: string | null }> = [];
    let waitlisted = 0;
    for (const d of regsSnap.docs) {
      const r = d.data();
      if (r.status === 'approved') {
        teams.push({ name: r.name ?? '', tag: r.tag ?? '', logoUrl: r.logoUrl ?? null });
      } else if (r.status === 'waitlisted') {
        waitlisted++;
      }
    }
    teams.sort((a, b) => a.name.localeCompare(b.name));

    let circuitName: string | null = null;
    if (comp.circuitId) {
      const circuitSnap = await db.collection('circuits').doc(comp.circuitId as string).get();
      circuitName = (circuitSnap.data()?.name as string) ?? null;
    }

    return NextResponse.json({
      competition: {
        id,
        name: comp.name ?? '',
        game: comp.game ?? '',
        status: comp.status ?? 'draft',
        circuitId: comp.circuitId ?? null,
        circuitName,
        format: comp.format ?? null,
        roster: comp.roster ?? null,
        eligibility: comp.eligibility ?? null,
        registration: {
          opensAt: comp.registration?.opensAt?.toDate?.()?.toISOString() ?? null,
          closesAt: comp.registration?.closesAt?.toDate?.()?.toISOString() ?? null,
          waitlist: comp.registration?.waitlist === true,
        },
        schedule: comp.schedule ?? null,
      },
      teams,
      waitlistedCount: waitlisted,
    });
  } catch (err) {
    captureApiError('API Competitions GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
