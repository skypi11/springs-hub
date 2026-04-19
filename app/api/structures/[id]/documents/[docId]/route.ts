import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, verifyAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { captureApiError } from '@/lib/sentry';
import { limiters, rateLimitKey, checkRateLimit } from '@/lib/rate-limit';
import { resolveUserContext } from '@/lib/event-context';
import { canAccessDocuments } from '@/lib/document-permissions';
import { writeAuditLog } from '@/lib/audit-log';
import { deleteFileSilent, fileExists } from '@/lib/storage';

// PATCH /api/structures/[id]/documents/[docId]
// Corps possibles :
//   - { finalize: true }                   → passe le doc en status=ready après PUT R2
//   - { title, notes, folderId }           → met à jour les métadonnées / déplace
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
    if (blocked) return blocked;

    const { id: structureId, docId } = await params;
    const body = await req.json().catch(() => ({}));

    const db = getAdminDb();
    const resolved = await resolveUserContext(db, uid, structureId);
    if (!resolved) return NextResponse.json({ error: 'Structure introuvable' }, { status: 404 });
    if (!canAccessDocuments(resolved.context)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const ref = db.collection('structure_documents').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'Document introuvable' }, { status: 404 });
    const current = snap.data()!;
    if (current.structureId !== structureId) {
      return NextResponse.json({ error: 'Document hors structure' }, { status: 403 });
    }

    // Mode finalize — vérifie que le fichier est bien présent sur R2
    if (body.finalize === true) {
      if (current.status === 'ready') {
        return NextResponse.json({ ok: true });
      }
      const exists = await fileExists(current.r2Key as string);
      if (!exists) {
        return NextResponse.json({ error: 'Fichier absent sur R2' }, { status: 409 });
      }
      await ref.update({
        status: 'ready',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await writeAuditLog(db, {
        structureId,
        action: 'document_uploaded',
        actorUid: uid,
        targetId: docId,
        metadata: {
          title: current.title,
          folderId: current.folderId,
          sizeBytes: current.sizeBytes,
          filename: current.filename,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // Mode metadata — titre, notes, déplacement
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    const changes: Record<string, unknown> = {};

    if (typeof body.title === 'string') {
      const t = body.title.trim().slice(0, 120);
      if (!t) return NextResponse.json({ error: 'Titre invalide' }, { status: 400 });
      update.title = t;
      changes.title = t;
    }
    if ('notes' in body) {
      const n = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;
      update.notes = n;
      changes.notes = n;
    }
    if ('folderId' in body) {
      const raw = body.folderId;
      const newFolderId: string | null = typeof raw === 'string' && raw ? raw : null;
      if (newFolderId) {
        const fSnap = await db.collection('structure_folders').doc(newFolderId).get();
        if (!fSnap.exists || fSnap.data()?.structureId !== structureId) {
          return NextResponse.json({ error: 'Dossier cible introuvable' }, { status: 404 });
        }
      }
      update.folderId = newFolderId;
      changes.folderId = newFolderId;
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ ok: true });
    }

    await ref.update(update);

    await writeAuditLog(db, {
      structureId,
      action: 'document_updated',
      actorUid: uid,
      targetId: docId,
      metadata: changes,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API document PATCH', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/structures/[id]/documents/[docId]
// Supprime le fichier R2 + le doc Firestore. Accès dirigeant uniquement.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  try {
    const uid = await verifyAuth(req);
    if (!uid) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const blocked = await checkRateLimit(limiters.write, rateLimitKey(req, uid));
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

    await deleteFileSilent(data.r2Key as string);
    await ref.delete();

    await writeAuditLog(db, {
      structureId,
      action: 'document_deleted',
      actorUid: uid,
      targetId: docId,
      metadata: { title: data.title, filename: data.filename, sizeBytes: data.sizeBytes },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureApiError('API document DELETE', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
