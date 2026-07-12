import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { materializeBracket, type TeamDisplay } from '@/lib/competitions/bracket-store';
import { MIN_TEAMS, MAX_TEAMS } from '@/lib/tournament';

// Seeding + matérialisation du bracket (archi §3, spec §2). Admins de
// compétition (rôle scopé) : le seeding fait partie de leur périmètre.
//
// Cycle : validation/registration → open_seeding (statut 'seeding', ordre
// aléatoire) → shuffle/reorder (ajustement admin) → publish (génère le bracket
// via lib/tournament, écrit competition_matches + ACL privées, statut 'live').
// La publication est one-shot : elle quitte 'seeding', donc n'écrase jamais un
// bracket dont des matchs ont progressé.

interface ApprovedReg {
  registrationId: string;
  name: string;
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

    const seeding = ordered.map((rid, i) => {
      const r = byId.get(rid)!;
      return { registrationId: rid, name: r.name, tag: r.tag, logoUrl: r.logoUrl, seed: i + 1 };
    });

    const status = (comp.status as string) ?? 'draft';
    const materialized = !!comp.bracketMaterializedAt;

    return NextResponse.json({
      status,
      approvedCount: approved.length,
      minTeams: MIN_TEAMS,
      maxTeams: MAX_TEAMS,
      seeding,
      // Ouverture du seeding depuis les statuts pré-live, avec assez d'équipes.
      canOpenSeeding: ['draft', 'registration', 'validation'].includes(status)
        && approved.length >= MIN_TEAMS && approved.length <= MAX_TEAMS,
      canEditSeeding: status === 'seeding',
      canPublish: status === 'seeding' && !materialized
        && approved.length >= MIN_TEAMS && approved.length <= MAX_TEAMS,
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
      if (approved.length < MIN_TEAMS) {
        return NextResponse.json({ error: `Il faut au moins ${MIN_TEAMS} équipes validées pour seeder (actuellement ${approved.length}).` }, { status: 409 });
      }
      if (approved.length > MAX_TEAMS) {
        return NextResponse.json({ error: `Le format accepte au plus ${MAX_TEAMS} équipes (${approved.length} validées) : retire des équipes ou passe-les en liste d'attente.` }, { status: 409 });
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
    if (comp.bracketMaterializedAt) {
      return NextResponse.json({ error: 'Le bracket est déjà publié : le seeding est figé.' }, { status: 409 });
    }

    // ── shuffle ──
    if (action === 'shuffle') {
      const seeding = shuffle(approved.map(r => r.registrationId));
      await compRef.update({ seeding, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, uid, 'competition_seeding_shuffled', id, comp, {});
      return NextResponse.json({ success: true, seeding });
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
      await compRef.update({ seeding: order, updatedAt: FieldValue.serverTimestamp() });
      await audit(db, uid, 'competition_seeding_reordered', id, comp, {});
      return NextResponse.json({ success: true, seeding: order });
    }

    // ── publish ──
    if (action === 'publish') {
      if (approved.length < MIN_TEAMS || approved.length > MAX_TEAMS) {
        return NextResponse.json({ error: `Nombre d'équipes validées hors format (${approved.length}).` }, { status: 409 });
      }
      // Le seeding stocké doit correspondre EXACTEMENT aux équipes validées
      // (aucune validation/retrait survenu entre-temps sans re-seed).
      const stored = (comp.seeding as string[] | undefined) ?? [];
      const storedSet = new Set(stored);
      if (stored.length !== approvedIds.size || storedSet.size !== stored.length
        || ![...storedSet].every(rid => approvedIds.has(rid))) {
        return NextResponse.json({ error: 'Le seeding ne correspond plus aux équipes validées (validation ou retrait entre-temps). Re-seed avant de publier.' }, { status: 409 });
      }

      // Anti-double-matérialisation : aucun match ne doit déjà exister.
      const existing = await db.collection('competition_matches').where('competitionId', '==', id).limit(1).get();
      if (!existing.empty) {
        return NextResponse.json({ error: 'Des matchs existent déjà pour cette compétition.' }, { status: 409 });
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
      });

      // Écriture batchée (63 matchs + ~32 ACL pour 32 équipes en double élim,
      // N−1 (+petite finale) en simple élim → < 500).
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
        bracketMaterializedAt: FieldValue.serverTimestamp(),
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
