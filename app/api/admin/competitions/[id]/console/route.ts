import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import {
  openPhaseCheckin,
  reopenCheckin,
  forceScore,
  validateForfeit,
  type GamePair,
} from '@/lib/competitions/match-flow';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { sendCompetitionChannelMessage } from '@/lib/discord-competition';
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

    // Rooms : les admins voient tous les codes (spec §8). SELF-HEAL : un match
    // lancé dont la room manque (échec transitoire au launch) la récupère ici
    // — recharger la console suffit, jamais de chirurgie en base.
    const NEEDS_ROOM = new Set(['checkin', 'ready', 'live', 'awaiting_scores', 'score_review', 'disputed', 'awaiting_forfeit_validation']);
    const roomSnaps = await Promise.all(docs.map(d => d.ref.collection('private').doc('room').get()));
    const rooms: Record<string, { name: string; password: string }> = {};
    for (let i = 0; i < docs.length; i++) {
      const r = roomSnaps[i];
      if (r.exists) {
        rooms[docs[i].id] = r.data() as { name: string; password: string };
      } else if (NEEDS_ROOM.has((docs[i].data.status as string) ?? 'pending')) {
        const creds = generateRoomCredentials(docs[i].id);
        try {
          await docs[i].ref.collection('private').doc('room').create(creds);
          rooms[docs[i].id] = creds;
        } catch {
          // Créée en concurrence par un autre admin : relire.
          const again = await docs[i].ref.collection('private').doc('room').get();
          if (again.exists) rooms[docs[i].id] = again.data() as { name: string; password: string };
        }
      }
    }

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
      const rawIds: string[] = Array.isArray(body.matchIds)
        ? (body.matchIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      if (rawIds.length === 0) return NextResponse.json({ error: 'Aucun match à lancer.' }, { status: 400 });
      const matchIds = rawIds.slice(0, 40);

      const SKIP_REASON_FR: Record<string, string> = {
        invalid_state: 'déjà lancé ou terminé',
        teams_not_ready: 'équipes pas toutes connues',
        dispute_open: 'litige en cours',
      };
      const launched: Array<{ matchKey: string; teamA: string; teamB: string }> = [];
      const skipped: Array<{ matchId: string; reason: string }> = [];
      // Cap de sécurité tracé — jamais de troncature silencieuse.
      for (const over of rawIds.slice(40)) skipped.push({ matchId: over, reason: 'au-delà du plafond de 40 matchs par lancement' });

      for (const matchKey of matchIds) {
        const ref = refOf(matchKey);
        const res = await db.runTransaction<{ ok: boolean; reason?: string; teamA?: string; teamB?: string }>(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) return { ok: false, reason: 'match introuvable' };
          const m = snap.data()!;
          const dec = openPhaseCheckin(toFlowState(matchKey, m), cfg, Date.now());
          if (!dec.ok) return { ok: false, reason: SKIP_REASON_FR[dec.error] ?? dec.error };
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
          return { ok: true, teamA: m.teamA as string, teamB: m.teamB as string };
        });
        if (!res.ok) { skipped.push({ matchId: matchKey, reason: res.reason ?? 'non lançable' }); continue; }
        launched.push({ matchKey, teamA: res.teamA!, teamB: res.teamB! });
        // Room générée par le site (spec §8) — créée une seule fois, jamais
        // régénérée. SEUL already-exists est ignoré : tout autre échec est
        // tracé et signalé (le GET console auto-répare aussi — self-heal).
        try {
          await ref.collection('private').doc('room').create(generateRoomCredentials(matchKey));
        } catch (e) {
          const code = (e as { code?: number | string }).code;
          if (code !== 6 && code !== 'already-exists') {
            captureApiError('Console launch_phase room create', e);
            skipped.push({ matchId: matchKey, reason: 'room non créée — recharger la console la régénère' });
          }
        }
      }

      // Le check-in ne démarre jamais en silence (spec §8) : notif in-app à
      // tout le roster + message dans les salons Discord privés des équipes.
      // Best-effort borné — jamais bloquant pour le lancement lui-même.
      if (launched.length > 0) {
        try {
          const regIds = [...new Set(launched.flatMap(l => [l.teamA, l.teamB]))].filter(Boolean);
          const regSnaps = await db.getAll(...regIds.map(r => db.collection('competition_registrations').doc(r)));
          const regs = new Map(regSnaps.filter(s => s.exists).map(s => [s.id, s.data()!]));
          const compName = (comp.name as string) ?? id;
          const payloads: NotificationPayload[] = [];
          const discordPosts: Array<Promise<unknown>> = [];
          for (const l of launched) {
            const a = regs.get(l.teamA);
            const b = regs.get(l.teamB);
            const title = 'Check-in ouvert';
            const message = `${a?.name ?? '?'} vs ${b?.name ?? '?'} — ${compName}. Le capitaine a ${cfg.matchCheckinMinutes} minutes pour check-in.`;
            for (const reg of [a, b]) {
              if (!reg) continue;
              for (const ruid of (reg.rosterUids as string[] | undefined) ?? []) {
                payloads.push({
                  userId: ruid, type: 'competition_match_checkin', title, message,
                  link: `/competitions/${id}`, metadata: { competitionId: id, matchId: l.matchKey },
                });
              }
              const channelId = reg.discord?.textChannelId as string | undefined;
              if (channelId) {
                discordPosts.push(sendCompetitionChannelMessage(channelId, {
                  title, message, link: `https://aedral.com/competitions/${id}`,
                }).catch(() => null));
              }
            }
          }
          await createNotifications(db, payloads);
          // Salons Discord : borné à 8 s au total (pattern DM borné du repo).
          await Promise.race([
            Promise.allSettled(discordPosts),
            new Promise(resolve => setTimeout(resolve, 8_000)),
          ]);
        } catch (e) {
          captureApiError('Console launch_phase notifications', e);
        }
      }

      await audit(db, uid, 'competition_phase_launched', id, comp, {
        launched: launched.map(l => l.matchKey), skipped,
      });
      return NextResponse.json({ ok: true, launched: launched.map(l => l.matchKey), skipped });
    }

    if (action === 'reopen_checkin') {
      // Reprise d'un match en attente de forfait : l'équipe en retard est
      // arrivée, l'admin relance le check-in au lieu de valider le forfait
      // (le forfait n'est jamais la seule issue — spec §8).
      const matchKey = String(body.matchId ?? '');
      if (!matchKey) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
      const ref = refOf(matchKey);
      const res = await db.runTransaction<{ ok: boolean; reason?: string; live?: boolean }>(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, reason: 'Match introuvable.' };
        const dec = reopenCheckin(toFlowState(matchKey, snap.data()!), cfg, Date.now());
        if (!dec.ok) return { ok: false, reason: dec.error };
        tx.update(ref, dec.bothDone
          ? { status: 'live', updatedAt: FieldValue.serverTimestamp() }
          : {
              status: 'checkin',
              'checkin.openedAt': Timestamp.now(),
              'checkin.deadline': Timestamp.fromMillis(dec.deadlineMs),
              updatedAt: FieldValue.serverTimestamp(),
            });
        return { ok: true, live: dec.bothDone };
      });
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 409 });
      await audit(db, uid, 'competition_checkin_reopened', id, comp, { matchId: matchKey, resumedLive: res.live === true });
      return NextResponse.json({ ok: true, live: res.live === true });
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
        // Un litige encore ouvert sur ce match est clôturé par la décision.
        resolveDispute: reason ?? 'Résolu par forfait validé.',
      });
      if (result.changedMatchIds.length === 0) {
        // La garde pivot a no-opé (déjà finalisé par une action concurrente) :
        // le dire à l'admin plutôt que de faire semblant d'avoir tranché.
        return NextResponse.json({ error: 'Ce match est déjà finalisé — recharge la console.' }, { status: 409 });
      }
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
      if (result.changedMatchIds.length === 0) {
        return NextResponse.json({ error: 'Ce match est déjà finalisé — recharge la console.' }, { status: 409 });
      }
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
        // 1 match casté par phase (spec §8) : dé-feature les autres de la
        // phase — les matchs hors plan (phase null) forment leur propre groupe.
        const phase = snap.data()!.phase ?? null;
        const others = await db.collection('competition_matches')
          .where('competitionId', '==', id).get();
        for (const d of others.docs) {
          if (d.id !== snap.id && (d.data().phase ?? null) === phase && d.data().cast?.featured === true) {
            batch.update(d.ref, { 'cast.featured': false, updatedAt: FieldValue.serverTimestamp() });
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
