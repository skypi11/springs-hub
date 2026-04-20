import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { UPLOAD_LIMITS } from '@/lib/upload-limits';
import {
  StorageKeys,
  generateUploadUrl,
  isAllowedMime,
  sanitizeFilename,
  extensionForStorage,
  getTotalSize,
} from '@/lib/storage';

function ts(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

// GET /api/structures/[id]/documents?folderId=...
// Liste les documents (status=ready) d'un dossier (null = racine). Inclut l'usage total pour jauge quota.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.read, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const url = new URL(req.url);
    const folderParam = url.searchParams.get('folderId');
    const folderId: string | null = folderParam || null;

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const snap = await db.collection('structure_documents')
      .where('structureId', '==', structureId)
      .where('folderId', '==', folderId)
      .get();

    const documents: Record<string, unknown>[] = snap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Record<string, unknown>)
      .filter(d => d.status === 'ready')
      .map(d => ({
        ...d,
        createdAt: ts(d.createdAt),
        updatedAt: ts(d.updatedAt),
      }));

    documents.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? ''), 'fr', { sensitivity: 'base' }));

    // Usage total pour afficher la jauge de quota côté UI (somme des sizeBytes status=ready)
    const usageSnap = await db.collection('structure_documents')
      .where('structureId', '==', structureId)
      .get();
    const usageBytes = usageSnap.docs.reduce((sum, d) => {
      const data = d.data();
      if (data.status !== 'ready') return sum;
      const sz = typeof data.sizeBytes === 'number' ? data.sizeBytes : 0;
      return sum + sz;
    }, 0);

    return NextResponse.json({
      documents,
      usageBytes,
      quotaBytes: UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES,
    });
  } catch (err) {
    captureApiError('API documents GET', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/structures/[id]/documents
// Prépare un upload : crée un doc Firestore pending + retourne une URL signée R2 PUT.
// Pour les images, le client les convertit en webp AVANT PUT (voir ReplayUploader pour le pattern).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId } = await params;
    const body = await req.json().catch(() => ({}));
    const folderParam = body.folderId;
    const folderId: string | null = typeof folderParam === 'string' && folderParam ? folderParam : null;
    const filename = typeof body.filename === 'string' ? body.filename : '';
    const mime = typeof body.mime === 'string' ? body.mime : 'application/octet-stream';
    const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;
    const titleRaw = typeof body.title === 'string' ? body.title : '';
    const sensitive = body.sensitive === true;
    // Pour les sensibles, le client envoie `mime='application/octet-stream'` vers R2
    // (robuste CORS), mais on préserve le vrai mime (originalMime) pour le download
    // et les icônes dans l'explorateur.
    const originalMime = typeof body.originalMime === 'string' && body.originalMime
      ? body.originalMime
      : mime;

    if (!filename) return NextResponse.json({ error: 'filename requis' }, { status: 400 });
    if (sizeBytes <= 0 || sizeBytes > UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES) {
      const mb = Math.round(UPLOAD_LIMITS.STAFF_DOCUMENT_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Taille invalide — max ${mb} MB par fichier` }, { status: 413 });
    }
    // On valide le VRAI mime (originalMime) pour les sensibles, car le `mime` envoyé
    // est 'application/octet-stream' pour contourner CORS sur l'étape PUT vers R2.
    const mimeForValidation = sensitive ? originalMime : mime;
    if (!isAllowedMime(mimeForValidation, 'DOCUMENTS')) {
      return NextResponse.json({ error: 'Type de fichier non supporté' }, { status: 415 });
    }

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Vérifie que le dossier parent existe (si fourni)
    if (folderId) {
      const fSnap = await db.collection('structure_folders').doc(folderId).get();
      if (!fSnap.exists || fSnap.data()?.structureId !== structureId) {
        return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
      }
    }

    // Vérifie le quota total (somme des fichiers ready + ce nouvel upload)
    const currentUsage = await getTotalSize(StorageKeys.structureDocumentsPrefix(structureId));
    if (currentUsage + sizeBytes > UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES) {
      const qmb = Math.round(UPLOAD_LIMITS.STRUCTURE_DOCS_QUOTA_BYTES / (1024 * 1024));
      return NextResponse.json({ error: `Quota dépassé — max ${qmb} MB par structure` }, { status: 413 });
    }

    const safeName = sanitizeFilename(filename);
    const title = (titleRaw || safeName.replace(/\.[^.]+$/, '') || 'Document sans titre').slice(0, 120);

    const ref = db.collection('structure_documents').doc();
    const docId = ref.id;
    // Pour nommer la clé R2, on part du vrai mime (originalMime) — évite qu'un
    // fichier sensible soit stocké avec une extension .bin systématique.
    const ext = extensionForStorage(safeName, mimeForValidation);
    // Clé R2 : structures/{sid}/documents/{docId}.{ext} — simple, unique, prévisible
    const r2Key = `structures/${structureId}/documents/${docId}.${ext}`;

    await ref.set({
      structureId,
      folderId,
      uploadedBy: uid,
      filename: safeName,
      // On stocke le vrai mime (pour les icônes et le Content-Type du download déchiffré).
      mime: mimeForValidation,
      sizeBytes,
      r2Key,
      status: 'pending',
      title,
      notes: null,
      sensitive,
      encrypted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // URL signée 10 min (20 MB peut prendre du temps sur une connexion lente)
    const uploadUrl = await generateUploadUrl(r2Key, mime, 600);

    return NextResponse.json({ documentId: docId, uploadUrl, r2Key });
  } catch (err) {
    captureApiError('API documents POST', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
