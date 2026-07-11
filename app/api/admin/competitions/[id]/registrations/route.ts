import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { clampString } from '@/lib/validation';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import { sendCompetitionDM, deprovisionRegistration } from '@/lib/discord-competition';
import { releaseCircuitClaim } from '@/lib/competitions/withdraw-registration';
import {
  resolveCircuitIdentity,
  circuitTeamSlug,
  type IdentityCandidate,
  type IdentityResolution,
} from '@/lib/competitions/identity';
import { syncRegistrationToCalendar, removeRegistrationFromCalendar } from '@/lib/competitions/calendar-sync';
import { getSanctionsFor } from '@/lib/competitions/sanctions';

// File de validation des inscriptions (spec Legends §4, archi §2 + §7).
//
// GET  — détail complet pour les admins de compétition : roster (MMR/réf, âge,
//        pays, comptes, tracker), drapeaux, signalements smurf en AGRÉGAT
//        ANONYMISÉ (jamais l'identité des signaleurs ni les notes des flags
//        admin — archi §7), proposition de rattachement circuit.
// POST — approve / reject / unapprove. Tout passe en TRANSACTION :
//        cap maxTeams → approved | waitlisted (compteur dénormalisé
//        `approvedCount`, pas de query en transaction — piège documenté),
//        dérogations mineurs exigées joueur par joueur (note tracée),
//        résolution d'identité circuit avec claim atomique
//        (`circuit_teams/{id}/private/state`) — jamais de rattachement
//        silencieux en cas d'ambiguïté.

// ── Helpers circuit ─────────────────────────────────────────────────────────

interface CircuitTeamContext {
  id: string;
  name: string;
  tag: string;
  totalPoints: number;
  participationsCount: number;
  claims: Record<string, string>;
  rosterByCompetition: Record<string, {
    registrationId: string;
    rosterUids: string[];
    starterUids: string[];
  }>;
}

interface CircuitContext {
  circuitId: string;
  circuitName: string;
  /** Rang chronologique de chaque compétition du circuit (0 = la plus ancienne). */
  competitionRank: Map<string, number>;
  teams: CircuitTeamContext[];
}

async function loadCircuitContext(
  db: FirebaseFirestore.Firestore,
  circuitId: string,
): Promise<CircuitContext | null> {
  const circuitSnap = await db.collection('circuits').doc(circuitId).get();
  if (!circuitSnap.exists) return null;
  const circuit = circuitSnap.data()!;

  // Ordre chronologique des compétitions du circuit : par date du premier jour
  // (l'ordre d'arrayUnion de competitionIds suit l'ordre de création, pas
  // forcément le calendrier). Fallback : position dans competitionIds.
  const compIds = (circuit.competitionIds as string[] | undefined) ?? [];
  const compSnaps = compIds.length > 0
    ? await db.getAll(...compIds.map(cid => db.collection('competitions').doc(cid)))
    : [];
  const withDates = compSnaps
    .filter(s => s.exists)
    .map((s, i) => ({
      id: s.id,
      date: (s.data()?.schedule?.days?.[0]?.date as string | undefined) ?? '',
      fallbackRank: i,
    }))
    .sort((a, b) => (a.date && b.date && a.date !== b.date)
      ? a.date.localeCompare(b.date)
      : a.fallbackRank - b.fallbackRank);
  const competitionRank = new Map<string, number>();
  withDates.forEach((c, i) => competitionRank.set(c.id, i));

  const teamsSnap = await db.collection('circuit_teams').where('circuitId', '==', circuitId).get();
  const teams: CircuitTeamContext[] = [];
  if (!teamsSnap.empty) {
    const stateSnaps = await db.getAll(
      ...teamsSnap.docs.map(d => d.ref.collection('private').doc('state')),
    );
    teamsSnap.docs.forEach((d, i) => {
      const data = d.data();
      const state = stateSnaps[i].exists ? stateSnaps[i].data()! : {};
      const participations = (data.participations as Array<{ points?: number }> | undefined) ?? [];
      teams.push({
        id: d.id,
        name: (data.name as string) ?? '',
        tag: (data.tag as string) ?? '',
        totalPoints: participations.reduce((sum, p) => sum + (p.points ?? 0), 0),
        participationsCount: participations.length,
        claims: (state.claims as Record<string, string>) ?? {},
        rosterByCompetition: (state.rosterByCompetition as CircuitTeamContext['rosterByCompetition']) ?? {},
      });
    });
  }

  return { circuitId, circuitName: (circuit.name as string) ?? '', competitionRank, teams };
}

/** Roster de la « précédente participation » : l'entrée de la compétition la
 *  plus récente dans l'ordre du circuit, hors compétition courante. */
function lastRosterUids(team: CircuitTeamContext, ctx: CircuitContext, excludeCompetitionId: string): string[] {
  let best: { rank: number; uids: string[] } | null = null;
  for (const [compId, entry] of Object.entries(team.rosterByCompetition)) {
    if (compId === excludeCompetitionId) continue;
    const rank = ctx.competitionRank.get(compId) ?? -1;
    if (best === null || rank > best.rank) best = { rank, uids: entry.rosterUids };
  }
  return best?.uids ?? [];
}

function identityCandidates(
  ctx: CircuitContext,
  competitionId: string,
  registrationId: string,
): IdentityCandidate[] {
  return ctx.teams.map(t => ({
    circuitTeamId: t.id,
    name: t.name,
    lastRosterUids: lastRosterUids(t, ctx, competitionId),
    claimedByOther: !!t.claims[competitionId] && t.claims[competitionId] !== registrationId,
  }));
}

function resolveFor(
  ctx: CircuitContext,
  competitionId: string,
  registrationId: string,
  reg: FirebaseFirestore.DocumentData,
): IdentityResolution {
  const starterUids = ((reg.roster as Array<{ uid: string; role: string }>) ?? [])
    .filter(r => r.role === 'titulaire')
    .map(r => r.uid);
  return resolveCircuitIdentity({
    name: (reg.name as string) ?? '',
    starterUids,
    candidates: identityCandidates(ctx, competitionId, registrationId),
  });
}

// ── Méta par joueur : agrégat smurf anonymisé (archi §7) + infos de
//    navigation console (slug de profil, username Discord, pseudo Epic frais).

interface PlayerMeta {
  pendingReports: number;
  adminFlag: boolean;
  slug: string | null;
  displayName: string | null;
  discordUsername: string | null;
  epicName: string | null;
}

async function loadPlayerMeta(
  db: FirebaseFirestore.Firestore,
  uids: string[],
): Promise<Map<string, PlayerMeta>> {
  const map = new Map<string, PlayerMeta>();
  if (uids.length === 0) return map;
  for (const uid of uids) {
    map.set(uid, { pendingReports: 0, adminFlag: false, slug: null, displayName: null, discordUsername: null, epicName: null });
  }

  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));

  const [reportSnaps, flagSnaps, userSnaps] = await Promise.all([
    Promise.all(chunks.map(chunk =>
      db.collection('rank_reports').where('targetUid', 'in', chunk).get(),
    )),
    db.getAll(...uids.map(uid => db.collection('user_admin_flags').doc(uid))),
    db.getAll(...uids.map(uid => db.collection('users').doc(uid))),
  ]);

  for (const snap of reportSnaps) {
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.motif !== 'smurf' || d.status !== 'pending') continue;
      const entry = map.get(d.targetUid as string);
      if (entry) entry.pendingReports += 1;
    }
  }
  flagSnaps.forEach((snap, i) => {
    const flag = snap.data()?.suspectedSmurf;
    if (flag && typeof flag === 'object') {
      const entry = map.get(uids[i]);
      if (entry) entry.adminFlag = true;
    }
  });
  userSnaps.forEach((snap, i) => {
    const entry = map.get(uids[i]);
    if (!entry || !snap.exists) return;
    entry.slug = (snap.data()?.slug as string) || null;
    entry.displayName = (snap.data()?.displayName as string) || (snap.data()?.discordUsername as string) || null;
    entry.discordUsername = (snap.data()?.discordUsername as string) || null;
    entry.epicName = (snap.data()?.rlEpicName as string) || null;
  });
  return map;
}

// ── GET : la file complète ──────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const { id } = await params;
    const db = getAdminDb();

    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const regsSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .get();

    const activeStatuses = new Set(['pending', 'approved', 'waitlisted']);
    const structureIds = Array.from(new Set(regsSnap.docs.map(d => d.data().structureId as string).filter(Boolean)));
    const teamIds = Array.from(new Set(regsSnap.docs.map(d => d.data().teamId as string).filter(Boolean)));
    const allRosterUids = Array.from(new Set(regsSnap.docs.flatMap(d => (d.data().rosterUids as string[] | undefined) ?? [])));

    // 1) Structures + équipes (bloc « Staff & direction » — lecture LIVE, le
    //    snapshot d'inscription ne fige PAS le staff).
    const [structureSnaps, teamSnaps] = await Promise.all([
      structureIds.length ? db.getAll(...structureIds.map(sid => db.collection('structures').doc(sid))) : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
      teamIds.length ? db.getAll(...teamIds.map(tid => db.collection('sub_teams').doc(tid))) : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]),
    ]);
    const structuresById = new Map<string, { name: string; slug: string | null; founderId: string; coFounderIds: string[]; managerIds: string[] }>();
    for (const s of structureSnaps) {
      if (!s.exists) continue;
      const d = s.data()!;
      structuresById.set(s.id, {
        name: (d.name as string) ?? '', slug: (d.slug as string) || null,
        founderId: (d.founderId as string) ?? '', coFounderIds: (d.coFounderIds as string[]) ?? [], managerIds: (d.managerIds as string[]) ?? [],
      });
    }
    const teamsById = new Map<string, { staffIds: string[]; staffRoles: Record<string, string>; captainId: string | null }>();
    for (const t of teamSnaps) {
      if (!t.exists) continue;
      const d = t.data()!;
      teamsById.set(t.id, { staffIds: (d.staffIds as string[]) ?? [], staffRoles: (d.staffRoles as Record<string, string>) ?? {}, captainId: (d.captainId as string) ?? null });
    }

    // 2) Méta joueurs : roster actifs + inscripteurs + reviewers + STAFF/DIRIGEANTS.
    const staffUids = new Set<string>();
    for (const s of structuresById.values()) {
      if (s.founderId) staffUids.add(s.founderId);
      s.coFounderIds.forEach(u => u && staffUids.add(u));
      s.managerIds.forEach(u => u && staffUids.add(u));
    }
    for (const t of teamsById.values()) {
      t.staffIds.forEach(u => u && staffUids.add(u));
      if (t.captainId) staffUids.add(t.captainId);
    }
    const metaUids = Array.from(new Set([
      ...regsSnap.docs.flatMap(d => {
        const r = d.data();
        return [
          ...(activeStatuses.has(r.status) ? ((r.rosterUids as string[] | undefined) ?? []) : []),
          r.createdBy as string,
          r.review?.by as string | undefined,
        ].filter(Boolean) as string[];
      }),
      ...staffUids,
    ]));

    // 3) Méta + contexte circuit + historique des sanctions (par cibles de la compét).
    const [meta, circuitCtx, sanctionRecords] = await Promise.all([
      loadPlayerMeta(db, metaUids),
      comp.circuitId ? loadCircuitContext(db, comp.circuitId as string) : Promise.resolve(null),
      getSanctionsFor(db, { uids: allRosterUids, structureIds, teamIds }),
    ]);

    // displayName des créateurs/reviewers/staff — tous présents dans la méta.
    const names = new Map<string, string>();
    for (const uid of metaUids) names.set(uid, meta.get(uid)?.displayName ?? uid);
    const nameOf = (u: string) => ({ uid: u, displayName: names.get(u) ?? u, discordUsername: meta.get(u)?.discordUsername ?? null, slug: meta.get(u)?.slug ?? null });

    const registrations = regsSnap.docs.map(d => {
      const r = d.data();
      const roster = ((r.roster as Array<Record<string, unknown>>) ?? []).map(m => {
        const pm = meta.get(m.uid as string);
        return {
          uid: m.uid,
          role: m.role,
          displayName: m.displayName,
          slug: pm?.slug ?? null,
          declaredCurrentMmr: m.declaredCurrentMmr ?? 0,
          declaredPeakMmr: m.declaredPeakMmr ?? 0,
          refMmr: m.refMmr ?? 0,
          trackerUrl: m.trackerUrl ?? null,
          discordId: m.discordId ?? null,
          // Snapshot d'abord (contractuel), méta fraîche en secours pour les
          // inscriptions antérieures à l'enrichissement du snapshot.
          discordUsername: (m.discordUsername as string) ?? pm?.discordUsername ?? null,
          epicId: m.epicId ?? null,
          epicName: (m.epicName as string) ?? pm?.epicName ?? null,
          steamId: m.steamId ?? null,
          onDiscordGuild: (m.onDiscordGuild as boolean | null) ?? null,
          country: m.country ?? null,
          age: m.age ?? null,
          verified: m.verified === true,
          smurf: pm
            ? { pendingReports: pm.pendingReports, adminFlag: pm.adminFlag }
            : { pendingReports: 0, adminFlag: false },
        };
      });

      const identity = circuitCtx && r.status === 'pending'
        ? enrichIdentity(resolveFor(circuitCtx, id, d.id, r), circuitCtx)
        : null;

      const structureInfo = structuresById.get(r.structureId as string);
      const createdByMeta = meta.get(r.createdBy as string);

      // Staff & direction (LIVE) : dirigeant + responsables de la structure,
      // staff de l'équipe (manager/coach), capitaine désigné (distinct de
      // l'inscripteur). Null-safe si l'équipe a été archivée depuis l'inscription.
      const teamInfo = teamsById.get(r.teamId as string);
      const staff = {
        founder: structureInfo?.founderId ? nameOf(structureInfo.founderId) : null,
        coFounders: (structureInfo?.coFounderIds ?? []).map(nameOf),
        responsables: (structureInfo?.managerIds ?? []).map(nameOf),
        teamManagers: (teamInfo?.staffIds ?? []).filter(u => (teamInfo!.staffRoles[u] ?? 'coach') === 'manager').map(nameOf),
        teamCoaches: (teamInfo?.staffIds ?? []).filter(u => (teamInfo!.staffRoles[u] ?? 'coach') === 'coach').map(nameOf),
        captain: teamInfo?.captainId ? nameOf(teamInfo.captainId) : null,
      };

      // Historique des sanctions visant cette inscription (joueurs du roster,
      // structure, équipe) — fonde l'escalade manuelle à la validation.
      const regRosterUids = new Set((r.rosterUids as string[] | undefined) ?? []);
      const sanctions = sanctionRecords.filter(s =>
        (s.targetType === 'user' && regRosterUids.has(s.targetId))
        || (s.targetType === 'structure' && s.targetId === r.structureId)
        || (s.targetType === 'team' && s.targetId === r.teamId));

      return {
        id: d.id,
        teamId: r.teamId ?? '',
        structureId: r.structureId ?? '',
        structureName: structureInfo?.name ?? '',
        structureSlug: structureInfo?.slug ?? null,
        name: r.name ?? '',
        tag: r.tag ?? '',
        logoUrl: r.logoUrl ?? null,
        status: r.status ?? 'pending',
        createdAt: r.createdAt?.toDate?.()?.toISOString() ?? null,
        createdByName: names.get(r.createdBy as string) ?? '',
        createdByUid: r.createdBy ?? '',
        createdBySlug: createdByMeta?.slug ?? null,
        createdByDiscordUsername: createdByMeta?.discordUsername ?? null,
        createdByOnDiscordGuild: (r.createdByOnDiscordGuild as boolean | null) ?? null,
        captainUid: r.captainUid ?? '',
        staff,
        sanctions,
        adminNotes: (r.adminNotes as string) ?? '',
        roster,
        computed: r.computed ?? { worstLineupAvg: null, worstLineupGap: null, flags: [] },
        review: r.review
          ? {
              byName: names.get(r.review.by as string) ?? '',
              at: r.review.at?.toDate?.()?.toISOString() ?? null,
              reason: r.review.reason ?? null,
              derogations: r.review.derogations ?? [],
            }
          : null,
        rulebookAccepted: r.rulebookAccepted
          ? { version: r.rulebookAccepted.version ?? 0, at: r.rulebookAccepted.at?.toDate?.()?.toISOString() ?? null }
          : null,
        circuitTeamId: r.circuitTeamId ?? null,
        discord: {
          provisioningStatus: r.discord?.provisioningStatus ?? 'none',
          roleId: r.discord?.roleId ?? null,
          textChannelId: r.discord?.textChannelId ?? null,
          voiceChannelId: r.discord?.voiceChannelId ?? null,
          warnings: r.discord?.warnings ?? [],
          errorMessage: r.discord?.errorMessage ?? null,
        },
        identity,
      };
    });

    return NextResponse.json({
      registrations,
      counts: {
        approved: (comp.approvedCount as number | undefined) ?? 0,
        maxTeams: (comp.format?.maxTeams as number | undefined) ?? 0,
        waitlistEnabled: comp.registration?.waitlist === true,
      },
      minAge: comp.eligibility?.minAge ?? null,
      discordConfigured: !!comp.discord?.guildId,
      circuitName: circuitCtx?.circuitName ?? null,
    });
  } catch (err) {
    captureApiError('API Admin/Competitions/Registrations GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// Enrichit les matches de la résolution avec les points du circuit (aide à
// l'arbitrage : « qui hérite des points, l'autre repart à 0 »).
function enrichIdentity(resolution: IdentityResolution, ctx: CircuitContext) {
  const byId = new Map(ctx.teams.map(t => [t.id, t]));
  return {
    proposal: resolution.kind,
    circuitTeamId: resolution.kind === 'attach' ? resolution.circuitTeamId : null,
    flags: resolution.flags,
    matches: resolution.matches.map(m => ({
      ...m,
      totalPoints: byId.get(m.circuitTeamId)?.totalPoints ?? 0,
      participationsCount: byId.get(m.circuitTeamId)?.participationsCount ?? 0,
    })),
  };
}

// ── POST : approve / reject / unapprove ─────────────────────────────────────

interface DerogationInput { uid: string; note: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id } = await params;
    const body = await req.json();
    const action = body.action as string;
    const registrationId = typeof body.registrationId === 'string' ? body.registrationId : '';
    if (!registrationId) return NextResponse.json({ error: 'Inscription requise.' }, { status: 400 });

    const db = getAdminDb();
    const compSnap = await db.collection('competitions').doc(id).get();
    if (!compSnap.exists) return NextResponse.json({ error: 'Compétition introuvable.' }, { status: 404 });
    const comp = compSnap.data()!;

    const regRef = db.collection('competition_registrations').doc(registrationId);
    const regSnap = await regRef.get();
    if (!regSnap.exists || regSnap.data()?.competitionId !== id) {
      return NextResponse.json({ error: 'Inscription introuvable.' }, { status: 404 });
    }
    const reg = regSnap.data()!;

    // Notes admin internes (jamais vues par l'équipe) — édition simple.
    if (action === 'set_notes') {
      const notes = clampString(body.notes, 2000);
      await regRef.update({ adminNotes: notes });
      return NextResponse.json({ success: true });
    }

    if (action === 'approve') {
      return await approve(db, { id, comp, regRef, registrationId, reg, adminUid: uid, body });
    }
    if (action === 'reject') {
      return await reject(db, { id, comp, regRef, registrationId, reg, adminUid: uid, body });
    }
    if (action === 'unapprove') {
      return await unapprove(db, { id, comp, regRef, registrationId, reg, adminUid: uid });
    }
    return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });
  } catch (err) {
    captureApiError('API Admin/Competitions/Registrations POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

interface ActionContext {
  id: string;
  comp: FirebaseFirestore.DocumentData;
  regRef: FirebaseFirestore.DocumentReference;
  registrationId: string;
  reg: FirebaseFirestore.DocumentData;
  adminUid: string;
  body?: Record<string, unknown>;
}

// ── approve ─────────────────────────────────────────────────────────────────

async function approve(db: FirebaseFirestore.Firestore, ctx: ActionContext) {
  const { id, comp, regRef, registrationId, reg, adminUid, body } = ctx;

  if (reg.status !== 'pending' && reg.status !== 'waitlisted') {
    return NextResponse.json({ error: 'Seule une inscription en attente ou en liste d\'attente peut être validée.' }, { status: 409 });
  }

  // ── Dérogations mineurs : chaque joueur sous l'âge minimum (ou d'âge
  //    inconnu) exige une note explicite — jamais de validation muette (spec §4).
  const minAge = comp.eligibility?.minAge ?? null;
  const roster = (reg.roster as Array<{ uid: string; displayName: string; age: number | null }>) ?? [];
  const needsDerogation = minAge !== null
    ? roster.filter(m => m.age === null || m.age < minAge).map(m => m.uid)
    : [];
  const providedDerogations: DerogationInput[] = Array.isArray(body?.derogations)
    ? (body!.derogations as Array<Record<string, unknown>>)
        .filter(d => typeof d.uid === 'string' && typeof d.note === 'string' && (d.note as string).trim().length >= 3)
        .map(d => ({ uid: d.uid as string, note: clampString(d.note, 500) }))
    : [];
  const existingDerogations: DerogationInput[] = Array.isArray(reg.review?.derogations)
    ? reg.review.derogations : [];
  const derogations: DerogationInput[] = [];
  for (const target of needsDerogation) {
    const found = providedDerogations.find(d => d.uid === target)
      ?? existingDerogations.find(d => d.uid === target);
    if (!found) {
      const player = roster.find(m => m.uid === target);
      return NextResponse.json({
        error: `Dérogation requise pour ${player?.displayName ?? target} (âge ${player?.age ?? 'inconnu'}) : ajoute une note (accord parental, justificatif…).`,
        needsDerogationFor: needsDerogation,
      }, { status: 422 });
    }
    derogations.push(found);
  }

  // ── Résolution d'identité circuit — recalculée SERVEUR, jamais confiance
  //    au client. Ambiguïté sans choix explicite → 409 avec le détail.
  const circuitCtx = comp.circuitId ? await loadCircuitContext(db, comp.circuitId as string) : null;
  let identityDecision:
    | { kind: 'attach'; circuitTeamId: string; rename: boolean }
    | { kind: 'new'; explicit?: boolean }
    | null = null;
  if (circuitCtx && reg.circuitTeamId) {
    // Déjà rattachée (promotion d'une waitlisted) : le claim posé à la première
    // approbation reste valable — pas de nouvelle résolution, sinon l'équipe
    // entrerait en conflit d'identité avec sa PROPRE circuit_team.
    identityDecision = { kind: 'attach', circuitTeamId: reg.circuitTeamId as string, rename: false };
  } else if (circuitCtx) {
    const resolution = resolveFor(circuitCtx, id, registrationId, reg);
    const choice = body?.circuitTeam as { choice?: string; circuitTeamId?: string } | undefined;
    if (resolution.kind === 'attach') {
      identityDecision = { kind: 'attach', circuitTeamId: resolution.circuitTeamId, rename: false };
    } else if (resolution.kind === 'new') {
      identityDecision = { kind: 'new' };
    } else {
      // choice_required : le choix admin doit exister ET pointer un candidat calculé.
      if (choice?.choice === 'new') {
        identityDecision = { kind: 'new', explicit: true };
      } else if (choice?.choice === 'attach' && typeof choice.circuitTeamId === 'string') {
        const match = resolution.matches.find(m => m.circuitTeamId === choice.circuitTeamId);
        if (!match) {
          return NextResponse.json({ error: 'Équipe de circuit invalide pour ce rattachement.' }, { status: 400 });
        }
        if (match.claimedByOther) {
          return NextResponse.json({ error: 'Une autre inscription de cette compétition est déjà rattachée à cette équipe de circuit.' }, { status: 409 });
        }
        identityDecision = { kind: 'attach', circuitTeamId: match.circuitTeamId, rename: !match.nameMatch };
      } else {
        return NextResponse.json({
          error: 'Le rattachement circuit est ambigu : choisis explicitement l\'équipe qui conserve ses points, ou une nouvelle équipe.',
          identity: enrichIdentity(resolution, circuitCtx),
        }, { status: 409 });
      }
    }
  }

  // ── Chevauchement de joueurs re-vérifié à la validation : la course
  //    résiduelle du POST register (check hors transaction) a ici son filet
  //    humain — deux inscriptions actives ne peuvent pas partager un joueur.
  const regRosterUids = (reg.rosterUids as string[] | undefined) ?? [];
  if (regRosterUids.length > 0) {
    const overlapSnap = await db.collection('competition_registrations')
      .where('competitionId', '==', id)
      .where('rosterUids', 'array-contains-any', regRosterUids.slice(0, 10))
      .get();
    const overlap = overlapSnap.docs.find(d => {
      const st = d.data().status;
      return d.id !== registrationId && (st === 'approved' || st === 'waitlisted');
    });
    if (overlap) {
      return NextResponse.json({
        error: `Un joueur de ce roster figure déjà dans l'inscription validée de « ${overlap.data().name ?? ''} ». Règle d'abord ce doublon.`,
      }, { status: 409 });
    }
  }

  // IDs candidats pour une création : slug du nom, avec repli déterministe si
  // le slug est déjà pris. Le repli n'est autorisé QUE si « nouvelle équipe »
  // est un CHOIX ADMIN explicite : en résolution automatique, un slug déjà pris
  // signifie qu'une homonyme vient d'être créée par une approbation concurrente
  // → on s'arrête pour que l'admin arbitre (jamais deux homonymes silencieuses,
  // archi §2). Les gets sont faits DANS la transaction.
  const newIdPrimary = circuitCtx ? circuitTeamSlug(circuitCtx.circuitId, (reg.name as string) ?? '') : null;
  const newIdFallback = newIdPrimary ? `${newIdPrimary}--${reg.teamId}` : null;

  const compRef = db.collection('competitions').doc(id);
  const starterUids = roster.length > 0
    ? ((reg.roster as Array<{ uid: string; role: string }>).filter(r => r.role === 'titulaire').map(r => r.uid))
    : [];

  let finalStatus: 'approved' | 'waitlisted' = 'approved';
  let finalCircuitTeamId: string | null = null;
  let renamedTeam = false;

  try {
    await db.runTransaction(async tx => {
      const [regNow, compNow] = await Promise.all([tx.get(regRef), tx.get(compRef)]);
      const regData = regNow.data();
      if (!regNow.exists || (regData?.status !== 'pending' && regData?.status !== 'waitlisted')) {
        throw new Error('state_changed');
      }
      // Le doc id est DÉTERMINISTE et réécrit en place à la re-soumission
      // (rejected → pending avec un roster potentiellement différent). Toutes
      // les décisions de cette approbation (dérogations, identité, roster
      // snapshoté) ont été calculées sur `reg` : si le doc a été réécrit entre
      // la lecture et la transaction, on refuse (TOCTOU).
      const createdAtNow = regData?.createdAt as Timestamp | undefined;
      const createdAtRead = reg.createdAt as Timestamp | undefined;
      if (!createdAtNow || !createdAtRead || !createdAtNow.isEqual(createdAtRead)) {
        throw new Error('state_changed');
      }
      const approvedCount = (compNow.data()?.approvedCount as number | undefined) ?? 0;
      const maxTeams = (compNow.data()?.format?.maxTeams as number | undefined) ?? 0;
      const waitlistEnabled = compNow.data()?.registration?.waitlist === true;

      if (approvedCount < maxTeams) {
        finalStatus = 'approved';
      } else if (waitlistEnabled) {
        finalStatus = 'waitlisted';
      } else {
        throw new Error('competition_full');
      }
      if (regData?.status === 'waitlisted' && finalStatus === 'waitlisted') {
        throw new Error('still_full');
      }

      // ── Identité circuit : claim atomique ──
      let ctRef: FirebaseFirestore.DocumentReference | null = null;
      let createTeam = false;
      let renameTeam = false;
      if (identityDecision && circuitCtx) {
        if (identityDecision.kind === 'attach') {
          ctRef = db.collection('circuit_teams').doc(identityDecision.circuitTeamId);
          renameTeam = identityDecision.rename;
          const [ctSnap, stateSnap] = await Promise.all([
            tx.get(ctRef),
            tx.get(ctRef.collection('private').doc('state')),
          ]);
          if (!ctSnap.exists) throw new Error('circuit_team_missing');
          const claims = (stateSnap.data()?.claims as Record<string, string>) ?? {};
          if (claims[id] && claims[id] !== registrationId) throw new Error('circuit_team_claimed');
        } else {
          const primaryRef = db.collection('circuit_teams').doc(newIdPrimary!);
          const primarySnap = await tx.get(primaryRef);
          if (!primarySnap.exists) {
            ctRef = primaryRef;
          } else if (identityDecision.explicit) {
            // Homonymie ASSUMÉE par un choix admin explicite → id de repli.
            const fallbackRef = db.collection('circuit_teams').doc(newIdFallback!);
            const fallbackSnap = await tx.get(fallbackRef);
            if (fallbackSnap.exists) throw new Error('circuit_team_id_taken');
            ctRef = fallbackRef;
          } else {
            // Résolution automatique « new » qui perd la course contre une
            // homonyme créée entre-temps : jamais de contournement silencieux.
            throw new Error('circuit_team_id_taken');
          }
          createTeam = true;
        }
        finalCircuitTeamId = ctRef.id;
      }

      // ── Writes ──
      if (ctRef) {
        if (createTeam) {
          tx.set(ctRef, {
            circuitId: circuitCtx!.circuitId,
            name: reg.name ?? '',
            tag: reg.tag ?? '',
            participations: [],
            createdAt: Timestamp.now(),
          });
        } else if (renameTeam) {
          // Rattacher malgré un name_mismatch = accord admin de changement de
          // nom (spec §4) : l'équipe de circuit adopte le nouveau nom.
          tx.update(ctRef, { name: reg.name ?? '', tag: reg.tag ?? '' });
          renamedTeam = true;
        }
        // Le claim réserve l'identité pour cette compétition (waitlisted
        // inclus : nécessaire à la promotion). Le roster de référence de la
        // règle noyau (« précédente participation », spec §4) ne doit venir
        // QUE des inscriptions effectivement validées : une waitlisted jamais
        // promue ne joue pas — l'écrire créerait une participation fantôme
        // qui corromprait la résolution du Qualif suivant.
        tx.set(ctRef.collection('private').doc('state'), {
          claims: { [id]: registrationId },
          ...(finalStatus === 'approved' ? {
            rosterByCompetition: {
              [id]: {
                registrationId,
                rosterUids: (reg.rosterUids as string[]) ?? [],
                starterUids,
                approvedAt: Timestamp.now(),
              },
            },
          } : {}),
        }, { merge: true });
      }

      const queueProvisioning = finalStatus === 'approved'
        && !!comp.discord?.guildId
        && (regData?.discord?.provisioningStatus ?? 'none') !== 'done';
      tx.update(regRef, {
        status: finalStatus,
        circuitTeamId: finalCircuitTeamId,
        review: {
          by: adminUid,
          at: Timestamp.now(),
          reason: null,
          derogations,
        },
        ...(queueProvisioning ? { 'discord.provisioningStatus': 'queued' } : {}),
      });
      if (finalStatus === 'approved') {
        tx.update(compRef, { approvedCount: approvedCount + 1 });
      }
    });
  } catch (err) {
    if (err instanceof Error) {
      const conflictMessages: Record<string, string> = {
        state_changed: 'L\'inscription a changé d\'état entre-temps. Recharge la liste.',
        competition_full: 'La compétition est complète et la liste d\'attente est désactivée.',
        still_full: 'Toujours aucune place disponible : l\'inscription reste en liste d\'attente.',
        circuit_team_missing: 'L\'équipe de circuit ciblée n\'existe plus. Recharge la liste.',
        circuit_team_claimed: 'Une autre inscription vient d\'être rattachée à cette équipe de circuit.',
        circuit_team_id_taken: 'Conflit de nom d\'équipe de circuit : recharge la liste et arbitre le rattachement.',
      };
      if (conflictMessages[err.message]) {
        return NextResponse.json({ error: conflictMessages[err.message] }, { status: 409 });
      }
    }
    throw err;
  }

  // L'arbitrage d'identité (archi §2) et les dérogations mineurs (spec §4,
  // traçabilité de l'accord parental — elles ne survivent pas à un unapprove
  // sur le doc registration) sont journalisés EN ENTIER dans l'audit log.
  const choice = body?.circuitTeam as { choice?: string } | undefined;
  await writeAdminAuditLog(db, {
    action: 'competition_registration_approved',
    adminUid,
    targetType: 'competition',
    targetId: id,
    targetLabel: (comp.name as string) ?? id,
    metadata: {
      registrationId,
      teamName: reg.name ?? '',
      result: finalStatus,
      circuitTeamId: finalCircuitTeamId,
      identityChoice: identityDecision
        ? `${choice?.choice ? 'admin' : 'auto'}-${identityDecision.kind}${renamedTeam ? '-renamed' : ''}`
        : null,
      derogations,
      flags: reg.computed?.flags ?? [],
    },
  });

  await notifyDecision(db, {
    reg,
    competitionId: id,
    competitionName: (comp.name as string) ?? '',
    decision: finalStatus,
    reason: null,
  });

  // Créneaux au calendrier de l'équipe (retour Matt 07/07) : uniquement si
  // VALIDÉE (pas liste d'attente). Best-effort — n'échoue jamais l'approbation.
  if (finalStatus === 'approved') {
    try {
      await syncRegistrationToCalendar(db, {
        competitionId: id, comp, teamId: reg.teamId as string, structureId: reg.structureId as string,
      });
    } catch (err) {
      console.error('[competitions/registrations] calendar sync on approve failed:', err);
    }
  }

  return NextResponse.json({ success: true, status: finalStatus, circuitTeamId: finalCircuitTeamId });
}

// ── reject ──────────────────────────────────────────────────────────────────

async function reject(db: FirebaseFirestore.Firestore, ctx: ActionContext) {
  const { id, comp, regRef, registrationId, reg, adminUid, body } = ctx;

  if (reg.status !== 'pending' && reg.status !== 'waitlisted') {
    return NextResponse.json({ error: 'Seule une inscription en attente ou en liste d\'attente peut être refusée. Annule d\'abord la validation.' }, { status: 409 });
  }
  const reason = clampString(body?.reason, 500);
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json({ error: 'Un motif de refus est obligatoire (il sera transmis à l\'équipe).' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const regNow = await tx.get(regRef);
      const regData = regNow.data();
      if (!regNow.exists || (regData?.status !== 'pending' && regData?.status !== 'waitlisted')) {
        throw new Error('state_changed');
      }
      await releaseCircuitClaim(db, tx, id, registrationId, regData?.circuitTeamId ?? null);
      tx.update(regRef, {
        status: 'rejected',
        circuitTeamId: null,
        review: { by: adminUid, at: Timestamp.now(), reason, derogations: [] },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'state_changed') {
      return NextResponse.json({ error: 'L\'inscription a changé d\'état entre-temps. Recharge la liste.' }, { status: 409 });
    }
    throw err;
  }

  // Refus définitif : une équipe refusée ne garde ni salon privé ni rôle
  // (résidu d'accès sinon). Best-effort — les échecs restent visibles console.
  const hadDiscord = reg.discord?.roleId || reg.discord?.textChannelId || reg.discord?.voiceChannelId;
  if (hadDiscord && comp.discord?.guildId) {
    try {
      await deprovisionRegistration(db, comp.discord.guildId as string, {
        registrationId,
        roleId: (reg.discord?.roleId as string | null) ?? null,
        textChannelId: (reg.discord?.textChannelId as string | null) ?? null,
        voiceChannelId: (reg.discord?.voiceChannelId as string | null) ?? null,
        participantRoleId: (comp.discord?.participantRoleId as string | null) ?? null,
        roster: ((reg.roster as Array<Record<string, unknown>>) ?? []).map(m => ({
          discordId: (m.discordId as string) ?? '',
          displayName: (m.displayName as string) ?? '',
        })),
      });
    } catch (err) {
      console.error('[competitions/registrations] deprovision on reject failed:', err);
    }
  }

  await writeAdminAuditLog(db, {
    action: 'competition_registration_rejected',
    adminUid,
    targetType: 'competition',
    targetId: id,
    targetLabel: (comp.name as string) ?? id,
    metadata: { registrationId, teamName: reg.name ?? '', reason },
  });

  await notifyDecision(db, {
    reg,
    competitionId: id,
    competitionName: (comp.name as string) ?? '',
    decision: 'rejected',
    reason,
  });

  // Retire les créneaux calendrier posés à une éventuelle validation antérieure
  // (idempotent : no-op si l'équipe n'avait jamais été validée). Best-effort.
  try {
    await removeRegistrationFromCalendar(db, { competitionId: id, teamId: reg.teamId as string });
  } catch (err) {
    console.error('[competitions/registrations] calendar cleanup on reject failed:', err);
  }

  return NextResponse.json({ success: true, status: 'rejected' });
}

// ── unapprove ───────────────────────────────────────────────────────────────

async function unapprove(db: FirebaseFirestore.Firestore, ctx: ActionContext) {
  const { id, comp, regRef, registrationId, reg, adminUid } = ctx;

  if (reg.status !== 'approved' && reg.status !== 'waitlisted') {
    return NextResponse.json({ error: 'Seule une inscription validée ou en liste d\'attente peut être remise en attente.' }, { status: 409 });
  }

  const compRef = db.collection('competitions').doc(id);
  try {
    await db.runTransaction(async tx => {
      const [regNow, compNow] = await Promise.all([tx.get(regRef), tx.get(compRef)]);
      const regData = regNow.data();
      if (!regNow.exists || (regData?.status !== 'approved' && regData?.status !== 'waitlisted')) {
        throw new Error('state_changed');
      }
      const wasApproved = regData?.status === 'approved';
      await releaseCircuitClaim(db, tx, id, registrationId, regData?.circuitTeamId ?? null);
      tx.update(regRef, { status: 'pending', circuitTeamId: null, review: null });
      if (wasApproved) {
        const approvedCount = (compNow.data()?.approvedCount as number | undefined) ?? 0;
        tx.update(compRef, { approvedCount: Math.max(0, approvedCount - 1) });
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'state_changed') {
      return NextResponse.json({ error: 'L\'inscription a changé d\'état entre-temps. Recharge la liste.' }, { status: 409 });
    }
    throw err;
  }

  await writeAdminAuditLog(db, {
    action: 'competition_registration_unapproved',
    adminUid,
    targetType: 'competition',
    targetId: id,
    targetLabel: (comp.name as string) ?? id,
    metadata: { registrationId, teamName: reg.name ?? '' },
  });

  // L'équipe n'est plus validée → retirer ses créneaux du calendrier. Best-effort.
  try {
    await removeRegistrationFromCalendar(db, { competitionId: id, teamId: reg.teamId as string });
  } catch (err) {
    console.error('[competitions/registrations] calendar cleanup on unapprove failed:', err);
  }

  return NextResponse.json({ success: true, status: 'pending' });
}

// Libère la réservation d'identité circuit d'une inscription (reject /
// unapprove) et supprime l'équipe de circuit si elle ne porte plus rien
// (aucune participation close, aucun claim, aucun roster) — pas de fantômes.
// Appelée DANS une transaction : les gets précèdent tous les writes de
// l'appelant (contrat Firestore respecté par ordre d'appel).

// ── Notifications de décision (in-app garanties + DM best-effort) ───────────

async function notifyDecision(
  db: FirebaseFirestore.Firestore,
  input: {
    reg: FirebaseFirestore.DocumentData;
    competitionId: string;
    competitionName: string;
    decision: 'approved' | 'waitlisted' | 'rejected';
    reason: string | null;
  },
): Promise<void> {
  const { reg, competitionId, competitionName, decision, reason } = input;
  const teamName = (reg.name as string) ?? '';
  const link = `/competitions/${competitionId}`;

  let title: string;
  let message: string;
  if (decision === 'approved') {
    title = 'Inscription validée';
    message = `${teamName} est officiellement inscrite à ${competitionName}.`;
  } else if (decision === 'waitlisted') {
    title = 'Inscription en liste d\'attente';
    message = `${competitionName} est complète pour le moment — ${teamName} est en liste d'attente. Vous serez prévenus si une place se libère.`;
  } else {
    title = 'Inscription refusée';
    message = `L'inscription de ${teamName} à ${competitionName} a été refusée. Motif : ${reason ?? '—'}`;
  }

  try {
    const recipients = Array.from(new Set([
      ...(((reg.rosterUids as string[] | undefined) ?? [])),
      reg.createdBy as string,
    ].filter(Boolean)));
    const payloads: NotificationPayload[] = recipients.map(userId => ({
      userId,
      type: 'competition_registration',
      title,
      message,
      link,
      metadata: { competitionId, decision },
    }));
    await createNotifications(db, payloads);
  } catch (err) {
    console.error('[competitions/registrations] notifications in-app failed:', err);
  }

  // DM Discord au capitaine + au dirigeant qui a inscrit (dédupliqués) — DM
  // fonctionnel best-effort, jamais bloquant pour la décision elle-même.
  try {
    const roster = (reg.roster as Array<{ uid: string; discordId?: string }> | undefined) ?? [];
    const dmTargets = new Map<string, string>(); // uid → discordId
    const captain = roster.find(m => m.uid === reg.captainUid);
    if (captain?.discordId) dmTargets.set(captain.uid, captain.discordId);
    const createdBy = reg.createdBy as string;
    if (createdBy && !dmTargets.has(createdBy)) {
      const inRoster = roster.find(m => m.uid === createdBy);
      if (inRoster?.discordId) {
        dmTargets.set(createdBy, inRoster.discordId);
      } else {
        const snap = await db.collection('users').doc(createdBy).get();
        const discordId = snap.data()?.discordId as string | undefined;
        if (discordId) dmTargets.set(createdBy, discordId);
      }
    }
    // Budget dur de 10 s pour l'ensemble des DM : le backoff 429 de la lib
    // peut monter à plusieurs minutes en épisode de rate-limit, et l'admin
    // attend la réponse de l'API — la notif in-app est déjà garantie, les DM
    // restent best-effort.
    await Promise.race([
      Promise.all(Array.from(dmTargets.values()).map(discordId =>
        sendCompetitionDM(discordId, { title, message, link: `https://aedral.com${link}` }))),
      new Promise(resolve => setTimeout(resolve, 10_000)),
    ]);
  } catch (err) {
    console.error('[competitions/registrations] DM decision failed:', err);
  }
}
