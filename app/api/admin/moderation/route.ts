import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { captureApiError } from '@/lib/sentry';

const MAX_USERS_SCAN = 2000;
const MAX_STRUCTURES_SCAN = 1000;
const RECENT_LOGS = 50;

// Actions d'audit considérées comme modération (user / structure).
const MODERATION_ACTIONS = new Set([
  'user_banned',
  'user_unbanned',
  'user_deleted',
  'structure_rejected',
  'structure_suspended',
  'structure_unsuspended',
  'structure_deletion_scheduled',
  'structure_deletion_cancelled',
  'structure_deleted',
  'structure_orphaned',
]);

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  if (v instanceof Date) return v.toISOString();
  return null;
}

// GET /api/admin/moderation — tableau de bord modération.
// Agrège : utilisateurs bannis, structures suspendues / orphaned / deletion_scheduled,
// et les ~50 dernières actions de modération (audit logs).
// Un vrai système de signalements (reports) viendra plus tard.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const [usersSnap, structuresSnap, adminLogsSnap] = await Promise.all([
      db.collection('users').limit(MAX_USERS_SCAN).get(),
      db.collection('structures').limit(MAX_STRUCTURES_SCAN).get(),
      db.collection('admin_audit_logs').orderBy('createdAt', 'desc').limit(200).get(),
    ]);

    // Bannis
    const bannedUsers = usersSnap.docs
      .filter(d => d.data().banned === true)
      .map(d => {
        const data = d.data();
        return {
          uid: d.id,
          displayName: (data.displayName as string) ?? (data.discordUsername as string) ?? d.id,
          discordUsername: (data.discordUsername as string) ?? '',
          avatarUrl: (data.avatarUrl as string) ?? (data.discordAvatar as string) ?? '',
          banReason: (data.banReason as string) ?? '',
          bannedAt: ts(data.bannedAt),
          bannedBy: (data.bannedBy as string) ?? null,
        };
      })
      .sort((a, b) => (b.bannedAt ?? '').localeCompare(a.bannedAt ?? ''));

    // Structures en état critique
    const criticalStructures = structuresSnap.docs
      .filter(d => {
        const s = d.data().status as string | undefined;
        return s === 'suspended' || s === 'orphaned' || s === 'deletion_scheduled' || s === 'pending_validation';
      })
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          name: (data.name as string) ?? '',
          tag: (data.tag as string) ?? '',
          logoUrl: (data.logoUrl as string) ?? '',
          status: (data.status as string) ?? '',
          founderId: (data.founderId as string) ?? '',
          suspendedAt: ts(data.suspendedAt),
          orphanedAt: ts(data.orphanedAt),
          deletionScheduledAt: ts(data.deletionScheduledAt),
          requestedAt: ts(data.requestedAt),
        };
      })
      .sort((a, b) => {
        const order: Record<string, number> = {
          pending_validation: 0, suspended: 1, orphaned: 2, deletion_scheduled: 3,
        };
        const oa = order[a.status] ?? 99;
        const ob = order[b.status] ?? 99;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });

    // Actions modération récentes
    const moderationLogs = adminLogsSnap.docs
      .filter(d => MODERATION_ACTIONS.has(d.data().action as string))
      .slice(0, RECENT_LOGS)
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          action: data.action as string,
          adminUid: (data.adminUid as string) ?? '',
          targetType: (data.targetType as string) ?? null,
          targetId: (data.targetId as string) ?? null,
          targetLabel: (data.targetLabel as string) ?? null,
          metadata: (data.metadata as Record<string, unknown>) ?? {},
          createdAt: ts(data.createdAt),
        };
      });

    // Hydrate les UIDs référencés (admins actors + founders + banned by + user targets).
    const userIds = new Set<string>();
    for (const u of bannedUsers) {
      if (u.bannedBy) userIds.add(u.bannedBy);
    }
    for (const s of criticalStructures) {
      if (s.founderId) userIds.add(s.founderId);
    }
    for (const l of moderationLogs) {
      if (l.adminUid) userIds.add(l.adminUid);
      if (l.targetType === 'user' && l.targetId) userIds.add(l.targetId);
    }

    const usersById = await fetchDocsByIds(db, 'users', Array.from(userIds));

    const nameOf = (uid?: string | null) => {
      if (!uid) return '';
      const u = usersById.get(uid);
      return (u?.displayName as string) || (u?.discordUsername as string) || '';
    };

    const logsEnriched = moderationLogs.map(l => ({
      ...l,
      actorName: nameOf(l.adminUid),
      targetName: l.targetType === 'user' ? nameOf(l.targetId) : null,
    }));

    const bannedEnriched = bannedUsers.map(b => ({
      ...b,
      bannedByName: nameOf(b.bannedBy),
    }));

    const structuresEnriched = criticalStructures.map(s => ({
      ...s,
      founderName: nameOf(s.founderId),
    }));

    return NextResponse.json({
      summary: {
        bannedUsers: bannedEnriched.length,
        pendingStructures: structuresEnriched.filter(s => s.status === 'pending_validation').length,
        suspendedStructures: structuresEnriched.filter(s => s.status === 'suspended').length,
        orphanedStructures: structuresEnriched.filter(s => s.status === 'orphaned').length,
        deletionScheduledStructures: structuresEnriched.filter(s => s.status === 'deletion_scheduled').length,
        recentModerationActions: logsEnriched.length,
      },
      bannedUsers: bannedEnriched,
      criticalStructures: structuresEnriched,
      recentLogs: logsEnriched,
      truncated: {
        users: usersSnap.size >= MAX_USERS_SCAN,
        structures: structuresSnap.size >= MAX_STRUCTURES_SCAN,
      },
    });
  } catch (err) {
    captureApiError('API Admin/Moderation GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
