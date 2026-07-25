import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { materializeBracket, type TeamDisplay } from '@/lib/competitions/bracket-store';
import { roundRobinBlocker, swissBlocker, swissDefaultRounds } from '@/lib/tournament';
import { kindOf } from '@/lib/competitions/formats-server';
import { stagesOf, teamBoundsForKind } from '@/lib/competitions/stages';
import { mmrSeedValue, orderByCircuitRank, orderByMmr, type SeedableTeam } from '@/lib/competitions/seeding';
import { circuitRankByTeamId } from '@/lib/competitions/seeding-server';

/** Bornes moteur du format : 4-64 pour tous (les arbres arrondissent à la
 *  puissance de 2 supérieure, le round robin et le suisse non). Source
 *  unique : stages.teamBoundsForKind. */
function teamBounds(format: { kind?: string } | null | undefined): { min: number; max: number } {
  return teamBoundsForKind(kindOf(format));
}

/**
 * Blocage de faisabilité pour l'EFFECTIF RÉEL d'équipes validées (round robin
 * et suisse) : la validation de format ne connaît que le max théorique — un
 * champ de 6 équipes en « 4 poules », ou 5 rondes suisses pour 4 équipes,
 * doit être refusé ICI, proprement, pas en 500 au moment où le générateur
 * jette (review adversariale, blocker).
 */
function feasibilityBlocker(
  format: { kind?: string; groupCount?: number; swissRounds?: number; maxTeams?: number } | null | undefined,
  approvedCount: number,
): string | null {
  const kind = kindOf(format);
  if (kind === 'round_robin') return roundRobinBlocker(approvedCount, format?.groupCount ?? 1);
  if (kind === 'swiss') {
    // Fallback IDENTIQUE au générateur (rondes par défaut sur l'effectif
    // RÉEL, pas sur maxTeams) — jamais deux verdicts divergents.
    return swissBlocker(approvedCount, format?.swissRounds ?? swissDefaultRounds(approvedCount));
  }
  return null;
}

// Seeding + matérialisation du bracket (archi §3, spec §2). Admins de
// compétition (rôle scopé) : le seeding fait partie de leur périmètre.
//
// Cycle : validation/registration → open_seeding (statut 'seeding', ordre
// aléatoire) → shuffle/reorder (ajustement admin) → publish (génère le bracket
// via lib/tournament, écrit competition_matches + ACL privées, statut 'live').
// La publication est one-shot : elle quitte 'seeding', donc n'écrase jamais un
// bracket dont des matchs ont progressé.

interface ApprovedReg extends SeedableTeam {
  tag: string;
  logoUrl: string | null;
  rosterUids: string[];
}

async function loadApproved(db: FirebaseFirestore.Firestore, competitionId: string): Promise<ApprovedReg[]> {
  const snap = await db.collection('competition_registrations')
    .where('competitionId', '==', competitionId)
    .where('status', '==', 'approved')
    .get();
  return snap.docs.map(d => {
    const r = d.data();
    return {
      registrationId: d.id,
      name: (r.name as string) ?? '',
      tag: (r.tag as string) ?? '',
      logoUrl: (r.logoUrl as string | null) ?? null,
      rosterUids: (r.rosterUids as string[]) ?? [],
      // Données de seeding (design §10) — figées au submit par le serveur.
      worstLineupAvg: typeof r.computed?.worstLineupAvg === 'number' ? r.computed.worstLineupAvg : null,
      rosterRefMmrs: Array.isArray(r.roster)
        ? (r.roster as Array<{ refMmr?: number }>).map(p => (typeof p.refMmr === 'number' ? p.refMmr : 0))
        : [],
      circuitTeamId: (r.circuitTeamId as string | null) ?? null,
    };
  });
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); // CSPRNG — seeding défendable/auditable
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── GET : état du seeding + équipes validées ─────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const approved = await loadApproved(db, id);
    const byId = new Map(approved.map(r => [r.registrationId, r]));

    // Ordre courant : le seeding stocké (filtré aux équipes encore validées),
    // complété des nouvelles validées non encore seedées (en fin de liste).
    const storedSeeding = (comp.seeding as string[] | undefined) ?? [];
    const ordered = storedSeeding.filter(rid => byId.has(rid));
    for (const r of approved) if (!ordered.includes(r.registrationId)) ordered.push(r.registrationId);

    // Rangs circuit pour l'affichage du panneau Seeding (design §10c) — null
    // hors circuit ou circuit introuvable, jamais bloquant en lecture.
    const circuitRanks = typeof comp.circuitId === 'string' && comp.circuitId
      ? await circuitRankByTeamId(db, comp.circuitId)
      : null;
    const seeding = ordered.map((rid, i) => {
      const r = byId.get(rid)!;
      return {
        registrationId: rid, name: r.name, tag: r.tag, logoUrl: r.logoUrl, seed: i + 1,
        // Valeurs de seed affichées à l'admin (jamais publiques — route admin).
        mmrSeed: mmrSeedValue(r),
        circuitRank: (r.circuitTeamId ? circuitRanks?.get(r.circuitTeamId) : undefined) ?? null,
      };
    });

    const status = (comp.status as string) ?? 'draft';
    const materialized = !!comp.bracketMaterializedAt;

    const bounds = teamBounds(comp.format);
    const feasibility = feasibilityBlocker(comp.format, approved.length);
    // Le seeding STOCKÉ diverge des validées (validation/retrait depuis le
    // dernier seed) : le publish refusera — le GET le dit AVANT le clic
    // (review adversariale : la liste « réparée » masquait la divergence).
    const seedingStale = status === 'seeding' && (
      storedSeeding.length !== approved.length
      || new Set(storedSeeding).size !== storedSeeding.length
      || !storedSeeding.every(rid => byId.has(rid))
    );
    return NextResponse.json({
      status,
      approvedCount: approved.length,
      minTeams: bounds.min,
      maxTeams: bounds.max,
      seeding,
      // Stratégies disponibles (design §10b) — 'circuit' exige un circuit AVEC
      // des résultats (un classement vide donnerait un ordre 100 % MMR
      // étiqueté « circuit » : mensonger).
      strategies: { random: true, mmr: true, circuit: circuitRanks !== null && circuitRanks.size > 0 },
      // Ouverture du seeding depuis les statuts pré-live, avec assez d'équipes
      // ET une répartition en poules jouable (round robin).
      canOpenSeeding: ['draft', 'registration', 'validation'].includes(status)
        && approved.length >= bounds.min && approved.length <= bounds.max
        && feasibility === null,
      canEditSeeding: status === 'seeding',
      canPublish: status === 'seeding' && !materialized
        && approved.length >= bounds.min && approved.length <= bounds.max
        && feasibility === null
        && !seedingStale,
      seedingStale,
      // Message actionnable pour l'UI quand la répartition en poules bloque.
      feasibilityError: feasibility,
      materialized,
    });
  } catch (err) {
    captureApiError('API Admin/Competitions/Bracket GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── POST : open_seeding | shuffle | reorder | publish ────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();
    const action = body.action as string;
    const db = getAdminDb();

    const compRef = db.collection('competitions').doc(id);
    const compSnap = await compRef.get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;
    const status = (comp.status as string) ?? 'draft';
    const approved = await loadApproved(db, id);
    const approvedIds = new Set(approved.map(r => r.registrationId));

    // ── open_seeding ──
    if (action === 'open_seeding') {
      if (!['draft', 'registration', 'validation'].includes(status)) {
        return NextResponse.json({ error: 'Le seeding ne peut s\'ouvrir que depuis une compétition en inscriptions ou validation.' }, { status: 409 });
      }
      const bounds = teamBounds(comp.format);
      if (approved.length < bounds.min) {
        return NextResponse.json({ error: `Il faut au moins ${bounds.min} équipes validées pour seeder (actuellement ${approved.length}).` }, { status: 409 });
      }
      if (approved.length > bounds.max) {
        return NextResponse.json({ error: `Le format accepte au plus ${bounds.max} équipes (${approved.length} validées) : retire des équipes ou passe-les en liste d'attente.` }, { status: 409 });
      }
      const feasibility = feasibilityBlocker(comp.format, approved.length);
      if (feasibility) {
        return NextResponse.json({ error: `${feasibility} Ajuste le nombre de poules du format ou le champ d'équipes.` }, { status: 409 });
      }
      const seeding = shuffle(approved.map(r => r.registrationId));
      await compRef.update({ status: 'seeding', seeding, bracketMaterializedAt: null, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, uid, 'competition_seeding_opened', id, comp, { teams: seeding.length });
      return NextResponse.json({ success: true, status: 'seeding', seeding });
    }

    // Les actions suivantes exigent le statut 'seeding'.
    if (status !== 'seeding') {
      return NextResponse.json({ error: 'Action réservée au statut seeding.' }, { status: 409 });
    }

    // Écriture du seeding en TRANSACTION COURTE (review adversariale) : les
    // gates statut/verrou sont re-lus FRAIS — un seed_by/reorder concurrent
    // d'un publish ne peut plus écraser le seeding d'un bracket matérialisé
    // (le verrou bracketMaterializedAt est posé en TÊTE du publish).
    const writeSeeding = async (seeding: string[]) => {
      try {
        await db.runTransaction(async tx => {
          const fresh = (await tx.get(compRef)).data();
          if (!fresh || fresh.status !== 'seeding') throw new Error('not_seeding');
          if (fresh.bracketMaterializedAt) throw new Error('materialized');
          tx.update(compRef, { seeding, updatedAt: FieldValue.serverTimestamp() });
        });
        return null;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'not_seeding') return 'La compétition n\'est plus en seeding.';
        if (msg === 'materialized') return 'Le bracket est déjà publié : le seeding est figé.';
        throw e;
      }
    };

    // ── shuffle ──
    if (action === 'shuffle') {
      const seeding = shuffle(approved.map(r => r.registrationId));
      const blocked = await writeSeeding(seeding);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
      await audit(db, uid, 'competition_seeding_shuffled', id, comp, {});
      return NextResponse.json({ success: true, seeding });
    }

    // ── seed_by : stratégie de seeding (design §10b) ──
    if (action === 'seed_by') {
      const strategy = String(body.strategy ?? '');
      if (!['random', 'mmr', 'circuit'].includes(strategy)) {
        return NextResponse.json({ error: 'Stratégie de seeding invalide.' }, { status: 400 });
      }
      let seeding: string[];
      if (strategy === 'random') {
        seeding = shuffle(approved.map(r => r.registrationId));
      } else if (strategy === 'mmr') {
        // Seed 1 = compo la plus forte (worstLineupAvg serveur, anti-smurf).
        seeding = orderByMmr(approved);
      } else {
        const circuitId = typeof comp.circuitId === 'string' && comp.circuitId ? comp.circuitId : null;
        const ranks = circuitId ? await circuitRankByTeamId(db, circuitId) : null;
        if (!ranks) {
          return NextResponse.json({ error: 'Seeding par classement de circuit : cette compétition n\'est pas rattachée à un circuit valide.' }, { status: 409 });
        }
        if (ranks.size === 0) {
          // Aucun résultat enregistré (cas nominal du Qualif 1) : un ordre
          // 100 % MMR étiqueté « circuit » serait mensonger — refus actionnable.
          return NextResponse.json({ error: 'Aucun résultat de circuit encore enregistré — utilise le seeding par MMR.' }, { status: 409 });
        }
        seeding = orderByCircuitRank(approved, ranks);
      }
      const blocked = await writeSeeding(seeding);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
      await audit(db, uid, 'competition_seeding_strategy', id, comp, { strategy });
      return NextResponse.json({ success: true, seeding, strategy });
    }

    // ── reorder ──
    if (action === 'reorder') {
      const order = Array.isArray(body.order) ? (body.order as unknown[]).map(String) : null;
      if (!order) return NextResponse.json({ error: 'Ordre requis.' }, { status: 400 });
      // L'ordre doit être une PERMUTATION EXACTE des équipes validées.
      const orderSet = new Set(order);
      if (order.length !== approvedIds.size || orderSet.size !== order.length
        || ![...orderSet].every(rid => approvedIds.has(rid))) {
        return NextResponse.json({ error: 'L\'ordre ne correspond pas exactement aux équipes validées. Recharge la liste.' }, { status: 409 });
      }
      const blocked = await writeSeeding(order);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
      await audit(db, uid, 'competition_seeding_reordered', id, comp, {});
      return NextResponse.json({ success: true, seeding: order });
    }

    // ── publish ──
    if (action === 'publish') {
      // Mêmes bornes que le GET et open_seeding (teamBounds par kind — un
      // round robin monte à 64) + faisabilité de la répartition en poules
      // sur l'effectif réel : jamais un 500 du générateur au dernier clic.
      const bounds = teamBounds(comp.format);
      if (approved.length < bounds.min || approved.length > bounds.max) {
        return NextResponse.json({ error: `Nombre d'équipes validées hors format (${approved.length}).` }, { status: 409 });
      }
      const feasibility = feasibilityBlocker(comp.format, approved.length);
      if (feasibility) {
        return NextResponse.json({ error: `${feasibility} Ajuste le nombre de poules du format ou le champ d'équipes.` }, { status: 409 });
      }
      // Le seeding stocké doit correspondre EXACTEMENT aux équipes validées
      // (aucune validation/retrait survenu entre-temps sans re-seed).
      const stored = (comp.seeding as string[] | undefined) ?? [];
      const storedSet = new Set(stored);
      if (stored.length !== approvedIds.size || storedSet.size !== stored.length
        || ![...storedSet].every(rid => approvedIds.has(rid))) {
        return NextResponse.json({ error: 'Le seeding ne correspond plus aux équipes validées (validation ou retrait entre-temps). Re-seed avant de publier.' }, { status: 409 });
      }

      // VERROU TRANSACTIONNEL (review adversariale) : la garde ci-dessus est
      // un pré-check sur snapshot — la vraie fenêtre se ferme ICI. La
      // transaction re-lit la compétition ET les inscriptions du seeding
      // FRAÎCHES (lookups par doc id — jamais de .where en transaction),
      // vérifie le compteur dénormalisé (attrape un approve ADDITIONNEL),
      // puis pose `bracketMaterializedAt` AVANT toute écriture de match :
      // approve / unapprove / retrait sont gatés dessus — un concurrent ne
      // peut plus faire diverger le bracket des inscriptions validées. Le
      // statut ne passe 'live' qu'au DERNIER batch : un crash au milieu se
      // répare en re-cliquant Publier (purge + re-matérialisation ci-dessous).
      try {
        await db.runTransaction(async tx => {
          const fresh = (await tx.get(compRef)).data();
          if (!fresh || fresh.status !== 'seeding') throw new Error('not_seeding');
          const freshSeeding = (fresh.seeding as string[] | undefined) ?? [];
          if (JSON.stringify(freshSeeding) !== JSON.stringify(stored)) throw new Error('seeding_changed');
          const regSnaps = await tx.getAll(
            ...stored.map(rid => db.collection('competition_registrations').doc(rid)));
          for (const s of regSnaps) {
            if (!s.exists || s.data()!.status !== 'approved') throw new Error('regs_changed');
          }
          if (((fresh.approvedCount as number) ?? 0) !== stored.length) throw new Error('regs_changed');
          tx.update(compRef, {
            bracketMaterializedAt: FieldValue.serverTimestamp(),
            // Révision des matérialisations (gardes concurrentes — cf.
            // change_roster) : le verrou EST la matérialisation qui commence.
            matchesRevision: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'not_seeding') {
          return NextResponse.json({ error: 'La compétition n\'est plus en seeding.' }, { status: 409 });
        }
        if (msg === 'seeding_changed') {
          return NextResponse.json({ error: 'Le seeding a changé pendant la publication — recharge et relance.' }, { status: 409 });
        }
        if (msg === 'regs_changed') {
          return NextResponse.json({ error: 'Le seeding ne correspond plus aux équipes validées (validation ou retrait entre-temps). Re-seed avant de publier.' }, { status: 409 });
        }
        throw e;
      }

      // Reprise après crash mi-publication : le statut est resté 'seeding'
      // (il ne passe live qu'au dernier batch) → les matchs partiels sont
      // purgés puis re-matérialisés. Jamais un bracket LIVE ici : le gate
      // statut en amont l'exclut.
      const existing = await db.collection('competition_matches').where('competitionId', '==', id).select().get();
      if (!existing.empty) {
        let purge = db.batch();
        let purgeOps = 0;
        for (const doc of existing.docs) {
          purge.delete(doc.ref.collection('private').doc('acl'));
          purge.delete(doc.ref);
          purgeOps += 2;
          if (purgeOps >= 400) { await purge.commit(); purge = db.batch(); purgeOps = 0; }
        }
        if (purgeOps > 0) await purge.commit();
      }

      const registrations: Record<string, { display: TeamDisplay; rosterUids: string[] }> = {};
      for (const r of approved) {
        registrations[r.registrationId] = {
          display: { name: r.name, tag: r.tag, logoUrl: r.logoUrl },
          rosterUids: r.rosterUids,
        };
      }

      const { matches, acls } = materializeBracket({
        competitionId: id,
        seeding: stored,
        bo: comp.format.bo,
        forfeitScore: comp.format.forfeitScore,
        phasePlan: comp.schedule?.phasePlan,
        registrations,
        kind: comp.format.kind,
        thirdPlace: comp.format.thirdPlace === true,
        groups: comp.format.groupCount ?? 1,
        doubleRound: comp.format.doubleRound === true,
        swissRounds: typeof comp.format.swissRounds === 'number' ? comp.format.swissRounds : undefined,
      });

      // Écriture batchée : 63 matchs + ~32 ACL à 32 équipes en double élim,
      // 127 + ~64 au cap de 64 — au-delà de 400 opérations le batch est
      // flushé et repris (le statut ne bascule 'live' qu'au dernier).
      const aclByMatch = new Map(acls.map(a => [a.matchId, a.participantUids]));
      let batch = db.batch();
      let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };
      // `hidden` dénormalisé pour les rules (défense en profondeur, review
      // Lot 3) : le publish flippe le statut en 'live', seule une compétition
      // de test (isDev) garde ses matchs invisibles en lecture directe.
      const hidden = comp.isDev === true;
      for (const { id: matchKey, doc } of matches) {
        const matchRef = db.collection('competition_matches').doc(`${id}__${matchKey}`);
        batch.set(matchRef, { id: matchKey, ...doc, hidden, updatedAt: FieldValue.serverTimestamp() });
        ops++;
        const participantUids = aclByMatch.get(matchKey);
        if (participantUids && participantUids.length > 0) {
          batch.set(matchRef.collection('private').doc('acl'), { participantUids, staffUids: [] });
          ops++;
        }
        if (ops >= 400) await flush();
      }
      batch.update(compRef, {
        status: 'live',
        withdrawn: [],
        // Multi-étapes : le publish matérialise TOUJOURS l'étape 1
        // (comp.format === stages[0].format — invariant §9a).
        ...(stagesOf({ format: comp.format, stages: comp.stages }).length > 1
          ? { currentStage: 1, stageResults: [] }
          : {}),
        // bracketMaterializedAt : posé par le VERROU transactionnel en tête.
        updatedAt: FieldValue.serverTimestamp(),
      });
      ops++;
      await flush();

      await audit(db, uid, 'competition_bracket_published', id, comp, { matches: matches.length, teams: stored.length });
      return NextResponse.json({ success: true, status: 'live', matchCount: matches.length });
    }

    return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });
  } catch (err) {
    captureApiError('API Admin/Competitions/Bracket POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

async function audit(
  db: FirebaseFirestore.Firestore,
  adminUid: string,
  action: Parameters<typeof writeAdminAuditLog>[1]['action'],
  competitionId: string,
  comp: FirebaseFirestore.DocumentData,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAdminAuditLog(db, {
    action,
    adminUid,
    targetType: 'competition',
    targetId: competitionId,
    targetLabel: (comp.name as string) ?? competitionId,
    metadata,
  });
}

export const maxDuration = 60;
