import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCircuitHidden, isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { pickFocusEvent } from '@/lib/competitions/circuit-timeline';

// GET /api/competitions/circuits — liste publique des circuits Aedral natifs,
// point d'entrée de /competitions. Un circuit en brouillon (dont le circuit de
// test) n'est renvoyé qu'aux testeurs autorisés (feature gating). Chaque circuit
// porte un résumé « focus » (état d'inscription + prochaine étape) pour la
// stat-décision du héros de la liste — dérivé de ses étapes visibles, même gate
// que la fiche circuit. La fiche (/api/competitions/circuit/[id]) porte le détail.

function toIso(v: unknown): string | null {
  const d = v as { toDate?: () => Date } | null | undefined;
  return d?.toDate?.()?.toISOString() ?? null;
}

export async function GET(req: NextRequest) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const db = getAdminDb();
    const uid = await verifyAuth(req);
    const isViewer = uid ? await canViewHiddenCompetition(db, uid) : false;
    const now = Date.now();

    const snap = await db.collection('circuits').get();
    const visibleDocs = snap.docs.filter(d => isViewer || !isCircuitHidden(d.data()));

    const circuits = await Promise.all(visibleDocs.map(async d => {
      const c = d.data();
      const compIds: string[] = Array.isArray(c.competitionIds) ? c.competitionIds : [];
      const compDocs = compIds.length
        ? await db.getAll(...compIds.map(cid => db.collection('competitions').doc(cid)))
        : [];

      // Étapes visibles par ce visiteur (une Qualif masquée n'est vue que d'un
      // testeur) — même gate que la fiche circuit et le classement.
      const events = compDocs
        .filter(dd => dd.exists)
        .map(dd => {
          const cc = dd.data()!;
          const opensAt = toIso(cc.registration?.opensAt);
          const closesAt = toIso(cc.registration?.closesAt);
          const days: Array<{ date: string }> = Array.isArray(cc.schedule?.days) ? cc.schedule.days : [];
          const registrationOpen = cc.status === 'registration'
            && !!opensAt && !!closesAt
            && now >= new Date(opensAt).getTime() && now <= new Date(closesAt).getTime();
          return {
            id: dd.id,
            name: (cc.name as string) ?? '',
            status: (cc.status as string) ?? 'draft',
            hidden: isCompetitionHidden(cc),
            registrationOpen,
            closesAt,
            startDate: days[0]?.date ?? null,
            approvedCount: (cc.approvedCount as number) ?? 0,
            maxTeams: (cc.format?.maxTeams as number) ?? null,
          };
        })
        .filter(e => isViewer || !e.hidden);

      // Étape focus : Qualif ouverte d'abord, puis cible testeur (Qualif masquée
      // qu'un testeur peut dérouler dans le bac à sable), sinon prochaine/en cours.
      const openTarget = events.find(e => e.registrationOpen);
      const testerTarget = isViewer ? events.find(e => e.hidden) : undefined;
      const focus = pickFocusEvent(events);
      const focusEvent = openTarget ?? testerTarget ?? focus.event;

      return {
        id: d.id,
        name: (c.name as string) ?? '',
        game: (c.game as string) ?? 'rocket_league',
        status: (c.status as string) ?? 'draft',
        hidden: isCircuitHidden(c),
        eventCount: compIds.length,
        lanTeamCount: (c.lanTeamCount as number) ?? 0,
        prizePool: c.prizePool ?? null,
        organizer: (c.organizer as { name: string; logoUrl?: string | null }) ?? null,
        createdAt: c.createdAt?.toDate?.()?.toISOString() ?? null,
        focus: {
          mode: focus.mode,                       // open | live | upcoming | done
          registrationOpen: !!openTarget,
          targetId: (openTarget ?? testerTarget)?.id ?? null,
          eventName: focusEvent?.name ?? null,
          closesAt: openTarget?.closesAt ?? null,
          startDate: focusEvent?.startDate ?? null,
          approvedCount: focusEvent?.approvedCount ?? 0,
          maxTeams: focusEvent?.maxTeams ?? null,
        },
      };
    }));

    circuits.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ circuits });
  } catch (err) {
    captureApiError('API Competitions/Circuits GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
