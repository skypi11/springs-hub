import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isDirigeant, isResponsable, isResponsableForGame } from '@/lib/structure-permissions';
import { getSanctionsFor } from '@/lib/competitions/sanctions';
import { withdrawRegistration } from '@/lib/competitions/withdraw-registration';

// GET /api/structures/[id]/registrations — SUIVI des inscriptions compétition
// d'une structure (onglet « Inscriptions » de Ma structure). Pas une vitrine :
// ne renvoie QUE les compétitions où la structure a une inscription.
//
// Portée par rôle (précision Matt 04/07) :
//  - dirigeant                → toutes les inscriptions de la structure
//  - responsable (scopé jeu)  → les inscriptions des jeux qu'il gère
//  - manager d'ÉQUIPE         → uniquement les inscriptions de SES équipes
//  - autres (coach, capitaine, joueur) → 403
//
// Aucune donnée personnelle (ni uid, ni roster, ni MMR) : nom d'équipe, compét,
// circuit, statut. `canWithdraw` prépare le retrait depuis l'onglet (Lot 3).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;

  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { id: structureId } = await params;
    const db = getAdminDb();

    const structSnap = await db.collection('structures').doc(structureId).get();
    if (!structSnap.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const structure = structSnap.data()!;
    const ctx = { uid, structure: structure as never };

    const dir = isDirigeant(ctx);
    const resp = isResponsable(ctx);

    // Équipes de CETTE structure dont l'user est manager d'équipe (staffRoles==='manager').
    // Calculé pour tout le monde SAUF le dirigeant (qui voit tout) : un responsable
    // scopé à un jeu peut aussi être manager d'une équipe d'un AUTRE jeu → il doit voir
    // l'inscription de cette équipe (parité avec le wizard, qui l'autorise à l'inscrire).
    const managedTeamIds = new Set<string>();
    if (!dir) {
      const staffedSnap = await db.collection('sub_teams')
        .where('structureId', '==', structureId)
        .where('staffIds', 'array-contains', uid)
        .get();
      for (const d of staffedSnap.docs) {
        const t = d.data();
        if (((t.staffRoles as Record<string, string> | undefined)?.[uid] ?? 'coach') === 'manager') {
          managedTeamIds.add(d.id);
        }
      }
    }

    if (!dir && !resp && managedTeamIds.size === 0) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const regsSnap = await db.collection('competition_registrations')
      .where('structureId', '==', structureId)
      .get();

    // Sanctions ACTIVES visant la structure, ses équipes ou les joueurs des
    // rosters (le staff a le droit de voir les sanctions de SON équipe). Motif +
    // type + date seulement (pas d'uid signaleur).
    const allTeamIds = Array.from(new Set(regsSnap.docs.map(d => d.data().teamId as string).filter(Boolean)));
    const allRosterUids = Array.from(new Set(regsSnap.docs.flatMap(d => (d.data().rosterUids as string[] | undefined) ?? [])));
    const activeSanctions = (await getSanctionsFor(db, { uids: allRosterUids, structureIds: [structureId], teamIds: allTeamIds }))
      .filter(s => s.active);

    // Caches pour éviter les lectures répétées (peu de compétitions/circuits).
    const compCache = new Map<string, FirebaseFirestore.DocumentData | null>();
    const circuitCache = new Map<string, string | null>();

    const registrations: Array<Record<string, unknown>> = [];
    for (const doc of regsSnap.docs) {
      const r = doc.data();
      const teamId = r.teamId as string;
      const competitionId = r.competitionId as string;
      if (!competitionId) continue;

      if (!compCache.has(competitionId)) {
        const cs = await db.collection('competitions').doc(competitionId).get();
        compCache.set(competitionId, cs.exists ? cs.data()! : null);
      }
      const comp = compCache.get(competitionId);
      if (!comp) continue;
      const game = (comp.game as string) ?? '';

      // Union des portées : dirigeant (tout) OU responsable du jeu OU manager de
      // cette équipe. Aligné sur canWithdraw plus bas et sur le wizard d'inscription.
      const visible = dir || (resp && isResponsableForGame(ctx, game)) || managedTeamIds.has(teamId);
      if (!visible) continue;

      const circuitId = (comp.circuitId as string | null) ?? null;
      if (circuitId && !circuitCache.has(circuitId)) {
        const cc = await db.collection('circuits').doc(circuitId).get();
        circuitCache.set(circuitId, cc.exists ? ((cc.data()!.name as string) ?? null) : null);
      }

      // Roster FIGÉ à l'inscription (spec §4 : roster lock total) : c'est SON
      // équipe, le staff a le droit de voir qui a été aligné. On expose seulement
      // pseudo + rôle + capitaine (jamais MMR/âge/uid — restent au snapshot admin).
      const captainUid = (r.captainUid as string) ?? '';
      const rosterRaw = Array.isArray(r.roster) ? r.roster as Array<Record<string, unknown>> : [];
      const roster = rosterRaw.map(p => ({
        displayName: (p.displayName as string) ?? '',
        role: p.role === 'titulaire' ? 'titulaire' : 'remplacant',
        isCaptain: (p.uid as string) === captainUid,
      }));
      const days: Array<{ date: string; startsAt: string; endsAt: string | null }> =
        Array.isArray(comp.schedule?.days)
          ? comp.schedule.days.map((d: Record<string, unknown>) => ({
              date: (d.date as string) ?? '',
              startsAt: (d.startsAt as string) ?? '',
              endsAt: (d.endsAt as string) ?? null,
            }))
          : [];

      // Sanctions actives visibles côté équipe (avertissements/bans en cours).
      const regRosterUids = new Set((r.rosterUids as string[] | undefined) ?? []);
      const sanctions = activeSanctions
        .filter(s =>
          (s.targetType === 'team' && s.targetId === teamId)
          || (s.targetType === 'structure' && s.targetId === structureId)
          || (s.targetType === 'user' && regRosterUids.has(s.targetId)))
        .map(s => ({ type: s.type, reason: s.reason, createdAt: s.createdAt }));

      registrations.push({
        id: doc.id,
        teamId,
        teamName: (r.name as string) ?? '',
        game,
        competitionId,
        competitionName: (comp.name as string) ?? '',
        competitionStatus: (comp.status as string) ?? 'draft',
        circuitId,
        circuitName: circuitId ? circuitCache.get(circuitId) ?? null : null,
        status: (r.status as string) ?? 'pending',
        rejectionReason: r.status === 'rejected' ? (r.review?.reason as string | null) ?? null : null,
        bracketPublished: !!comp.bracketMaterializedAt,
        createdAt: r.createdAt?.toDate?.()?.toISOString() ?? null,
        roster,
        days,
        sanctions,
        // Prépare le retrait depuis l'onglet (Lot 3) : le bouton n'est pas encore
        // rendu, mais le droit est calculé côté serveur dès maintenant.
        canWithdraw: dir || (resp && isResponsableForGame(ctx, game)) || managedTeamIds.has(teamId),
      });
    }

    // Retirées/rejetées en bas, puis par date de création décroissante.
    const rank = (s: string) => (s === 'withdrawn' || s === 'rejected' ? 1 : 0);
    registrations.sort((a, b) =>
      rank(a.status as string) - rank(b.status as string)
      || String(b.createdAt).localeCompare(String(a.createdAt)));

    return NextResponse.json({ registrations });
  } catch (err) {
    captureApiError('API Structures/Registrations GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST { action: 'withdraw', registrationId } — retrait de SON inscription
// (Lot 3G). Mêmes droits que l'inscription elle-même : dirigeant, responsable
// du jeu, ou manager de l'équipe. Possible uniquement AVANT la publication du
// bracket (après = disqualification, décidée par un admin via la console).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const body = await req.json();
    if (body.action !== 'withdraw') return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
    const registrationId = typeof body.registrationId === 'string' ? body.registrationId : '';
    if (!registrationId) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });

    const db = getAdminDb();
    const [structSnap, regSnap] = await Promise.all([
      db.collection('structures').doc(structureId).get(),
      db.collection('competition_registrations').doc(registrationId).get(),
    ]);
    if (!structSnap.exists || !regSnap.exists || regSnap.data()!.structureId !== structureId) {
      return NextResponse.json({ error: 'Inscription introuvable.' }, { status: 404 });
    }
    const reg = regSnap.data()!;
    const ctx = { uid, structure: structSnap.data()! as never };
    const dir = isDirigeant(ctx);
    const resp = isResponsable(ctx);

    let allowed = dir;
    if (!allowed) {
      const compSnap = await db.collection('competitions').doc(reg.competitionId as string).get();
      const game = (compSnap.data()?.game as string) ?? '';
      if (resp && isResponsableForGame(ctx, game)) allowed = true;
      if (!allowed) {
        const teamSnap = await db.collection('sub_teams').doc(reg.teamId as string).get();
        const t = teamSnap.data();
        allowed = !!t && Array.isArray(t.staffIds) && (t.staffIds as string[]).includes(uid)
          && ((t.staffRoles as Record<string, string> | undefined)?.[uid] ?? 'coach') === 'manager';
      }
    }
    if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const actor = await db.collection('users').doc(uid).get();
    const actorName = (actor.data()?.displayName as string) || (actor.data()?.discordUsername as string) || 'un dirigeant';
    const result = await withdrawRegistration(db, {
      registrationId,
      cause: `Retrait décidé par ${actorName}.`,
    });
    if (!result.ok) {
      const messages: Record<string, string> = {
        not_found: 'Inscription introuvable.',
        already_withdrawn: 'Inscription déjà retirée.',
        bracket_published: 'Le bracket est publié — un retrait est une disqualification, à demander à un admin de compétition.',
        state_changed: "L'inscription a changé d'état entre-temps. Recharge la page.",
      };
      return NextResponse.json({ error: messages[result.code] }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API Structures/Registrations POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
