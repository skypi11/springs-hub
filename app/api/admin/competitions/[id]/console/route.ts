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
import { sendCompetitionChannelMessage, sendCompetitionDM } from '@/lib/discord-competition';
import { discordIdOfUid } from '@/lib/competitions/discord-guard';
import { publishMatchResults } from '@/lib/competitions/publish-result';
import {
  broadcast, summarizeDelivery,
  type BroadcastItem, type DeliveryReport,
} from '@/lib/competitions/tournament-broadcast';
import {
  matchCheckinText, checkinReopenedText, adminRulingText,
  teamWithdrawnText, opponentWithdrawnText, organizerAnnouncementText,
  generalCheckinOpenText, finalPlacementText, podiumAnnounceText, stageOutcomeText,
  waitlistClosedText,
  type BroadcastText,
} from '@/lib/competitions/broadcast-messages';
import { phasePlanForStage } from '@/lib/competitions/schedule-plan';
import { toFlowState, toIso, flowConfigOf, generateRoomCredentials, toEngineOutcome } from '@/lib/competitions/match-flow-server';
import { applyMatchOutcome, applyWithdraw, applyReplacement } from '@/lib/competitions/progression';
import { reconstructBracket, materializeMatches, type MatchDoc, type TeamDisplay } from '@/lib/competitions/bracket-store';
import { engineFor, kindOf } from '@/lib/competitions/formats-server';
import {
  computeStageAdvance,
  currentStageOf,
  formatOfStage,
  isStageTransferStuck,
  stageLabelOf,
  stageOfMatch,
  stagesOf,
  teamBoundsForKind,
} from '@/lib/competitions/stages';
import { computeTeamStats, type Placement } from '@/lib/tournament';
import { orderByCircuitRank, orderByMmr, seedRankOf, type SeedableTeam } from '@/lib/competitions/seeding';
import { circuitRankByTeamId } from '@/lib/competitions/seeding-server';
import type { CompetitionFormat, PhasePlanEntry } from '@/types/competitions';
import { randomInt } from 'node:crypto';
import { syncRegistrationToCalendar, removeRegistrationFromCalendar } from '@/lib/competitions/calendar-sync';
import { closeCompetition } from '@/lib/competitions/close-competition';

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

    // État global du bracket de l'ÉTAPE COURANTE (clôture possible ? passage
    // d'étape possible ? décision admin requise ?).
    const stages = stagesOf(comp);
    const cur = currentStageOf(comp);
    const stageFormat = formatOfStage(comp, cur);
    let finished = false;
    let adminDecision = false;
    let canGenerateNextRound = false;
    let canAdvanceStage = false;
    let placements: Placement[] | null = null;
    let unresolvedTiebreaks: Array<{
      group: string;
      teams: Array<{ registrationId: string; tied: boolean; goalDiff: number; goalsFor: number }>;
    }> = [];
    if (docs.length > 0 && stageFormat?.bo) {
      try {
        // Prédicats et placements routés par la registry de formats : un round
        // robin est « fini » quand tous ses matchs sont terminaux (jamais de
        // champion mécanique, jamais de « décision admin » pour un titre).
        const engine = engineFor(kindOf(stageFormat));
        const bracket = reconstructBracket({
          withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
          bo: stageFormat.bo,
          forfeitScore: stageFormat.forfeitScore ?? { games: 3, goalsPerGame: 1 },
          matches: docs.map(d => ({ id: d.id, ...(d.data as MatchDoc) })),
          kind: kindOf(stageFormat),
          swissRounds: typeof stageFormat?.swissRounds === 'number' ? stageFormat.swissRounds : undefined,
          stage: cur,
        });
        const stageFinished = engine.isFinished(bracket);
        adminDecision = engine.needsAdminDecision(bracket);
        // « Fini » côté console = CLÔTURABLE : dernière étape terminée. Une
        // étape intermédiaire terminée ouvre le PASSAGE d'étape, pas la clôture.
        finished = stageFinished && cur === stages.length;
        canAdvanceStage = comp.status === 'live' && stageFinished && cur < stages.length;
        // Formats à génération incrémentale (suisse) : la ronde suivante
        // est-elle appariable ? (tous les matchs terminaux + rondes restantes)
        canGenerateNextRound = comp.status === 'live'
          && (engine.canGenerateNextRound?.(bracket) ?? false);
        // Clôture (Lot 4) : placements provisoires + égalités à arbitrer,
        // calculés dès que l'ÉTAPE est finie — l'arbitrage précède aussi bien
        // la clôture que le passage d'étape (le seed de l'étape suivante et le
        // classement doivent raconter la même histoire, design §9c).
        if (stageFinished) {
          const resolutions = (comp.tiebreakResolutions as Record<string, string[]> | undefined) ?? undefined;
          placements = engine.computePlacements(bracket, stageFormat, resolutions);
          const stats = computeTeamStats(bracket);
          const byGroup = new Map<string, typeof placements>();
          for (const p of placements) {
            if (!p.needsAdminTiebreak) continue;
            const g = byGroup.get(p.group) ?? [];
            g.push(p);
            byGroup.set(p.group, g);
          }
          unresolvedTiebreaks = [...byGroup.keys()].map(group => ({
            group,
            // L'admin arbitre le groupe ENTIER (il voit les stats) — ordre
            // provisoire du moteur comme point de départ.
            teams: placements!.filter(p => p.group === group).map(p => ({
              registrationId: p.teamId,
              tied: p.needsAdminTiebreak,
              goalDiff: Math.round((stats.get(p.teamId)?.normalizedDiff ?? 0) * 100) / 100,
              goalsFor: stats.get(p.teamId)?.goalsFor ?? 0,
            })),
          }));
          // SOUPAPE (design §9c, review adversariale) : étape intermédiaire
          // finie et arbitrée mais transfert STRUCTURELLEMENT impossible
          // (retraits massifs, génération infaisable) → le CTA bascule sur la
          // clôture au classement courant — jamais de compétition briquée.
          if (canAdvanceStage && unresolvedTiebreaks.length === 0) {
            const transfer = stages[cur - 1]?.transfer;
            const nextStage = stages[cur];
            const stuck = !transfer || !nextStage || isStageTransferStuck({
              transfer,
              placements,
              stats,
              withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
              tiebreakResolutions: (comp.tiebreakResolutions as Record<string, string[]> | undefined) ?? {},
              nextStage,
              generateNext: seeding => engineFor(kindOf(nextStage.format)).generate(seeding, nextStage.format),
            });
            if (stuck) {
              canAdvanceStage = false;
              finished = true;
            }
          }
        }
      } catch {
        // Bracket incohérent : la console reste utilisable, les flags à false.
      }
    }

    // Inscriptions : check-in général + waitlist (repêchage) + retraits.
    const regsSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id).get();
    const registrations = regsSnap.docs
      .filter(d => ['approved', 'waitlisted', 'withdrawn'].includes((d.data().status as string) ?? ''))
      .map(d => {
        const r = d.data();
        return {
          registrationId: d.id,
          name: r.name ?? '',
          tag: r.tag ?? '',
          logoUrl: r.logoUrl ?? null,
          status: r.status,
          seed: r.seed ?? null,
          generalCheckin: r.generalCheckin
            ? { done: r.generalCheckin.done === true, at: toIso(r.generalCheckin.at) }
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      competition: {
        id, name: comp.name ?? id, status: comp.status ?? 'draft',
        game: (comp.game as string) ?? 'rocket_league',
        phasePlan: comp.schedule?.phasePlan ?? [],
        // Un serveur est-il branché ? (pilote le nettoyage de fin de tournoi)
        discordConfigured: !!comp.discord?.guildId,
        checkinMinutes: flowConfigOf(comp).matchCheckinMinutes,
        generalCheckinMinutes: (comp.schedule?.generalCheckinMinutes as number) ?? 20,
        withdrawn: Array.isArray(comp.withdrawn) ? comp.withdrawn : [],
      },
      matches: docs.map(d => serializeConsoleMatch(d.id, d.data)),
      rooms,
      registrations,
      finished,
      needsAdminDecision: adminDecision,
      canGenerateNextRound,
      // Multi-étapes (design §9) : métas d'étapes + étape courante + résultats
      // figés — l'UI groupe les matchs par `stage` et affiche le CTA de
      // passage quand l'étape courante est terminée.
      stages: stages.map((s, i) => ({
        stage: i + 1,
        kind: s.kind,
        label: stageLabelOf(s),
        // Tolérance doc abîmé (review) : la console ne crash JAMAIS sur un
        // format absent — même règle que `stageFormat?.bo` plus haut.
        maxTeams: s.format?.maxTeams ?? null,
        transfer: s.transfer ?? null,
      })),
      currentStage: cur,
      stageResults: Array.isArray(comp.stageResults)
        ? (comp.stageResults as Array<Record<string, unknown>>).map(r => ({
            ...r,
            closedAt: toIso(r.closedAt),
          }))
        : [],
      canAdvanceStage,
      // Clôture (Lot 4) : classement provisoire + égalités à arbitrer, et le
      // classement FINAL écrit si la compétition est déjà clôturée.
      placements: placements?.map(p => ({
        registrationId: p.teamId, placement: p.placement, group: p.group,
      })) ?? null,
      unresolvedTiebreaks,
      finalPlacements: (comp.finalPlacements as unknown[] | undefined) ?? null,
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

    /** Les deux camps d'un match, avec leurs noms — pour parler aux équipes. */
    const sidesOf = async (m: Record<string, unknown>) => {
      const aId = (m.teamA as string) ?? '';
      const bId = (m.teamB as string) ?? '';
      const ids = [aId, bId].filter(Boolean);
      if (ids.length === 0) return { aId, bId, nameOf: () => 'ton adversaire' };
      const snaps = await db.getAll(...ids.map(r => db.collection('competition_registrations').doc(r)));
      const names = new Map(snaps.map(s => [s.id, (s.data()?.name as string) ?? '']));
      return { aId, bId, nameOf: (rid: string) => names.get(rid) || 'ton adversaire' };
    };
    /** Même message aux deux camps d'un match (arbitrage : les deux le lisent). */
    const toBothSides = (aId: string, bId: string, text: BroadcastText, link: string): BroadcastItem[] =>
      [aId, bId].filter(Boolean).map(rid => ({
        target: { kind: 'team' as const, registrationId: rid }, text, link,
      }));

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
      const launched: Array<{ matchKey: string; teamA: string; teamB: string; room: { name: string; password: string } | null }> = [];
      const skipped: Array<{ matchId: string; reason: string }> = [];
      // Accusé de livraison Discord : sans lui, une équipe qui dit « on n'a
      // rien reçu » est indiscernable d'une équipe qui n'a pas regardé.
      let delivery: DeliveryReport | null = null;
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
        // Room générée par le site (spec §8) — créée une seule fois, jamais
        // régénérée. SEUL already-exists est ignoré : tout autre échec est
        // tracé et signalé (le GET console auto-répare aussi — self-heal).
        // Les identifiants sont RETENUS pour partir avec le message de check-in :
        // ils sont aléatoires, donc illisibles autrement que depuis le doc.
        let room: { name: string; password: string } | null = null;
        try {
          const creds = generateRoomCredentials(matchKey);
          await ref.collection('private').doc('room').create(creds);
          room = creds;
        } catch (e) {
          const code = (e as { code?: number | string }).code;
          if (code === 6 || code === 'already-exists') {
            // Relance après interruption : la room existante fait foi.
            const existing = await ref.collection('private').doc('room').get().catch(() => null);
            const d = existing?.data();
            room = d ? { name: (d.name as string) ?? '', password: (d.password as string) ?? '' } : null;
          } else {
            captureApiError('Console launch_phase room create', e);
            skipped.push({ matchId: matchKey, reason: 'room non créée — recharger la console la régénère' });
          }
        }
        launched.push({ matchKey, teamA: res.teamA!, teamB: res.teamB!, room });
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
          const items: BroadcastItem[] = [];
          for (const l of launched) {
            // Chaque camp reçoit SON message : « tu joues contre X » plutôt que
            // « A vs B », et le lien pointe sur la page du match, pas sur la
            // fiche du tournoi — sur une fenêtre de 5 minutes, la navigation
            // en moins compte.
            for (const [regId, oppId] of [[l.teamA, l.teamB], [l.teamB, l.teamA]] as const) {
              const reg = regs.get(regId);
              if (!reg) continue;
              const text = matchCheckinText({
                opponentName: (regs.get(oppId)?.name as string) ?? 'ton adversaire',
                minutes: cfg.matchCheckinMinutes,
                room: l.room,
              });
              const link = `/competitions/${id}/match/${l.matchKey}`;
              for (const ruid of (reg.rosterUids as string[] | undefined) ?? []) {
                payloads.push({
                  userId: ruid, type: 'competition_match_checkin',
                  title: text.title, message: `${compName} — ${text.message}`,
                  link, metadata: { competitionId: id, matchId: l.matchKey },
                });
              }
              items.push({
                target: { kind: 'team', registrationId: regId },
                text, link: `https://aedral.com${link}`,
              });
            }
          }
          await createNotifications(db, payloads);
          delivery = await broadcast(db, id, items, { competition: comp });

          // Le tournoi part au complet : la liste d'attente doit l'apprendre.
          // Elle n'a pas de salon (jamais provisionnée), donc message privé au
          // capitaine — et une seule fois, au PREMIER lancement.
          if (comp.waitlistClosedNotifiedAt == null) {
            const claimed = await db.runTransaction(async tx => {
              const fresh = await tx.get(compRef);
              if (fresh.data()?.waitlistClosedNotifiedAt != null) return false;
              tx.update(compRef, { waitlistClosedNotifiedAt: Timestamp.now() });
              return true;
            });
            if (claimed) {
              const wl = await db.collection('competition_registrations')
                .where('competitionId', '==', id).where('status', '==', 'waitlisted').get();
              const text = waitlistClosedText({ competitionName: (comp.name as string) ?? id });
              for (const d of wl.docs) {
                const discordId = discordIdOfUid((d.data().captainUid as string) ?? '');
                if (!discordId) continue;
                await sendCompetitionDM(discordId, {
                  title: text.title, message: text.message,
                  link: `https://aedral.com/competitions/${id}`,
                }).catch(() => null);
              }
            }
          }
        } catch (e) {
          captureApiError('Console launch_phase notifications', e);
        }
      }

      await audit(db, uid, 'competition_phase_launched', id, comp, {
        launched: launched.map(l => l.matchKey), skipped,
      });
      return NextResponse.json({
        ok: true, launched: launched.map(l => l.matchKey), skipped,
        delivery, deliverySummary: delivery ? summarizeDelivery(delivery) : null,
      });
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

      // Les deux camps doivent le savoir : celui qui était en retard a une
      // seconde chance, et celui qui attendait un forfait apprend que le match
      // repart. Sans ce message, l'action relance une horloge que personne ne voit.
      let reopenDelivery: DeliveryReport | null = null;
      if (res.live !== true) {
        try {
          const m = (await refOf(matchKey).get()).data() ?? {};
          const { aId, bId, nameOf } = await sidesOf(m);
          const room = (await refOf(matchKey).collection('private').doc('room').get().catch(() => null))?.data();
          const link = `https://aedral.com/competitions/${id}/match/${matchKey}`;
          reopenDelivery = await broadcast(db, id, [aId, bId].filter(Boolean).map(rid => ({
            target: { kind: 'team' as const, registrationId: rid },
            text: checkinReopenedText({
              opponentName: nameOf(rid === aId ? bId : aId),
              minutes: cfg.matchCheckinMinutes,
              room: room ? { name: (room.name as string) ?? '', password: (room.password as string) ?? '' } : null,
            }),
            link,
          })), { competition: comp });
        } catch (e) {
          captureApiError('Console reopen_checkin notifications', e);
        }
      }

      await audit(db, uid, 'competition_checkin_reopened', id, comp, { matchId: matchKey, resumedLive: res.live === true });
      return NextResponse.json({
        ok: true, live: res.live === true,
        delivery: reopenDelivery,
        deliverySummary: reopenDelivery ? summarizeDelivery(reopenDelivery) : null,
      });
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
      await publishMatchResults(db, id, result.changedMatchIds);
      // Une décision d'arbitrage qui tombe en silence se découvre par
      // l'adversaire — et le conflit commence là. Les deux camps reçoivent la
      // même chose, avec le motif saisi par l'admin.
      let forfeitDelivery: DeliveryReport | null = null;
      try {
        const { aId, bId, nameOf } = await sidesOf(snap.data()!);
        const loserIsA = team === 'a';
        const text = adminRulingText({
          kind: team === 'both' ? 'double_forfeit' : 'forfeit',
          winnerName: nameOf(loserIsA ? bId : aId),
          loserName: nameOf(loserIsA ? aId : bId),
          reason,
        });
        forfeitDelivery = await broadcast(db, id,
          toBothSides(aId, bId, text, `https://aedral.com/competitions/${id}/match/${matchKey}`),
          { competition: comp });
      } catch (e) {
        captureApiError('Console validate_forfeit notifications', e);
      }

      await audit(db, uid, 'competition_forfeit_validated', id, comp, { matchId: matchKey, team, reason });
      return NextResponse.json({
        ok: true, ...result,
        delivery: forfeitDelivery,
        deliverySummary: forfeitDelivery ? summarizeDelivery(forfeitDelivery) : null,
      });
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
      await publishMatchResults(db, id, result.changedMatchIds);
      // Score retenu + motif aux deux camps : c'est la décision la plus
      // contestée d'un tournoi, elle ne peut pas rester dans la console.
      let scoreDelivery: DeliveryReport | null = null;
      try {
        const { aId, bId, nameOf } = await sidesOf(snap.data()!);
        const wonA = games.filter(g => g.a > g.b).length;
        const wonB = games.filter(g => g.b > g.a).length;
        const aWins = wonA >= wonB;
        const text = adminRulingText({
          kind: 'forced_score',
          winnerName: nameOf(aWins ? aId : bId),
          loserName: nameOf(aWins ? bId : aId),
          score: `${Math.max(wonA, wonB)}-${Math.min(wonA, wonB)}`,
          reason: resolution,
        });
        scoreDelivery = await broadcast(db, id,
          toBothSides(aId, bId, text, `https://aedral.com/competitions/${id}/match/${matchKey}`),
          { competition: comp });
      } catch (e) {
        captureApiError('Console force_score notifications', e);
      }

      await audit(db, uid, 'competition_score_forced', id, comp, { matchId: matchKey, games, resolution });
      return NextResponse.json({
        ok: true, ...result,
        delivery: scoreDelivery,
        deliverySummary: scoreDelivery ? summarizeDelivery(scoreDelivery) : null,
      });
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

    if (action === 'open_general_checkin') {
      // Spec §8 : 14 h 30, 20 min, capitaine seul. Action admin explicite.
      let checkinDelivery: DeliveryReport | null = null;
      const regsSnap = await db.collection('competition_registrations')
        .where('competitionId', '==', id).where('status', '==', 'approved').get();
      const batch = db.batch();
      let opened = 0;
      for (const d of regsSnap.docs) {
        if (d.data().generalCheckin?.done === true) continue;   // idempotent, ne réinitialise jamais un done
        batch.update(d.ref, {
          generalCheckin: { done: false, byUid: null, at: null },
          updatedAt: FieldValue.serverTimestamp(),
        });
        opened++;
      }
      // Heure d'ouverture retenue sur la compétition : sans elle, impossible de
      // relancer les retardataires avant l'échéance (le tick s'en sert).
      // `remindedAt` remis à null : une réouverture doit pouvoir relancer.
      batch.update(compRef, {
        generalCheckin: { openedAt: Timestamp.now(), remindedAt: null },
      });
      await batch.commit();
      // Le check-in ne démarre jamais en silence : notif aux capitaines +
      // salons Discord d'équipe (borné, best-effort).
      try {
        const compName = (comp.name as string) ?? id;
        const minutes = (comp.schedule?.generalCheckinMinutes as number) ?? 20;
        const pending = regsSnap.docs.filter(d => d.data().generalCheckin?.done !== true);

        // Nom du capitaine, en UNE lecture groupée. Il est figé au moment de
        // l'inscription : ce n'est pas forcément celui qui dirige l'équipe
        // aujourd'hui, et lui seul peut confirmer. Le nommer évite l'équipe au
        // complet bloquée devant un bouton que personne d'autre ne peut presser.
        const captainUids = [...new Set(pending
          .map(d => d.data().captainUid as string | undefined)
          .filter((u): u is string => !!u))];
        const captainNames = new Map<string, string>();
        if (captainUids.length > 0) {
          const snaps = await db.getAll(...captainUids.map(u => db.collection('users').doc(u)));
          for (const s of snaps) {
            const u = s.data();
            const name = (u?.displayName as string) || (u?.discordUsername as string) || '';
            if (name) captainNames.set(s.id, name);
          }
        }

        const payloads: NotificationPayload[] = [];
        const items: BroadcastItem[] = [];
        for (const d of pending) {
          const r = d.data();
          const text = generalCheckinOpenText({
            teamName: (r.name as string) ?? 'ton équipe',
            captainName: captainNames.get((r.captainUid as string) ?? '') ?? null,
            minutes,
          });
          for (const ruid of (r.rosterUids as string[] | undefined) ?? []) {
            payloads.push({
              userId: ruid, type: 'competition_match_checkin',
              title: text.title, message: `${compName} — ${text.message}`,
              link: `/competitions/${id}`, metadata: { competitionId: id },
            });
          }
          items.push({
            target: { kind: 'team', registrationId: d.id },
            text, link: `https://aedral.com/competitions/${id}`,
          });
        }
        await createNotifications(db, payloads);
        checkinDelivery = await broadcast(db, id, items, { competition: comp });
      } catch (e) {
        captureApiError('Console open_general_checkin notifications', e);
      }
      await audit(db, uid, 'competition_general_checkin_opened', id, comp, { teams: opened });
      return NextResponse.json({
        ok: true, opened,
        delivery: checkinDelivery,
        deliverySummary: checkinDelivery ? summarizeDelivery(checkinDelivery) : null,
      });
    }

    if (action === 'withdraw_team') {
      // Disqualification / abandon (R5-4) : cascade moteur (forfaits
      // conventionnels aval, placement figé), statut d'inscription, créneaux
      // calendrier retirés. L'équipe reste au classement (place figée).
      const registrationId = String(body.registrationId ?? '');
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
      if (!registrationId) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
      const regRef = db.collection('competition_registrations').doc(registrationId);
      const regSnap = await regRef.get();
      if (!regSnap.exists || regSnap.data()!.competitionId !== id) {
        return NextResponse.json({ error: 'Inscription introuvable.' }, { status: 404 });
      }
      if (regSnap.data()!.status === 'withdrawn') {
        return NextResponse.json({ error: 'Équipe déjà retirée.' }, { status: 409 });
      }
      const result = await applyWithdraw(db, id, registrationId, { forfeitReason: reason ?? 'Équipe retirée du tournoi.' });
      await regRef.update({ status: 'withdrawn', updatedAt: FieldValue.serverTimestamp() });
      try {
        await removeRegistrationFromCalendar(db, { competitionId: id, teamId: regSnap.data()!.teamId as string });
      } catch (e) { captureApiError('Console withdraw_team calendar cleanup', e); }
      // L'équipe qui part le sait, et surtout : les équipes qui devaient
      // l'affronter héritent d'un forfait. Sans ce message, elles attendent en
      // lobby quelqu'un qui ne viendra jamais.
      let withdrawDelivery: DeliveryReport | null = null;
      const teamName = (regSnap.data()!.name as string) ?? 'L\'équipe';
      try {
        const items: BroadcastItem[] = [{
          target: { kind: 'team', registrationId },
          text: teamWithdrawnText({ teamName, reason }),
          link: `https://aedral.com/competitions/${id}`,
        }];

        // Adversaires touchés par la cascade, dédupliqués.
        const matchRefs = result.changedMatchIds.map(mid =>
          db.collection('competition_matches').doc(mid.includes('__') ? mid : `${id}__${mid}`));
        if (matchRefs.length > 0) {
          const snaps = await db.getAll(...matchRefs);
          const affected = new Set<string>();
          for (const s of snaps) {
            const m = s.data();
            if (!m) continue;
            for (const side of [m.teamA, m.teamB]) {
              if (typeof side === 'string' && side && side !== registrationId) affected.add(side);
            }
          }
          for (const rid of affected) {
            items.push({
              target: { kind: 'team', registrationId: rid },
              text: opponentWithdrawnText({ opponentName: teamName }),
              link: `https://aedral.com/competitions/${id}`,
            });
          }
        }
        withdrawDelivery = await broadcast(db, id, items, { competition: comp });
      } catch (e) {
        captureApiError('Console withdraw_team notifications', e);
      }

      await audit(db, uid, 'competition_team_withdrawn', id, comp, {
        registrationId, team: regSnap.data()!.name ?? registrationId, reason,
        cascadedMatches: result.changedMatchIds,
      });
      return NextResponse.json({
        ok: true, ...result,
        delivery: withdrawDelivery,
        deliverySummary: withdrawDelivery ? summarizeDelivery(withdrawDelivery) : null,
      });
    }

    if (action === 'replace_team') {
      // Repêchage waitlist AVANT le round 1 (spec §8) — le moteur refuse dès
      // qu'un match du bracket est joué. newRegistrationId null = personne en
      // liste d'attente → le siège devient un bye.
      // Multi-étapes : étape 1 uniquement — une waitlistée n'a pas joué les
      // étapes précédentes, elle ne peut pas s'asseoir dans une phase finale.
      if (currentStageOf(comp) > 1) {
        return NextResponse.json({ error: 'Le repêchage par la liste d\'attente n\'existe qu\'avant la première étape.' }, { status: 409 });
      }
      const oldRegistrationId = String(body.oldRegistrationId ?? '');
      const newRegistrationId = body.newRegistrationId ? String(body.newRegistrationId) : null;
      if (!oldRegistrationId) return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });

      const oldRef = db.collection('competition_registrations').doc(oldRegistrationId);
      const oldSnap = await oldRef.get();
      if (!oldSnap.exists || oldSnap.data()!.competitionId !== id) {
        return NextResponse.json({ error: 'Inscription sortante introuvable.' }, { status: 404 });
      }
      let newSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      if (newRegistrationId) {
        newSnap = await db.collection('competition_registrations').doc(newRegistrationId).get();
        if (!newSnap.exists || newSnap.data()!.competitionId !== id) {
          return NextResponse.json({ error: 'Inscription entrante introuvable.' }, { status: 404 });
        }
        if (newSnap.data()!.status !== 'waitlisted') {
          return NextResponse.json({ error: "L'équipe entrante doit venir de la liste d'attente." }, { status: 409 });
        }
      }

      let result;
      try {
        result = await applyReplacement(db, id, oldRegistrationId, newRegistrationId);
      } catch (e) {
        // Garde moteur §8 : refus dès qu'un match est joué.
        return NextResponse.json({ error: (e as Error).message }, { status: 409 });
      }

      // Les statuts d'inscription ont basculé DANS la transaction moteur
      // (applyEngineOp, blocker review Lot 4) — ici uniquement le best-effort.
      try {
        await removeRegistrationFromCalendar(db, { competitionId: id, teamId: oldSnap.data()!.teamId as string });
      } catch (e) { captureApiError('Console replace_team calendar cleanup (old)', e); }

      if (newSnap) {
        const n = newSnap.data()!;
        try {
          await syncRegistrationToCalendar(db, {
            competitionId: id, comp, teamId: n.teamId as string, structureId: n.structureId as string,
          });
        } catch (e) { captureApiError('Console replace_team calendar sync (new)', e); }
        try {
          const payloads: NotificationPayload[] = ((n.rosterUids as string[]) ?? []).map(ruid => ({
            userId: ruid,
            type: 'competition_registration',
            title: 'Repêchage — vous êtes dans le tournoi',
            message: `${n.name ?? 'Votre équipe'} remplace ${oldSnap.data()!.name ?? 'une équipe'} sur ${(comp.name as string) ?? id}.`,
            link: `/competitions/${id}`,
            metadata: { competitionId: id },
          }));
          await createNotifications(db, payloads);
        } catch (e) { captureApiError('Console replace_team notify', e); }
      }

      await audit(db, uid, 'competition_team_replaced', id, comp, {
        oldRegistrationId, newRegistrationId,
        oldTeam: oldSnap.data()!.name ?? oldRegistrationId,
        newTeam: newSnap?.data()?.name ?? null,
        changedMatchIds: result.changedMatchIds,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    // Arbitrage d'une égalité de placement (Lot 4B, spec §11 « sinon décision
    // admin ») : l'admin fixe l'ordre COMPLET d'un groupe d'élimination. La
    // validité (groupe existant, équipes exactes) est re-vérifiée à la clôture
    // — une résolution périmée y est simplement ignorée et re-signalée.
    if (action === 'resolve_tiebreak') {
      const group = typeof body.group === 'string' ? body.group.trim() : '';
      const order = Array.isArray(body.order) ? (body.order as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      if (!group || !/^[A-Za-z0-9_]{1,24}$/.test(group) || order.length < 2 || order.length > 32
        || new Set(order).size !== order.length) {
        return NextResponse.json({ error: 'Arbitrage invalide (groupe et ordre complet requis).' }, { status: 400 });
      }
      // Le groupe doit avoir une VRAIE égalité irrésolue par le moteur (review
      // Lot 4 : la décision admin est le DERNIER critère de la spec §11, pas un
      // override d'un ordre déjà décidé) et l'ordre doit couvrir exactement ses
      // équipes — sinon refus explicite (pas de toast de succès mensonger).
      const matchesSnap = await db.collection('competition_matches').where('competitionId', '==', id).get();
      // Multi-étapes : les égalités s'arbitrent sur l'ÉTAPE COURANTE (celles
      // des étapes closes sont archivées dans stageResults — design §9c).
      // `cur` est capturé ICI et re-vérifié FRAIS dans la transaction : sans
      // cette garde, un arbitrage soumis depuis une console chargée avant un
      // advance_stage concurrent polluerait les résolutions de l'étape
      // suivante — et pourrait s'y appliquer en silence (review adversariale,
      // les clés de groupe `rank{K}` sont communes à tous les formats).
      const curAtRead = currentStageOf(comp);
      try {
        const cur = curAtRead;
        const stageFormat = formatOfStage(comp, cur);
        const engine = engineFor(kindOf(stageFormat));
        const bracket = reconstructBracket({
          withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
          bo: stageFormat.bo,
          forfeitScore: stageFormat.forfeitScore ?? { games: 3, goalsPerGame: 1 },
          matches: matchesSnap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ...(d.data() as MatchDoc) })),
          kind: kindOf(stageFormat),
          swissRounds: typeof stageFormat?.swissRounds === 'number' ? stageFormat.swissRounds : undefined,
          stage: cur,
        });
        // Sans aucune résolution : l'état BRUT du moteur pour ce groupe.
        const raw = engine.computePlacements(bracket, stageFormat);
        const groupRows = raw.filter(p => p.group === group);
        if (!groupRows.some(p => p.needsAdminTiebreak)) {
          return NextResponse.json({ error: 'Ce groupe n\'a pas (ou plus) d\'égalité à arbitrer — recharge la console.' }, { status: 409 });
        }
        const groupTeams = new Set(groupRows.map(p => p.teamId));
        if (order.length !== groupTeams.size || !order.every(t => groupTeams.has(t))) {
          return NextResponse.json({ error: 'Le groupe a changé depuis l\'affichage (retrait, correction) — recharge la console.' }, { status: 409 });
        }
      } catch (e) {
        if (e instanceof ConsoleError) throw e;
        return NextResponse.json({ error: 'Bracket illisible — recharge la console.' }, { status: 409 });
      }
      await db.runTransaction(async tx => {
        const snap = await tx.get(db.collection('competitions').doc(id));
        if (!snap.exists) throw new ConsoleError(404, 'Compétition introuvable.');
        if (snap.data()!.status !== 'live') throw new ConsoleError(409, 'La compétition n\'est plus en jeu.');
        if (currentStageOf(snap.data()!) !== curAtRead) {
          throw new ConsoleError(409, 'L\'étape a changé pendant l\'arbitrage — recharge la console.');
        }
        const existing = (snap.data()!.tiebreakResolutions as Record<string, string[]> | undefined) ?? {};
        tx.update(snap.ref, { tiebreakResolutions: { ...existing, [group]: order } });
      });
      await audit(db, uid, 'competition_tiebreak_resolved', id, comp, { group, order });
      return NextResponse.json({ ok: true });
    }

    // Clôture du Qualif (Lot 4A, archi §4) : l'unique écriture du classement
    // final et des points de circuit. Refusée tant qu'une égalité reste à
    // arbitrer ou qu'aucun champion mécanique n'existe.
    // ── generate_next_round (formats à génération incrémentale : suisse) ──
    // La ronde N+1 s'apparie sur les résultats des rondes 1..N — elle ne peut
    // naître qu'une fois tous les matchs terminaux. Idempotent par
    // construction : ids déterministes S{r}-{s}, un double clic réécrit les
    // mêmes docs à l'identique (mêmes standings → mêmes appariements).
    if (action === 'generate_next_round') {
      if (comp.status !== 'live') {
        return NextResponse.json({ error: 'La compétition n\'est pas en jeu.' }, { status: 409 });
      }
      // Multi-étapes : la génération incrémentale opère sur l'ÉTAPE COURANTE
      // (un suisse peut être une étape — design §9c).
      const cur = currentStageOf(comp);
      const stageFormat = formatOfStage(comp, cur);
      const engine = engineFor(kindOf(stageFormat));
      if (!engine.generateNextRound || !engine.canGenerateNextRound) {
        return NextResponse.json({ error: 'Ce format matérialise toutes ses rondes à la publication.' }, { status: 409 });
      }
      const matchesSnap = await db.collection('competition_matches').where('competitionId', '==', id).get();
      const before = reconstructBracket({
        withdrawn: Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [],
        bo: stageFormat.bo,
        forfeitScore: stageFormat.forfeitScore ?? { games: 3, goalsPerGame: 1 },
        matches: matchesSnap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ...(d.data() as MatchDoc) })),
        kind: kindOf(stageFormat),
        swissRounds: typeof stageFormat?.swissRounds === 'number' ? stageFormat.swissRounds : undefined,
        stage: cur,
      });
      if (!engine.canGenerateNextRound(before)) {
        return NextResponse.json({ error: 'Ronde en cours ou toutes les rondes jouées — rien à apparier.' }, { status: 409 });
      }
      let after;
      try {
        // Les entrées de l'étape COURANTE seulement (même piège que le
        // publish : les numéros de ronde se recoupent d'une étape à l'autre).
        after = engine.generateNextRound(
          before,
          stageFormat as CompetitionFormat,
          phasePlanForStage<PhasePlanEntry>(comp.schedule?.phasePlan, cur),
        );
      } catch (e) {
        // Erreurs moteur actionnables (re-match inévitable…) — jamais un 500.
        return NextResponse.json({ error: (e as Error).message }, { status: 409 });
      }
      const newIds = after.order.filter(mid => !before.matches[mid]);
      if (newIds.length === 0) {
        return NextResponse.json({ error: 'Aucun nouveau match à créer.' }, { status: 409 });
      }

      // Display + rosters (ACL privées) depuis les inscriptions de la compét.
      const regsSnap = await db.collection('competition_registrations')
        .where('competitionId', '==', id).get();
      const regsForDocs: Record<string, { display: TeamDisplay; rosterUids: string[] }> = {};
      for (const doc of regsSnap.docs) {
        const r = doc.data();
        regsForDocs[doc.id] = {
          display: {
            name: (r.name as string) ?? doc.id,
            tag: (r.tag as string) ?? '',
            logoUrl: (r.logoUrl as string | null) ?? null,
          },
          rosterUids: Array.isArray(r.rosterUids) ? (r.rosterUids as string[]) : [],
        };
      }
      const { matches: newDocs, acls } = materializeMatches({
        competitionId: id, bracket: after, matchIds: newIds, registrations: regsForDocs, stage: cur,
      });
      const aclByMatch = new Map(acls.map(a => [a.matchId, a.participantUids]));
      // Même flag de visibilité que le publish (rules défense en profondeur).
      const hidden = comp.isDev === true;
      // Écriture en TRANSACTION avec re-validation de l'état frais (review
      // adversariale, TOCTOU) : un retrait concurrent entre la lecture et
      // l'écriture aurait apparié une équipe DQ ; un rejeu tardif aurait
      // écrasé un match de la nouvelle ronde déjà lancé. Une ronde ≤ 40
      // matchs ×2 docs = loin sous la limite de 500 writes.
      const withdrawnAtRead = JSON.stringify(
        [...(Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [])].sort());
      try {
        await db.runTransaction(async tx => {
          const [freshComp, ...freshNew] = await Promise.all([
            tx.get(compRef),
            ...newDocs.map(({ id: matchKey }) => tx.get(refOf(matchKey))),
          ]);
          const fresh = freshComp.data();
          if (!fresh || fresh.status !== 'live') throw new Error('competition_not_live');
          // Un passage d'étape concurrent rendrait la ronde appariée caduque.
          if (currentStageOf(fresh) !== cur) throw new Error('state_changed');
          const withdrawnNow = JSON.stringify(
            [...(Array.isArray(fresh.withdrawn) ? (fresh.withdrawn as string[]) : [])].sort());
          if (withdrawnNow !== withdrawnAtRead) {
            throw new Error('state_changed');
          }
          for (const snap of freshNew) {
            const status = snap.exists ? (snap.data()!.status as string) : 'pending';
            // Rejeu concurrent bénin (mêmes docs pending) : on réécrit à
            // l'identique. Un doc déjà AVANCÉ (check-in lancé, joué…) ne doit
            // jamais être écrasé.
            if (snap.exists && status !== 'pending') throw new Error('round_already_started');
          }
          for (const { id: matchKey, doc } of newDocs) {
            const matchRef = refOf(matchKey);
            tx.set(matchRef, { id: matchKey, ...doc, hidden, updatedAt: FieldValue.serverTimestamp() });
            const uids = aclByMatch.get(matchKey);
            if (uids && uids.length > 0) {
              tx.set(matchRef.collection('private').doc('acl'), { participantUids: uids, staffUids: [] });
            }
          }
          // Révision des matérialisations : signale aux gardes concurrentes
          // (change_roster) que des matchs invisibles de leurs refs existent.
          tx.update(compRef, { matchesRevision: FieldValue.increment(1) });
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'state_changed') {
          return NextResponse.json({ error: 'Un retrait est survenu pendant l\'appariement — recharge la console et relance.' }, { status: 409 });
        }
        if (msg === 'round_already_started') {
          return NextResponse.json({ error: 'La ronde a déjà été générée et lancée — recharge la console.' }, { status: 409 });
        }
        throw e;
      }

      const round = after.matches[newIds[0]]?.round ?? 0;
      await audit(db, uid, 'competition_round_generated', id, comp, { round, matches: newIds.length });
      return NextResponse.json({ success: true, round, matchCount: newIds.length });
    }

    // ── advance_stage (multi-étapes, design §9c) : clôt l'étape courante
    // (placements figés dans stageResults), qualifie le top-N re-seedé et
    // matérialise le bracket de l'étape suivante — en transaction, avec
    // re-validation de l'état frais (même règle de course que
    // generate_next_round : retrait, arbitrage ou rejeu concurrents = 409).
    if (action === 'advance_stage') {
      if (comp.status !== 'live') {
        return NextResponse.json({ error: 'La compétition n\'est pas en jeu.' }, { status: 409 });
      }
      const stages = stagesOf(comp);
      const cur = currentStageOf(comp);
      if (cur >= stages.length) {
        return NextResponse.json({ error: 'Aucune étape suivante — clôture la compétition.' }, { status: 409 });
      }
      const curStage = stages[cur - 1];
      const nextStage = stages[cur];
      if (!curStage.transfer) {
        return NextResponse.json({ error: 'Étape courante sans règle de transfert — configuration incohérente.' }, { status: 409 });
      }

      const withdrawn = Array.isArray(comp.withdrawn) ? (comp.withdrawn as string[]) : [];
      const stageFormat = curStage.format;
      const engine = engineFor(kindOf(stageFormat));
      const matchesSnap = await db.collection('competition_matches').where('competitionId', '==', id).get();
      let bracket;
      try {
        bracket = reconstructBracket({
          withdrawn,
          bo: stageFormat.bo,
          forfeitScore: stageFormat.forfeitScore ?? { games: 3, goalsPerGame: 1 },
          matches: matchesSnap.docs.map(d => ({ id: (d.data().id as string) ?? d.id, ...(d.data() as MatchDoc) })),
          kind: kindOf(stageFormat),
          swissRounds: typeof stageFormat?.swissRounds === 'number' ? stageFormat.swissRounds : undefined,
          stage: cur,
        });
      } catch {
        return NextResponse.json({ error: 'Bracket illisible — recharge la console.' }, { status: 409 });
      }
      if (!engine.isFinished(bracket)) {
        return NextResponse.json({ error: 'L\'étape en cours n\'est pas terminée — tous les matchs doivent être réglés.' }, { status: 409 });
      }

      // Inscriptions chargées ICI (avant le transfert) : elles servent au
      // re-seeding MMR/circuit ET aux displays/ACL de la matérialisation.
      const regsSnap = await db.collection('competition_registrations')
        .where('competitionId', '==', id).get();

      // Re-seeding MMR / classement circuit (design §10) : rang de seed
      // construit depuis les inscriptions (worstLineupAvg figé au submit) ou
      // le classement du circuit à l'instant du passage (tracé dans l'audit).
      let seedRank: Map<string, number> | undefined;
      if (curStage.transfer.reseed === 'mmr' || curStage.transfer.reseed === 'circuit') {
        const seedables: SeedableTeam[] = regsSnap.docs.map(d => {
          const r = d.data();
          return {
            registrationId: d.id,
            name: (r.name as string) ?? d.id,
            worstLineupAvg: typeof r.computed?.worstLineupAvg === 'number' ? r.computed.worstLineupAvg : null,
            rosterRefMmrs: Array.isArray(r.roster)
              ? (r.roster as Array<{ refMmr?: number }>).map(p => (typeof p.refMmr === 'number' ? p.refMmr : 0))
              : [],
            circuitTeamId: (r.circuitTeamId as string | null) ?? null,
          };
        });
        if (curStage.transfer.reseed === 'mmr') {
          seedRank = seedRankOf(orderByMmr(seedables));
        } else {
          const circuitId = (comp.circuitId as string | null) ?? null;
          const ranks = circuitId ? await circuitRankByTeamId(db, circuitId) : null;
          if (!ranks) {
            return NextResponse.json({ error: 'Re-seeding par classement de circuit : cette compétition n\'est pas rattachée à un circuit valide.' }, { status: 409 });
          }
          seedRank = seedRankOf(orderByCircuitRank(seedables, ranks));
        }
      }

      const resolutions = (comp.tiebreakResolutions as Record<string, string[]> | undefined) ?? {};
      const adv = computeStageAdvance({
        stage: cur,
        transfer: curStage.transfer,
        placements: engine.computePlacements(bracket, stageFormat, resolutions),
        stats: computeTeamStats(bracket),
        withdrawn,
        tiebreakResolutions: resolutions,
        nextStageMinTeams: teamBoundsForKind(nextStage.kind).min,
        // Fisher-Yates CSPRNG (reseed 'random') — même source que le seeding.
        shuffle: xs => {
          const a = [...xs];
          for (let i = a.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        },
        seedRank,
      });
      if (!adv.ok) {
        return NextResponse.json(
          { error: adv.error, ...(adv.tiebreakGroups ? { tiebreakGroups: adv.tiebreakGroups } : {}) },
          { status: 409 },
        );
      }

      // Plan de phases de l'étape suivante. Le formulaire de création planifie
      // désormais TOUTES les étapes (la structure d'une phase finale est connue
      // dès le départ — seuls les noms d'équipes manquent) : si l'organisateur
      // a prévu ses journées, on les respecte. Sinon (compétitions créées avant,
      // ou par script), entries par défaut du format, phases offsettées et jour
      // clampé au planning existant.
      const existingPlan = (comp.schedule?.phasePlan as PhasePlanEntry[] | undefined) ?? [];
      const nextEngine = engineFor(kindOf(nextStage.format));
      const plannedEntries = existingPlan.filter(e => (e.stage ?? 1) === cur + 1);
      const phaseOffset = existingPlan.reduce((m, e) => Math.max(m, e.phase), 0);
      const dayUsed = existingPlan.reduce((m, e) => Math.max(m, e.day), 1);
      const dayMax = Array.isArray(comp.schedule?.days) ? Math.max(1, comp.schedule.days.length) : 1;
      const newEntries: PhasePlanEntry[] = plannedEntries.length > 0
        ? plannedEntries
        : nextEngine.buildDefaultPhasePlan(nextStage.format).map(e => ({
            ...e,
            phase: e.phase + phaseOffset,
            day: Math.min(dayUsed + e.day, dayMax),
            stage: cur + 1,
            label: `${stageLabelOf(nextStage)} — ${e.label}`.slice(0, 60),
          }));

      let nextBracket;
      try {
        nextBracket = nextEngine.generate(adv.advanced, nextStage.format, newEntries);
      } catch (e) {
        // Erreurs moteur actionnables (faisabilité poules…) — jamais un 500.
        return NextResponse.json({ error: (e as Error).message }, { status: 409 });
      }

      // Display + rosters (ACL privées) depuis les inscriptions déjà chargées.
      const regsForDocs: Record<string, { display: TeamDisplay; rosterUids: string[] }> = {};
      for (const doc of regsSnap.docs) {
        const r = doc.data();
        regsForDocs[doc.id] = {
          display: {
            name: (r.name as string) ?? doc.id,
            tag: (r.tag as string) ?? '',
            logoUrl: (r.logoUrl as string | null) ?? null,
          },
          rosterUids: Array.isArray(r.rosterUids) ? (r.rosterUids as string[]) : [],
        };
      }
      const { matches: newDocs, acls } = materializeMatches({
        competitionId: id, bracket: nextBracket, matchIds: nextBracket.order,
        registrations: regsForDocs, stage: cur + 1,
      });
      // Garde runtime miroir de la validation (limite des 500 writes d'une
      // transaction) — un état qui l'atteint est refusé, jamais tronqué.
      if (newDocs.length > 200) {
        return NextResponse.json({ error: `Étape suivante trop grande pour un lancement atomique (${newDocs.length} matchs).` }, { status: 409 });
      }
      const aclByMatch = new Map(acls.map(a => [a.matchId, a.participantUids]));
      const hidden = comp.isDev === true;

      const withdrawnAtRead = JSON.stringify([...withdrawn].sort());
      const resolutionsAtRead = JSON.stringify(resolutions);
      const stageResultDoc = { ...adv.stageResult, closedAt: Timestamp.now() };
      try {
        await db.runTransaction(async tx => {
          const [freshComp, ...freshNew] = await Promise.all([
            tx.get(compRef),
            ...newDocs.map(({ id: matchKey }) => tx.get(refOf(matchKey))),
          ]);
          const fresh = freshComp.data();
          if (!fresh || fresh.status !== 'live') throw new Error('competition_not_live');
          if (currentStageOf(fresh) !== cur) throw new Error('stage_already_advanced');
          const withdrawnNow = JSON.stringify(
            [...(Array.isArray(fresh.withdrawn) ? (fresh.withdrawn as string[]) : [])].sort());
          if (withdrawnNow !== withdrawnAtRead) throw new Error('state_changed');
          // Un arbitrage concurrent changerait le classement → l'ordre de seed.
          const resolutionsNow = JSON.stringify((fresh.tiebreakResolutions as Record<string, string[]> | undefined) ?? {});
          if (resolutionsNow !== resolutionsAtRead) throw new Error('state_changed');
          for (const snap of freshNew) {
            const status = snap.exists ? (snap.data()!.status as string) : 'pending';
            if (snap.exists && status !== 'pending') throw new Error('stage_already_started');
          }
          for (const { id: matchKey, doc } of newDocs) {
            const matchRef = refOf(matchKey);
            tx.set(matchRef, { id: matchKey, ...doc, hidden, updatedAt: FieldValue.serverTimestamp() });
            const uids = aclByMatch.get(matchKey);
            if (uids && uids.length > 0) {
              tx.set(matchRef.collection('private').doc('acl'), { participantUids: uids, staffUids: [] });
            }
          }
          const freshResults = Array.isArray(fresh.stageResults) ? fresh.stageResults : [];
          tx.update(compRef, {
            currentStage: cur + 1,
            stageResults: [...freshResults, stageResultDoc],
            // Les arbitrages de l'étape close sont archivés dans son résultat ;
            // le champ plat repart vide pour l'étape suivante (design §9c).
            tiebreakResolutions: {},
            // Déroulé déjà planifié : rien à ajouter, il est en place.
            'schedule.phasePlan': plannedEntries.length > 0
              ? existingPlan
              : [...existingPlan, ...newEntries],
            // Révision des matérialisations (gardes concurrentes, cf. suisse).
            matchesRevision: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === 'stage_already_advanced') {
          return NextResponse.json({ error: 'L\'étape suivante a déjà été lancée — recharge la console.' }, { status: 409 });
        }
        if (msg === 'state_changed') {
          return NextResponse.json({ error: 'Un retrait ou un arbitrage est survenu pendant le passage — recharge la console et relance.' }, { status: 409 });
        }
        if (msg === 'stage_already_started') {
          return NextResponse.json({ error: 'Des matchs de l\'étape suivante ont déjà été lancés — recharge la console.' }, { status: 409 });
        }
        throw e;
      }

      // Notifs best-effort : qualifiées et éliminées (jamais bloquant). Sur
      // Discord aussi — une équipe qui ne sait pas si elle continue reste
      // connectée pour rien, ou s'absente au mauvais moment.
      try {
        const compName = (comp.name as string) ?? id;
        const advancedSet = new Set(adv.advanced);
        const payloads: NotificationPayload[] = [];
        const items: BroadcastItem[] = [];
        for (const p of adv.stageResult.placements) {
          const reg = regsSnap.docs.find(d => d.id === p.registrationId)?.data();
          if (!reg) continue;
          const qualified = advancedSet.has(p.registrationId);
          const title = qualified ? 'Qualification' : 'Fin de parcours';
          const message = qualified
            ? `${reg.name ?? 'Ton équipe'} se qualifie pour ${stageLabelOf(nextStage)} — ${compName}.`
            : `${reg.name ?? 'Ton équipe'} termine ${p.placement}e de ${stageLabelOf(curStage)} — ${compName}.`;
          for (const ruid of (reg.rosterUids as string[] | undefined) ?? []) {
            payloads.push({
              userId: ruid, type: 'competition_registration', title, message,
              link: `/competitions/${id}`, metadata: { competitionId: id },
            });
          }
          items.push({
            target: { kind: 'team', registrationId: p.registrationId },
            text: stageOutcomeText({
              qualified,
              nextStageLabel: qualified ? stageLabelOf(nextStage) : null,
              placement: p.placement,
            }),
            link: `https://aedral.com/competitions/${id}`,
          });
        }
        await createNotifications(db, payloads);
        await broadcast(db, id, items, { competition: comp, deadlineMs: 20_000 });
      } catch (e) {
        captureApiError('Console advance_stage notifications', e);
      }

      await audit(db, uid, 'competition_stage_advanced', id, comp, {
        fromStage: cur, toStage: cur + 1,
        reseed: curStage.transfer.reseed,
        advanced: adv.advanced, matches: newDocs.length,
      });
      return NextResponse.json({
        success: true, stage: cur + 1, advanced: adv.advanced, matchCount: newDocs.length,
      });
    }

    if (action === 'close_competition') {
      const result = await closeCompetition(db, { competitionId: id });
      if (!result.ok) {
        const messages: Record<string, string> = {
          not_found: 'Compétition introuvable.',
          already_closed: 'Compétition déjà clôturée.',
          invalid_status: 'La compétition n\'est pas en jeu — rien à clôturer.',
          bracket_not_published: 'Aucun bracket publié.',
          not_finished: 'Le bracket n\'est pas terminé — le titre doit être décidé avant la clôture.',
          tiebreak_required: `Égalité(s) à arbitrer avant la clôture : ${result.tiebreakGroups?.join(', ') ?? ''}.`,
          stage_not_last: 'Le tournoi a encore des étapes à jouer — lance l\'étape suivante avant de clôturer.',
          stage_data_invalid: 'Résultats d\'étape incohérents — contacte le support (rien n\'a été écrit).',
          state_changed: 'L\'état a changé pendant la clôture (passage d\'étape concurrent) — recharge la console et relance.',
        };
        return NextResponse.json({ error: messages[result.code] }, { status: result.code === 'not_found' ? 404 : 409 });
      }
      // Fin de tournoi : le podium en public, et sa place à chaque équipe.
      // C'est l'information la plus attendue de la journée — elle n'existait
      // jusqu'ici que sur le site.
      let closeDelivery: DeliveryReport | null = null;
      try {
        const competitionName = (comp.name as string) ?? id;
        const teamCount = result.finalPlacements.length;
        const items: BroadcastItem[] = [{
          target: { kind: 'announce' },
          text: podiumAnnounceText({
            competitionName,
            podium: result.finalPlacements.slice(0, 3).map(p => ({ placement: p.placement, name: p.name })),
            teamCount,
          }),
          link: `https://aedral.com/competitions/${id}`,
        }];
        for (const p of result.finalPlacements) {
          items.push({
            target: { kind: 'team', registrationId: p.registrationId },
            text: finalPlacementText({
              competitionName, placement: p.placement, teamCount, points: p.points,
            }),
            link: `https://aedral.com/competitions/${id}`,
          });
        }
        closeDelivery = await broadcast(db, id, items, { competition: comp, deadlineMs: 20_000 });
      } catch (e) {
        captureApiError('Console close_competition notifications', e);
      }

      await audit(db, uid, 'competition_closed', id, comp, {
        teamCount: result.finalPlacements.length,
        podium: result.finalPlacements.slice(0, 3).map(p => `${p.placement}. ${p.name}`),
        ...(result.unlinked.length > 0 ? { unlinked: result.unlinked } : {}),
      });
      return NextResponse.json({
        ok: true, finalPlacements: result.finalPlacements, unlinked: result.unlinked,
        delivery: closeDelivery,
        deliverySummary: closeDelivery ? summarizeDelivery(closeDelivery) : null,
      });
    }

    if (action === 'announce') {
      // Le message que le système n'a pas prévu : retard, incident serveurs,
      // consigne de dernière minute. C'est l'outil le plus utilisé un jour de
      // tournoi ; sans lui, il faut écrire à la main dans 32 salons.
      const raw = typeof body.message === 'string' ? body.message.trim() : '';
      if (raw.length < 3) {
        return NextResponse.json({ error: 'Le message est vide.' }, { status: 400 });
      }
      const to = ['announce', 'teams', 'both'].includes(body.to as string)
        ? (body.to as 'announce' | 'teams' | 'both')
        : 'announce';
      const text = organizerAnnouncementText({
        competitionName: (comp.name as string) ?? id,
        // 1500 : marge sous la limite d'embed Discord, coupé proprement plutôt
        // que refusé — un organisateur pressé ne compte pas ses caractères.
        body: raw.slice(0, 1500),
      });

      const items: BroadcastItem[] = [];
      if (to === 'announce' || to === 'both') {
        items.push({ target: { kind: 'announce' }, text, link: `https://aedral.com/competitions/${id}` });
      }
      if (to === 'teams' || to === 'both') {
        // Aux équipes VALIDÉES : ce sont elles qui jouent. Chacune est pingée
        // dans son salon (c'est le seul canal qui réveille vraiment).
        const regs = await db.collection('competition_registrations')
          .where('competitionId', '==', id)
          .where('status', '==', 'approved')
          .get();
        for (const d of regs.docs) {
          items.push({
            target: { kind: 'team', registrationId: d.id },
            text, link: `https://aedral.com/competitions/${id}`,
          });
        }
      }
      if (items.length === 0) {
        return NextResponse.json({ error: 'Aucun destinataire : pas de salon d\'annonces ni d\'équipe validée.' }, { status: 409 });
      }

      const delivery = await broadcast(db, id, items, { competition: comp, deadlineMs: 20_000 });
      await audit(db, uid, 'competition_announcement_sent', id, comp, {
        to, length: raw.length, sent: delivery.sent, failures: delivery.failures.length,
      });
      return NextResponse.json({ ok: true, delivery, deliverySummary: summarizeDelivery(delivery) });
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (err) {
    if (err instanceof ConsoleError) return NextResponse.json({ error: err.msg }, { status: err.status });
    if (err instanceof Error && err.message === 'competition_not_live') {
      return NextResponse.json({ error: 'La compétition n\'est plus en jeu (clôturée ?) — le bracket est figé.' }, { status: 409 });
    }
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
    // Poule (round robin) — absent sur les matchs d'arbre.
    ...(typeof m.group === 'number' ? { group: m.group } : {}),
    // Étape de format (multi-étapes) — absent = étape 1.
    stage: stageOfMatch(m as { stage?: number | null }),
    phase: m.phase ?? null,
    bo: m.bo ?? 5,
    status: m.status ?? 'pending',
    teamA: m.teamA ?? null,
    teamB: m.teamB ?? null,
    voidA: m.voidA === true,
    voidB: m.voidB === true,
    teamAInfo: m.teamAInfo ?? null,
    teamBInfo: m.teamBInfo ?? null,
    // Provenances publiques (seed / match amont) — hints du bracket, aucune PII.
    sourceA: m.sourceA ?? null,
    sourceB: m.sourceB ?? null,
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
