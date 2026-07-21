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
    type PublicRosterPlayer = { displayName: string; role: 'titulaire' | 'remplacant'; trackerUrl: string | null; verified: boolean };
    type PublicTeam = { teamId: string; name: string; tag: string; logoUrl: string | null; roster: PublicRosterPlayer[]; staff: Array<{ name: string; role: 'manager' | 'coach' }> };
    const teams: PublicTeam[] = [];
    let waitlisted = 0;
    for (const d of regsSnap.docs) {
      const r = d.data();
      if (r.status === 'approved') {
        // Roster PUBLIC : uniquement pseudo + rôle + tracker + vérifié. Les champs
        // sensibles du snapshot (MMR, âge, Discord/Epic/Steam IDs) restent
        // admin-only (archi §2) — on ne les mappe JAMAIS ici.
        const roster: PublicRosterPlayer[] = Array.isArray(r.roster)
          ? (r.roster as Array<Record<string, unknown>>).map(p => ({
              displayName: (p.displayName as string) ?? '',
              role: p.role === 'titulaire' ? 'titulaire' : 'remplacant',
              trackerUrl: (p.trackerUrl as string) || null,
              verified: p.verified === true,
            }))
          : [];
        teams.push({ teamId: (r.teamId as string) ?? '', name: r.name ?? '', tag: r.tag ?? '', logoUrl: r.logoUrl ?? null, roster, staff: [] });
      } else if (r.status === 'waitlisted') {
        waitlisted++;
      }
    }
    teams.sort((a, b) => a.name.localeCompare(b.name));

    // Staff (coach/manager) de chaque équipe validée : résolu en DIRECT depuis
    // sub_teams — le staff n'est pas figé dans le snapshot (contrairement au
    // roster compétitif, gelé pour la fairness) car ce n'est pas un fait de
    // fairness. Public : pseudo + rôle uniquement.
    const teamIds = teams.map(t => t.teamId).filter(Boolean);
    if (teamIds.length > 0) {
      const teamDocs = await Promise.all(teamIds.map(tid => db.collection('sub_teams').doc(tid).get()));
      const staffByTeam = new Map<string, Array<{ uid: string; role: 'manager' | 'coach' }>>();
      const allStaffUids = new Set<string>();
      teamDocs.forEach((ts, i) => {
        if (!ts.exists) return;
        const t = ts.data()!;
        const ids = Array.isArray(t.staffIds) ? (t.staffIds as string[]) : [];
        const roles = (t.staffRoles as Record<string, string> | undefined) ?? {};
        const entries = ids.map(u => ({ uid: u, role: (roles[u] === 'manager' ? 'manager' : 'coach') as 'manager' | 'coach' }));
        staffByTeam.set(teamIds[i], entries);
        entries.forEach(e => allStaffUids.add(e.uid));
      });
      const staffDocs = await Promise.all([...allStaffUids].map(u => db.collection('users').doc(u).get()));
      const nameByUid = new Map<string, string>();
      staffDocs.forEach(s => {
        if (s.exists) nameByUid.set(s.id, (s.data()!.displayName as string) || (s.data()!.discordUsername as string) || s.id);
      });
      for (const t of teams) {
        t.staff = (staffByTeam.get(t.teamId) ?? []).map(e => ({ name: nameByUid.get(e.uid) ?? e.uid, role: e.role }));
      }
    }

    let circuitName: string | null = null;
    let organizer: { name: string; logoUrl?: string | null } | null = null;
    if (comp.circuitId) {
      const circuitSnap = await db.collection('circuits').doc(comp.circuitId as string).get();
      const c = circuitSnap.data();
      circuitName = (c?.name as string) ?? null;
      organizer = (c?.organizer as { name: string; logoUrl?: string | null } | undefined) ?? null;
    }

    // Statut des inscriptions de l'utilisateur connecté sur cette compétition
    // (bandeau « ton équipe : validée / en attente » sur la fiche). Couvre celui
    // qui a inscrit (createdBy) ET les joueurs du roster (rosterUids). Non retirées.
    const myRegistrations: Array<{ teamName: string; tag: string; logoUrl: string | null; status: string }> = [];
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
        myRegistrations.push({
          teamName: (r.name as string) ?? '',
          tag: (r.tag as string) ?? '',
          logoUrl: (r.logoUrl as string) ?? null,
          status: (r.status as string) ?? 'pending',
        });
      }
    }

    // Classement final (compét clôturée) : déjà public-safe (registrationId +
    // dénormalisations, aucun uid — archi §4). On le mappe EXPLICITEMENT (jamais
    // de spread brut sur un doc) et on l'enrichit du logo d'équipe via les
    // inscriptions (regsSnap déjà chargé), pour un rendu public avec crests.
    const logoByRegId = new Map<string, string | null>();
    for (const d of regsSnap.docs) logoByRegId.set(d.id, (d.data().logoUrl as string) ?? null);
    const finalPlacements = Array.isArray(comp.finalPlacements)
      ? (comp.finalPlacements as Array<Record<string, unknown>>).map(p => ({
          registrationId: (p.registrationId as string) ?? '',
          name: (p.name as string) ?? '',
          tag: (p.tag as string) ?? '',
          placement: typeof p.placement === 'number' ? p.placement : 0,
          points: typeof p.points === 'number' ? p.points : null,
          goalDiff: typeof p.goalDiff === 'number' ? p.goalDiff : 0,
          goalsFor: typeof p.goalsFor === 'number' ? p.goalsFor : 0,
          logoUrl: logoByRegId.get(p.registrationId as string) ?? null,
        }))
      : null;

    return NextResponse.json({
      competition: {
        id,
        name: comp.name ?? '',
        game: comp.game ?? '',
        status: comp.status ?? 'draft',
        circuitId: comp.circuitId ?? null,
        circuitName,
        organizer,
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
        // Classement final (null tant que la compét n'est pas clôturée).
        finalPlacements,
        closedAt: comp.closedAt?.toDate?.()?.toISOString() ?? null,
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
