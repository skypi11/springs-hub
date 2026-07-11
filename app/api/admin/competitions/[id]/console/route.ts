import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import {
  openPhaseCheckin,
  forceScore,
  validateForfeit,
  type GamePair,
} from '@/lib/competitions/match-flow';
import { toFlowState, toIso, flowConfigOf, generateRoomCredentials, toEngineOutcome } from '@/lib/competitions/match-flow-server';
import { applyMatchOutcome } from '@/lib/competitions/progression';
import { reconstructBracket, type MatchDoc } from '@/lib/competitions/bracket-store';
import { isFinished, needsAdminDecision } from '@/lib/tournament';

// Console live admin (archi §7) — jour de match. Lecture : admins de
// compétition (un admin Aedral complet l'est automatiquement, spec §6).
// Toutes les actions sont journalisées dans admin_audit_logs (l'identité de
// l'admin ne va JAMAIS dans les docs publics — invariant §8).
//
// - launch_phase : action EXPLICITE (R5-2), liste de matchs = lancement
//   PARTIEL naturel (un litige qui bloque un match ne gèle pas les autres).
//   Ouvre le check-in (5 min) et crée la room (/private/room) si absente.
// - validate_forfeit / force_score : passent par la PROGRESSION (unique chemin
//   d'écriture d'un résultat, idempotent).
// - set_cast : 1 match casté par phase (spec §8) — dé-feature les autres
//   matchs de la même phase.

class ConsoleError extends Error {
  constructor(public status: number, public msg: string) { super(msg); }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const matchesSnap = await db.collection('competition_matches').where('competitionId', '==', id).get();
    const docs = matchesSnap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ref: d.ref, data: d.data() }));

    // Rooms : les admins voient tous les codes (spec §8).
    const roomSnaps = await Promise.all(docs.map(d => d.ref.collection('private').doc('room').get()));
    const rooms: Record<string, { name: string; password: string }> = {};
    roomSnaps.forEach((r, i) => {
      if (r.exists) rooms[docs[i].id] = r.data() as { name: string; password: string };
    });

    // État global du bracket (clôture possible ? décision admin requise ?).
    let finished = false;
    let adminDecision = false;
    if (docs.length > 0 && comp.format?.bo) {
      try {
        const bracket = reconstructBracket({
          withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
          bo: comp.format.bo,
          forfeitScore: comp.format.forfeitScore ?? { games: 3, goalsPerGame: 1 },
          matches: docs.map(d => ({ id: d.id, ...(d.data as MatchDoc) })),
        });
        finished = isFinished(bracket);
        adminDecision = needsAdminDecision(bracket);
      } catch {
        // Bracket incohérent : la console reste utilisable, les flags à false.
      }
    }

    return NextResponse.json({
      competition: {
        id, name: comp.name ?? id, status: comp.status ?? 'draft',
        phasePlan: comp.schedule?.phasePlan ?? [],
        checkinMinutes: flowConfigOf(comp).matchCheckinMinutes,
      },
      matches: docs.map(d => serializeConsoleMatch(d.id, d.data)),
      rooms,
      finished,
      needsAdminDecision: adminDecision,
    });
  } catch (err) {
    captureApiError('API Admin/Competitions/Console GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const db = getAdminDb();
    const compRef = db.collection('competitions').doc(id);
    const compSnap = await compRef.get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;
    const cfg = flowConfigOf(comp);

    const body = await req.json();
    const action = body.action as string;
    const refOf = (matchKey: string) => db.collection('competition_matches').doc(`${id}__${matchKey}`);

    if (action === 'launch_phase') {
      const matchIds: string[] = Array.isArray(body.matchIds)
        ? (body.matchIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 40)
        : [];
      if (matchIds.length === 0) return NextResponse.json({ error: 'Aucun match à lancer.' }, { status: 400 });

      const launched: string[] = [];
      const skipped: Array<{ matchId: string; reason: string }> = [];
      for (const matchKey of matchIds) {
        const ref = refOf(matchKey);
        const ok = await db.runTransaction<boolean>(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return false;
          const dec = openPhaseCheckin(toFlowState(matchKey, snap.data()!), cfg, Date.now());
          if (!dec.ok) return false;
          tx.update(ref, {
            status: 'checkin',
            checkin: {
              openedAt: Timestamp.now(),
              deadline: Timestamp.fromMillis(dec.deadlineMs),
              a: { done: false, at: null },
              b: { done: false, at: null },
            },
            updatedAt: FieldValue.serverTimestamp(),
          });
          return true;
        });
        if (!ok) { skipped.push({ matchId: matchKey, reason: 'non lançable' }); continue; }
        launched.push(matchKey);
        // Room générée par le site (spec §8) — créée une seule fois, JAMAIS
        // régénérée (create ignore l'échec si le doc existe déjà).
        try {
          await ref.collection('private').doc('room').create(generateRoomCredentials(matchKey));
        } catch { /* room déjà créée (relance d'un check-in) */ }
      }
      await audit(db, uid, 'competition_phase_launched', id, comp, { launched, skipped });
      return NextResponse.json({ ok: true, launched, skipped });
    }

    if (action === 'validate_forfeit') {
      const matchKey = String(body.matchId ?? '');
      const team = body.team as 'a' | 'b' | 'both';
      if (!matchKey || !['a', 'b', 'both'].includes(team)) {
        return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
      }
      const snap = await refOf(matchKey).get();
      if (!snap.exists) return NextResponse.json({ error: 'Match introuvable.' }, { status: 404 });
      const dec = validateForfeit(toFlowState(matchKey, snap.data()!), team);
      if (!dec.ok) return NextResponse.json({ error: dec.error }, { status: 409 });
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
      const result = await applyMatchOutcome(db, id, matchKey, toEngineOutcome(dec.outcome), {
        validatedBy: 'admin', forfeitReason: reason,
      });
      await audit(db, uid, 'competition_forfeit_validated', id, comp, { matchId: matchKey, team, reason });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'force_score') {
      const matchKey = String(body.matchId ?? '');
      const games = sanitizeGames(body.games);
      if (!matchKey || !games) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
      const snap = await refOf(matchKey).get();
      if (!snap.exists) return NextResponse.json({ error: 'Match introuvable.' }, { status: 404 });
      const dec = forceScore(toFlowState(matchKey, snap.data()!), games);
      if (!dec.ok) return NextResponse.json({ error: dec.error }, { status: 409 });
      const resolution = typeof body.resolution === 'string' ? body.resolution.slice(0, 500) : null;
      const result = await applyMatchOutcome(db, id, matchKey, toEngineOutcome(dec.outcome), {
        validatedBy: 'admin',
        // Résout le litige ouvert le cas échéant (texte visible des équipes).
        resolveDispute: resolution,
      });
      await audit(db, uid, 'competition_score_forced', id, comp, { matchId: matchKey, games, resolution });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'set_cast') {
      const matchKey = String(body.matchId ?? '');
      const featured = body.featured === true;
      const rawUrl = typeof body.streamUrl === 'string' ? body.streamUrl.trim() : '';
      const streamUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl.slice(0, 300) : null;
      const ref = refOf(matchKey);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: 'Match introuvable.' }, { status: 404 });

      const batch = db.batch();
      if (featured) {
        // 1 match casté par phase (spec §8) : dé-feature les autres de la phase.
        const phase = snap.data()!.phase ?? null;
        if (phase !== null) {
          const others = await db.collection('competition_matches')
            .where('competitionId', '==', id).get();
          for (const d of others.docs) {
            if (d.id !== snap.id && d.data().phase === phase && d.data().cast?.featured === true) {
              batch.update(d.ref, { 'cast.featured': false, updatedAt: FieldValue.serverTimestamp() });
            }
          }
        }
      }
      batch.update(ref, {
        cast: featured ? { featured: true, streamUrl } : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      await audit(db, uid, 'competition_cast_set', id, comp, { matchId: matchKey, featured, streamUrl });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (err) {
    if (err instanceof ConsoleError) return NextResponse.json({ error: err.msg }, { status: err.status });
    captureApiError('API Admin/Competitions/Console POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

function serializeConsoleMatch(engineId: string, m: FirebaseFirestore.DocumentData) {
  return {
    id: engineId,
    bracket: m.bracket ?? 'winners',
    round: m.round ?? 1,
    slot: m.slot ?? 1,
    phase: m.phase ?? null,
    bo: m.bo ?? 5,
    status: m.status ?? 'pending',
    teamA: m.teamA ?? null,
    teamB: m.teamB ?? null,
    voidA: m.voidA === true,
    voidB: m.voidB === true,
    teamAInfo: m.teamAInfo ?? null,
    teamBInfo: m.teamBInfo ?? null,
    roomHost: m.roomHost ?? 'a',
    checkin: m.checkin
      ? {
          deadline: toIso(m.checkin.deadline),
          a: { done: m.checkin.a?.done === true },
          b: { done: m.checkin.b?.done === true },
        }
      : null,
    scores: {
      a: Array.isArray(m.scores?.a) ? m.scores.a : [],
      b: Array.isArray(m.scores?.b) ? m.scores.b : [],
      counterDeadline: toIso(m.scores?.counterDeadline),
      final: m.scores?.final ?? null,
      validatedBy: m.scores?.validatedBy ?? null,
    },
    dispute: m.dispute
      ? { openedBy: m.dispute.openedBy, auto: m.dispute.auto === true, resolvedBy: m.dispute.resolvedBy ?? null }
      : null,
    forfeit: m.forfeit ? { team: m.forfeit.team, reason: m.forfeit.reason ?? null } : null,
    cast: m.cast ?? null,
    winner: m.winner ?? null,
  };
}

function sanitizeGames(raw: unknown): GamePair[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 13) return null;
  const out: GamePair[] = [];
  for (const g of raw) {
    const a = (g as { a?: unknown })?.a;
    const b = (g as { b?: unknown })?.b;
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if ((a as number) < 0 || (b as number) < 0 || (a as number) > 99 || (b as number) > 99) return null;
    out.push({ a: a as number, b: b as number });
  }
  return out;
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
