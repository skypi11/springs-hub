import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth, isAdmin } from '@/lib/firebase-admin';
import { fetchDocsByIds } from '@/lib/firestore-helpers';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import { captureApiError } from '@/lib/sentry';

const MAX_DOCS = 5000;
const MAX_REPLAYS = 5000;

type StructureUsage = {
  structureId: string;
  structureName: string;
  structureTag: string;
  structureLogoUrl: string;
  founderId: string;
  founderName: string;
  docsBytes: number;
  docsCount: number;
  replaysBytes: number;
  replaysCount: number;
  totalBytes: number;
  quotaBytes: number;
  quotaPct: number;
};

// GET /api/admin/uploads — vue globale du stockage R2 via les métadonnées Firestore.
// On n'appelle pas R2 listObjectsV2 (coût latence + trafic) — on se base sur les
// sizeBytes stockés dans structure_documents / structure_replays au moment de l'upload.
// L'écart possible avec R2 réel (orphelins) est signalé comme item à auditer ailleurs.
export async function GET(req: NextRequest) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    if (!(await isAdmin(uid))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });

    const db = getAdminDb();

    const [docsSnap, replaysSnap] = await Promise.all([
      db.collection('structure_documents').limit(MAX_DOCS).get(),
      db.collection('structure_replays').limit(MAX_REPLAYS).get(),
    ]);

    const byStructure = new Map<string, StructureUsage>();
    const structureIds = new Set<string>();

    let gDocsBytes = 0, gDocsCount = 0, gDocsPending = 0;
    let gReplaysBytes = 0, gReplaysCount = 0, gReplaysPending = 0;

    function getOrCreate(structureId: string): StructureUsage {
      let s = byStructure.get(structureId);
      if (!s) {
        s = {
          structureId,
          structureName: '',
          structureTag: '',
          structureLogoUrl: '',
          founderId: '',
          founderName: '',
          docsBytes: 0,
          docsCount: 0,
          replaysBytes: 0,
          replaysCount: 0,
          totalBytes: 0,
          quotaBytes: UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES,
          quotaPct: 0,
        };
        byStructure.set(structureId, s);
      }
      return s;
    }

    for (const doc of docsSnap.docs) {
      const d = doc.data();
      const structureId = d.structureId as string | undefined;
      if (!structureId) continue;
      structureIds.add(structureId);
      const size = typeof d.sizeBytes === 'number' ? d.sizeBytes : 0;
      const status = typeof d.status === 'string' ? d.status : 'ready';
      if (status !== 'ready') {
        gDocsPending++;
        continue;
      }
      const s = getOrCreate(structureId);
      s.docsBytes += size;
      s.docsCount++;
      gDocsBytes += size;
      gDocsCount++;
    }

    for (const doc of replaysSnap.docs) {
      const d = doc.data();
      const structureId = d.structureId as string | undefined;
      if (!structureId) continue;
      structureIds.add(structureId);
      const size = typeof d.sizeBytes === 'number' ? d.sizeBytes : 0;
      const status = typeof d.status === 'string' ? d.status : 'ready';
      if (status !== 'ready') {
        gReplaysPending++;
        continue;
      }
      const s = getOrCreate(structureId);
      s.replaysBytes += size;
      s.replaysCount++;
      gReplaysBytes += size;
      gReplaysCount++;
    }

    const structuresById = await fetchDocsByIds(db, 'structures', Array.from(structureIds));
    const founderIds = new Set<string>();
    for (const s of byStructure.values()) {
      const struct = structuresById.get(s.structureId);
      s.structureName = (struct?.name as string | undefined) ?? '';
      s.structureTag = (struct?.tag as string | undefined) ?? '';
      s.structureLogoUrl = (struct?.logoUrl as string | undefined) ?? '';
      s.founderId = (struct?.founderId as string | undefined) ?? '';
      if (s.founderId) founderIds.add(s.founderId);
      s.totalBytes = s.docsBytes + s.replaysBytes;
      s.quotaPct = s.quotaBytes > 0 ? Math.round((s.docsBytes / s.quotaBytes) * 100) : 0;
    }

    const foundersById = await fetchDocsByIds(db, 'users', Array.from(founderIds));
    for (const s of byStructure.values()) {
      if (!s.founderId) continue;
      const u = foundersById.get(s.founderId);
      s.founderName = (u?.displayName as string | undefined)
        || (u?.discordUsername as string | undefined)
        || s.founderId;
    }

    const structures = Array.from(byStructure.values())
      .sort((a, b) => b.totalBytes - a.totalBytes);

    return NextResponse.json({
      global: {
        totalBytes: gDocsBytes + gReplaysBytes,
        docsBytes: gDocsBytes,
        docsCount: gDocsCount,
        docsPending: gDocsPending,
        replaysBytes: gReplaysBytes,
        replaysCount: gReplaysCount,
        replaysPending: gReplaysPending,
        structuresWithUploads: structures.length,
        perStructureQuotaBytes: UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES,
      },
      structures,
      truncated: {
        docs: docsSnap.size >= MAX_DOCS,
        replays: replaysSnap.size >= MAX_REPLAYS,
      },
    });
  } catch (err) {
    captureApiError('API Admin/Uploads GET error', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
