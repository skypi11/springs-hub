import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';
import { generateDownloadUrl } from '@/lib/storage';

// GET /api/structures/[id]/documents/[docId]/download
// Retourne une URL signée 60s pour télécharger le fichier avec son nom d'origine.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, docId } = await params;
    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const ref = db.collection('structure_documents').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    const data = snap.data()!;
    if (data.structureId !== structureId) {
      return NextResponse.json({ error: 'Document hors structure' }, { status: 403 });
    }
    if (data.status !== 'ready') {
      return NextResponse.json({ error: 'Document non finalisé' }, { status: 409 });
    }

    const url = await generateDownloadUrl(
      data.r2Key as string,
      60,
      (data.filename as string) || `${docId}.bin`
    );

    // Audit — permet de voir qui a téléchargé quoi (utile sur litige RGPD)
    await writeAuditLog(db, {
      structureId,
      action: 'document_downloaded',
      actorUid: uid,
      targetId: docId,
      metadata: { title: data.title, filename: data.filename },
    });

    return NextResponse.json({ url });
  } catch (err) {
    captureApiError('API document download', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
