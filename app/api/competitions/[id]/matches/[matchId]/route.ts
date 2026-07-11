import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { isCompetitionHidden, canViewHiddenCompetition } from '@/lib/competitions/visibility';
import { getMatchSideForUser, type MatchAccess } from '@/lib/competitions/match-access';
import {
  submitCheckin,
  submitScores,
  openDispute,
  type FlowSide,
  type GamePair,
  type SubmitScoresDecision,
} from '@/lib/competitions/match-flow';
import { toFlowState, toIso, flowConfigOf, toEngineOutcome } from '@/lib/competitions/match-flow-server';
import { applyMatchOutcome } from '@/lib/competitions/progression';
import { notifyMatchAlert } from '@/lib/competitions/match-notify';

// Page de match — détail public + zone privée (room, check-in, saisies) pour
// les participants, actions capitaine/staff (spec §8-§9). Le camp est TOUJOURS
// dérivé serveur (getMatchSideForUser, archi §8) — jamais un paramètre client.
//
// Écritures : transaction sur le doc match avec relecture fraîche (garde
// d'état) ; le RÉSULTAT final passe exclusivement par la progression
// (applyMatchOutcome, idempotente) — jamais écrit ici.

class FlowHttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

// Messages français des refus de la machine d'états — jamais de code brut
// devant un capitaine (review adversariale).
const FLOW_ERROR_FR: Record<string, string> = {
  invalid_state: "Cette action n'est plus possible dans l'état actuel du match.",
  teams_not_ready: 'Les deux équipes ne sont pas encore connues.',
  already_done: 'Déjà fait.',
  deadline_passed: 'Le délai est écoulé — un admin va statuer.',
  invalid_scores: 'Saisie incohérente avec le format du match (vainqueur net requis, pas de manche nulle).',
  dispute_open: 'Match gelé par un litige — un admin va trancher.',
};
const frError = (code: string) => FLOW_ERROR_FR[code] ?? "Action impossible dans l'état actuel du match.";

function matchRefOf(db: FirebaseFirestore.Firestore, competitionId: string, matchKey: string) {
  return db.collection('competition_matches').doc(`${competitionId}__${matchKey}`);
}

async function loadContext(req: NextRequest, params: Promise<{ id: string; matchId: string }>) {
  const { id, matchId } = await params;
  const db = getAdminDb();
  const compSnap = await db.collection('competitions').doc(id).get();
  if (!compSnap.exists) return { error: 404 as const };
  const comp = compSnap.data()!;
  const uid = await verifyAuth(req);
  if (isCompetitionHidden(comp)) {
    if (!uid || !(await canViewHiddenCompetition(db, uid))) return { error: 404 as const };
  }
  const matchSnap = await matchRefOf(db, id, matchId).get();
  if (!matchSnap.exists) return { error: 404 as const };
  return { db, id, matchId, comp, uid, match: matchSnap.data()!, ref: matchSnap.ref };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  const blocked = await checkRateLimit(limiters.read, rateLimitKey(req));
  if (blocked) return blocked;
  try {
    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { db, uid, match, ref } = ctx;

    // access calculé pour TOUT connecté, admins inclus : un admin qui est
    // aussi capitaine/staff d'une équipe du match (cas des tests sur preview)
    // voit la zone participant en plus de ses accès admin.
    const isAdmin = uid ? await isCompetitionAdmin(uid) : false;
    const access: MatchAccess | null = uid
      ? await getMatchSideForUser(db, { teamA: match.teamA ?? null, teamB: match.teamB ?? null }, uid)
      : null;
    const involved = isAdmin || (access?.side ?? null) !== null;

    // Room : équipes du match + admins uniquement (spec §8/§12 — jamais public).
    let room: { name: string; password: string } | null = null;
    if (involved) {
      const roomSnap = await ref.collection('private').doc('room').get();
      if (roomSnap.exists) room = roomSnap.data() as { name: string; password: string };
    }

    // Rosters PUBLICS des deux équipes (récap joueurs) : même projection que la
    // fiche — pseudo + rôle + capitaine + vérifié + tracker. RIEN d'autre du
    // snapshot (MMR, âges, IDs = admin only, archi §2).
    const rosterOf = async (regId: string | null) => {
      if (!regId) return null;
      const snap = await db.collection('competition_registrations').doc(regId).get();
      if (!snap.exists) return null;
      const r = snap.data()!;
      const captainUid = r.captainUid as string | undefined;
      return Array.isArray(r.roster)
        ? (r.roster as Array<Record<string, unknown>>).map(p => ({
            displayName: (p.displayName as string) ?? '',
            role: p.role === 'titulaire' ? 'titulaire' : 'remplacant',
            isCaptain: !!captainUid && p.uid === captainUid,
            verified: p.verified === true,
            trackerUrl: (p.trackerUrl as string) || null,
          }))
        : [];
    };
    const [rosterA, rosterB] = await Promise.all([
      rosterOf(match.teamA ?? null),
      rosterOf(match.teamB ?? null),
    ]);

    return NextResponse.json({
      match: {
        id: (match.id as string) ?? ctx.matchId,
        bracket: match.bracket ?? 'winners',
        round: match.round ?? 1,
        slot: match.slot ?? 1,
        phase: match.phase ?? null,
        bo: match.bo ?? 5,
        status: match.status ?? 'pending',
        teamA: match.teamA ?? null,
        teamB: match.teamB ?? null,
        voidA: match.voidA === true,
        voidB: match.voidB === true,
        teamAInfo: match.teamAInfo ?? null,
        teamBInfo: match.teamBInfo ?? null,
        roomHost: match.roomHost ?? 'a',
        checkin: match.checkin
          ? {
              deadline: toIso(match.checkin.deadline),
              a: { done: match.checkin.a?.done === true, at: toIso(match.checkin.a?.at) },
              b: { done: match.checkin.b?.done === true, at: toIso(match.checkin.b?.at) },
            }
          : null,
        scores: {
          a: Array.isArray(match.scores?.a) ? match.scores.a : [],
          b: Array.isArray(match.scores?.b) ? match.scores.b : [],
          aSubmittedAt: toIso(match.scores?.aSubmittedAt),
          bSubmittedAt: toIso(match.scores?.bSubmittedAt),
          counterDeadline: toIso(match.scores?.counterDeadline),
          final: match.scores?.final ?? null,
          validatedBy: match.scores?.validatedBy ?? null,
        },
        dispute: match.dispute
          ? {
              openedBy: match.dispute.openedBy,
              auto: match.dispute.auto === true,
              openedAt: toIso(match.dispute.openedAt),
              resolvedBy: match.dispute.resolvedBy ?? null,
              resolution: match.dispute.resolution ?? null,
            }
          : null,
        forfeit: match.forfeit ? { team: match.forfeit.team, reason: match.forfeit.reason ?? null } : null,
        cast: match.cast ?? null,
        winner: match.winner ?? null,
      },
      access: access ?? {
        side: null, isCaptain: false, isStaff: false, canCheckin: false, canSubmitScores: false,
      },
      isAdmin,
      room,
      rosters: { a: rosterA, b: rosterB },
    });
  } catch (err) {
    captureApiError('API Competitions/Match GET error', err);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const ctx = await loadContext(req, params);
    if ('error' in ctx) return NextResponse.json({ error: 'not_found' }, { status: ctx.error });
    const { db, id, matchId, comp, match, ref } = ctx;

    const body = await req.json();
    const action = body.action as string;

    const access = await getMatchSideForUser(db, { teamA: match.teamA ?? null, teamB: match.teamB ?? null }, uid);
    if (!access.side) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    const side: FlowSide = access.side;
    const cfg = flowConfigOf(comp);
    const label = matchId;
    const compName = (comp.name as string) ?? id;

    if (action === 'checkin') {
      if (!access.canCheckin) {
        return NextResponse.json({ error: 'Seul le capitaine peut check-in.' }, { status: 403 });
      }
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new FlowHttpError(404, 'not_found');
        const dec = submitCheckin(toFlowState(matchId, snap.data()!), side, Date.now());
        if (!dec.ok) throw new FlowHttpError(409, dec.error);
        tx.update(ref, {
          [`checkin.${side}.done`]: true,
          [`checkin.${side}.at`]: Timestamp.now(),
          ...(dec.bothDone ? { status: 'live' } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'submit_scores') {
      if (!access.canSubmitScores) {
        return NextResponse.json({ error: 'Réservé au capitaine ou au staff.' }, { status: 403 });
      }
      const games = sanitizeGames(body.games);
      if (!games) return NextResponse.json({ error: 'Saisie invalide.' }, { status: 400 });

      // Résolution retournée par la transaction (jamais mutée dans le
      // callback : une transaction peut être rejouée).
      const resolution = await db.runTransaction<Extract<SubmitScoresDecision, { ok: true }>['resolution']>(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new FlowHttpError(404, 'not_found');
        const st = toFlowState(matchId, snap.data()!);
        const dec = submitScores(st, side, games, cfg, Date.now());
        if (!dec.ok) throw new FlowHttpError(409, dec.error);
        const update: Record<string, unknown> = {
          [`scores.${side}`]: dec.games,
          [`scores.${side}SubmittedAt`]: Timestamp.now(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (dec.resolution === null) {
          if (dec.counterDeadlineMs !== null && st.scores.counterDeadlineMs === null) {
            update['scores.counterDeadline'] = Timestamp.fromMillis(dec.counterDeadlineMs);
          }
          if (st.status !== 'score_review') update.status = 'score_review';
        } else if (dec.resolution.kind === 'mismatch') {
          update.status = 'disputed';
          update.dispute = {
            openedBy: 'auto', auto: true, openedAt: Timestamp.now(), resolvedBy: null, resolution: null,
          };
        }
        // Accord : rien à poser ici — la progression (après la transaction)
        // écrit le résultat ; en cas de crash entre les deux, le tick répare
        // (detectUnfinalizedAgreement).
        tx.update(ref, update);
        return dec.resolution;
      });

      if (resolution?.kind === 'agreement') {
        // autoGuard : la progression re-valide l'accord sur le doc frais dans
        // SA transaction (une correction divergente peut arriver entre-temps).
        await applyMatchOutcome(db, id, matchId, toEngineOutcome(resolution.outcome), { validatedBy: 'auto', autoGuard: true });
      } else if (resolution?.kind === 'mismatch') {
        // Attendu (pas de fire-and-forget en serverless — la fonction peut
        // être gelée dès la réponse envoyée).
        await notifyMatchAlert(db, { kind: 'dispute_auto', competitionId: id, competitionName: compName, matchLabel: label });
      }
      return NextResponse.json({ ok: true, resolution: resolution?.kind ?? 'recorded' });
    }

    if (action === 'open_dispute') {
      if (!access.canSubmitScores) {
        return NextResponse.json({ error: 'Réservé au capitaine ou au staff.' }, { status: 403 });
      }
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new FlowHttpError(404, 'not_found');
        const dec = openDispute(toFlowState(matchId, snap.data()!));
        if (!dec.ok) throw new FlowHttpError(409, dec.error);
        tx.update(ref, {
          status: 'disputed',
          dispute: { openedBy: side, auto: false, openedAt: Timestamp.now(), resolvedBy: null, resolution: null },
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await notifyMatchAlert(db, { kind: 'dispute_manual', competitionId: id, competitionName: compName, matchLabel: label });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (err) {
    if (err instanceof FlowHttpError) {
      return NextResponse.json({ error: frError(err.code), code: err.code }, { status: err.status });
    }
    captureApiError('API Competitions/Match POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Saisie brute → manches propres (bornes larges : la validation métier fine —
// vainqueur net, BO — vit dans match-flow).
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
