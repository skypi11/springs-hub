import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCircuitHidden, isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { computeCircuitStandings, type StandingTeam } from '@/lib/competitions/standings';
import { LEGENDS_TIE_BREAKERS } from '@/lib/competitions/defaults';

// GET /api/competitions/circuit/[id] — vitrine publique d'un circuit : le
// parcours (Qualifs + destination LAN), la règle de qualification, le barème,
// le classement, et la Qualif vers laquelle diriger l'inscription. Aucune
// donnée personnelle (circuit_teams est public-safe : nom/tag/participations,
// les rosters/uids vivent dans /private, deny-all).
//
// Gating : un circuit en brouillon (dont le circuit de test) n'est visible que
// des testeurs autorisés. Pour un circuit publié, les Qualifs elles-mêmes
// encore masquées (draft/isDev) sont filtrées pour le public.

function toIso(v: unknown): string | null {
  const d = v as { toDate?: () => Date } | null | undefined;
  return d?.toDate?.()?.toISOString() ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const { id } = await params;
    const db = getAdminDb();

    const circuitSnap = await db.collection('circuits').doc(id).get();
    if (!circuitSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const circuit = circuitSnap.data()!;

    // Un utilisateur est « testeur » (voit le contenu masqué) s'il est admin
    // compét ou compte du bac à sable. Résolu une seule fois, réutilisé pour le
    // gate du circuit ET le filtrage des Qualifs masquées.
    const uid = await verifyAuth(req);
    const isViewer = uid ? await canViewHiddenCompetition(db, uid) : false;

    if (isCircuitHidden(circuit) && !isViewer) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // Étapes du circuit : chargées dans l'ordre chronologique de competitionIds.
    const competitionIds: string[] = Array.isArray(circuit.competitionIds) ? circuit.competitionIds : [];
    const eventDocs = competitionIds.length
      ? await db.getAll(...competitionIds.map(cid => db.collection('competitions').doc(cid)))
      : [];
    const now = Date.now();

    const events = eventDocs
      .filter(d => d.exists)
      .map(d => {
        const c = d.data()!;
        const opensAt = toIso(c.registration?.opensAt);
        const closesAt = toIso(c.registration?.closesAt);
        const days: Array<{ date: string }> = Array.isArray(c.schedule?.days) ? c.schedule.days : [];
        const registrationOpen = c.status === 'registration'
          && !!opensAt && !!closesAt
          && now >= new Date(opensAt).getTime() && now <= new Date(closesAt).getTime();
        return {
          id: d.id,
          name: (c.name as string) ?? '',
          status: (c.status as string) ?? 'draft',
          hidden: isCompetitionHidden(c),
          startDate: days[0]?.date ?? null,
          endDate: days.length ? days[days.length - 1].date : null,
          opensAt,
          closesAt,
          registrationOpen,
          approvedCount: (c.approvedCount as number) ?? 0,
          maxTeams: (c.format?.maxTeams as number) ?? null,
          prizePool: c.prizePool ?? null,
        };
      })
      // Une Qualif encore masquée n'est listée que pour un testeur.
      .filter(e => isViewer || !e.hidden);

    // Format « type » du circuit : identique sur toutes les Qualifs (préréglage),
    // dérivé de la première étape VISIBLE (même gate que la liste `events` — ne
    // jamais servir au public la config d'une Qualif masquée, review circuit).
    // Le détail (fenêtres, phases) reste sur la fiche de chaque Qualif.
    const firstVisible = eventDocs.find(d => d.exists && (isViewer || !isCompetitionHidden(d.data()!)))?.data();
    const formatSample = firstVisible
      ? { format: firstVisible.format ?? null, eligibility: firstVisible.eligibility ?? null, roster: firstVisible.roster ?? null }
      : null;

    // Cible d'inscription : la Qualif vers laquelle diriger le CTA. Une Qualif
    // réellement en fenêtre d'inscription d'abord ; à défaut, pour un testeur,
    // une Qualif masquée (draft/isDev) qu'il peut dérouler dans le bac à sable —
    // cohérent avec le bypass testeur de l'endpoint /register.
    const openTarget = events.find(e => e.registrationOpen);
    const testerTarget = isViewer ? events.find(e => e.hidden) : undefined;
    const target = openTarget ?? testerTarget ?? null;

    // Classement : circuit_teams (public-safe). Vide tant qu'aucun Qualif joué.
    const teamsSnap = await db.collection('circuit_teams').where('circuitId', '==', id).get();
    const standingTeams: StandingTeam[] = teamsSnap.docs.map(doc => {
      const t = doc.data();
      return {
        id: doc.id,
        name: (t.name as string) ?? '',
        tag: (t.tag as string) ?? '',
        participations: Array.isArray(t.participations) ? t.participations.map((p: Record<string, unknown>) => ({
          competitionId: (p.competitionId as string) ?? '',
          placement: (p.placement as number) ?? 0,
          points: (p.points as number) ?? 0,
          goalDiff: (p.goalDiff as number) ?? 0,
          goalsFor: (p.goalsFor as number) ?? 0,
        })) : [],
      };
    });
    const standings = computeCircuitStandings(
      {
        // Classement calculé sur les Qualifs VISIBLES par ce visiteur : pour un
        // non-testeur, les résultats d'une Qualif masquée (draft/isDev) sont
        // exclus (computeCircuitStandings filtre les participations hors de
        // cette liste) — même gate que le parcours.
        competitionIds: events.map(e => e.id),
        bestResultsCount: (circuit.bestResultsCount as number) ?? 3,
        lanTeamCount: (circuit.lanTeamCount as number) ?? 16,
        // Départage spec-conforme par défaut si le doc n'a pas de tieBreakers
        // (doc hors du CRUD admin validé) : sinon le classement retomberait en
        // ordre alphabétique à égalité de points.
        tieBreakers: Array.isArray(circuit.tieBreakers) && circuit.tieBreakers.length
          ? circuit.tieBreakers
          : [...LEGENDS_TIE_BREAKERS],
      },
      standingTeams,
    );

    return NextResponse.json({
      circuit: {
        id,
        name: (circuit.name as string) ?? '',
        game: (circuit.game as string) ?? 'rocket_league',
        status: (circuit.status as string) ?? 'draft',
        bestResultsCount: (circuit.bestResultsCount as number) ?? 3,
        lanTeamCount: (circuit.lanTeamCount as number) ?? 16,
        prizePool: circuit.prizePool ?? null,
        organizer: (circuit.organizer as { name: string; logoUrl?: string | null }) ?? null,
        pointsScale: circuit.pointsScale ?? {},
        isDev: isCircuitHidden(circuit),  // le public ne voit jamais ce cas (404 plus haut)
      },
      events,
      formatSample,
      standings,
      registrationTargetId: target?.id ?? null,
      registrationTargetName: target?.name ?? null,
      registrationTargetOpen: !!openTarget,   // true = vraie fenêtre ; false = accès testeur
    });
  } catch (err) {
    captureApiError('API Competitions/Circuit GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
