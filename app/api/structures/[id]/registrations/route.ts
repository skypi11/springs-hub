import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isDirigeant, isResponsable, isResponsableForGame } from '@/lib/structure-permissions';

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
