import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isCompetitionAdmin } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { writeAdminAuditLog } from '@/lib/admin-audit-log';
import { clampString } from '@/lib/validation';
import { serializeSanction, SANCTION_REASON_CODE_SET } from '@/lib/competitions/sanctions';
import { notifyCompetitionSanction } from '@/lib/competitions/sanctions-notify';
import { withdrawRegistration } from '@/lib/competitions/withdraw-registration';
import { createNotifications, type NotificationPayload } from '@/lib/notifications';
import type { SanctionScope, SanctionTargetType, SanctionType } from '@/types/competitions';

// Registre unifié des sanctions (warn / exclusion / ban) — géré par les admins
// de compétition (rôle scopé, spec §6). Jamais de delete : révocation horodatée.
// Warns cumulables (escalade MANUELLE) ; ban/exclusion = 1 seul actif par cible.

const VALID_TYPES: SanctionType[] = ['warn', 'exclusion', 'ban'];
const VALID_TARGETS: SanctionTargetType[] = ['user', 'structure', 'team'];

// GET — liste complète (registre) ; ?search=xxx → picker cibles (users + structures).
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const db = getAdminDb();
    const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() || '';

    if (search) {
      if (search.length < 2) return NextResponse.json({ users: [], structures: [] });
      const [usersSnap, structuresSnap] = await Promise.all([
        db.collection('users').limit(1000).get(),
        db.collection('structures').limit(200).get(),
      ]);
      const users = usersSnap.docs
        .map(d => ({
          uid: d.id,
          displayName: (d.data().displayName as string) || (d.data().discordUsername as string) || d.id,
          discordUsername: (d.data().discordUsername as string) || '',
        }))
        .filter(u => u.displayName.toLowerCase().includes(search) || u.discordUsername.toLowerCase().includes(search))
        .slice(0, 6);
      const structures = structuresSnap.docs
        .map(d => ({ id: d.id, name: (d.data().name as string) || d.id, tag: (d.data().tag as string) || '' }))
        .filter(s => s.name.toLowerCase().includes(search) || s.tag.toLowerCase().includes(search))
        .slice(0, 6);
      return NextResponse.json({ users, structures });
    }

    const snap = await db.collection('competition_sanctions').get();
    const sanctions = snap.docs
      .map(d => serializeSanction(d.id, d.data()))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return NextResponse.json({ sanctions });
  } catch (err) {
    captureApiError('API Admin/CompetitionSanctions GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST — créer une sanction (warn / exclusion / ban).
export async function POST(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isCompetitionAdmin(uid))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const blocked = await checkRateLimit(limiters.admin, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const body = await req.json();
    const type = VALID_TYPES.includes(body.type) ? body.type as SanctionType : null;
    const targetType = VALID_TARGETS.includes(body.targetType) ? body.targetType as SanctionTargetType : null;
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    const reason = clampString(body.reason, 500);
    const reasonCode = typeof body.reasonCode === 'string' && SANCTION_REASON_CODE_SET.has(body.reasonCode)
      ? body.reasonCode : null;
    const competitionId = typeof body.competitionId === 'string' && body.competitionId.trim() ? body.competitionId.trim() : null;

    if (!type || !targetType || !targetId) return NextResponse.json({ error: 'Sanction invalide (type/cible).' }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'Le motif est obligatoire.' }, { status: 400 });

    // Scope : ban toujours global ; warn global (avertissement, non bloquant) ;
    // exclusion scopée à une compétition ou un circuit (spec — effet au Lot 3).
    let scope: SanctionScope = { kind: 'global' };
    if (type === 'exclusion') {
      const cId = typeof body.scopeCompetitionId === 'string' && body.scopeCompetitionId.trim() ? body.scopeCompetitionId.trim() : null;
      const circId = typeof body.scopeCircuitId === 'string' && body.scopeCircuitId.trim() ? body.scopeCircuitId.trim() : null;
      if (cId) scope = { kind: 'competition', competitionId: cId };
      else if (circId) scope = { kind: 'circuit', circuitId: circId };
      else return NextResponse.json({ error: 'Une exclusion doit viser une compétition ou un circuit.' }, { status: 400 });
    }

    // Expiration : null = permanent ; sinon future.
    let expiresAt: Timestamp | null = null;
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Date d\'expiration invalide.' }, { status: 400 });
      if (d <= new Date()) return NextResponse.json({ error: 'La date d\'expiration doit être dans le futur.' }, { status: 400 });
      expiresAt = Timestamp.fromDate(d);
    }

    const db = getAdminDb();

    // Cible réelle + label dénormalisé.
    let targetLabel = '';
    let notifStructureId: string | null = null;
    let notifTeamId: string | null = null;
    if (targetType === 'user') {
      const s = await db.collection('users').doc(targetId).get();
      if (!s.exists) return NextResponse.json({ error: 'Joueur introuvable.' }, { status: 404 });
      targetLabel = (s.data()?.displayName as string) || (s.data()?.discordUsername as string) || targetId;
    } else if (targetType === 'structure') {
      const s = await db.collection('structures').doc(targetId).get();
      if (!s.exists) return NextResponse.json({ error: 'Structure introuvable.' }, { status: 404 });
      targetLabel = (s.data()?.name as string) || targetId;
      notifStructureId = targetId;
    } else {
      const s = await db.collection('sub_teams').doc(targetId).get();
      if (!s.exists) return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 });
      targetLabel = (s.data()?.name as string) || targetId;
      notifTeamId = targetId;
      notifStructureId = (s.data()?.structureId as string) ?? null;
    }
    // Contexte d'émission (panel de validation) pour élargir la notif.
    if (typeof body.contextStructureId === 'string' && body.contextStructureId.trim()) notifStructureId = notifStructureId ?? body.contextStructureId.trim();
    if (typeof body.contextTeamId === 'string' && body.contextTeamId.trim()) notifTeamId = notifTeamId ?? body.contextTeamId.trim();

    // Anti-doublon TYPE-AWARE : ban/exclusion = 1 seul actif par cible (réviser
    // l'existant plutôt qu'empiler). Warn = CUMULABLE (escalade manuelle, §5).
    if (type !== 'warn') {
      const existing = await db.collection('competition_sanctions')
        .where('targetType', '==', targetType)
        .where('targetId', '==', targetId)
        .get();
      const now = new Date();
      const hasActive = existing.docs.some(d => {
        const data = d.data();
        if (data.type !== type) return false;
        if (data.revokedAt) return false;
        const exp = data.expiresAt?.toDate?.() ?? null;
        return !exp || exp > now;
      });
      if (hasActive) {
        return NextResponse.json({ error: `${targetLabel} a déjà un(e) ${type} actif(ve). Révoque-le d'abord pour le remplacer.` }, { status: 409 });
      }
    }

    const competitionName = typeof body.competitionName === 'string' ? body.competitionName : '';

    const ref = await db.collection('competition_sanctions').add({
      type, targetType, targetId, targetLabel, scope,
      reasonCode, reason, competitionId,
      expiresAt,
      createdBy: uid, createdAt: FieldValue.serverTimestamp(),
      revokedAt: null, revokedBy: null,
      notified: false,
    });

    await writeAdminAuditLog(db, {
      action: 'competition_sanction_added',
      adminUid: uid,
      targetType: targetType === 'user' ? 'user' : targetType === 'structure' ? 'structure' : 'team',
      targetId, targetLabel,
      metadata: { sanctionId: ref.id, type, reasonCode, reason, scope: scope.kind, competitionId, permanent: expiresAt === null },
    });

    // Notif (in-app garanti + DM best-effort) — jamais bloquante.
    try {
      await notifyCompetitionSanction(db, {
        sanctionId: ref.id, type, targetType, targetId, targetLabel, reason,
        competitionId, competitionName, structureId: notifStructureId, teamId: notifTeamId,
      });
      await ref.update({ notified: true });
    } catch (err) {
      console.error('[competition-sanctions] notify failed:', err);
    }

    // EFFET de l'exclusion / du ban (Lot 3G, spec §5) : les inscriptions
    // ACTIVES de la cible dans le périmètre sont retirées automatiquement —
    // SAUF si le bracket est déjà publié : là c'est une disqualification, un
    // humain décide via la console (on signale, on ne DQ jamais tout seul).
    // Best-effort : la sanction elle-même est déjà posée.
    let effect: { withdrawn: string[]; stillInBracket: string[] } = { withdrawn: [], stillInBracket: [] };
    if (type === 'exclusion' || type === 'ban') {
      try {
        effect = await applySanctionEffect(db, { targetType, targetId, targetLabel, scope, reason });
      } catch (err) {
        captureApiError('API Admin/CompetitionSanctions effect error', err);
      }
    }

    return NextResponse.json({ success: true, id: ref.id, effect });
  } catch (err) {
    captureApiError('API Admin/CompetitionSanctions POST error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ── Effet d'une exclusion / d'un ban sur les inscriptions actives ───────────

async function applySanctionEffect(
  db: FirebaseFirestore.Firestore,
  { targetType, targetId, targetLabel, scope, reason }: {
    targetType: SanctionTargetType;
    targetId: string;
    targetLabel: string;
    scope: SanctionScope;
    reason: string;
  },
): Promise<{ withdrawn: string[]; stillInBracket: string[] }> {
  // Inscriptions actives de la CIBLE.
  let query = db.collection('competition_registrations') as FirebaseFirestore.Query;
  if (targetType === 'user') query = query.where('rosterUids', 'array-contains', targetId);
  else if (targetType === 'team') query = query.where('teamId', '==', targetId);
  else query = query.where('structureId', '==', targetId);
  const snap = await query.get();
  const active = snap.docs.filter(d => ['pending', 'approved', 'waitlisted'].includes((d.data().status as string) ?? ''));
  if (active.length === 0) return { withdrawn: [], stillInBracket: [] };

  // Périmètre : compétition précise, compétitions d'un circuit, ou global
  // (ban). Les compétitions terminées/archivées ne sont jamais touchées.
  let scopeCompIds: Set<string> | null = null;   // null = global
  if (scope.kind === 'competition') scopeCompIds = new Set([scope.competitionId]);
  else if (scope.kind === 'circuit') {
    const circuit = await db.collection('circuits').doc(scope.circuitId).get();
    scopeCompIds = new Set(Array.isArray(circuit.data()?.competitionIds) ? (circuit.data()!.competitionIds as string[]) : []);
  }

  const withdrawn: string[] = [];
  const stillInBracket: string[] = [];
  const compCache = new Map<string, FirebaseFirestore.DocumentData | null>();

  for (const d of active) {
    const r = d.data();
    const compId = r.competitionId as string;
    if (scopeCompIds && !scopeCompIds.has(compId)) continue;
    if (!compCache.has(compId)) {
      const cs = await db.collection('competitions').doc(compId).get();
      compCache.set(compId, cs.exists ? cs.data()! : null);
    }
    const comp = compCache.get(compId);
    if (!comp || comp.status === 'finished' || comp.status === 'archived') continue;

    const teamLine = `${(r.name as string) ?? d.id} (${(comp.name as string) ?? compId})`;
    if (comp.bracketMaterializedAt) {
      stillInBracket.push(teamLine);
      continue;
    }
    const res = await withdrawRegistration(db, {
      registrationId: d.id,
      cause: `Sanction appliquée à ${targetLabel} : ${reason}`,
    });
    if (res.ok) withdrawn.push(teamLine);
    else if (res.code === 'bracket_published') stillInBracket.push(teamLine);
  }

  // Équipes encore dans un bracket vivant : les admins tranchent (console).
  if (stillInBracket.length > 0) {
    try {
      const [aedralSnap, compAdminsSnap] = await Promise.all([
        db.collection('aedral_admins').get(),
        db.collection('competition_admins').get(),
      ]);
      const admins = new Set<string>();
      for (const a of aedralSnap.docs) admins.add(a.id);
      for (const a of compAdminsSnap.docs) admins.add(a.id);
      const payloads: NotificationPayload[] = Array.from(admins).map(userId => ({
        userId,
        type: 'competition_match_alert',
        title: 'Sanction posée — équipe encore en bracket',
        message: `${targetLabel} est sanctionné(e) mais encore dans un bracket publié : ${stillInBracket.join(' · ')}. Retrait à décider via la console.`,
        link: '/admin/competitions',
        metadata: { sanctionTargetId: targetId },
      }));
      await createNotifications(db, payloads);
    } catch (err) {
      captureApiError('applySanctionEffect notify admins', err);
    }
  }

  return { withdrawn, stillInBracket };
}
