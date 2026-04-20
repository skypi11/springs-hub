import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';
import { generateDownloadUrl, downloadBuffer } from '@/lib/storage';
import { decryptBuffer } from '@/lib/document-crypto';

// GET /api/structures/[id]/documents/[docId]/download[?preview=1]
// - Doc non chiffré : retourne { url } signée 60s, client redirige dessus.
// - Doc chiffré     : retourne le binaire déchiffré directement (stream),
//                     pas d'URL signée (le blob sur R2 est inutilisable sans clé).
// - ?preview=1      : Content-Disposition: inline (ouvrable dans un iframe/img)
//                     au lieu d'attachment (qui force le download).
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

    const isEncrypted = data.encrypted === true;
    const filename = (data.filename as string) || `${docId}.bin`;
    const preview = new URL(req.url).searchParams.get('preview') === '1';
    const disposition = preview ? 'inline' : 'attachment';

    await writeAuditLog(db, {
      structureId,
      action: 'document_downloaded',
      actorUid: uid,
      targetId: docId,
      metadata: { title: data.title, filename, encrypted: isEncrypted, preview },
    });

    if (!isEncrypted) {
      const url = await generateDownloadUrl(data.r2Key as string, 60, filename, disposition);
      return NextResponse.json({ url });
    }

    // Doc chiffré : déchiffrement côté serveur puis stream binaire
    const blob = await downloadBuffer(data.r2Key as string);
    const plain = decryptBuffer(blob);
    const safeFilename = filename.replace(/"/g, '');
    return new NextResponse(new Uint8Array(plain), {
      status: 200,
      headers: {
        'Content-Type': (data.mime as string) || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
        'Content-Length': String(plain.length),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    captureApiError('API document download', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
