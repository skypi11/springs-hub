import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';

// Cap dur pour éviter les pulls massifs — si on a besoin de plus, on paginera.
const MAX_LOGS = 200;

type Source = 'admin' | 'structure';

type MergedLog = {
  id: string;
  source: Source;
  action: string;
  actorUid: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  structureId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
};

// GET /api/admin/audit — flux fusionné admin_audit_logs + structure_audit_logs
// Query params :
//   ?limit=N (max 200)
//   ?source=admin|structure (optionnel, filtre source)
//   ?action=xxx (optionnel, filtre action)
//   ?actorUid=uid (optionnel)
//   ?targetId=id (optionnel)
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();
    const params = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(params.get('limit') || '100', 10) || 100, MAX_LOGS);
    const source = params.get('source') as Source | null;
    const action = params.get('action');
    const actorUid = params.get('actorUid');
    const targetId = params.get('targetId');

    const fetchAdminLogs = async () => {
      let q: FirebaseFirestore.Query = db.collection('admin_audit_logs');
      if (action) q = q.where('action', '==', action);
      if (actorUid) q = q.where('adminUid', '==', actorUid);
      if (targetId) q = q.where('targetId', '==', targetId);
      q = q.orderBy('createdAt', 'desc').limit(limit);
      const snap = await q.get();
      return snap.docs.map<MergedLog>(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          source: 'admin',
          action: d.action,
          actorUid: d.adminUid,
          targetType: d.targetType ?? null,
          targetId: d.targetId ?? null,
          targetLabel: d.targetLabel ?? null,
          structureId: d.targetType === 'structure' ? d.targetId : null,
          metadata: d.metadata ?? {},
          createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
        };
      });
    };

    const fetchStructureLogs = async () => {
      let q: FirebaseFirestore.Query = db.collection('structure_audit_logs');
      if (action) q = q.where('action', '==', action);
      if (actorUid) q = q.where('actorUid', '==', actorUid);
      if (targetId) q = q.where('structureId', '==', targetId);
      q = q.orderBy('createdAt', 'desc').limit(limit);
      const snap = await q.get();
      return snap.docs.map<MergedLog>(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          source: 'structure',
          action: d.action,
          actorUid: d.actorUid,
          targetType: d.targetUid ? 'user' : null,
          targetId: d.targetUid ?? d.targetId ?? null,
          targetLabel: null,
          structureId: d.structureId ?? null,
          metadata: d.metadata ?? {},
          createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
        };
      });
    };

    const [adminLogs, structureLogs] = await Promise.all([
      source === 'structure' ? Promise.resolve([] as MergedLog[]) : fetchAdminLogs(),
      source === 'admin' ? Promise.resolve([] as MergedLog[]) : fetchStructureLogs(),
    ]);

    const merged = [...adminLogs, ...structureLogs]
      .sort((a, b) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, limit);

    // Hydrater les infos des acteurs (admins) + structures référencées
    const actorIds = Array.from(new Set(merged.map(m => m.actorUid).filter(Boolean)));
    const structureIds = Array.from(new Set(merged.map(m => m.structureId).filter(Boolean) as string[]));
    const userTargetIds = Array.from(new Set(
      merged.filter(m => m.targetType === 'user').map(m => m.targetId).filter(Boolean) as string[]
    ));
    const allUserIds = Array.from(new Set([...actorIds, ...userTargetIds]));

    const [usersMap, structuresMap] = await Promise.all([
      fetchDocsMap(db, 'users', allUserIds),
      fetchDocsMap(db, 'structures', structureIds),
    ]);

    const enriched = merged.map(log => {
      const actor = usersMap.get(log.actorUid);
      const actorLabel = actor
        ? (actor.displayName as string) || (actor.discordUsername as string) || log.actorUid
        : log.actorUid;
      let targetLabel = log.targetLabel;
      if (!targetLabel && log.targetType === 'user' && log.targetId) {
        const t = usersMap.get(log.targetId);
        if (t) targetLabel = (t.displayName as string) || (t.discordUsername as string) || log.targetId;
      }
      if (!targetLabel && log.targetType === 'structure' && log.targetId) {
        const s = structuresMap.get(log.targetId);
        if (s) targetLabel = (s.name as string) || log.targetId;
      }
      const structureLabel = log.structureId
        ? (structuresMap.get(log.structureId)?.name as string) ?? null
        : null;
      return { ...log, actorLabel, targetLabel, structureLabel };
    });

    return NextResponse.json({ logs: enriched, total: enriched.length, limit, max: MAX_LOGS });
  } catch (err) {
    captureApiError('API Admin/Audit GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

async function fetchDocsMap(
  db: FirebaseFirestore.Firestore,
  collection: string,
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return map;
  // Firestore 'in' max 30 — batcher
  for (let i = 0; i < ids.length; i += 30) {
    const batch = ids.slice(i, i + 30);
    const snap = await db.collection(collection).where('__name__', 'in', batch).get();
    for (const doc of snap.docs) map.set(doc.id, doc.data());
  }
  return map;
}
