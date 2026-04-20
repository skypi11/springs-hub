import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import {
  uploadBuffer,
  isAllowedMime,
  sanitizeFilename,
  extensionForStorage,
  getTotalSize,
  StorageKeys,
} from '@/lib/storage';
import { encryptBuffer, ENCRYPTION_ALGO_LABEL, isEncryptionAvailable } from '@/lib/document-crypto';

// POST /api/structures/[id]/documents/upload-sensitive
// Upload direct vers le serveur (multipart/form-data) : le fichier est chiffré
// AES-256-GCM côté serveur avant d'être poussé sur R2. Le fichier ne transite
// jamais en clair hors du serveur Next.js — même les credentials R2 qui fuitent
// ne donnent pas accès au contenu.
//
// FormData attendu : file (File), folderId (string|''), title (string)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    if (!isEncryptionAvailable()) {
      return NextResponse.json(
        { error: 'Chiffrement non configuré — contacter un admin' },
        { status: 500 }
      );
    }

    const { id: structureId } = await params;

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });
    }

    const folderParam = form.get('folderId');
    const folderId: string | null = typeof folderParam === 'string' && folderParam ? folderParam : null;
    const titleRaw = typeof form.get('title') === 'string' ? (form.get('title') as string) : '';

    const filename = file.name;
    const mime = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    if (!filename) return NextResponse.json({ error: 'filename requis' }, { status: 400 });
    if (sizeBytes <= 0 || sizeBytes > UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES) {
      const mb = Math.round(UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Taille invalide — max ${mb} MB par fichier` }, { status: 413 });
    }
    if (!isAllowedMime(mime, 'DOCUMENTS')) {
      return NextResponse.json({ error: 'Type de fichier non supporté' }, { status: 415 });
    }

    if (folderId) {
      const fSnap = await db.collection('structure_folders').doc(folderId).get();
      if (!fSnap.exists || fSnap.data()?.structureId !== structureId) {
        return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
      }
    }

    const currentUsage = await getTotalSize(StorageKeys.structureDocumentsPrefix(structureId));
    if (currentUsage + sizeBytes > UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES) {
      const qmb = Math.round(UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Quota dépassé — max ${qmb} MB par structure` }, { status: 413 });
    }

    const safeName = sanitizeFilename(filename);
    const title = (titleRaw || safeName.replace(/\.[^.]+$/, '') || 'Document sans titre').slice(0, 120);

    const ref = db.collection('structure_documents').doc();
    const docId = ref.id;
    const ext = extensionForStorage(safeName, mime);
    const r2Key = `structures/${structureId}/documents/${docId}.${ext}`;

    // Lecture → chiffrement → upload R2 (tout server-side)
    const plain = Buffer.from(await file.arrayBuffer());
    const blob = encryptBuffer(plain);
    await uploadBuffer(r2Key, blob, 'application/octet-stream', 'private, no-store');

    await ref.set({
      structureId,
      folderId,
      uploadedBy: uid,
      filename: safeName,
      mime,
      sizeBytes,
      r2Key,
      status: 'ready',
      title,
      notes: null,
      sensitive: true,
      encrypted: true,
      encryptionAlgo: ENCRYPTION_ALGO_LABEL,
      ciphertextBytes: blob.length,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog(db, {
      structureId,
      action: 'document_uploaded',
      actorUid: uid,
      targetId: docId,
      metadata: {
        title,
        folderId,
        sizeBytes,
        filename: safeName,
        sensitive: true,
        encrypted: true,
      },
    });

    return NextResponse.json({ documentId: docId });
  } catch (err) {
    captureApiError('API documents upload-sensitive', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
