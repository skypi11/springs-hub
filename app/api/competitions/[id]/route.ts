import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';

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

    // uid résolu systématiquement (pas seulement pour le gate) : sert aussi à
    // remonter le statut des inscriptions de l'utilisateur (bandeau « ton équipe »).
    const uid = await verifyAuth(req);

    // Masquée du public : brouillon OU compétition de test (isDev), même
    // publiée. Visible uniquement des admins compét et des comptes du bac à
    // sable (helper partagé — garde-fou anti-fuite des données de test).
    if (isCompetitionHidden(comp)) {
      if (!uid || !(await canViewHiddenCompetition(db, uid))) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
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

    // Statut des inscriptions de l'utilisateur connecté sur cette compétition
    // (bandeau « ton équipe : validée / en attente » sur la fiche). Couvre celui
    // qui a inscrit (createdBy) ET les joueurs du roster (rosterUids). Non retirées.
    const myRegistrations: Array<{ teamName: string; status: string }> = [];
    if (uid) {
      const [byRoster, byCreator] = await Promise.all([
        db.collection('competition_registrations').where('competitionId', '==', id).where('rosterUids', 'array-contains', uid).get(),
        db.collection('competition_registrations').where('competitionId', '==', id).where('createdBy', '==', uid).get(),
      ]);
      const seen = new Set<string>();
      for (const d of [...byRoster.docs, ...byCreator.docs]) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const r = d.data();
        if (r.status === 'withdrawn') continue;
        myRegistrations.push({ teamName: (r.name as string) ?? '', status: (r.status as string) ?? 'pending' });
      }
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
        // Le client affiche le bracket (onSnapshot competition_matches) dès que
        // le bracket est matérialisé.
        bracketMaterializedAt: comp.bracketMaterializedAt?.toDate?.()?.toISOString() ?? null,
        prizePool: comp.prizePool ?? null,
        isDev: comp.isDev === true,
      },
      teams,
      waitlistedCount: waitlisted,
      myRegistrations,
    });
  } catch (err) {
    captureApiError('API Competitions GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
